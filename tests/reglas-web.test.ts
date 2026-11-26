import { test } from "node:test";
import assert from "node:assert/strict";
// Reglas del navegador que no dependen de la página: se prueban aquí igual que el núcleo del servidor.
import { aCentavos, destinoDeVisitaEnCola, estadoDeCuota, etiquetaDeBarra } from "../web/reglas.js";

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
  for (const status of [0, 401, 403, 429, 500, 502, 503]) assert.equal(destinoDeVisitaEnCola(status), "conservar", String(status));
  // El servidor dijo que esa visita no es válida (datos malos o crédito que ya no existe): reintentar no la arregla.
  for (const status of [400, 404]) assert.equal(destinoDeVisitaEnCola(status), "descartar", String(status));
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

test("la etiqueta de la gráfica abrevia en miles solo a partir de mil pesos", () => {
  assert.equal(etiquetaDeBarra(99_900), "$999");
  assert.equal(etiquetaDeBarra(50_000), "$500");
  assert.equal(etiquetaDeBarra(100_000), "$1.0k");
  assert.equal(etiquetaDeBarra(2_287_000), "$22.9k");
  assert.equal(etiquetaDeBarra(0), "$0");
});
