// Fechas en hora de la Ciudad de México. Desde 2022 el centro del país no cambia de horario: siempre UTC−6.
// Los días se manejan como texto AAAA-MM-DD para que comparar y ordenar sea directo.

const DESFASE_MS = 6 * 3_600_000;
const DIA_MS = 86_400_000;
const FORMATO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function aUtc(dia: string): number {
  const m = FORMATO_DIA.exec(dia);
  if (!m) throw new Error(`Fecha inválida: ${dia}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function aTexto(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Día calendario en la Ciudad de México. */
export function diaCdmx(fecha = new Date()): string {
  return aTexto(fecha.getTime() - DESFASE_MS);
}

/** Instante (ISO, UTC) de una hora del reloj de la Ciudad de México en el día indicado. */
export function instanteCdmx(dia: string, hora: number, minuto = 0): string {
  return new Date(aUtc(dia) + DESFASE_MS + hora * 3_600_000 + minuto * 60_000).toISOString();
}

/** Instante (ISO, UTC) en que empieza el día de la Ciudad de México. */
export function inicioDelDiaCdmx(fecha = new Date()): string {
  return instanteCdmx(diaCdmx(fecha), 0);
}

/** Día y hora del reloj de la Ciudad de México de un instante ISO: { dia: "2026-11-25", hora: "10:42:07" }. */
export function relojCdmx(instante: string): { dia: string; hora: string } {
  const local = new Date(Date.parse(instante) - DESFASE_MS).toISOString();
  return { dia: local.slice(0, 10), hora: local.slice(11, 19) };
}

/** true solo para una fecha real con formato AAAA-MM-DD. */
export function esDia(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FORMATO_DIA.test(valor)) return false;
  return aTexto(aUtc(valor)) === valor;
}

export function sumarDias(dia: string, dias: number): string {
  return aTexto(aUtc(dia) + dias * DIA_MS);
}

/** Suma meses conservando el día; si el mes destino es más corto, usa su último día (31 ene + 1 mes = 28 feb). */
export function sumarMeses(dia: string, meses: number): string {
  const base = new Date(aUtc(dia));
  const destino = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(base.getUTCDate(), ultimoDia));
  return aTexto(destino.getTime());
}

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS);
}

/** Horario en que CONDUSEF permite gestiones de cobranza: de 7:00 a 22:00. */
export const HORARIO_GESTION = { desde: 7, hasta: 22 } as const;

export function dentroDeHorario(fecha = new Date()): boolean {
  const hora = new Date(fecha.getTime() - DESFASE_MS).getUTCHours();
  return hora >= HORARIO_GESTION.desde && hora < HORARIO_GESTION.hasta;
}
