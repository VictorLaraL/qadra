// Tableros: la ruta del día del gestor y, para el portal, el resumen, la cartera, la conciliación y el corte.

import { compararConPey, type Cuadre } from "../core/conciliacion.ts";
import { inicioDelDiaCdmx, relojCdmx } from "../core/fechas.ts";
import { enmascararRastreo, totalPaginas } from "../core/validaciones.ts";
import { agruparAplicaciones, pagoVisible, type CuotasPorPago, type FilaAplicacion, type FilaPago } from "./consultas.ts";
import { creditosConEstado, gestores, type CreditoConEstado } from "./db.ts";
import type { Rol } from "./entorno.ts";
import { listarTransacciones } from "./pey.ts";

// ---------------------------------------------------------------------------------------------------------------
// Actividad del día
// ---------------------------------------------------------------------------------------------------------------

interface UltimaVisita {
  resultado: string;
  nota: string | null;
  promesaFecha: string | null;
  promesaCentavos: number | null;
  creadoEn: string;
}

interface ActividadDeHoy {
  cobrado: Map<string, { centavos: number; pagos: number }>;
  ultimaVisita: Map<string, UltimaVisita>;
  promesas: number;
}

/** Lo cobrado y la última visita de cada crédito desde que empezó el día en la Ciudad de México. */
async function actividadDeHoy(db: D1Database, ahora: Date): Promise<ActividadDeHoy> {
  const desde = inicioDelDiaCdmx(ahora);
  const [pagos, visitas] = (await db.batch([
    db
      .prepare(
        `SELECT credito_id, COALESCE(SUM(aplicado_centavos), 0) AS centavos, COUNT(*) AS pagos
         FROM pagos WHERE fecha_pago >= ? AND credito_id IS NOT NULL GROUP BY credito_id`,
      )
      .bind(desde),
    db.prepare("SELECT credito_id, resultado, nota, promesa_fecha, promesa_centavos, creado_en FROM gestiones WHERE creado_en >= ? ORDER BY creado_en").bind(desde),
  ])) as [
    D1Result<{ credito_id: string; centavos: number; pagos: number }>,
    D1Result<{ credito_id: string; resultado: string; nota: string | null; promesa_fecha: string | null; promesa_centavos: number | null; creado_en: string }>,
  ];

  const actividad: ActividadDeHoy = { cobrado: new Map(), ultimaVisita: new Map(), promesas: 0 };
  for (const p of pagos.results) actividad.cobrado.set(p.credito_id, { centavos: p.centavos, pagos: p.pagos });
  for (const v of visitas.results) {
    if (v.resultado === "promesa") actividad.promesas++;
    // Vienen en orden de tiempo: la última de cada crédito es la que queda.
    actividad.ultimaVisita.set(v.credito_id, {
      resultado: v.resultado,
      nota: v.nota,
      promesaFecha: v.promesa_fecha,
      promesaCentavos: v.promesa_centavos,
      creadoEn: v.creado_en,
    });
  }
  return actividad;
}

export type EstadoVisita = "pendiente" | "cobrado" | "promesa" | "no-localizado" | "sin-dinero" | "otro";

/** Un crédito está en la ruta de hoy si tiene algo exigible o si hoy ya se le cobró o se le visitó. */
function enRutaDeHoy(c: CreditoConEstado, actividad: ActividadDeHoy): boolean {
  return c.estado.exigibleCentavos > 0 || actividad.cobrado.has(c.id) || actividad.ultimaVisita.has(c.id);
}

function estadoDeVisita(creditoId: string, actividad: ActividadDeHoy): EstadoVisita {
  if (actividad.cobrado.has(creditoId)) return "cobrado";
  const resultado = actividad.ultimaVisita.get(creditoId)?.resultado;
  if (resultado === "pago") return "cobrado";
  return resultado === "promesa" || resultado === "no-localizado" || resultado === "sin-dinero" || resultado === "otro" ? resultado : "pendiente";
}

