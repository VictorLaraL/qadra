// Cartera por archivo: la financiera que no tiene un sistema con API sube sus créditos en CSV (lo que exporta Excel)
// y descarga los pagos aplicados en el mismo formato.

import type { Cuota } from "./conciliacion.ts";
import { aCentavos } from "./dinero.ts";
import { esDia, sumarDias, sumarMeses } from "./fechas.ts";
import { esIdCredito, limpiarCelular } from "./validaciones.ts";

export const FRECUENCIAS = ["semanal", "quincenal", "mensual"] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

export interface CreditoImportado {
  id: string;
  acreditado: string;
  telefono: string | null;
  producto: string;
  grupo: string | null;
  colonia: string;
  domicilio: string | null;
  gestor: string;
  montoCuotaCentavos: number;
  cuotasTotales: number;
  cuotasPagadas: number;
  frecuencia: Frecuencia;
  /** Día en que vence la siguiente cuota por pagar, AAAA-MM-DD. */
  proximoVencimiento: string;
}

export interface ErrorCartera {
  /** Renglón del archivo, contando el encabezado como 1. 0 = error del archivo completo. */
  fila: number;
  columna: string;
  mensaje: string;
}

export interface ResultadoCartera {
  ok: boolean;
  columnasFaltantes: string[];
  errores: ErrorCartera[];
  /** Solo los renglones válidos. */
  creditos: CreditoImportado[];
  resumen: { filas: number; validas: number; conErrores: number; gestores: string[]; saldoCentavos: number };
}

export const COLUMNAS_OBLIGATORIAS = [
  "id_credito",
  "acreditado",
  "producto",
  "colonia",
  "gestor",
  "monto_cuota",
  "cuotas_totales",
  "cuotas_pagadas",
  "frecuencia",
  "proximo_vencimiento",
] as const;

export const MAXIMO_CREDITOS = 500;

/** Marca de orden de bytes (U+FEFF). Excel la necesita al inicio de un CSV para leer bien los acentos. */
export const BOM = String.fromCharCode(0xfeff);

/** Archivo de ejemplo que se puede descargar, llenar en Excel y volver a subir. */
export const PLANTILLA_CARTERA =
  "id_credito,acreditado,telefono,producto,grupo,colonia,domicilio,gestor,monto_cuota,cuotas_totales,cuotas_pagadas,frecuencia,proximo_vencimiento\r\n" +
  "A-1001,Rosa M.,,Grupal semanal,Las Flores,Chuburná,Calle 21 #104,Mariana R.,450.00,16,7,semanal,2026-12-02\r\n" +
  "A-1002,Luis H.,,Individual quincenal,,Centro,Calle 60 #489,Diego T.,1250.50,12,3,quincenal,2026-12-05\r\n";

export interface FilaCsv {
  /** Renglón del archivo donde empieza la fila (el primero es el 1), contando renglones vacíos y saltos dentro de comillas. */
  renglon: number;
  celdas: string[];
}

/**
 * Lee un CSV respetando comillas y conserva el renglón del archivo de cada fila, para que un error se pueda ubicar
 * en Excel. Detecta el separador por el encabezado: coma, punto y coma (el que usa Excel en español) o tabulador.
 * Omite los renglones vacíos.
 */
export function leerCsvConRenglones(texto: string): FilaCsv[] {
  const limpio = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const encabezado = limpio.split(/\r?\n/, 1)[0] ?? "";
  const cuenta = (s: string) => encabezado.split(s).length;
  const separador = cuenta(";") > cuenta(",") && cuenta(";") >= cuenta("\t") ? ";" : cuenta("\t") > cuenta(",") ? "\t" : ",";

  const filas: FilaCsv[] = [];
  let celdas: string[] = [];
  let campo = "";
  let entreComillas = false;
  let renglon = 1;
  let renglonDeLaFila = 1;
  const cerrarFila = () => {
    celdas.push(campo);
    campo = "";
    if (celdas.some((c) => c.trim() !== "")) filas.push({ renglon: renglonDeLaFila, celdas });
    celdas = [];
  };

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === "\n") renglon++;
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"' && campo === "") entreComillas = true;
    else if (c === separador) {
      celdas.push(campo);
      campo = "";
    } else if (c === "\n") {
      cerrarFila();
      renglonDeLaFila = renglon;
    } else if (c !== "\r") campo += c;
  }
  if (campo !== "" || celdas.length > 0) cerrarFila();
  return filas;
}

