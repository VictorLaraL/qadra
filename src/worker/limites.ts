// Límites de uso por ventana de tiempo, guardados en D1. Protegen la cuenta de pey y la base de la demo pública.

import { huellaIp } from "./entorno.ts";
import { json } from "./http.ts";

export interface Limite {
  maximo: number;
  ventanaSeg: number;
}

/** Límites por persona (huella de IP) y globales. */
export const LIMITES = {
  cobroPorPersona: { maximo: 30, ventanaSeg: 600 },
  cobroGlobal: { maximo: 200, ventanaSeg: 600 },
  // El cobro al celular le llega a una persona en la app de su banco: límites mucho más bajos, por persona y por día,
  // para que una clave compartida no sirva para mandar solicitudes en masa.
  pushPorPersona: { maximo: 3, ventanaSeg: 600 },
  pushGlobal: { maximo: 60, ventanaSeg: 86_400 },
  simulacionPorPersona: { maximo: 40, ventanaSeg: 600 },
  visitaPorPersona: { maximo: 60, ventanaSeg: 600 },
  archivoPorPersona: { maximo: 12, ventanaSeg: 600 },
  cuadreGlobal: { maximo: 20, ventanaSeg: 600 },
} as const satisfies Record<string, Limite>;

/**
 * Cuenta un uso y dice si todavía cabe en el límite. La cuenta se reinicia sola al cambiar de ventana.
 * Es una sola sentencia, así que dos solicitudes simultáneas no se pisan.
 */
export async function consumir(db: D1Database, clave: string, limite: Limite, ahoraMs = Date.now()): Promise<boolean> {
  const ventana = Math.floor(ahoraMs / 1000 / limite.ventanaSeg);
  const fila = await db
    .prepare(
      `INSERT INTO limites (clave, cuenta, ventana) VALUES (?1, 1, ?2)
       ON CONFLICT (clave) DO UPDATE SET cuenta = CASE WHEN ventana = ?2 THEN cuenta + 1 ELSE 1 END, ventana = ?2
       RETURNING cuenta`,
    )
    .bind(clave, ventana)
    .first<{ cuenta: number }>();
  return (fila?.cuenta ?? 1) <= limite.maximo;
}

/** null si la persona todavía cabe en su límite; si no, la respuesta 429 ya lista con el mensaje indicado. */
export async function limitePorPersona(request: Request, env: Env, nombre: string, limite: Limite, mensaje: string): Promise<Response | null> {
  const persona = await huellaIp(request, env);
  return (await consumir(env.DB, `${nombre}:${persona}`, limite)) ? null : json({ error: mensaje }, 429);
}

/** null si el uso de toda la demo todavía cabe en el límite; si no, la respuesta 429 ya lista. */
export async function limiteGlobal(env: Env, nombre: string, limite: Limite, mensaje: string): Promise<Response | null> {
  return (await consumir(env.DB, `${nombre}:todos`, limite)) ? null : json({ error: mensaje }, 429);
}
