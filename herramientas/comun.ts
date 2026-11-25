// Utilidades de las herramientas locales (simulador y pruebas e2e).

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { firmarAviso } from "../src/core/firma.ts";

export const BASE = process.env.BASE_URL ?? "http://localhost:8790";

/** Lee .dev.vars (KEY=VALUE) para usar las mismas claves que el servidor local. */
export function leerDevVars(ruta = ".dev.vars"): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

export interface AvisoDePrueba {
  tipo?: "qr" | "pn";
  montoCentavos: number;
  codiQrId?: string;
  transactionId?: string;
  /** Folio del cobro: viaja como numRef. */
  folio?: number;
  /** Identificador del cobro: viaja en la metadata. */
  cobro?: string;
  concepto?: string;
}

/** Arma un aviso con la misma forma que manda pey (docs.pey.mx/docs/webhooks/codi/qr y /codi/pn). */
export function avisoDePago(a: AvisoDePrueba) {
  const tipo = a.tipo ?? "qr";
  return {
    type: `codi.${tipo}.payment_received`,
    amount: a.montoCentavos / 100,
    apiKeyId: "PRUEBA",
    ...(tipo === "qr" && a.codiQrId ? { codiQrId: a.codiQrId } : {}),
    concept: a.concepto ?? "Abono de prueba",
    datePaid: Math.floor(Date.now() / 1000),
    metadata: {
      clabe: "012180001234567895",
      bankCode: 40012,
      accountType: 40,
      trackingKey: "E2E" + randomBytes(8).toString("hex").toUpperCase(),
      externalMetadata: a.cobro ? { cobro: a.cobro } : {},
    },
    numRef: a.folio ? String(a.folio) : "0",
    transactionId: a.transactionId ?? "E2ETX" + randomBytes(8).toString("hex").toUpperCase(),
  };
}

/** Envía un aviso firmado igual que pey. */
export function enviarAviso(secreto: string, aviso: unknown, webhookId?: string) {
  return enviarCuerpoFirmado(secreto, JSON.stringify(aviso), webhookId);
}

/** Firma y envía un cuerpo tal cual (para probar cuerpos que no son JSON o demasiado grandes). */
export async function enviarCuerpoFirmado(secreto: string, cuerpo: string, webhookId = "msg_" + randomBytes(8).toString("hex")) {
  const ts = Math.floor(Date.now() / 1000);
  return fetch(`${BASE}/webhooks/pey`, {
    method: "POST",
    body: cuerpo,
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(ts),
      "webhook-signature": await firmarAviso(secreto, webhookId, ts, cuerpo),
    },
  });
}

/** Llama al API de la app con una clave de acceso. Regresa el estado HTTP y el cuerpo ya leído. */
export async function api<T = Record<string, any>>(
  ruta: string,
  opciones: { clave?: string; metodo?: string; cuerpo?: unknown; texto?: string } = {},
): Promise<{ status: number; datos: T }> {
  const respuesta = await fetch(BASE + ruta, {
    method: opciones.metodo ?? (opciones.cuerpo !== undefined || opciones.texto !== undefined ? "POST" : "GET"),
    headers: {
      ...(opciones.clave ? { Authorization: `Bearer ${opciones.clave}` } : {}),
      ...(opciones.cuerpo !== undefined ? { "content-type": "application/json" } : {}),
      ...(opciones.texto !== undefined ? { "content-type": "text/csv" } : {}),
    },
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : opciones.texto,
  });
  const texto = await respuesta.text();
  let datos: unknown = texto;
  try {
    datos = JSON.parse(texto);
  } catch {
    // respuesta que no es JSON (por ejemplo, un CSV)
  }
  return { status: respuesta.status, datos: datos as T };
}
