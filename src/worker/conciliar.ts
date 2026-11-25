// Conciliación de un pago: identificar a qué crédito corresponde, repartirlo entre sus cuotas y dejarlo registrado
// una sola vez. Aquí llegan los avisos de pey, los pagos recuperados del cuadre y los pagos de ejemplo.
//
// Garantías:
// - Un pago (transactionId) se registra una sola vez, aunque el aviso se repita o llegue por dos caminos.
// - El pago, sus aplicaciones a cuotas y el cierre del cobro se guardan juntos o no se guarda nada.
// - Una cuota nunca queda pagada de más: si dos pagos compiten por la misma cuota, el CHECK de la tabla rechaza al
//   segundo y este se vuelve a calcular con el estado nuevo.

import { planAplicacion, type Aplicacion, type Cuota } from "../core/conciliacion.ts";
import type { PagoRecibido } from "../core/pagos.ts";
import { generarId } from "../core/tokens.ts";
import { cuotasDe } from "./db.ts";

export type OrigenPago = "codi" | "simulado" | "ejemplo";
export type ViaPago = "cobro" | "qr-fijo" | "sin-referencia";
export type MotivoExcepcion = "sin-identificar" | "excedente";

export interface FilaCobro {
  id: string;
  folio: number;
  token: string;
  credito_id: string;
  monto_centavos: number;
  medio: "qr" | "push";
  estado: "pendiente" | "pagado";
  pey_id: string | null;
  qr_string: string | null;
  telefono_fin: string | null;
  gestor_id: string | null;
  simulado: number;
  creado_en: string;
  vence_en: string;
  pagado_en: string | null;
  transaction_id: string | null;
}

export interface PagoConciliado {
  /** false si el pago ya estaba registrado: no se hizo nada. */
  nuevo: boolean;
  transactionId: string;
  estado: "aplicado" | "excepcion";
  motivo: MotivoExcepcion | null;
  via: ViaPago;
  medio: "qr" | "pn";
  origen: OrigenPago;
  recuperado: boolean;
  creditoId: string | null;
  acreditado: string | null;
  gestorId: string | null;
  /** true si el crédito es el de la demo pública de la landing. */
  demo: boolean;
  cobroId: string | null;
  cobroToken: string | null;
  montoCentavos: number;
  aplicadoCentavos: number;
  excedenteCentavos: number;
  aplicaciones: Aplicacion[];
  /** Lo que sigue pendiente de la última cuota que recibió dinero (0 si quedó liquidada). */
  restaCuotaCentavos: number | null;
  claveRastreo: string | null;
  banco: string | null;
  cuentaFin: string | null;
  fechaPago: string;
}

interface Destino {
  via: ViaPago;
  cobro: FilaCobro | null;
  creditoId: string | null;
}

const ID_COBRO = /^cob_[0-9a-f]{12}$/;
const FOLIO = /^[1-9]\d{6}$/;

/**
 * Busca a qué cobro o crédito corresponde un pago, de la referencia más fuerte a la más débil:
 * el identificador que dio pey (IDC del QR o transacción del push), el cobro que mandamos en la metadata y el folio
 * que viajó como numRef. Si no es un cobro, puede ser el QR fijo de un crédito.
 */
async function identificar(db: D1Database, pago: PagoRecibido): Promise<Destino> {
  const peyId = pago.tipo === "qr" ? pago.codiQrId : pago.transactionId;
  const cobroId = typeof pago.metadata.cobro === "string" && ID_COBRO.test(pago.metadata.cobro) ? pago.metadata.cobro : null;
  const folio = pago.numRef && FOLIO.test(pago.numRef) ? Number(pago.numRef) : null;

  const cobro = await db
    .prepare(
      `SELECT * FROM cobros WHERE pey_id = ?1 OR id = ?2 OR folio = ?3
       ORDER BY (pey_id IS ?1) DESC, (id IS ?2) DESC LIMIT 1`,
    )
    .bind(peyId, cobroId, folio)
    .first<FilaCobro>();
  if (cobro) return { via: "cobro", cobro, creditoId: cobro.credito_id };

  if (pago.tipo === "qr") {
    const fijo = await db
      .prepare("SELECT credito_id FROM qr_fijos WHERE pey_id = ?1 OR folio = ?2 ORDER BY (pey_id IS ?1) DESC LIMIT 1")
      .bind(pago.codiQrId, folio)
      .first<{ credito_id: string }>();
    if (fijo) return { via: "qr-fijo", cobro: null, creditoId: fijo.credito_id };
  }
  return { via: "sin-referencia", cobro: null, creditoId: null };
}

const INTENTOS = 4;

function esChoqueDeCuota(error: unknown): boolean {
  return /CHECK constraint failed/i.test(error instanceof Error ? error.message : String(error));
}

