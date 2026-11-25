import { test } from "node:test";
import assert from "node:assert/strict";
import { generarCuotas } from "../src/core/cartera.ts";
import { estadoCredito } from "../src/core/conciliacion.ts";
import { CREDITO_DEMO, datosDeEjemplo } from "../src/core/ejemplo.ts";

const HOY = "2026-11-25";
const datos = datosDeEjemplo(HOY);
const estado = (id: string) => estadoCredito(generarCuotas(datos.creditos.find((c) => c.id === id)!), HOY);

test("la cartera de ejemplo tiene créditos con número único y un gestor que existe", () => {
  const ids = datos.creditos.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 20);
  const gestores = new Set(datos.gestores.map((g) => g.id));
  for (const c of datos.creditos) {
    assert.ok(gestores.has(c.gestorId), c.id);
    assert.match(c.id, /^[A-Za-z0-9-]{1,12}$/);
    assert.ok(c.cuotasPagadas < c.cuotasTotales, `${c.id} no debe estar liquidado`);
  }
});

test("ningún crédito de ejemplo trae teléfono: no se inventan celulares que podrían ser de alguien", () => {
  assert.deepEqual(
    datos.creditos.filter((c) => c.telefono !== null),
    [],
  );
});

test("el crédito de la demo pública vence hoy y está en la ruta del primer gestor", () => {
  const demo = datos.creditos.filter((c) => c.demo);
  assert.deepEqual(
    demo.map((c) => [c.id, c.gestorId]),
    [[CREDITO_DEMO, "g1"]],
  );
  assert.equal(estado(CREDITO_DEMO).situacion, "vence-hoy");
});

test("la ruta del primer gestor mezcla cuotas que vencen hoy, atrasos y un crédito al corriente", () => {
  const situaciones = datos.creditos.filter((c) => c.gestorId === "g1").map((c) => estado(c.id).situacion);
  assert.ok(situaciones.filter((s) => s === "vence-hoy").length >= 4, situaciones.join());
  assert.ok(situaciones.filter((s) => s === "atrasado").length >= 2, situaciones.join());
  assert.ok(situaciones.includes("al-corriente"), situaciones.join());
});

test("los pagos de ejemplo cubren lo exigible de un crédito que existe, en horario de gestión y en orden", () => {
  const pagos = datos.eventos.filter((e) => e.tipo === "pago");
  assert.ok(pagos.length >= 10);
  for (const e of pagos) {
    assert.equal(e.montoCentavos, estado(e.creditoId).exigibleCentavos, e.id);
    assert.ok(e.montoCentavos > 0, e.id);
    assert.notEqual(e.banco, "", e.id);
  }
  assert.ok(!pagos.some((e) => e.creditoId === CREDITO_DEMO), "el crédito de la demo queda libre para los pagos reales");
  const horas = datos.eventos.map((e) => e.hora);
  assert.deepEqual(horas, [...horas].sort());
  assert.ok(horas[0] >= "2026-11-25T13:00:00.000Z" && horas.at(-1)! < "2026-11-26T04:00:00.000Z", "entre 7:00 y 22:00 del centro");
  assert.equal(new Set(datos.eventos.map((e) => e.creditoId)).size, datos.eventos.length, "un evento por crédito");
});

test("las visitas de ejemplo sin pago llevan nota y no mueven dinero", () => {
  const visitas = datos.eventos.filter((e) => e.tipo === "gestion");
  assert.ok(visitas.length >= 2);
  for (const e of visitas) {
    assert.equal(e.montoCentavos, 0);
    assert.ok(e.nota && e.nota.length <= 280, e.id);
    assert.doesNotMatch(e.nota, /amenaz|embarg|demand|cárcel/i, "sin lenguaje de cobranza agresiva");
  }
});

test("el histórico cubre los 6 días anteriores a hoy", () => {
  assert.deepEqual(
    datos.historico.map((h) => h.dia),
    ["2026-11-24", "2026-11-23", "2026-11-22", "2026-11-21", "2026-11-20", "2026-11-19"],
  );
  assert.ok(datos.historico.every((h) => h.cobradoCentavos > 0 && h.pagos > 0));
});

test("las fechas siguen al día que se pida", () => {
  const otro = datosDeEjemplo("2027-01-02");
  assert.equal(otro.creditos.find((c) => c.id === CREDITO_DEMO)?.proximoVencimiento, "2027-01-02");
  assert.match(otro.eventos[0].id, /^EJ-2027-01-02-01$/);
});
