import { test } from "node:test";
import assert from "node:assert/strict";
import { compararConPey, estadoCredito, planAplicacion, type Cuota } from "../src/core/conciliacion.ts";

// Crédito de 4 cuotas semanales de $450.00. La 1 está pagada, la 2 tiene un abono de $100.00.
const CUOTAS: Cuota[] = [
  { numero: 1, vence: "2026-11-04", montoCentavos: 45_000, pagadoCentavos: 45_000 },
  { numero: 2, vence: "2026-11-11", montoCentavos: 45_000, pagadoCentavos: 10_000 },
  { numero: 3, vence: "2026-11-18", montoCentavos: 45_000, pagadoCentavos: 0 },
  { numero: 4, vence: "2026-11-25", montoCentavos: 45_000, pagadoCentavos: 0 },
];

test("un pago se aplica a la cuota pendiente más antigua y dice si la liquida", () => {
  assert.deepEqual(planAplicacion(CUOTAS, 35_000), {
    aplicaciones: [{ numero: 2, montoCentavos: 35_000, liquida: true }],
    aplicadoCentavos: 35_000,
    excedenteCentavos: 0,
  });
});

test("un abono menor que lo pendiente deja la cuota parcial", () => {
  assert.deepEqual(planAplicacion(CUOTAS, 1), {
    aplicaciones: [{ numero: 2, montoCentavos: 1, liquida: false }],
    aplicadoCentavos: 1,
    excedenteCentavos: 0,
  });
});

test("un pago mayor que la cuota sigue con las siguientes, en orden", () => {
  assert.deepEqual(planAplicacion(CUOTAS, 90_000), {
    aplicaciones: [
      { numero: 2, montoCentavos: 35_000, liquida: true },
      { numero: 3, montoCentavos: 45_000, liquida: true },
      { numero: 4, montoCentavos: 10_000, liquida: false },
    ],
    aplicadoCentavos: 90_000,
    excedenteCentavos: 0,
  });
});

test("lo que rebasa el saldo del crédito queda como excedente, nunca se aplica de más", () => {
  const plan = planAplicacion(CUOTAS, 130_000);
  assert.equal(plan.aplicadoCentavos, 125_000);
  assert.equal(plan.excedenteCentavos, 5_000);
  assert.equal(plan.aplicaciones.at(-1)?.liquida, true);
});

test("el orden lo dan los números de cuota aunque lleguen desordenadas", () => {
  const revueltas = [CUOTAS[3], CUOTAS[1], CUOTAS[0], CUOTAS[2]];
  assert.deepEqual(
    planAplicacion(revueltas, 40_000).aplicaciones.map((a) => a.numero),
    [2, 3],
  );
});

test("sin cuotas pendientes o con un monto que no es un entero positivo no se aplica nada", () => {
  const liquidado = CUOTAS.map((c) => ({ ...c, pagadoCentavos: c.montoCentavos }));
  assert.deepEqual(planAplicacion(liquidado, 500), { aplicaciones: [], aplicadoCentavos: 0, excedenteCentavos: 500 });
  for (const monto of [0, -5, 1.5, Number.NaN]) {
    assert.deepEqual(planAplicacion(CUOTAS, monto), { aplicaciones: [], aplicadoCentavos: 0, excedenteCentavos: 0 }, `con ${monto}`);
  }
});

test("estado del crédito: atrasado, con lo exigible a hoy y los días desde la cuota más vieja", () => {
  assert.deepEqual(estadoCredito(CUOTAS, "2026-11-25"), {
    situacion: "atrasado",
    saldoCentavos: 125_000,
    exigibleCentavos: 125_000,
    diasAtraso: 14,
    cuotasPagadas: 1,
    cuotasTotales: 4,
    cuotaActual: { numero: 2, vence: "2026-11-11", montoCentavos: 45_000, pagadoCentavos: 10_000, pendienteCentavos: 35_000 },
  });
});

test("estado del crédito: vence hoy cuando lo único exigible es la cuota de hoy", () => {
  const cuotas = CUOTAS.map((c) => (c.numero < 4 ? { ...c, pagadoCentavos: c.montoCentavos } : c));
  const e = estadoCredito(cuotas, "2026-11-25");
  assert.equal(e.situacion, "vence-hoy");
  assert.equal(e.exigibleCentavos, 45_000);
  assert.equal(e.diasAtraso, 0);
});

