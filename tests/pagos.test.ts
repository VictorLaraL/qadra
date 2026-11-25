import { test } from "node:test";
import assert from "node:assert/strict";
import { esEventoDePago, nombreBanco, normalizarPago } from "../src/core/pagos.ts";

// Ejemplos tomados de docs.pey.mx/docs/webhooks/codi/qr y /codi/pn (versión 2026-10-20 del API).
const AVISO_QR = {
  amount: 150,
  apiKeyId: "01M3QMMR6X9CBVDY1SF3G8QWNW",
  codiQrId: "35a13c183a",
  concept: "Abono credito 004512",
  datePaid: 1790724818,
  metadata: {
    clabe: "012180001234567895",
    bankCode: 40012,
    accountType: 40,
    description: "Abono credito 004512",
    trackingKey: "0192191042",
    externalMetadata: { cobro: "cob_a1b2c3d4e5f6", credito: "004512" },
  },
  numRef: "4512007",
  transactionId: "01M3QR8H0RH0XBCKYYD242YXNV",
  type: "codi.qr.payment_received",
};

const AHORA = new Date(1790724900 * 1000);

test("convierte el aviso de un QR pagado: monto en centavos, referencia y datos para conciliar", () => {
  assert.deepEqual(normalizarPago("msg_1", AVISO_QR, AHORA), {
    webhookId: "msg_1",
    tipo: "qr",
    transactionId: "01M3QR8H0RH0XBCKYYD242YXNV",
    montoCentavos: 15_000,
    concepto: "Abono credito 004512",
    codiQrId: "35a13c183a",
    numRef: "4512007",
    claveRastreo: "0192191042",
    banco: "BBVA México",
    cuentaFin: "7895",
    fechaPago: new Date(1790724818 * 1000).toISOString(),
    metadata: { cobro: "cob_a1b2c3d4e5f6", credito: "004512" },
  });
});

test("del pagador solo salen el banco y los últimos 4 dígitos de su cuenta, nunca la CLABE completa", () => {
  const pago = normalizarPago("msg_1", AVISO_QR, AHORA);
  assert.doesNotMatch(JSON.stringify(pago), /012180001234567895/);
});

test("convierte el aviso de un cobro push pagado (sin IDC de QR)", () => {
  const aviso = { ...AVISO_QR, type: "codi.pn.payment_received", codiQrId: undefined, amount: 0.01, numRef: "1000001" };
  const pago = normalizarPago("msg_2", aviso, AHORA);
  assert.equal(pago?.tipo, "pn");
  assert.equal(pago?.codiQrId, null);
  assert.equal(pago?.montoCentavos, 1);
  assert.equal(pago?.numRef, "1000001");
});

test("acepta el cuerpo dentro de `data` y la metadata propia como texto JSON", () => {
  const { type, ...resto } = AVISO_QR;
  const aviso = { type, data: { ...resto, metadata: { ...resto.metadata, externalMetadata: '{"cobro":"cob_x"}' } } };
  assert.equal(esEventoDePago(aviso), true);
  assert.deepEqual(normalizarPago("msg_3", aviso, AHORA)?.metadata, { cobro: "cob_x" });
});

test("un evento que no es un pago CoDi recibido se ignora", () => {
  assert.equal(normalizarPago("msg_4", { ...AVISO_QR, type: "payment_link.status_updated" }, AHORA), null);
  assert.equal(esEventoDePago({ type: "payment_link.status_updated" }), false);
  assert.equal(normalizarPago("msg_4", null, AHORA), null);
  assert.equal(normalizarPago("msg_4", [AVISO_QR], AHORA), null);
});

test("un aviso sin monto válido o sin transacción no se registra como pago", () => {
  for (const amount of [null, "", true, [5], "13,50", -1, "abc", undefined]) {
    assert.equal(normalizarPago("msg_5", { ...AVISO_QR, amount }, AHORA), null, `amount=${JSON.stringify(amount)}`);
  }
  assert.equal(normalizarPago("msg_5", { ...AVISO_QR, transactionId: "" }, AHORA), null);
  assert.equal(esEventoDePago({ ...AVISO_QR, amount: null }), true, "sigue siendo un evento de pago, aunque incompleto");
});

test("acepta el monto como número o como texto con hasta dos decimales", () => {
  assert.equal(normalizarPago("msg_6", { ...AVISO_QR, amount: "450.10" }, AHORA)?.montoCentavos, 45_010);
  assert.equal(normalizarPago("msg_6", { ...AVISO_QR, amount: " 13.5 " }, AHORA)?.montoCentavos, 1_350);
  assert.equal(normalizarPago("msg_6", { ...AVISO_QR, amount: 0.07 }, AHORA)?.montoCentavos, 7);
});

test("un monto en cero o con fracciones de centavo no es un pago: no se redondea en silencio", () => {
  for (const amount of [0, "0", "0.00", "0.004", 0.004, "13.505", 13.505]) {
    assert.equal(normalizarPago("msg_6", { ...AVISO_QR, amount }, AHORA), null, `amount=${JSON.stringify(amount)}`);
  }
});

test("una fecha de pago fuera de rango se cambia por la hora de recepción", () => {
  for (const datePaid of [1790724818000, -5, "ayer", undefined, 4102444800]) {
    assert.equal(normalizarPago("msg_7", { ...AVISO_QR, datePaid }, AHORA)?.fechaPago, AHORA.toISOString(), `datePaid=${datePaid}`);
  }
});

test("sin datos del pagador, banco y cuenta quedan vacíos", () => {
  const pago = normalizarPago("msg_8", { ...AVISO_QR, metadata: { trackingKey: "X1" } }, AHORA);
  assert.deepEqual({ banco: pago?.banco, cuentaFin: pago?.cuentaFin, metadata: pago?.metadata }, { banco: null, cuentaFin: null, metadata: {} });
});

test("nombre del banco por su clave de Banxico; una clave desconocida se muestra tal cual", () => {
  assert.equal(nombreBanco(40012), "BBVA México");
  assert.equal(nombreBanco("40072"), "Banorte");
  assert.equal(nombreBanco(90646), "STP");
  assert.equal(nombreBanco(49999), "Banco 49999");
  assert.equal(nombreBanco(undefined), null);
  assert.equal(nombreBanco("no-es-clave"), null);
});
