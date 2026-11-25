// Pruebas de punta a punta contra el servidor local (`npm run dev`, puerto 8790, modo simulación).
// Uso: npm run e2e
//
// Recorren el camino real: la app crea un cobro, llega un aviso firmado como los de pey, el pago se reparte entre las
// cuotas y el día cuadra. Al empezar se reinicia la cartera de ejemplo, así que se pueden correr las veces que haga falta.
// Usan créditos del primer gestor que no reciben pagos de ejemplo, para no depender de la hora del día.

import assert from "node:assert/strict";
import { test } from "node:test";
import { api, avisoDePago, BASE, enviarAviso, enviarCuerpoFirmado, leerDevVars } from "./comun.ts";

const vars = leerDevVars();
const SECRETO = vars.PEY_WEBHOOK_SECRET;
const ADMIN = vars.PORTAL_TOKEN;
const JURADO = vars.JURADO_TOKEN;

type Cuota = { numero: number; vence: string; montoCentavos: number; pagadoCentavos: number };

async function detalle(creditoId: string, clave = JURADO) {
  const r = await api(`/api/app/creditos/${creditoId}`, { clave });
  assert.equal(r.status, 200, `crédito ${creditoId}: ${JSON.stringify(r.datos)}`);
  return r.datos as { credito: { id: string; estado: Record<string, any> }; cuotas: Cuota[]; pagos: Array<Record<string, any>> };
}

async function crearCobro(cuerpo: Record<string, unknown>, clave = JURADO) {
  return api("/api/app/cobros", { clave, cuerpo });
}

const cuota = (cuotas: Cuota[], numero: number) => cuotas.find((c) => c.numero === numero) as Cuota;

test.before(async () => {
  const r = await api("/api/app/reiniciar", { clave: ADMIN, metodo: "POST" });
  assert.equal(r.status, 200, `No se pudo reiniciar la demo. ¿Está corriendo "npm run dev"? ${JSON.stringify(r.datos)}`);
});

test("salud del servicio", async () => {
  const r = await api("/api/salud");
  assert.deepEqual([r.status, r.datos], [200, { ok: true, servicio: "qadra" }]);
});

test("sin clave no se entra; cada clave da su rol y la clave 'demo' no sirve cuando hay claves configuradas", async () => {
  assert.equal((await api("/api/app/sesion")).status, 401);
  assert.equal((await api("/api/app/sesion", { clave: "otra-clave" })).status, 401);
  assert.equal((await api("/api/app/sesion", { clave: "demo" })).status, 401);
  const jurado = await api("/api/app/sesion", { clave: JURADO });
  assert.deepEqual([jurado.status, jurado.datos.rol, jurado.datos.simulacion], [200, "jurado", true]);
  assert.equal(jurado.datos.configuracion, undefined, "el jurado no ve la configuración");
  const admin = await api("/api/app/sesion", { clave: ADMIN });
  assert.deepEqual([admin.datos.rol, admin.datos.configuracion], ["admin", { pey: false, webhook: true }]);
  assert.equal(admin.datos.financiera.nombre, "Financiera Jacaranda");
  assert.equal(admin.datos.gestores.length, 3);
});

test("rechaza avisos sin firma válida o firmados con otro secreto", async () => {
  const aviso = avisoDePago({ montoCentavos: 100 });
  const sinFirma = await fetch(`${BASE}/webhooks/pey`, { method: "POST", body: JSON.stringify(aviso) });
  assert.equal(sinFirma.status, 401);
  const otro = await enviarAviso("whsec_b3Ryby1zZWNyZXRvLXF1ZS1uby1lcy1lbC1kZS1wZXk=", aviso);
  assert.equal(otro.status, 401);
});

test("un aviso firmado que no es JSON, es demasiado grande o no es un pago no registra nada", async () => {
  assert.equal((await enviarCuerpoFirmado(SECRETO, "esto no es json")).status, 400);
  assert.equal((await enviarCuerpoFirmado(SECRETO, JSON.stringify({ relleno: "x".repeat(70_000) }))).status, 413);
  const otroEvento = await enviarAviso(SECRETO, { type: "payment_link.status_updated", status: "paid" });
  assert.deepEqual(await otroEvento.json(), { ok: true, ignorado: true, motivo: "no es un pago" });
  const incompleto = await enviarAviso(SECRETO, { ...avisoDePago({ montoCentavos: 100 }), amount: 0 });
  assert.deepEqual(await incompleto.json(), { ok: true, ignorado: true, motivo: "pago incompleto" });
});

