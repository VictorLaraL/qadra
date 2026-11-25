// Cliente del API de pey (docs.pey.mx, versión 2026-10-20):
//
//   POST /codi/qr              crea un QR CoDi (cobro en pantalla, link de pago o QR fijo de un crédito)
//   POST /codi/pn              manda la solicitud de cobro al celular del acreditado (push)
//   GET  /transaction/api-key  lista las transacciones de la API key: con ella se cuadra el día
//   GET  /transaction/{id}     detalle de una transacción: con él se recupera un pago cuyo aviso no llegó
//
// Sin PEY_API_KEY y con SIMULACION=1 todo se simula y se rotula como simulado; "pey" es entonces la tabla
// `pey_simulado`, para poder probar el cuadre completo sin dinero real.

import { generarId } from "../core/tokens.ts";
import { modoSimulacion } from "./entorno.ts";

const BASE = "https://api.pey.mx";
const ESPERA_MS = 15_000;

/** Error que regresó pey, con su tipo (por ejemplo CALL_LIMIT_REACHED) para dar un mensaje útil. */
export class ErrorPey extends Error {
  readonly status: number;
  readonly tipo: string;
  constructor(status: number, tipo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorPey";
    this.status = status;
    this.tipo = tipo;
  }
}

/** Mensaje para la persona que está cobrando, sin detalles internos. */
export function mensajeDePey(error: unknown): string {
  if (error instanceof ErrorPey) {
    if (error.tipo === "CALL_LIMIT_REACHED") return "pey alcanzó su límite de solicitudes de este periodo. Intenta en unos minutos.";
    if (error.status === 503) return "pey está en mantenimiento. Intenta en unos minutos.";
    if (error.status === 401 || error.status === 403) return "pey rechazó la API key. Revisa PEY_API_KEY.";
    if (error.status === 400) return `pey no aceptó el cobro: ${error.message}`;
    return "pey no pudo crear el cobro. Intenta de nuevo.";
  }
  return "No se pudo conectar con pey. Revisa tu conexión e intenta de nuevo.";
}

function configurado(env: Env): boolean {
  if (env.PEY_API_KEY) return true;
  if (!modoSimulacion(env)) throw new ErrorPey(503, "SIN_CONFIGURAR", "Falta configurar PEY_API_KEY");
  return false;
}

