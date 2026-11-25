// Dinero siempre en centavos enteros: así las sumas de la conciliación son exactas.

const NUMERO_SIMPLE = /^\d+(\.\d{1,2})?$/;
const CON_MILES = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

/**
 * Convierte a centavos lo que una persona escribe en Excel o en un formulario: 450, "450.5", " $1,250.50 ".
 * Regresa null si no es una cantidad de dinero válida (negativa, con más de dos decimales o con texto).
 */
export function aCentavos(valor: unknown): number | null {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || valor < 0) return null;
    const centavos = Math.round(valor * 100);
    return Math.abs(valor * 100 - centavos) < 1e-6 ? centavos : null;
  }
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/[\s$]/g, "");
  if (!NUMERO_SIMPLE.test(limpio) && !CON_MILES.test(limpio)) return null;
  const [entero, decimales = ""] = limpio.replaceAll(",", "").split(".");
  return Number(entero) * 100 + Number(decimales.padEnd(2, "0"));
}

/** Formato de moneda: 45000 -> "$450.00". */
export function pesos(centavos: number): string {
  const absoluto = Math.abs(centavos);
  const entero = Math.trunc(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraccion = String(absoluto % 100).padStart(2, "0");
  return `${centavos < 0 ? "-" : ""}$${entero}.${fraccion}`;
}