test("el gestor crea un cobro por QR con folio de 7 dígitos y vigencia de 10 minutos; repetirlo reutiliza el mismo", async () => {
  const antes = await detalle("004533");
  const actual = antes.credito.estado.cuotaActual;
  const r = await crearCobro({ creditoId: "004533", montoCentavos: actual.pendienteCentavos, medio: "qr" });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const cobro = r.datos.cobro;
  assert.match(String(cobro.folio), /^[1-9]\d{6}$/);
  assert.match(cobro.token, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual([cobro.estado, cobro.medio, cobro.simulado, cobro.montoCentavos], ["pendiente", "qr", true, 125_000]);
  assert.ok(cobro.qrString.includes("SIMULADO"), "en simulación el QR se rotula como simulado");
  const vigencia = Date.parse(cobro.venceEn) - Date.parse(cobro.creadoEn);
  assert.equal(vigencia, 600_000);

  const otraVez = await crearCobro({ creditoId: "004533", montoCentavos: actual.pendienteCentavos, medio: "qr" });
  assert.deepEqual([otraVez.status, otraVez.datos.cobro.id, otraVez.datos.reutilizado], [200, cobro.id, true]);
});

test("un cobro inválido se rechaza con un mensaje claro y sin llamar a pey", async () => {
  const d = await detalle("004533");
  const deMas = await crearCobro({ creditoId: "004533", montoCentavos: d.credito.estado.saldoCentavos + 1, medio: "qr" });
  assert.equal(deMas.status, 400);
  assert.match(deMas.datos.error, /saldo del crédito/);
  assert.equal((await crearCobro({ creditoId: "NOEXISTE", montoCentavos: 100, medio: "qr" })).status, 404);
  const sinCelular = await crearCobro({ creditoId: "004533", montoCentavos: 100, medio: "push" });
  assert.equal(sinCelular.status, 400);
  assert.match(sinCelular.datos.error, /10 dígitos/);
  assert.equal((await crearCobro({ creditoId: "004533", montoCentavos: 100, medio: "qr" }, "sin-permiso")).status, 401);
});

test("el aviso de pago liquida la cuota, cierra el cobro y deja el pago con su clave de rastreo y banco", async () => {
  const antes = await detalle("004533");
  const actual = antes.credito.estado.cuotaActual;
  const { cobro } = (await crearCobro({ creditoId: "004533", montoCentavos: actual.pendienteCentavos, medio: "qr" })).datos;

  const aviso = avisoDePago({ montoCentavos: cobro.montoCentavos, codiQrId: cobro.peyId, folio: cobro.folio, cobro: cobro.id });
  const r = await enviarAviso(SECRETO, aviso, "msg_e2e_pago_1");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, duplicado: false, estado: "aplicado", motivo: null });

  const pagado = await api(`/api/app/cobros/${cobro.id}`, { clave: ADMIN });
  assert.deepEqual([pagado.datos.cobro.estado, pagado.datos.cobro.transactionId], ["pagado", aviso.transactionId]);
  assert.equal(pagado.datos.recibo.claveRastreo, aviso.metadata.trackingKey, "el administrador ve la clave completa");
  assert.deepEqual(pagado.datos.recibo.cuotas, [{ numero: actual.numero, montoCentavos: cobro.montoCentavos, liquida: true }]);
  assert.equal(pagado.datos.recibo.restaCuotaCentavos, 0);
  assert.equal(pagado.datos.recibo.banco, "BBVA México");

  const despues = await detalle("004533");
  assert.equal(cuota(despues.cuotas, actual.numero).pagadoCentavos, actual.montoCentavos);
  assert.equal(despues.credito.estado.saldoCentavos, antes.credito.estado.saldoCentavos - cobro.montoCentavos);
  assert.equal(despues.credito.estado.cuotaActual.numero, actual.numero + 1);
  const pago = despues.pagos[0];
  assert.deepEqual([pago.transactionId, pago.estado, pago.via, pago.origen, pago.cuentaFin], [aviso.transactionId, "aplicado", "cobro", "simulado", "7895"]);
  assert.notEqual(pago.claveRastreo, aviso.metadata.trackingKey, "el jurado ve la clave de rastreo recortada");
  assert.doesNotMatch(JSON.stringify(despues), /012180001234567895/, "la CLABE del pagador no se guarda ni se muestra");
});

test("un aviso repetido no aplica el pago dos veces, ni con el mismo aviso ni con otro aviso de la misma transacción", async () => {
  const antes = await detalle("004533");
  const { cobro } = (await crearCobro({ creditoId: "004533", montoCentavos: 5_000, medio: "qr" })).datos;
  const aviso = avisoDePago({ montoCentavos: 5_000, codiQrId: cobro.peyId, folio: cobro.folio });

  assert.deepEqual(await (await enviarAviso(SECRETO, aviso, "msg_e2e_rep_1")).json(), { ok: true, duplicado: false, estado: "aplicado", motivo: null });
  assert.deepEqual(await (await enviarAviso(SECRETO, aviso, "msg_e2e_rep_1")).json(), { ok: true, duplicado: true });
  assert.deepEqual(await (await enviarAviso(SECRETO, aviso, "msg_e2e_rep_2")).json(), { ok: true, duplicado: true });

  const despues = await detalle("004533");
  assert.equal(despues.credito.estado.saldoCentavos, antes.credito.estado.saldoCentavos - 5_000);
  assert.equal(despues.pagos.filter((p) => p.transactionId === aviso.transactionId).length, 1);
});

