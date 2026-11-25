// Validaciones de lo que llega del navegador. Sin dependencias de Cloudflare para poder probarlas solas.

import { pesos } from "./dinero.ts";
import { esDia, sumarDias } from "./fechas.ts";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

const ID_CREDITO = /^[A-Za-z0-9-]{1,12}$/;

/** Número de crédito de la financiera: de 1 a 12 letras, números o guiones. La misma regla al importar y al cobrar. */
export function esIdCredito(valor: string): boolean {
  return ID_CREDITO.test(valor);
}

/** Celular de 10 dígitos sin espacios ni guiones, o null si no lo es. */
export function limpiarCelular(valor: unknown): string | null {
  const digitos = typeof valor === "string" ? valor.replace(/[\s-]/g, "") : "";
  return /^\d{10}$/.test(digitos) ? digitos : null;
}

function idCredito(valor: unknown): string | null {
  const id = typeof valor === "string" ? valor.trim() : "";
  return esIdCredito(id) ? id : null;
}

export interface SolicitudCobro {
  creditoId: string;
  montoCentavos: number;
  /** qr = código en pantalla o en el link de pago; push = solicitud de cobro al celular del acreditado. */
  medio: "qr" | "push";
  telefono: string | null;
}

/**
 * Revisa un cobro antes de pedirlo a pey.
 * @param limites.saldoCentavos Saldo del crédito: no se cobra más de lo que se debe.
 * @param limites.topeCentavos Tope por cobro de la demo pública (0 = sin tope).
 */
export function validarCobro(e: unknown, limites: { saldoCentavos: number; topeCentavos: number }): Resultado<SolicitudCobro> {
  if (!esObjeto(e)) return { ok: false, error: "Faltan los datos del cobro." };
  const creditoId = idCredito(e.creditoId);
  if (!creditoId) return { ok: false, error: "Falta el número de crédito." };
  if (e.medio !== "qr" && e.medio !== "push") return { ok: false, error: "Elige cobrar con QR o con cobro al celular." };

  const monto = e.montoCentavos;
  if (typeof monto !== "number" || !Number.isInteger(monto) || monto <= 0) {
    return { ok: false, error: "El monto debe ser mayor que cero." };
  }
  if (monto > limites.saldoCentavos) {
    return { ok: false, error: `El monto es mayor que el saldo del crédito (${pesos(limites.saldoCentavos)}).` };
  }
  if (limites.topeCentavos > 0 && monto > limites.topeCentavos) {
    return { ok: false, error: `En la demo pública cada cobro real tiene un tope de ${pesos(limites.topeCentavos)}.` };
  }

  let telefono: string | null = null;
  if (e.medio === "push") {
    telefono = limpiarCelular(e.telefono);
    if (telefono === null) return { ok: false, error: "El celular debe tener 10 dígitos." };
  }
  return { ok: true, valor: { creditoId, montoCentavos: monto, medio: e.medio, telefono } };
}

export const RESULTADOS_GESTION = ["pago", "promesa", "no-localizado", "sin-dinero", "otro"] as const;
export type ResultadoGestion = (typeof RESULTADOS_GESTION)[number];

export interface SolicitudGestion {
  creditoId: string;
  resultado: ResultadoGestion;
  nota: string | null;
  promesaFecha: string | null;
  promesaCentavos: number | null;
  latitud: number | null;
  longitud: number | null;
}

const NOTA_MAXIMA = 280;
const PROMESA_DIAS_MAXIMO = 60;

/** Revisa el registro de una visita. `hoy` es el día en la Ciudad de México (AAAA-MM-DD). */
export function validarGestion(e: unknown, hoy: string): Resultado<SolicitudGestion> {
  if (!esObjeto(e)) return { ok: false, error: "Faltan los datos de la visita." };
  const creditoId = idCredito(e.creditoId);
  if (!creditoId) return { ok: false, error: "Falta el número de crédito." };
  const resultado = e.resultado as ResultadoGestion;
  if (!RESULTADOS_GESTION.includes(resultado)) return { ok: false, error: "Elige el resultado de la visita." };

  const nota = typeof e.nota === "string" ? e.nota.trim() : "";
  if (nota.length > NOTA_MAXIMA) return { ok: false, error: `La nota admite hasta ${NOTA_MAXIMA} caracteres.` };
  if (resultado === "otro" && nota === "") return { ok: false, error: "Escribe una nota que explique el resultado." };

  let promesaFecha: string | null = null;
  let promesaCentavos: number | null = null;
  if (resultado === "promesa") {
    if (!esDia(e.promesaFecha) || e.promesaFecha < hoy || e.promesaFecha > sumarDias(hoy, PROMESA_DIAS_MAXIMO)) {
      return { ok: false, error: `La promesa de pago debe tener una fecha de hoy a ${PROMESA_DIAS_MAXIMO} días.` };
    }
    if (typeof e.promesaCentavos !== "number" || !Number.isInteger(e.promesaCentavos) || e.promesaCentavos <= 0) {
      return { ok: false, error: "La promesa de pago necesita un monto mayor que cero." };
    }
    promesaFecha = e.promesaFecha;
    promesaCentavos = e.promesaCentavos;
  }

  // La ubicación solo se guarda completa y dentro de rango.
  const enRango = (valor: unknown, limite: number): valor is number => typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;
  const ubicada = enRango(e.latitud, 90) && enRango(e.longitud, 180);

  return {
    ok: true,
    valor: {
      creditoId,
      resultado,
      nota: nota === "" ? null : nota,
      promesaFecha,
      promesaCentavos,
      latitud: ubicada ? (e.latitud as number) : null,
      longitud: ubicada ? (e.longitud as number) : null,
    },
  };
}

/** Muestra una clave de rastreo sin exponerla completa: "MBAN01…2345". */
export function enmascararRastreo(clave: string | null): string | null {
  if (clave === null) return null;
  if (clave.length < 8) return "•".repeat(clave.length);
  const inicio = clave.length >= 14 ? 6 : 4;
  return `${clave.slice(0, inicio)}…${clave.slice(-4)}`;
}

/** Muestra solo los últimos 4 dígitos de un celular. */
export function enmascararTelefono(telefono: string | null): string | null {
  return telefono === null ? null : `••• ••• ${telefono.slice(-4)}`;
}

/** Página pedida en una consulta (?pagina=N). Cualquier valor raro regresa la primera. */
export function paginaPedida(valor: unknown): number {
  const texto = String(valor ?? "");
  if (!/^\d{1,4}$/.test(texto)) return 1;
  return Math.max(1, Number(texto));
}

export function totalPaginas(total: number, tamano: number): number {
  return Math.max(1, Math.ceil(total / tamano));
}