/** Lee un CSV y regresa solo sus celdas. */
export function leerCsv(texto: string): string[][] {
  return leerCsvConRenglones(texto).map((f) => f.celdas);
}

/** "Próximo Vencimiento" -> "proximo_vencimiento". */
function nombreColumna(encabezado: string): string {
  return encabezado
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Acepta AAAA-MM-DD y DD/MM/AAAA (como escribe Excel en México). */
function aDia(valor: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor);
  const dia = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : valor;
  return esDia(dia) ? dia : null;
}

function enteroEnRango(valor: string, minimo: number, maximo: number): number | null {
  if (!/^\d{1,4}$/.test(valor)) return null;
  const n = Number(valor);
  return n >= minimo && n <= maximo ? n : null;
}

/**
 * Revisa el archivo de cartera. Regresa los créditos válidos y, por cada problema, el renglón, la columna y qué se
 * esperaba, para corregirlo en Excel sin adivinar.
 */
export function validarCartera(texto: string, hoy: string): ResultadoCartera {
  const resultado: ResultadoCartera = {
    ok: false,
    columnasFaltantes: [],
    errores: [],
    creditos: [],
    resumen: { filas: 0, validas: 0, conErrores: 0, gestores: [], saldoCentavos: 0 },
  };
  const errorDeArchivo = (mensaje: string) => {
    resultado.errores.push({ fila: 0, columna: "", mensaje });
    return resultado;
  };

  const filas = leerCsvConRenglones(texto);
  if (filas.length === 0) return errorDeArchivo("El archivo está vacío.");

  const columnas = filas[0].celdas.map(nombreColumna);
  resultado.columnasFaltantes = COLUMNAS_OBLIGATORIAS.filter((c) => !columnas.includes(c));
  if (resultado.columnasFaltantes.length > 0) {
    return errorDeArchivo(`Faltan columnas obligatorias: ${resultado.columnasFaltantes.join(", ")}.`);
  }
  const datos = filas.slice(1);
  if (datos.length === 0) return errorDeArchivo("El archivo no tiene créditos: solo trae el encabezado.");
  if (datos.length > MAXIMO_CREDITOS) {
    return errorDeArchivo(`El archivo trae ${datos.length} créditos y el máximo por carga es ${MAXIMO_CREDITOS}.`);
  }

  const vistos = new Set<string>();
  const gestores = new Set<string>();
  resultado.resumen.filas = datos.length;

  datos.forEach(({ renglon: fila, celdas }) => {
    const valor = (columna: string) => (celdas[columnas.indexOf(columna)] ?? "").trim();
    const errores: ErrorCartera[] = [];
    const error = (columna: string, mensaje: string) => errores.push({ fila, columna, mensaje });
    const textoEntre = (columna: string, minimo: number, maximo: number, obligatorio = true): string | null => {
      const v = valor(columna);
      if (v === "" && !obligatorio) return null;
      if (v.length < minimo || v.length > maximo) {
        error(columna, v === "" ? "Falta este dato." : `Debe tener de ${minimo} a ${maximo} caracteres.`);
        return null;
      }
      return v;
    };

    const id = valor("id_credito");
    if (!esIdCredito(id)) {
      error("id_credito", id === "" ? "Falta el número de crédito." : "Usa de 1 a 12 letras, números o guiones.");
    } else if (vistos.has(id.toUpperCase())) error("id_credito", `El crédito ${id} está repetido en el archivo.`);
    else vistos.add(id.toUpperCase());

    const acreditado = textoEntre("acreditado", 2, 60);

    // Vacío, o solo guiones y espacios (como se marca "sin celular" en Excel), es un crédito sin celular.
    const sinTelefono = valor("telefono").replace(/[\s-]/g, "") === "";
    const telefono = sinTelefono ? null : limpiarCelular(valor("telefono"));
    if (!sinTelefono && telefono === null) error("telefono", "El celular debe tener 10 dígitos, o dejarse vacío.");

    const producto = textoEntre("producto", 1, 40);
    const grupo = textoEntre("grupo", 1, 40, false);
    const colonia = textoEntre("colonia", 1, 60);
    const domicilio = textoEntre("domicilio", 1, 120, false);
    const gestor = textoEntre("gestor", 2, 40);

    const montoCuotaCentavos = aCentavos(valor("monto_cuota"));
    if (montoCuotaCentavos === null || montoCuotaCentavos === 0) error("monto_cuota", "Escribe un monto mayor que cero, por ejemplo 450.00.");

    const cuotasTotales = enteroEnRango(valor("cuotas_totales"), 1, 520);
    if (cuotasTotales === null) error("cuotas_totales", "Debe ser un número entero de 1 a 520.");
    const cuotasPagadas = enteroEnRango(valor("cuotas_pagadas"), 0, 520);
    if (cuotasPagadas === null) error("cuotas_pagadas", "Debe ser un número entero, 0 si aún no paga ninguna.");
    else if (cuotasTotales !== null && cuotasPagadas > cuotasTotales) error("cuotas_pagadas", "No puede ser mayor que las cuotas totales.");

    const frecuencia = valor("frecuencia").toLowerCase() as Frecuencia;
    if (!FRECUENCIAS.includes(frecuencia)) error("frecuencia", `Usa una de: ${FRECUENCIAS.join(", ")}.`);

    const proximoVencimiento = aDia(valor("proximo_vencimiento"));
    if (proximoVencimiento === null) error("proximo_vencimiento", "Escribe una fecha real como 2026-12-02 o 02/12/2026.");
    else if (proximoVencimiento < sumarDias(hoy, -1825) || proximoVencimiento > sumarDias(hoy, 1825)) {
      error("proximo_vencimiento", "La fecha está a más de 5 años de hoy.");
    }

    if (errores.length > 0) {
      resultado.errores.push(...errores);
      resultado.resumen.conErrores++;
      return;
    }
    const credito: CreditoImportado = {
      id,
      acreditado: acreditado as string,
      telefono,
      producto: producto as string,
      grupo,
      colonia: colonia as string,
      domicilio,
      gestor: gestor as string,
      montoCuotaCentavos: montoCuotaCentavos as number,
      cuotasTotales: cuotasTotales as number,
      cuotasPagadas: cuotasPagadas as number,
      frecuencia,
      proximoVencimiento: proximoVencimiento as string,
    };
    resultado.creditos.push(credito);
    gestores.add(credito.gestor);
    resultado.resumen.validas++;
    resultado.resumen.saldoCentavos += (credito.cuotasTotales - credito.cuotasPagadas) * credito.montoCuotaCentavos;
  });

  resultado.resumen.gestores = [...gestores].sort();
  resultado.ok = resultado.errores.length === 0;
  return resultado;
}

