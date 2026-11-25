// Lo que depende de la configuración del Worker: modo simulación, roles y secretos.

import { compararSecreto, sha256Hex } from "../core/tokens.ts";
import { tokenBearer } from "./http.ts";

/**
 * - `admin`: la financiera. Todo, incluido reemplazar la cartera y reiniciar la demo.
 * - `jurado`: usa la app del gestor y el portal, pero no puede reemplazar la cartera ni reiniciar la demo, y ve las
 *   claves de rastreo recortadas.
 */
export type Rol = "admin" | "jurado";

/** Clave de acceso mientras la demo está en simulación y aún no se configuran las claves reales. */
export const CLAVE_DEMO = "demo";

// Secreto de firma que solo se usa en simulación, cuando todavía no hay secreto de pey. Es público a propósito:
// en simulación no se mueve dinero y cualquiera puede "simular un pago" desde la página.
const SECRETO_SIMULACION = "whsec_cWFkcmEtc2ltdWxhY2lvbi1zaW4tZGluZXJvLXJlYWw=";

/**
 * La simulación solo existe mientras no hay API key de pey. En cuanto se configura `PEY_API_KEY`, los cobros son
 * reales y todo lo simulado deja de estar disponible, aunque `SIMULACION` siga en 1.
 */
export function modoSimulacion(env: Env): boolean {
  return String(env.SIMULACION ?? "") === "1" && !env.PEY_API_KEY;
}

/** Secreto con el que se verifican los avisos de pago. Con API key de pey, solo vale el secreto real de pey. */
export function secretoAvisos(env: Env): string {
  return env.PEY_WEBHOOK_SECRET || (modoSimulacion(env) ? SECRETO_SIMULACION : "");
}

/** Secreto con el que se firman los boletos de los canales en vivo. */
export function secretoBoletos(env: Env): string {
  return env.PORTAL_TOKEN || env.JURADO_TOKEN || (modoSimulacion(env) ? SECRETO_SIMULACION : "");
}

/** true si se puede entrar con la clave "demo": en simulación y sin claves reales configuradas. */
export function claveDemoActiva(env: Env): boolean {
  return modoSimulacion(env) && !env.PORTAL_TOKEN && !env.JURADO_TOKEN;
}

function enteroNoNegativo(valor: unknown): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Tope por cobro real de la demo pública, en centavos (0 = sin tope). En simulación no hay tope: no es dinero real. */
export function topeDemo(env: Env): number {
  return modoSimulacion(env) ? 0 : enteroNoNegativo(env.TOPE_DEMO_CENTAVOS);
}

/** true si los cobros y las visitas fuera de 7:00 a 22:00 se bloquean en lugar de solo avisar. */
export function horarioEstricto(env: Env): boolean {
  return String(env.HORARIO_ESTRICTO ?? "") === "1";
}

export async function rolDe(request: Request, env: Env): Promise<Rol | null> {
  const token = tokenBearer(request);
  if (!token) return null;
  if (await compararSecreto(token, env.PORTAL_TOKEN ?? "")) return "admin";
  if (await compararSecreto(token, env.JURADO_TOKEN ?? "")) return "jurado";
  if (claveDemoActiva(env) && (await compararSecreto(token, CLAVE_DEMO))) return "jurado";
  return null;
}

/** Huella de la IP con sal (no se guarda la IP en claro). Sirve de llave para los límites de uso. */
export function huellaIp(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "desconocida";
  return sha256Hex(`qadra:${secretoBoletos(env)}:${ip}`).then((h) => h.slice(0, 24));
}