test("estado del crédito: al corriente si la siguiente cuota aún no vence, y liquidado si no debe nada", () => {
  const alCorriente = estadoCredito(CUOTAS, "2026-11-10");
  assert.equal(alCorriente.situacion, "al-corriente");
  assert.equal(alCorriente.exigibleCentavos, 0);
  assert.equal(alCorriente.saldoCentavos, 125_000);

  const liquidado = estadoCredito(
    CUOTAS.map((c) => ({ ...c, pagadoCentavos: c.montoCentavos })),
    "2026-11-25",
  );
  assert.deepEqual(
    { s: liquidado.situacion, saldo: liquidado.saldoCentavos, actual: liquidado.cuotaActual, pagadas: liquidado.cuotasPagadas },
    { s: "liquidado", saldo: 0, actual: null, pagadas: 4 },
  );
});

test("cuadre con pey: cuadra cuando los mismos pagos están en los dos lados", () => {
  const qadra = [
    { transactionId: "TX1", montoCentavos: 1 },
    { transactionId: "TX2", montoCentavos: 45_000 },
  ];
  const pey = [
    { transactionId: "TX2", montoCentavos: 45_000 },
    { transactionId: "TX1", montoCentavos: 1 },
  ];
  assert.deepEqual(compararConPey(qadra, pey), {
    cuadra: true,
    qadra: { pagos: 2, totalCentavos: 45_001 },
    pey: { pagos: 2, totalCentavos: 45_001 },
    faltanEnQadra: [],
    faltanEnPey: [],
    montosDistintos: [],
    repetidos: [],
  });
});

test("cuadre con pey: un pago registrado dos veces nunca cuadra, aunque exista en los dos lados", () => {
  const r = compararConPey(
    [
      { transactionId: "TX1", montoCentavos: 100 },
      { transactionId: "TX1", montoCentavos: 100 },
    ],
    [{ transactionId: "TX1", montoCentavos: 100 }],
  );
  assert.equal(r.cuadra, false);
  assert.deepEqual(r.repetidos, ["TX1"]);
  assert.deepEqual([r.qadra.totalCentavos, r.pey.totalCentavos], [200, 100]);
});

test("cuadre con pey: un pago repetido del lado de pey tampoco cuadra, y cada repetido se lista una sola vez", () => {
  const uno = { transactionId: "TX1", montoCentavos: 100 };
  const soloEnPey = compararConPey([uno], [uno, uno]);
  assert.deepEqual([soloEnPey.cuadra, soloEnPey.repetidos], [false, ["TX1"]]);
  const enAmbos = compararConPey([uno, uno, uno], [uno, uno]);
  assert.deepEqual([enAmbos.cuadra, enAmbos.repetidos], [false, ["TX1"]]);
});

test("cuadre con pey: señala el pago que pey cobró y Qadra no registró (aviso perdido)", () => {
  const r = compararConPey([{ transactionId: "TX1", montoCentavos: 1 }], [
    { transactionId: "TX1", montoCentavos: 1 },
    { transactionId: "TX9", montoCentavos: 45_000 },
  ]);
  assert.equal(r.cuadra, false);
  assert.deepEqual(r.faltanEnQadra, [{ transactionId: "TX9", montoCentavos: 45_000 }]);
  assert.deepEqual(r.faltanEnPey, []);
});

test("cuadre con pey: señala pagos que solo tiene Qadra y montos que no coinciden", () => {
  const r = compararConPey(
    [
      { transactionId: "TX1", montoCentavos: 100 },
      { transactionId: "TX2", montoCentavos: 5 },
    ],
    [{ transactionId: "TX1", montoCentavos: 150 }],
  );
  assert.equal(r.cuadra, false);
  assert.deepEqual(r.faltanEnPey, [{ transactionId: "TX2", montoCentavos: 5 }]);
  assert.deepEqual(r.montosDistintos, [{ transactionId: "TX1", qadraCentavos: 100, peyCentavos: 150 }]);
});
