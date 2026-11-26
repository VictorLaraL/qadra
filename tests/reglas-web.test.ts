import { test } from "node:test";
import assert from "node:assert/strict";
// Reglas del navegador que no dependen de la página: se prueban aquí igual que el núcleo del servidor.
import { aCentavos, cuotasPagadas, destinoDeVisitaEnCola, esDeOtraSesion, estadoDeCuota, etiquetaDeBarra, huellaDePago, pantallaDePago } from "../web/reglas.js";

test("aCentavos del formulario: acepta pesos con o sin centavos y rechaza lo demás", () => {
  assert.equal(aCentavos("450"), 45_000);
  assert.equal(aCentavos(" $1,250.50 "), 125_050);
  assert.equal(aCentavos("0.07"), 7);
  assert.equal(aCentavos("0.01"), 1);
  for (const malo of ["", "0", "0.00", "-5", "12.", "4.505", "abc", "1.2.3", null, undefined]) {
    assert.equal(aCentavos(malo), null, `con ${JSON.stringify(malo)}`);
  }
});

test("una visita en cola solo se descarta si el servidor la rechaza de forma definitiva", () => {
  // Sin red, sesión vencida, límite de uso o falla del servidor: la visita se conserva para reintentar.
  for (const status of [0, 401, 403, 429, 500, 502, 503]) assert.equal(destinoDeVisitaEnCola(status).conservar, true, String(status));
  // El servidor dijo que esa visita no es válida (datos malos o crédito que ya no existe): reintentar no la arregla.
  for (const status of [400, 404]) assert.equal(destinoDeVisitaEnCola(status).conservar, false, String(status));
});

test("la misma regla dice si vale la pena seguir enviando el resto de la cola", () => {
  // Sin red, sin sesión o con el límite de uso alcanzado, las demás visitas fallarían igual: el envío se detiene.
  for (const status of [0, 401, 429]) assert.equal(destinoDeVisitaEnCola(status).seguir, false, String(status));
  // Una falla de esa visita en particular no impide intentar con las demás.
  for (const status of [400, 403, 404, 500, 503]) assert.equal(destinoDeVisitaEnCola(status).seguir, true, String(status));
  // Solo una clave que ya no sirve cierra la sesión.
  assert.equal(destinoDeVisitaEnCola(401).claveVencida, true);
  for (const status of [0, 400, 403, 429, 500]) assert.equal(destinoDeVisitaEnCola(status).claveVencida, false, String(status));
});

test("una visita guardada solo se envía sola si la guardó la misma clave que está en sesión", () => {
  assert.equal(esDeOtraSesion("abc", "abc"), false, "misma clave: se envía sola");
  assert.equal(esDeOtraSesion("abc", "xyz"), true, "otra clave: se pregunta");
  assert.equal(esDeOtraSesion("", "xyz"), true, "visita sin dueño conocido: se pregunta");
  assert.equal(esDeOtraSesion("abc", ""), true, "sin huella de la sesión no se puede afirmar que sea suya");
});

test("el estado de una cuota sale de una sola regla, para el color y para el texto que se lee en voz alta", () => {
  const hoy = "2026-11-25";
  const cuota = (pagado: number, vence: string) => estadoDeCuota({ montoCentavos: 45_000, pagadoCentavos: pagado, vence }, hoy);
  assert.deepEqual(cuota(45_000, "2026-11-18"), { clase: "pagada", texto: "pagada" });
  assert.deepEqual(cuota(100, "2026-11-18"), { clase: "parcial", texto: "con abono" });
  assert.deepEqual(cuota(0, "2026-11-18"), { clase: "vencida", texto: "vencida" });
  assert.deepEqual(cuota(0, "2026-11-25"), { clase: "hoy", texto: "vence hoy" });
  assert.deepEqual(cuota(0, "2026-12-02"), { clase: "", texto: "por vencer" });
});

test("el texto de cuotas pagadas concuerda en número y arma la lista como se dice en español", () => {
  assert.equal(cuotasPagadas([7]), "Cuota 7 pagada completa");
  assert.equal(cuotasPagadas([7, 8]), "Cuotas 7 y 8 pagadas completas");
  assert.equal(cuotasPagadas([7, 8, 9]), "Cuotas 7, 8 y 9 pagadas completas");
});

test("la página de pago nunca muestra como pendiente un cobro ya pagado, aunque el recibo tarde en llegar", () => {
  assert.deepEqual(pantallaDePago("pendiente", false), { vista: "pendiente", seguir: true });
  assert.deepEqual(pantallaDePago("pagado", true), { vista: "recibo", seguir: false });
  // Pagado sin recibo todavía: ya no hay nada que pagar, así que no se enseña el QR; se sigue consultando.
  assert.deepEqual(pantallaDePago("pagado", false), { vista: "confirmando", seguir: true });
  assert.deepEqual(pantallaDePago("vencido", false), { vista: "vencido", seguir: false });
});

test("un pago nuevo se reconoce porque su huella cambia; sin pago no hay huella", () => {
  const pago = { fecha: "2026-11-25T16:00:00.000Z", claveRastreo: "SIMAB1…22CD", montoCentavos: 1 };
  assert.equal(huellaDePago(pago), huellaDePago({ ...pago, banco: "Santander" }));
  assert.notEqual(huellaDePago(pago), huellaDePago({ ...pago, fecha: "2026-11-25T16:00:05.000Z" }));
  assert.notEqual(huellaDePago(pago), huellaDePago({ ...pago, claveRastreo: "SIMZZ9…00AA" }));
  assert.equal(huellaDePago(null), "");
  assert.equal(huellaDePago(undefined), "");
});

test("la etiqueta de la gráfica abrevia en miles solo a partir de mil pesos", () => {
  assert.equal(etiquetaDeBarra(99_900), "$999");
  // Justo debajo de mil pesos no se redondea hacia arriba: "$1000" junto a "$1.0k" se contradirían.
  assert.equal(etiquetaDeBarra(99_950), "$999");
  assert.equal(etiquetaDeBarra(99_999), "$999");
  assert.equal(etiquetaDeBarra(50_000), "$500");
  assert.equal(etiquetaDeBarra(100_000), "$1.0k");
  assert.equal(etiquetaDeBarra(2_287_000), "$22.9k");
  assert.equal(etiquetaDeBarra(0), "$0");
});