/** Lo que queda por pagar de la última cuota tocada por un plan. */
function restaDeLaUltima(cuotas: Cuota[], aplicaciones: Aplicacion[]): number | null {
  const ultima = aplicaciones.at(-1);
  const cuota = ultima ? cuotas.find((c) => c.numero === ultima.numero) : undefined;
  return ultima && cuota ? cuota.montoCentavos - cuota.pagadoCentavos - ultima.montoCentavos : null;
}

/**
 * Registra y aplica un pago. Si ya estaba registrado, regresa `nuevo: false` y no cambia nada.
 * `creditoId` indica el crédito sin buscar referencias: solo lo usan los pagos de ejemplo de la demo.
 */
export async function conciliarPago(
  db: D1Database,
  pago: PagoRecibido,
  opciones: { origen: OrigenPago; recuperado?: boolean; creditoId?: string; ahora?: Date },
): Promise<PagoConciliado> {
  const ahora = (opciones.ahora ?? new Date()).toISOString();
  const destino: Destino = opciones.creditoId ? { via: "cobro", cobro: null, creditoId: opciones.creditoId } : await identificar(db, pago);
  const datosCredito = destino.creditoId
    ? await db
        .prepare("SELECT id, acreditado, gestor_id, demo FROM creditos WHERE id = ?")
        .bind(destino.creditoId)
        .first<{ id: string; acreditado: string; gestor_id: string | null; demo: number }>()
    : null;
  // El crédito del cobro puede ya no existir (cartera reemplazada): el pago queda sin identificar, nunca se pierde.
  const creditoId = datosCredito?.id ?? null;
  const reclamo = generarId("rec");

  for (let intento = 1; ; intento++) {
    const cuotas = creditoId ? await cuotasDe(db, creditoId) : [];
    const plan = creditoId ? planAplicacion(cuotas, pago.montoCentavos) : { aplicaciones: [], aplicadoCentavos: 0, excedenteCentavos: pago.montoCentavos };
    const motivo: MotivoExcepcion | null = !creditoId ? "sin-identificar" : plan.excedenteCentavos > 0 ? "excedente" : null;
    const estado = motivo ? "excepcion" : "aplicado";
    const via: ViaPago = creditoId ? destino.via : "sin-referencia";

    // Solo el intento que logró apuntar el pago en `recibidos` escribe lo demás.
    const reclamado = "EXISTS (SELECT 1 FROM recibidos WHERE transaction_id = ? AND reclamo = ?)";
    const llave = [pago.transactionId, reclamo];
    const sentencias = [
      db
        .prepare("INSERT INTO recibidos (transaction_id, reclamo, monto_centavos, origen, fecha_pago) VALUES (?, ?, ?, ?, ?) ON CONFLICT (transaction_id) DO NOTHING")
        .bind(pago.transactionId, reclamo, pago.montoCentavos, opciones.origen, pago.fechaPago),
      db
        .prepare(
          `INSERT INTO pagos (transaction_id, webhook_id, medio, via, cobro_id, credito_id, gestor_id, monto_centavos, aplicado_centavos, estado,
             motivo, concepto, num_ref, clave_rastreo, banco, cuenta_fin, origen, recuperado, fecha_pago, recibido_en)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${reclamado}
           ON CONFLICT (transaction_id) DO NOTHING`,
        )
        .bind(
          pago.transactionId,
          pago.webhookId,
          pago.tipo,
          via,
          destino.cobro?.id ?? null,
          creditoId,
          destino.cobro?.gestor_id ?? datosCredito?.gestor_id ?? null,
          pago.montoCentavos,
          plan.aplicadoCentavos,
          estado,
          motivo,
          pago.concepto.slice(0, 80),
          pago.numRef,
          pago.claveRastreo,
          pago.banco,
          pago.cuentaFin,
          opciones.origen,
          opciones.recuperado ? 1 : 0,
          pago.fechaPago,
          ahora,
          ...llave,
        ),
      ...plan.aplicaciones.flatMap((a) => [
        db
          .prepare(`UPDATE cuotas SET pagado_centavos = pagado_centavos + ? WHERE credito_id = ? AND numero = ? AND ${reclamado}`)
          .bind(a.montoCentavos, creditoId, a.numero, ...llave),
        db
          .prepare(
            `INSERT INTO aplicaciones (transaction_id, credito_id, cuota_numero, monto_centavos, liquida, aplicado_en)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${reclamado}`,
          )
          .bind(pago.transactionId, creditoId, a.numero, a.montoCentavos, a.liquida ? 1 : 0, ahora, ...llave),
      ]),
    ];
    if (destino.cobro && creditoId) {
      sentencias.push(
        db
          .prepare(`UPDATE cobros SET estado = 'pagado', pagado_en = ?, transaction_id = ? WHERE id = ? AND estado = 'pendiente' AND ${reclamado}`)
          .bind(pago.fechaPago, pago.transactionId, destino.cobro.id, ...llave),
      );
    }

    let resultados: D1Result[];
    try {
      resultados = await db.batch(sentencias);
    } catch (error) {
      // Otro pago cubrió antes la misma cuota: no se guardó nada; se recalcula con el estado nuevo.
      if (esChoqueDeCuota(error) && intento < INTENTOS) continue;
      throw error;
    }

    return {
      nuevo: resultados[0].meta.changes === 1,
      transactionId: pago.transactionId,
      estado,
      motivo,
      via,
      medio: pago.tipo,
      origen: opciones.origen,
      recuperado: opciones.recuperado === true,
      creditoId,
      acreditado: datosCredito?.acreditado ?? null,
      gestorId: destino.cobro?.gestor_id ?? datosCredito?.gestor_id ?? null,
      demo: datosCredito?.demo === 1,
      cobroId: creditoId ? (destino.cobro?.id ?? null) : null,
      cobroToken: creditoId ? (destino.cobro?.token ?? null) : null,
      montoCentavos: pago.montoCentavos,
      aplicadoCentavos: plan.aplicadoCentavos,
      excedenteCentavos: plan.excedenteCentavos,
      aplicaciones: plan.aplicaciones,
      restaCuotaCentavos: restaDeLaUltima(cuotas, plan.aplicaciones),
      claveRastreo: pago.claveRastreo,
      banco: pago.banco,
      cuentaFin: pago.cuentaFin,
      fechaPago: pago.fechaPago,
    };
  }
}

