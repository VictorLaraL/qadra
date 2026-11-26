// Reglas del navegador que no dependen de la página. Viven aparte para poder probarlas con `npm test`
// (tests/reglas-web.test.ts), igual que el núcleo del servidor.

import { pesos } from "./comun.js";

/** La cuota que llega por el canal en vivo solo se usa si es un número de cuota; si no, el pago queda "por revisar". */
const cuotaValida = (cuota) => (Number.isInteger(cuota) && cuota > 0 ? cuota : null);

/**
 * Cómo se dice un pago recibido en la landing: en el teléfono ("Aplicado"), en la tarjeta de la oficina y en el aviso
 * para lector de pantalla. Una sola regla para los tres, así no se contradicen.
 */
export function resumenDelPago(pago) {
  const monto = pesos(pago.montoCentavos);
  const cuota = cuotaValida(pago.cuota);
  return {
    cuota,
    aplicado: cuota ? `Abono a la cuota ${cuota}` : "Por revisar",
    oficina: cuota ? `${monto} a la cuota ${cuota}` : `${monto} por revisar`,
    anuncio: cuota ? `Pagado: ${monto} con CoDi, abono a la cuota ${cuota}.` : `Pagado: ${monto} con CoDi. La oficina lo revisa.`,
  };
}

/**
 * Convierte a centavos lo que la persona escribe en un campo de monto: "450", " $1,250.50 ".
 * Regresa null si no es una cantidad mayor que cero con hasta dos decimales.
 */
export function aCentavos(texto) {
  const limpio = String(texto ?? "").replace(/[\s$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const centavos = Math.round(Number(limpio) * 100);
  return centavos > 0 ? centavos : null;
}

/**
 * Qué hacer cuando falla el envío de una visita guardada sin conexión. Toda la política de la cola vive aquí:
 * - conservar: solo se descarta si el servidor la rechazó de forma definitiva (datos inválidos o crédito inexistente).
 *   Con cualquier otra falla (sin red, sesión vencida, límite de uso, error del servidor) se conserva para reintentar,
 *   porque es evidencia del trabajo del gestor.
 * - seguir: sin red, sin sesión o con el límite de uso alcanzado las demás visitas fallarían igual, así que el envío se
 *   detiene; una falla de esa visita en particular no impide intentar con las demás.
 * - claveVencida: la clave dejó de servir y hay que cerrar la sesión.
 * @param {number} status Estado HTTP de la respuesta; 0 si no hubo red.
 * @returns {{conservar: boolean, seguir: boolean, claveVencida: boolean}}
 */
export function destinoDeVisitaEnCola(status) {
  return {
    conservar: status !== 400 && status !== 404,
    seguir: status !== 0 && status !== 401 && status !== 429,
    claveVencida: status === 401,
  };
}

/**
 * ¿Una visita guardada en este teléfono es de otra sesión? Si lo es no se envía sola: en un teléfono compartido las
 * visitas de una persona no deben salir con la clave de otra, así que se le pregunta a quien entró.
 * `dueno` y `actual` son huellas de la clave (nunca la clave); sin alguna de las dos no se puede afirmar que sea suya.
 */
export function esDeOtraSesion(dueno, actual) {
  return !dueno || !actual || dueno !== actual;
}

/**
 * Estado de una cuota para pintarla: la clase da el color y el texto es lo que escucha quien usa lector de pantalla.
 * Una sola regla para los dos, así no se pueden contradecir.
 */
export function estadoDeCuota(cuota, hoy) {
  if (cuota.pagadoCentavos >= cuota.montoCentavos) return { clase: "pagada", texto: "pagada" };
  if (cuota.pagadoCentavos > 0) return { clase: "parcial", texto: "con abono" };
  if (cuota.vence < hoy) return { clase: "vencida", texto: "vencida" };
  if (cuota.vence === hoy) return { clase: "hoy", texto: "vence hoy" };
  return { clase: "", texto: "por vencer" };
}

const listaEnEspanol = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/** [7] -> "Cuota 7 pagada completa"; [7, 8, 9] -> "Cuotas 7, 8 y 9 pagadas completas". */
export function cuotasPagadas(numeros) {
  const varias = numeros.length > 1;
  return `${varias ? "Cuotas" : "Cuota"} ${listaEnEspanol.format(numeros.map(String))} ${varias ? "pagadas completas" : "pagada completa"}`;
}

/**
 * Qué ve el acreditado en la página de pago y si hay que seguir consultando al servidor.
 * Un cobro pagado cuyo recibo todavía no llega NO se muestra como pendiente (ya no hay nada que pagar): se dice que el
 * pago se recibió y se sigue consultando hasta tener el recibo.
 * @returns {{vista: "pendiente" | "recibo" | "confirmando" | "vencido", seguir: boolean}}
 */
export function pantallaDePago(estado, tieneRecibo) {
  if (estado === "pagado") return tieneRecibo ? { vista: "recibo", seguir: false } : { vista: "confirmando", seguir: true };
  if (estado === "vencido") return { vista: "vencido", seguir: false };
  return { vista: "pendiente", seguir: true };
}

/**
 * Huella de un pago de la lista pública de la demo, para reconocer después si llegó uno nuevo cuando el canal en vivo
 * no estaba conectado. Sin pago, la huella es "".
 */
export function huellaDePago(pago) {
  return pago ? `${pago.fecha}|${pago.claveRastreo ?? ""}|${pago.montoCentavos}` : "";
}

const MIL_PESOS = 100_000; // en centavos

/**
 * Etiqueta corta para la gráfica de la semana: pesos enteros, o miles con un decimal a partir de $1,000.
 * Debajo de mil se recorta (no se redondea) para que $999.99 no aparezca como "$1000" junto a un "$1.0k".
 */
export function etiquetaDeBarra(centavos) {
  return centavos >= MIL_PESOS ? `$${(centavos / MIL_PESOS).toFixed(1)}k` : `$${Math.floor(centavos / 100)}`;
}