// ---------------------------------------------------------------------------------------------------------------
// App del gestor: ruta del día
// ---------------------------------------------------------------------------------------------------------------

/** Ruta del día de un gestor: primero lo que falta por visitar, en el orden de su ruta. null si el gestor no existe. */
export async function rutaDelGestor(db: D1Database, hoy: string, gestorId: string, ahora = new Date()) {
  const gestor = (await gestores(db)).find((g) => g.id === gestorId);
  if (!gestor) return null;
  const [creditos, actividad] = await Promise.all([creditosConEstado(db, hoy, gestorId), actividadDeHoy(db, ahora)]);

  const visitas = creditos
    .filter((c) => enRutaDeHoy(c, actividad))
    .map((c) => ({
      creditoId: c.id,
      acreditado: c.acreditado,
      producto: c.producto,
      grupo: c.grupo,
      colonia: c.colonia,
      domicilio: c.domicilio,
      orden: c.orden,
      demo: c.demo === 1,
      estado: c.estado,
      visita: estadoDeVisita(c.id, actividad),
      cobradoHoyCentavos: actividad.cobrado.get(c.id)?.centavos ?? 0,
      ultimaVisita: actividad.ultimaVisita.get(c.id) ?? null,
    }))
    .sort((a, b) => Number(a.visita !== "pendiente") - Number(b.visita !== "pendiente") || a.orden - b.orden);

  const pendientes = visitas.filter((v) => v.visita === "pendiente");
  return {
    gestor,
    resumen: {
      total: visitas.length,
      hechas: visitas.length - pendientes.length,
      cobradoCentavos: visitas.reduce((suma, v) => suma + v.cobradoHoyCentavos, 0),
      porCobrarCentavos: pendientes.reduce((suma, v) => suma + v.estado.exigibleCentavos, 0),
    },
    visitas,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Portal: resumen, cartera, conciliación y corte
// ---------------------------------------------------------------------------------------------------------------

const PAGOS_POR_PAGINA = 10;
const CREDITOS_POR_PAGINA = 10;

/** Cuotas de una lista de pagos (los pagos de una página), con una sola consulta. */
async function cuotasDePagos(db: D1Database, pagos: FilaPago[]): Promise<CuotasPorPago> {
  if (pagos.length === 0) return new Map();
  const marcas = pagos.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT transaction_id, cuota_numero, monto_centavos, liquida FROM aplicaciones WHERE transaction_id IN (${marcas})`)
    .bind(...pagos.map((p) => p.transaction_id))
    .all<FilaAplicacion>();
  return agruparAplicaciones(results);
}

type FilaPagoConNombre = FilaPago & { acreditado: string | null };

export async function resumenDelPortal(db: D1Database, hoy: string, rol: Rol, ahora = new Date()) {
  const desde = inicioDelDiaCdmx(ahora);
  const [creditos, actividad, listaGestores, consultas] = await Promise.all([
    creditosConEstado(db, hoy),
    actividadDeHoy(db, ahora),
    gestores(db),
    db.batch([
      db
        .prepare(
          `SELECT COUNT(*) AS pagos,
                  COALESCE(SUM(monto_centavos), 0) AS recibido,
                  COALESCE(SUM(aplicado_centavos), 0) AS aplicado,
                  COALESCE(SUM(CASE WHEN estado = 'excepcion' THEN 1 ELSE 0 END), 0) AS excepciones,
                  COALESCE(SUM(CASE WHEN medio = 'qr' THEN monto_centavos ELSE 0 END), 0) AS qr,
                  COALESCE(SUM(CASE WHEN medio = 'pn' THEN monto_centavos ELSE 0 END), 0) AS pn,
                  COALESCE(SUM(CASE WHEN estado = 'aplicado' AND resuelto_en IS NULL AND recuperado = 0 THEN 1 ELSE 0 END), 0) AS solos,
                  COALESCE(SUM(CASE WHEN origen = 'ejemplo' THEN 1 ELSE 0 END), 0) AS ejemplos
           FROM pagos WHERE fecha_pago >= ?`,
        )
        .bind(desde),
      db
        .prepare("SELECT gestor_id, COUNT(*) AS pagos, COALESCE(SUM(aplicado_centavos), 0) AS centavos FROM pagos WHERE fecha_pago >= ? GROUP BY gestor_id")
        .bind(desde),
      db.prepare("SELECT dia, cobrado_centavos, pagos FROM historico ORDER BY dia"),
      db
        .prepare(
          `SELECT p.*, c.acreditado FROM pagos p LEFT JOIN creditos c ON c.id = p.credito_id
           WHERE p.fecha_pago >= ? ORDER BY p.fecha_pago DESC, p.recibido_en DESC LIMIT 8`,
        )
        .bind(desde),
      db.prepare("SELECT COUNT(*) AS n FROM recibidos WHERE origen = 'codi'"),
    ]),
  ]);
  const [totales, porGestor, historico, ultimos, reales] = consultas as [
    D1Result<{ pagos: number; recibido: number; aplicado: number; excepciones: number; qr: number; pn: number; solos: number; ejemplos: number }>,
    D1Result<{ gestor_id: string | null; pagos: number; centavos: number }>,
    D1Result<{ dia: string; cobrado_centavos: number; pagos: number }>,
    D1Result<FilaPagoConNombre>,
    D1Result<{ n: number }>,
  ];
  const t = totales.results[0];
  const cuotas = await cuotasDePagos(db, ultimos.results);
  const enRuta = creditos.filter((c) => enRutaDeHoy(c, actividad));
  const hecha = (c: CreditoConEstado) => estadoDeVisita(c.id, actividad) !== "pendiente";
  const cuenta = (situacion: string) => creditos.filter((c) => c.estado.situacion === situacion).length;

  return {
    hoy: {
      cobradoCentavos: t.aplicado,
      recibidoCentavos: t.recibido,
      pagos: t.pagos,
      excepciones: t.excepciones,
      porMedio: { qrCentavos: t.qr, pushCentavos: t.pn },
      /** Porcentaje de pagos de hoy que se aplicaron sin que nadie interviniera. */
      conciliadosSolos: t.pagos === 0 ? null : Math.round((t.solos / t.pagos) * 100),
      deEjemplo: t.ejemplos,
    },
    cartera: {
      creditos: creditos.length,
      saldoCentavos: creditos.reduce((suma, c) => suma + c.estado.saldoCentavos, 0),
      exigibleCentavos: creditos.reduce((suma, c) => suma + c.estado.exigibleCentavos, 0),
      atrasados: cuenta("atrasado"),
      venceHoy: cuenta("vence-hoy"),
      alCorriente: cuenta("al-corriente"),
      liquidados: cuenta("liquidado"),
    },
    visitas: { enRuta: enRuta.length, hechas: enRuta.filter(hecha).length, promesas: actividad.promesas },
    semana: [
      ...historico.results.map((h) => ({ dia: h.dia, cobradoCentavos: h.cobrado_centavos, pagos: h.pagos })),
      { dia: hoy, cobradoCentavos: t.aplicado, pagos: t.pagos },
    ],
    gestores: listaGestores.map((g) => {
      const suyos = enRuta.filter((c) => c.gestor_id === g.id);
      const cobrado = porGestor.results.find((p) => p.gestor_id === g.id);
      return {
        id: g.id,
        nombre: g.nombre,
        zona: g.zona,
        enRuta: suyos.length,
        hechas: suyos.filter(hecha).length,
        cobradoCentavos: cobrado?.centavos ?? 0,
        pagos: cobrado?.pagos ?? 0,
      };
    }),
    ultimosPagos: ultimos.results.map((p) => pagoVisible(p, cuotas, rol, { acreditado: p.acreditado })),
    /** Pagos CoDi reales (no simulados ni de ejemplo) conciliados desde que se publicó la demo. */
    pagosReales: reales.results[0].n,
  };
}

const sinAcentos = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const ORDEN_SITUACION: Record<string, number> = { atrasado: 0, "vence-hoy": 1, "al-corriente": 2, liquidado: 3 };

export async function carteraDelPortal(db: D1Database, hoy: string, filtros: { buscar: string; situacion: string; pagina: number }) {
  const [creditos, listaGestores] = await Promise.all([creditosConEstado(db, hoy), gestores(db)]);
  const nombreGestor = new Map(listaGestores.map((g) => [g.id, g.nombre]));
  const buscado = sinAcentos(filtros.buscar.trim());

  const filtrados = creditos
    .filter((c) => !filtros.situacion || c.estado.situacion === filtros.situacion)
    .filter((c) => !buscado || [c.id, c.acreditado, c.grupo ?? "", c.colonia].some((campo) => sinAcentos(campo).includes(buscado)))
    .sort(
      (a, b) =>
        ORDEN_SITUACION[a.estado.situacion] - ORDEN_SITUACION[b.estado.situacion] ||
        b.estado.diasAtraso - a.estado.diasAtraso ||
        a.id.localeCompare(b.id),
    );

  const paginas = totalPaginas(filtrados.length, CREDITOS_POR_PAGINA);
  const pagina = Math.min(filtros.pagina, paginas);
  return {
    total: filtrados.length,
    pagina,
    paginas,
    totales: {
      saldoCentavos: filtrados.reduce((suma, c) => suma + c.estado.saldoCentavos, 0),
      exigibleCentavos: filtrados.reduce((suma, c) => suma + c.estado.exigibleCentavos, 0),
    },
    creditos: filtrados.slice((pagina - 1) * CREDITOS_POR_PAGINA, pagina * CREDITOS_POR_PAGINA).map((c) => ({
      id: c.id,
      acreditado: c.acreditado,
      producto: c.producto,
      grupo: c.grupo,
      colonia: c.colonia,
      gestorId: c.gestor_id,
      gestor: c.gestor_id ? (nombreGestor.get(c.gestor_id) ?? null) : null,
      demo: c.demo === 1,
      estado: c.estado,
    })),
  };
}

/** Pagos de hoy, más las excepciones de días anteriores que sigan sin resolver, del más reciente al más antiguo. */
export async function conciliacionDelDia(db: D1Database, rol: Rol, filtros: { estado: string; pagina: number }, ahora = new Date()) {
  const desde = inicioDelDiaCdmx(ahora);
  const estado = filtros.estado === "aplicado" || filtros.estado === "excepcion" ? filtros.estado : null;
  const donde = "(p.fecha_pago >= ?1 OR p.estado = 'excepcion') AND (?2 IS NULL OR p.estado = ?2)";
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM pagos p WHERE ${donde}`).bind(desde, estado).first<{ n: number }>())?.n ?? 0;
  const paginas = totalPaginas(total, PAGOS_POR_PAGINA);
  const pagina = Math.min(filtros.pagina, paginas);
  const { results } = await db
    .prepare(
      `SELECT p.*, c.acreditado FROM pagos p LEFT JOIN creditos c ON c.id = p.credito_id
       WHERE ${donde} ORDER BY p.fecha_pago DESC, p.recibido_en DESC LIMIT ?3 OFFSET ?4`,
    )
    .bind(desde, estado, PAGOS_POR_PAGINA, (pagina - 1) * PAGOS_POR_PAGINA)
    .all<FilaPagoConNombre>();
  const cuotas = await cuotasDePagos(db, results);
  return { total, pagina, paginas, pagos: results.map((p) => pagoVisible(p, cuotas, rol, { acreditado: p.acreditado })) };
}

