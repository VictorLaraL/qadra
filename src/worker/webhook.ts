// POST /webhooks/pey — avisos de pago de pey.
//
// 1. Verifica la firma (Standard Webhooks) sobre el cuerpo crudo.
// 2. Identifica el cobro o el crédito y reparte el pago entre sus cuotas (conciliar.ts), una sola vez.
// 3. Avisa en vivo a la app del gestor, al portal y a la página de pago.
// Responde 500 ante errores inesperados para que pey reintente.

import { verificarAviso } from "../core/firma.ts";
import { esEventoDePago, normalizarPago } from "../core/pagos.ts";
import { conciliarPago } from "./conciliar.ts";
import { modoSimulacion, secretoAvisos } from "./entorno.ts";
import type { Avisador } from "./eventos.ts";
import { json, leerTextoLimitado, log } from "./http.ts";

const TAMANO_MAXIMO = 64 * 1024;

export async function manejarAviso(request: Request, env: Env, avisar: Avisador): Promise<Response> {
  const secreto = secretoAvisos(env);
  if (!secreto) return json({ ok: false, error: "Falta configurar PEY_WEBHOOK_SECRET" }, 503);

  // Esta ruta no pide clave y la firma se revisa después de leer: el cuerpo se lee con tope, venga o no Content-Length.
  const cuerpo = await leerTextoLimitado(request, TAMANO_MAXIMO);
  if (cuerpo === null) return json({ ok: false, error: "Aviso demasiado grande" }, 413);

  const encabezados = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };
  const firma = await verificarAviso(secreto, encabezados, cuerpo);
  if (!firma.ok) {
    log("aviso_rechazado", { motivo: firma.motivo, webhookId: encabezados["webhook-id"] });
    return json({ ok: false, error: firma.motivo }, 401);
  }

  let aviso: unknown;
  try {
    aviso = JSON.parse(cuerpo);
  } catch {
    return json({ ok: false, error: "El aviso no es JSON" }, 400);
  }

  const pago = normalizarPago(encabezados["webhook-id"], aviso);
  if (!pago) {
    // Se responde 200 porque reintentar no lo arregla, pero queda en el registro para revisarlo contra pey.
    const motivo = esEventoDePago(aviso) ? "pago incompleto" : "no es un pago";
    const tipo = typeof aviso === "object" && aviso !== null ? String((aviso as { type?: unknown }).type ?? "") : "";
    log(motivo === "pago incompleto" ? "aviso_pago_incompleto" : "aviso_ignorado", { motivo, tipo, webhookId: encabezados["webhook-id"] });
    return json({ ok: true, ignorado: true, motivo });
  }

  const conciliado = await conciliarPago(env.DB, pago, { origen: modoSimulacion(env) ? "simulado" : "codi" });
  if (!conciliado.nuevo) return json({ ok: true, duplicado: true });

  log("pago_conciliado", {
    transactionId: pago.transactionId,
    credito: conciliado.creditoId,
    via: conciliado.via,
    estado: conciliado.estado,
    motivo: conciliado.motivo,
    montoCentavos: pago.montoCentavos,
    aplicadoCentavos: conciliado.aplicadoCentavos,
    cuotas: conciliado.aplicaciones.map((a) => a.numero),
  });
  // El pago ya quedó guardado. El aviso en vivo corre aparte y, si falla, no cambia la respuesta: un reintento de pey
  // caería en "duplicado" y tampoco lo repetiría.
  avisar({ tipo: "pago", pago: conciliado });
  return json({ ok: true, duplicado: false, estado: conciliado.estado, motivo: conciliado.motivo });
}