test("un abono de un centavo deja la cuota parcial y se identifica solo con el folio (numRef)", async () => {
  const antes = await detalle("004541");
  const actual = antes.credito.estado.cuotaActual;
  const { cobro } = (await crearCobro({ creditoId: "004541", montoCentavos: 1, medio: "qr" })).datos;
  const r = await enviarAviso(SECRETO, avisoDePago({ montoCentavos: 1, folio: cobro.folio }));
  assert.deepEqual(await r.json(), { ok: true, duplicado: false, estado: "aplicado", motivo: null });

  const despues = await detalle("004541");
  assert.equal(cuota(despues.cuotas, actual.numero).pagadoCentavos, actual.pagadoCentavos + 1);
  assert.equal(despues.credito.estado.cuotaActual.numero, actual.numero, "la cuota sigue siendo la actual");
  assert.equal(despues.credito.estado.exigibleCentavos, antes.credito.estado.exigibleCentavos - 1);
  const recibo = (await api(`/api/app/cobros/${cobro.id}`, { clave: JURADO })).datos.recibo;
  assert.deepEqual([recibo.cuotas[0].liquida, recibo.restaCuotaCentavos], [false, actual.pendienteCentavos - 1]);
});

test("cobro al celular: guarda solo los últimos 4 dígitos y se concilia por la transacción del cobro", async () => {
  const r = await crearCobro({ creditoId: "004546", montoCentavos: 148_000, medio: "push", telefono: "999 123 4567" });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const cobro = r.datos.cobro;
  assert.deepEqual([cobro.medio, cobro.telefonoFin, cobro.qrString, cobro.estado], ["push", "4567", null, "pendiente"]);
  assert.doesNotMatch(JSON.stringify(r.datos), /9991234567/);

  const aviso = avisoDePago({ tipo: "pn", montoCentavos: 148_000, transactionId: cobro.peyId });
  assert.deepEqual(await (await enviarAviso(SECRETO, aviso)).json(), { ok: true, duplicado: false, estado: "aplicado", motivo: null });
  const pagado = await api(`/api/app/cobros/${cobro.id}`, { clave: JURADO });
  assert.equal(pagado.datos.cobro.estado, "pagado");
  assert.equal(pagado.datos.recibo.medio, "pn");
});

test("dos pagos al mismo tiempo sobre el mismo crédito se aplican completos y ninguna cuota queda pagada de más", async () => {
  const antes = await detalle("004527");
  const actual = antes.credito.estado.cuotaActual; // cuota 7 de $380.00, y la 8 vence hoy
  const { cobro } = (await crearCobro({ creditoId: "004527", montoCentavos: 38_000, medio: "qr" })).datos;
  const avisos = [1, 2, 3].map(() => avisoDePago({ montoCentavos: 38_000, codiQrId: cobro.peyId, folio: cobro.folio }));
  const respuestas = await Promise.all(avisos.map((a) => enviarAviso(SECRETO, a)));
  for (const r of respuestas) assert.deepEqual(await r.json(), { ok: true, duplicado: false, estado: "aplicado", motivo: null });

  const despues = await detalle("004527");
  for (const numero of [actual.numero, actual.numero + 1, actual.numero + 2]) {
    assert.deepEqual([numero, cuota(despues.cuotas, numero).pagadoCentavos], [numero, 38_000]);
  }
  assert.ok(despues.cuotas.every((c) => c.pagadoCentavos <= c.montoCentavos));
  assert.equal(despues.credito.estado.saldoCentavos, antes.credito.estado.saldoCentavos - 3 * 38_000);
});

test("un pago mayor que el saldo liquida el crédito y deja el sobrante como excepción, sin aplicarlo de más", async () => {
  const antes = await detalle("004552");
  const saldo = antes.credito.estado.saldoCentavos;
  const { cobro } = (await crearCobro({ creditoId: "004552", montoCentavos: saldo, medio: "qr" })).datos;
  const aviso = avisoDePago({ montoCentavos: saldo + 40_000, codiQrId: cobro.peyId });
  assert.deepEqual(await (await enviarAviso(SECRETO, aviso)).json(), { ok: true, duplicado: false, estado: "excepcion", motivo: "excedente" });

  const despues = await detalle("004552");
  assert.deepEqual([despues.credito.estado.situacion, despues.credito.estado.saldoCentavos], ["liquidado", 0]);
  const pago = despues.pagos.find((p) => p.transactionId === aviso.transactionId) as Record<string, any>;
  assert.deepEqual([pago.montoCentavos, pago.aplicadoCentavos, pago.estado, pago.motivo], [saldo + 40_000, saldo, "excepcion", "excedente"]);
});

test("un pago sin referencia queda como excepción sin identificar: no se pierde ni se aplica a ciegas", async () => {
  const aviso = avisoDePago({ montoCentavos: 45_000, codiQrId: "QR-QUE-NO-ES-NUESTRO" });
  assert.deepEqual(await (await enviarAviso(SECRETO, aviso)).json(), { ok: true, duplicado: false, estado: "excepcion", motivo: "sin-identificar" });
});

test("el detalle de un crédito que no existe responde 404", async () => {
  assert.equal((await api("/api/app/creditos/NOEXISTE", { clave: JURADO })).status, 404);
});
