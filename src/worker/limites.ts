// Límites de uso por ventana de tiempo, guardados en D1. Protegen la cuenta de pey y la base de la demo pública.

export interface Limite {
  maximo: number;
  ventanaSeg: number;
}

/** Límites por persona (huella de IP) y globales. */
export const LIMITES = {
  cobroPorPersona: { maximo: 15, ventanaSeg: 600 },
  cobroGlobal: { maximo: 150, ventanaSeg: 600 },
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