/**
 * Arma el calendario de un crédito importado: las cuotas ya pagadas quedan hacia atrás, la siguiente vence en
 * `proximoVencimiento` y las demás siguen según la frecuencia.
 */
export function generarCuotas(credito: CreditoImportado): Cuota[] {
  const mover = (pasos: number): string => {
    if (credito.frecuencia === "mensual") return sumarMeses(credito.proximoVencimiento, pasos);
    return sumarDias(credito.proximoVencimiento, pasos * (credito.frecuencia === "semanal" ? 7 : 15));
  };
  return Array.from({ length: credito.cuotasTotales }, (_, i) => {
    const numero = i + 1;
    return {
      numero,
      vence: mover(numero - (credito.cuotasPagadas + 1)),
      montoCentavos: credito.montoCuotaCentavos,
      pagadoCentavos: numero <= credito.cuotasPagadas ? credito.montoCuotaCentavos : 0,
    };
  });
}

/**
 * CSV para abrir en Excel: con BOM (acentos), saltos de línea de Windows y comillas donde hacen falta.
 * Un texto que empieza con =, +, - o @ lleva un apóstrofo delante para que Excel no lo ejecute como fórmula.
 */
export function aCsv(encabezados: string[], filas: Array<Array<string | number | null>>): string {
  const celda = (valor: string | number | null): string => {
    if (valor === null) return "";
    if (typeof valor === "number") return String(valor);
    const seguro = /^[=+\-@]/.test(valor) ? `'${valor}` : valor;
    return /[",\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
  };
  return BOM + [encabezados, ...filas].map((fila) => fila.map(celda).join(",") + "\r\n").join("");
}