export type ResultadoResolucion =
  | { ok: true; aplicadoCentavos: number; pendienteCentavos: number; aplicaciones: Aplicacion[] }
  | { ok: false; error: string; status: number };

/**
 * Aplica a un crédito lo que quedó sin aplicar de un pago en excepción (sin identificar o con excedente).
 * Si aún sobra dinero después de cubrir el saldo de ese crédito, el pago sigue en excepción con el resto.
 */
export async function resolverExcepcion(db: D1Database, transactionId: string, creditoId: string, ahora = new Date()): Promise<ResultadoResolucion> {
  const pago = await db
    .prepare("SELECT monto_centavos, aplicado_centavos, estado FROM pagos WHERE transaction_id = ?")
    .bind(transactionId)
    .first<{ monto_centavos: number; aplicado_centavos: number; estado: string }>();
  if (!pago) return { ok: false, error: "No existe ese pago.", status: 404 };
  if (pago.estado !== "excepcion") return { ok: false, error: "Ese pago ya está aplicado.", status: 409 };

  const cuotas = await cuotasDe(db, creditoId);
  if (cuotas.length === 0) return { ok: false, error: "No existe ese crédito.", status: 404 };
  const pendiente = pago.monto_centavos - pago.aplicado_centavos;
  const plan = planAplicacion(cuotas, pendiente);
  if (plan.aplicadoCentavos === 0) return { ok: false, error: "Ese crédito no tiene saldo pendiente.", status: 409 };

  // Solo aplica si el pago sigue como lo leímos: dos personas resolviendo a la vez no lo aplican dos veces.
  const sinCambios = "EXISTS (SELECT 1 FROM pagos WHERE transaction_id = ? AND estado = 'excepcion' AND aplicado_centavos = ?)";
  const llave = [transactionId, pago.aplicado_centavos];
  const momento = ahora.toISOString();
  const completo = plan.excedenteCentavos === 0;
  const sentencias = [
    ...plan.aplicaciones.flatMap((a) => [
      db.prepare(`UPDATE cuotas SET pagado_centavos = pagado_centavos + ? WHERE credito_id = ? AND numero = ? AND ${sinCambios}`).bind(a.montoCentavos, creditoId, a.numero, ...llave),
      db
        .prepare(
          `INSERT INTO aplicaciones (transaction_id, credito_id, cuota_numero, monto_centavos, liquida, aplicado_en)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${sinCambios}`,
        )
        .bind(transactionId, creditoId, a.numero, a.montoCentavos, a.liquida ? 1 : 0, momento, ...llave),
    ]),
    db
      .prepare(
        `UPDATE pagos SET aplicado_centavos = aplicado_centavos + ?, credito_id = ?, estado = ?, motivo = ?, resuelto_en = ?,
           gestor_id = COALESCE(gestor_id, (SELECT gestor_id FROM creditos WHERE id = ?))
         WHERE transaction_id = ? AND estado = 'excepcion' AND aplicado_centavos = ?`,
      )
      .bind(plan.aplicadoCentavos, creditoId, completo ? "aplicado" : "excepcion", completo ? null : "excedente", momento, creditoId, ...llave),
  ];

  let resultados: D1Result[];
  try {
    resultados = await db.batch(sentencias);
  } catch (error) {
    if (esChoqueDeCuota(error)) return { ok: false, error: "El crédito cambió mientras se aplicaba. Intenta de nuevo.", status: 409 };
    throw error;
  }
  if (resultados.at(-1)?.meta.changes !== 1) return { ok: false, error: "Alguien más ya resolvió este pago.", status: 409 };
  return { ok: true, aplicadoCentavos: plan.aplicadoCentavos, pendienteCentavos: plan.excedenteCentavos, aplicaciones: plan.aplicaciones };
}
