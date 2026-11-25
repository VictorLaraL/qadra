// Pagos simulados (solo en modo simulación, sin API key de pey).
//
// Un pago simulado recorre el mismo camino que uno real: se apunta en el "libro de pey" (tabla pey_simulado) y llega
// como un aviso firmado a /webhooks/pey. También se puede simular que el aviso se pierde, para ver cómo el cuadre del
// día lo detecta y lo recupera.

import { firmarAviso } from "../core/firma.ts";
import { generarId } from "../core/tokens.ts";
import { secretoAvisos } from "./entorno.ts";
import type { Avisador } from "./eventos.ts";
import { json } from "./http.ts";
import { avisoSimulado } from "./pey.ts";
import { manejarAviso } from "./webhook.ts";

// Claves de Banxico de bancos conocidos, para que el banco de origen del pago simulado varíe.
const BANCOS = [40012, 40072, 40127, 40014, 40002, 90638, 90722];

export interface PagoPorSimular {
  tipo: "qr" | "pn";
  /** IDC del QR o transacción del cobro push; null para una transferencia sin referencia. */
  peyId: string | null;
  folio: number | null;
  cobroId: string | null;
  creditoId: string | null;
  montoCentavos: number;
}

/**
 * Simula que alguien pagó desde su banco.
 * @param avisar false = pey cobró pero el aviso "se perdió" (queda solo en el libro simulado de pey).
 */
export async function simularPago(env: Env, origen: URL, p: PagoPorSimular, opciones: { conAviso: boolean }, avisar: Avisador): Promise<Response> {
  const ahoraSeg = Math.floor(Date.now() / 1000);
  // Un cobro push se paga una sola vez y su transacción es la que dio pey al crearlo; un QR admite varios pagos.
  const transactionId = p.tipo === "pn" && p.peyId ? p.peyId : generarId("SIMTX");
  const fila = {
    transaction_id: transactionId,
    tipo: p.tipo,
    pey_id: p.peyId,
    num_ref: p.folio === null ? null : String(p.folio),
    cobro_id: p.cobroId,
    credito_id: p.creditoId,
    monto_centavos: p.montoCentavos,
    banco_codigo: BANCOS[ahoraSeg % BANCOS.length],
    clave_rastreo: `SIM${generarId("X").slice(2).toUpperCase()}`,
    fecha_seg: ahoraSeg,
  };
  const apuntado = await env.DB.prepare(
    `INSERT INTO pey_simulado (transaction_id, tipo, pey_id, num_ref, cobro_id, credito_id, monto_centavos, banco_codigo, clave_rastreo, fecha_seg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (transaction_id) DO NOTHING`,
  )
    .bind(fila.transaction_id, fila.tipo, fila.pey_id, fila.num_ref, fila.cobro_id, fila.credito_id, fila.monto_centavos, fila.banco_codigo, fila.clave_rastreo, fila.fecha_seg)
    .run();
  if (apuntado.meta.changes !== 1) return json({ error: "Ese cobro al celular ya se pagó." }, 409);
  if (!opciones.conAviso) return json({ ok: true, transactionId, avisoPerdido: true });

  const cuerpo = JSON.stringify(avisoSimulado(fila));
  const id = generarId("msg_sim");
  const aviso = new Request(new URL("/webhooks/pey", origen), {
    method: "POST",
    body: cuerpo,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ahoraSeg),
      "webhook-signature": await firmarAviso(secretoAvisos(env), id, ahoraSeg, cuerpo),
    },
  });
  const respuesta = await manejarAviso(aviso, env, avisar);
  const resultado = (await respuesta.json()) as Record<string, unknown>;
  return json({ ...resultado, transactionId }, respuesta.status);
}