export interface Corte {
  dia: string;
  pagos: number;
  recibidoCentavos: number;
  aplicadoCentavos: number;
  /** Dinero recibido que todavía no está aplicado a un crédito (excepciones). */
  porRevisarCentavos: number;
  excepciones: number;
  /** Comparación contra lo que reporta pey. Solo se calcula cuando se pide. */
  pey?: Cuadre & { completo: boolean; simulado: boolean };
}

/**
 * Corte del día. Por dentro, lo recibido siempre es lo aplicado más lo que está por revisar. Con `conPey`, además se
 * compara contra las transacciones que pey reporta: si pey cobró algo que Qadra no registró, el aviso se perdió y el
 * pago se puede recuperar.
 */
export async function corteDelDia(env: Env, hoy: string, opciones: { conPey: boolean; simulado: boolean }, ahora = new Date()): Promise<Corte> {
  const desde = inicioDelDiaCdmx(ahora);
  const [totales, propios] = (await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS pagos, COALESCE(SUM(monto_centavos), 0) AS recibido, COALESCE(SUM(aplicado_centavos), 0) AS aplicado,
              COALESCE(SUM(CASE WHEN estado = 'excepcion' THEN 1 ELSE 0 END), 0) AS excepciones
       FROM pagos WHERE fecha_pago >= ?`,
    ).bind(desde),
    // Los pagos de ejemplo no pasan por pey: no entran en la comparación.
    env.DB.prepare("SELECT transaction_id, monto_centavos FROM pagos WHERE fecha_pago >= ? AND origen <> 'ejemplo'").bind(desde),
  ])) as [
    D1Result<{ pagos: number; recibido: number; aplicado: number; excepciones: number }>,
    D1Result<{ transaction_id: string; monto_centavos: number }>,
  ];

  const t = totales.results[0];
  const corte: Corte = {
    dia: hoy,
    pagos: t.pagos,
    recibidoCentavos: t.recibido,
    aplicadoCentavos: t.aplicado,
    porRevisarCentavos: t.recibido - t.aplicado,
    excepciones: t.excepciones,
  };
  if (opciones.conPey) {
    const { transacciones, completo } = await listarTransacciones(env, Math.floor(Date.parse(desde) / 1000));
    const cuadre = compararConPey(
      propios.results.map((p) => ({ transactionId: p.transaction_id, montoCentavos: p.monto_centavos })),
      transacciones.map((p) => ({ transactionId: p.transactionId, montoCentavos: p.montoCentavos })),
    );
    corte.pey = { ...cuadre, completo, simulado: opciones.simulado };
  }
  return corte;
}

export const COLUMNAS_DE_PAGOS = [
  "fecha",
  "hora",
  "id_credito",
  "acreditado",
  "cuota",
  "monto_aplicado",
  "monto_pago",
  "medio",
  "folio",
  "clave_rastreo",
  "banco",
  "transaccion",
  "estado",
  "origen",
];

/** Pagos de hoy para el sistema de la financiera: un renglón por cada cuota que recibió dinero. */
export async function pagosParaExportar(db: D1Database, rol: Rol, ahora = new Date()): Promise<Array<Array<string | number | null>>> {
  const { results } = await db
    .prepare(
      `SELECT p.*, c.acreditado, a.cuota_numero, a.monto_centavos AS aplicado_a_cuota
       FROM pagos p LEFT JOIN aplicaciones a ON a.transaction_id = p.transaction_id LEFT JOIN creditos c ON c.id = p.credito_id
       WHERE p.fecha_pago >= ? ORDER BY p.fecha_pago, p.transaction_id, a.cuota_numero`,
    )
    .bind(inicioDelDiaCdmx(ahora))
    .all<FilaPagoConNombre & { cuota_numero: number | null; aplicado_a_cuota: number | null }>();
  const decimal = (centavos: number | null) => (centavos === null ? null : (centavos / 100).toFixed(2));
  return results.map((p) => {
    const local = relojCdmx(p.fecha_pago);
    return [
      local.dia,
      local.hora,
      p.credito_id,
      p.acreditado,
      p.cuota_numero,
      decimal(p.aplicado_a_cuota),
      decimal(p.monto_centavos),
      p.medio === "pn" ? "CoDi push" : "CoDi QR",
      p.num_ref,
      rol === "admin" ? p.clave_rastreo : enmascararRastreo(p.clave_rastreo),
      p.banco,
      p.transaction_id,
      p.estado,
      p.origen,
    ];
  });
}
