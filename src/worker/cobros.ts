// Cobros CoDi: el QR con vigencia o el cobro al celular que el gestor crea para un crédito, y el QR fijo de un crédito.
// Cada cobro lleva un folio de 7 dígitos que viaja a Banxico como `numRef` y regresa en el aviso de pago.

import { pesos } from "../core/dinero.ts";
import { generarFolio, generarId, generarToken } from "../core/tokens.ts";
import { enmascararRastreo, type SolicitudCobro } from "../core/validaciones.ts";
import type { FilaCobro } from "./conciliar.ts";
import { crearQr, enviarPush } from "./pey.ts";

/** Vigencia de un cobro, en segundos. pey exige al menos 360. */
export const VIGENCIA_SEG = 600;
// Un QR pendiente se reutiliza si todavía le queda al menos este tiempo: no se pide otro a pey por el mismo cobro.
const MARGEN_REUSO_MS = 120_000;

export function cobroPorId(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM cobros WHERE id = ?").bind(id).first<FilaCobro>();
}

export function cobroPorToken(db: D1Database, token: string) {
  return db.prepare("SELECT * FROM cobros WHERE token = ?").bind(token).first<FilaCobro>();
}

/** Estado de un cobro para mostrar: un cobro pendiente cuya vigencia ya pasó se muestra vencido. */
export function estadoDelCobro(cobro: FilaCobro, ahora = new Date()): "pendiente" | "pagado" | "vencido" {
  if (cobro.estado === "pagado") return "pagado";
  return cobro.vence_en <= ahora.toISOString() ? "vencido" : "pendiente";
}

/** Cobro tal como lo ve el personal de la financiera. */
export function cobroVisible(cobro: FilaCobro, ahora = new Date()) {
  return {
    id: cobro.id,
    folio: cobro.folio,
    token: cobro.token,
    creditoId: cobro.credito_id,
    montoCentavos: cobro.monto_centavos,
    medio: cobro.medio,
    estado: estadoDelCobro(cobro, ahora),
    peyId: cobro.pey_id,
    qrString: cobro.qr_string,
    telefonoFin: cobro.telefono_fin,
    simulado: cobro.simulado === 1,
    creadoEn: cobro.creado_en,
    venceEn: cobro.vence_en,
    pagadoEn: cobro.pagado_en,
    transactionId: cobro.transaction_id,
  };
}

/** Datos del pago de un cobro ya pagado, para la pantalla "Pagado" y el recibo. */
export async function reciboDelCobro(db: D1Database, cobro: FilaCobro, opciones: { rastreoCompleto: boolean }) {
  if (!cobro.transaction_id) return null;
  const pago = await db
    .prepare("SELECT monto_centavos, medio, clave_rastreo, banco, fecha_pago, origen FROM pagos WHERE transaction_id = ?")
    .bind(cobro.transaction_id)
    .first<{ monto_centavos: number; medio: string; clave_rastreo: string | null; banco: string | null; fecha_pago: string; origen: string }>();
  if (!pago) return null;
  const { results } = await db
    .prepare(
      `SELECT a.cuota_numero AS numero, a.monto_centavos AS montoCentavos, a.liquida AS liquida,
              q.monto_centavos - q.pagado_centavos AS restaCentavos
       FROM aplicaciones a JOIN cuotas q ON q.credito_id = a.credito_id AND q.numero = a.cuota_numero
       WHERE a.transaction_id = ? ORDER BY a.cuota_numero`,
    )
    .bind(cobro.transaction_id)
    .all<{ numero: number; montoCentavos: number; liquida: number; restaCentavos: number }>();
  return {
    montoCentavos: pago.monto_centavos,
    medio: pago.medio,
    claveRastreo: opciones.rastreoCompleto ? pago.clave_rastreo : enmascararRastreo(pago.clave_rastreo),
    banco: pago.banco,
    fecha: pago.fecha_pago,
    origen: pago.origen,
    cuotas: results.map((r) => ({ numero: r.numero, montoCentavos: r.montoCentavos, liquida: r.liquida === 1 })),
    restaCuotaCentavos: results.at(-1)?.restaCentavos ?? null,
  };
}

function concepto(creditoId: string): string {
  // Lo ve quien paga en la app de su banco. Sin nombres ni datos personales.
  return `Abono credito ${creditoId}`;
}

async function folioLibre(db: D1Database): Promise<number> {
  for (let intento = 0; intento < 6; intento++) {
    const folio = generarFolio();
    const usado = await db
      .prepare("SELECT 1 AS x FROM cobros WHERE folio = ?1 UNION ALL SELECT 1 FROM qr_fijos WHERE folio = ?1 LIMIT 1")
      .bind(folio)
      .first();
    if (!usado) return folio;
  }
  throw new Error("No se pudo asignar un folio al cobro");
}

/**
 * Crea un cobro en pey y lo guarda. Un QR pendiente por el mismo crédito y monto se reutiliza mientras siga vigente.
 * Lanza ErrorPey si pey no lo acepta.
 */