async function llamar(env: Env, metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<Record<string, unknown>> {
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${env.PEY_API_KEY}`, ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(ESPERA_MS),
  });
  const texto = await respuesta.text();
  let datos: unknown = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    // pey siempre responde JSON; si no, se trata como error con el texto recortado.
  }
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  if (!respuesta.ok) {
    const error = typeof objeto.error === "object" && objeto.error !== null ? (objeto.error as Record<string, unknown>) : {};
    throw new ErrorPey(respuesta.status, String(error.type ?? "ERROR"), String(error.message ?? texto.slice(0, 200)));
  }
  return objeto;
}

export interface DatosCobro {
  montoCentavos: number;
  /** Lo que ve quien paga en la app de su banco. Sin datos personales; máximo 40 caracteres. */
  concepto: string;
  /** 0 = no vence (QR fijo). pey exige al menos 360 segundos cuando hay vigencia. */
  expiracionSeg: number;
  /** Folio de 7 dígitos: viaja como `numRef` y regresa en el aviso de pago. */
  folio: number;
  /** Regresa en el aviso como `metadata.externalMetadata`. Solo valores simples. */
  metadata: Record<string, string>;
}

export interface QrCreado {
  /** IDC que Banxico asigna al QR. */
  id: string;
  qrString: string;
  simulado: boolean;
}

export async function crearQr(env: Env, datos: DatosCobro): Promise<QrCreado> {
  if (!configurado(env)) {
    const id = generarId("SIMQR");
    return { id, qrString: `QADRA SIMULADO | ${id} | folio ${datos.folio} | ${datos.concepto}`, simulado: true };
  }
  const cuerpo = await llamar(env, "POST", "/codi/qr", {
    amount: datos.montoCentavos / 100,
    concept: datos.concepto.slice(0, 40),
    expiration: datos.expiracionSeg,
    numRef: String(datos.folio),
    metadata: datos.metadata,
  });
  if (typeof cuerpo.id !== "string" || typeof cuerpo.qrString !== "string") throw new ErrorPey(502, "RESPUESTA", "pey no regresó el QR");
  return { id: cuerpo.id, qrString: cuerpo.qrString, simulado: false };
}

export interface PushEnviado {
  /** Transacción de pey con la que se sigue el cobro; es la misma que llega en el aviso de pago. */
  transactionId: string;
  simulado: boolean;
}

export async function enviarPush(env: Env, datos: DatosCobro & { telefono: string }): Promise<PushEnviado> {
  if (!configurado(env)) return { transactionId: generarId("SIMPN"), simulado: true };
  const cuerpo = await llamar(env, "POST", "/codi/pn", {
    amount: datos.montoCentavos / 100,
    phoneNumber: datos.telefono,
    concept: datos.concepto.slice(0, 40),
    expiration: datos.expiracionSeg,
    numRef: String(datos.folio),
    metadata: datos.metadata,
  });
  if (typeof cuerpo.transactionId !== "string") throw new ErrorPey(502, "RESPUESTA", "pey no regresó la transacción del cobro");
  return { transactionId: cuerpo.transactionId, simulado: false };
}

/** Una transacción pagada tal como la reporta pey, en la forma de un aviso de pago para poder conciliarla igual. */
export interface TransaccionPey {
  transactionId: string;
  montoCentavos: number;
  fechaPagoSeg: number;
  /** Cuerpo equivalente al aviso `codi.*.payment_received` de esta transacción. */
  aviso: Record<string, unknown>;
}

interface FilaSimulada {
  transaction_id: string;
  tipo: "qr" | "pn";
  pey_id: string | null;
  num_ref: string | null;
  cobro_id: string | null;
  credito_id: string | null;
  monto_centavos: number;
  banco_codigo: number;
  clave_rastreo: string;
  fecha_seg: number;
}

/** Arma el aviso que pey mandaría por una transacción de su libro simulado. */
export function avisoSimulado(f: FilaSimulada): Record<string, unknown> {
  const externa: Record<string, string> = {};
  if (f.cobro_id) externa.cobro = f.cobro_id;
  if (f.credito_id) externa.credito = f.credito_id;
  return {
    type: `codi.${f.tipo}.payment_received`,
    amount: f.monto_centavos / 100,
    apiKeyId: "SIMULADO",
    ...(f.tipo === "qr" && f.pey_id ? { codiQrId: f.pey_id } : {}),
    concept: f.credito_id ? `Abono credito ${f.credito_id}` : "Transferencia sin referencia",
    datePaid: f.fecha_seg,
    metadata: {
      clabe: "000000000000000000",
      bankCode: f.banco_codigo,
      accountType: 40,
      trackingKey: f.clave_rastreo,
      externalMetadata: externa,
    },
    numRef: f.num_ref ?? "0",
    transactionId: f.transaction_id,
  };
}

function transaccionReal(item: Record<string, unknown>): TransaccionPey | null {
  if (item.status !== "PAID" || item.paymentMethod !== "CODI" || typeof item.id !== "string") return null;
  const tipo = item.payableType === "API_CODI_PN" ? "pn" : item.payableType === "API_CODI_QR" ? "qr" : null;
  const monto = Number(item.amount);
  const fecha = Number(item.datePaid ?? item.dateCreated);
  if (!tipo || !Number.isFinite(monto) || !Number.isFinite(fecha)) return null;
  return {
    transactionId: item.id,
    montoCentavos: Math.round(monto * 100),
    fechaPagoSeg: fecha,
    aviso: {
      type: `codi.${tipo}.payment_received`,
      amount: monto,
      ...(tipo === "qr" && typeof item.payableId === "string" ? { codiQrId: item.payableId } : {}),
      concept: item.description ?? "",
      datePaid: fecha,
      metadata: item.metadata ?? {},
      transactionId: item.id,
    },
  };
}

const PAGINAS_MAXIMAS = 5; // 80 transacciones por página

/**
 * Transacciones CoDi pagadas desde `desdeSeg` (segundos Unix) según pey.
 * `completo` es false si hubo que dejar de leer antes de llegar a esa fecha.
 */
export async function listarTransacciones(env: Env, desdeSeg: number): Promise<{ transacciones: TransaccionPey[]; completo: boolean }> {
  if (!configurado(env)) {
    const { results } = await env.DB.prepare("SELECT * FROM pey_simulado WHERE fecha_seg >= ? ORDER BY fecha_seg DESC").bind(desdeSeg).all<FilaSimulada>();
    return {
      transacciones: results.map((f) => ({
        transactionId: f.transaction_id,
        montoCentavos: f.monto_centavos,
        fechaPagoSeg: f.fecha_seg,
        aviso: avisoSimulado(f),
      })),
      completo: true,
    };
  }

  const transacciones: TransaccionPey[] = [];
  let siguiente: string | null = null;
  for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
    const cuerpo = await llamar(env, "GET", `/transaction/api-key${siguiente ? `?nextToken=${encodeURIComponent(siguiente)}` : ""}`);
    const items = Array.isArray(cuerpo.items) ? (cuerpo.items as Array<Record<string, unknown>>) : [];
    let llegoAlInicio = false;
    for (const item of items) {
      const creada = Number(item.dateCreated ?? item.datePaid);
      if (Number.isFinite(creada) && creada < desdeSeg) llegoAlInicio = true;
      const t = transaccionReal(item);
      if (t && t.fechaPagoSeg >= desdeSeg) transacciones.push(t);
    }
    siguiente = typeof cuerpo.nextToken === "string" && cuerpo.nextToken ? cuerpo.nextToken : null;
    if (llegoAlInicio || !siguiente) return { transacciones, completo: true };
  }
  return { transacciones, completo: false };
}

/** Consulta una transacción pagada en pey, o null si no existe, no es de esta API key o aún no está pagada. */
export async function consultarTransaccion(env: Env, transactionId: string): Promise<TransaccionPey | null> {
  if (!configurado(env)) {
    const f = await env.DB.prepare("SELECT * FROM pey_simulado WHERE transaction_id = ?").bind(transactionId).first<FilaSimulada>();
    return f ? { transactionId: f.transaction_id, montoCentavos: f.monto_centavos, fechaPagoSeg: f.fecha_seg, aviso: avisoSimulado(f) } : null;
  }
  try {
    return transaccionReal(await llamar(env, "GET", `/transaction/${encodeURIComponent(transactionId)}`));
  } catch (error) {
    if (error instanceof ErrorPey && error.status === 404) return null;
    throw error;
  }
}