export async function crearCobro(env: Env, solicitud: SolicitudCobro, gestorId: string | null, ahora = new Date()): Promise<{ cobro: FilaCobro; reutilizado: boolean }> {
  if (solicitud.medio === "qr") {
    const vigente = await env.DB.prepare(
      `SELECT * FROM cobros WHERE credito_id = ? AND monto_centavos = ? AND medio = 'qr' AND estado = 'pendiente' AND vence_en > ?
       ORDER BY creado_en DESC LIMIT 1`,
    )
      .bind(solicitud.creditoId, solicitud.montoCentavos, new Date(ahora.getTime() + MARGEN_REUSO_MS).toISOString())
      .first<FilaCobro>();
    if (vigente) return { cobro: vigente, reutilizado: true };
  }

  const id = generarId("cob");
  const folio = await folioLibre(env.DB);
  const datos = {
    montoCentavos: solicitud.montoCentavos,
    concepto: concepto(solicitud.creditoId),
    expiracionSeg: VIGENCIA_SEG,
    folio,
    metadata: { cobro: id, credito: solicitud.creditoId },
  };

  let peyId: string;
  let qrString: string | null = null;
  let simulado: boolean;
  if (solicitud.medio === "push") {
    const push = await enviarPush(env, { ...datos, telefono: solicitud.telefono as string });
    peyId = push.transactionId;
    simulado = push.simulado;
  } else {
    const qr = await crearQr(env, datos);
    peyId = qr.id;
    qrString = qr.qrString;
    simulado = qr.simulado;
  }

  const cobro: FilaCobro = {
    id,
    folio,
    token: generarToken(),
    credito_id: solicitud.creditoId,
    monto_centavos: solicitud.montoCentavos,
    medio: solicitud.medio,
    estado: "pendiente",
    pey_id: peyId,
    qr_string: qrString,
    telefono_fin: solicitud.telefono ? solicitud.telefono.slice(-4) : null,
    gestor_id: gestorId,
    simulado: simulado ? 1 : 0,
    creado_en: ahora.toISOString(),
    vence_en: new Date(ahora.getTime() + VIGENCIA_SEG * 1000).toISOString(),
    pagado_en: null,
    transaction_id: null,
  };
  await env.DB.prepare(
    `INSERT INTO cobros (id, folio, token, credito_id, monto_centavos, medio, estado, pey_id, qr_string, telefono_fin, gestor_id, simulado, creado_en, vence_en)
     VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(cobro.id, cobro.folio, cobro.token, cobro.credito_id, cobro.monto_centavos, cobro.medio, cobro.pey_id, cobro.qr_string, cobro.telefono_fin, cobro.gestor_id, cobro.simulado, cobro.creado_en, cobro.vence_en)
    .run();
  return { cobro, reutilizado: false };
}

export interface FilaQrFijo {
  credito_id: string;
  pey_id: string | null;
  qr_string: string | null;
  monto_centavos: number;
  folio: number;
  simulado: number;
  creado_en: string;
}

// Si quien estaba creando el QR en pey no terminó (por ejemplo, se cortó la solicitud), otro puede intentarlo después.
const RECLAMO_VIEJO_MS = 60_000;

/**
 * QR fijo de un crédito: no vence y acepta muchos pagos (el "tarjetón"). Se crea en pey una sola vez, aunque lleguen
 * varias solicitudes a la vez. Regresa null si otra solicitud lo está creando en este momento.
 */
export async function asegurarQrFijo(env: Env, creditoId: string, montoCentavos: number, ahora = new Date()): Promise<FilaQrFijo | null> {
  const leer = () => env.DB.prepare("SELECT * FROM qr_fijos WHERE credito_id = ?").bind(creditoId).first<FilaQrFijo>();
  const actual = await leer();
  if (actual?.pey_id) return actual;
  if (actual && ahora.getTime() - Date.parse(actual.creado_en) > RECLAMO_VIEJO_MS) {
    await env.DB.prepare("DELETE FROM qr_fijos WHERE credito_id = ? AND pey_id IS NULL").bind(creditoId).run();
  }

  const folio = await folioLibre(env.DB);
  const reclamo = await env.DB.prepare(
    "INSERT INTO qr_fijos (credito_id, pey_id, qr_string, monto_centavos, folio, simulado, creado_en) VALUES (?, NULL, NULL, ?, ?, 0, ?) ON CONFLICT (credito_id) DO NOTHING",
  )
    .bind(creditoId, montoCentavos, folio, ahora.toISOString())
    .run();
  if (reclamo.meta.changes !== 1) return (await leer())?.pey_id ? leer() : null;

  try {
    const qr = await crearQr(env, { montoCentavos, concepto: concepto(creditoId), expiracionSeg: 0, folio, metadata: { credito: creditoId, fijo: "1" } });
    await env.DB.prepare("UPDATE qr_fijos SET pey_id = ?, qr_string = ?, simulado = ? WHERE credito_id = ?")
      .bind(qr.id, qr.qrString, qr.simulado ? 1 : 0, creditoId)
      .run();
  } catch (error) {
    await env.DB.prepare("DELETE FROM qr_fijos WHERE credito_id = ? AND pey_id IS NULL").bind(creditoId).run();
    throw error;
  }
  return leer();
}

/** Texto corto de un cobro para los registros del Worker. */
export function resumenDelCobro(cobro: FilaCobro): Record<string, unknown> {
  return { cobro: cobro.id, credito: cobro.credito_id, medio: cobro.medio, monto: pesos(cobro.monto_centavos), simulado: cobro.simulado === 1 };
}
