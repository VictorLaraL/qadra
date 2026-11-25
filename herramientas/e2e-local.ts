// Pruebas de punta a punta contra el servidor local (`npm run dev`, puerto 8790, modo simulación).
// Uso: npm run e2e
//
// Recorren el camino real: la app crea un cobro, llega un aviso firmado como los de pey, el pago se reparte entre las
// cuotas y el día cuadra. Al empezar se reinicia la cartera de ejemplo, así que se pueden correr las veces que haga falta.
// Usan créditos del primer gestor que no reciben pagos de ejemplo, para no depender de la hora del día.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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
  return r.datos as {
    credito: { id: string; estado: Record<string, any> };
    cuotas: Cuota[];
    pagos: Array<Record<string, any>>;
    gestiones: Array<Record<string, any>>;
    qrFijo: Record<string, any> | null;
  };
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

test("los cobros al celular tienen un límite propio y más bajo: no sirven para mandar solicitudes en masa", async () => {
  const push = () => crearCobro({ creditoId: "004533", montoCentavos: 100, medio: "push", telefono: "9991234567" });
  // Ya se mandó uno en la prueba anterior; el límite es de 3 cada 10 minutos por persona.
  assert.equal((await push()).status, 201);
  assert.equal((await push()).status, 201);
  const cuarto = await push();
  assert.equal(cuarto.status, 429);
  assert.match(cuarto.datos.error, /cobros al celular/);
  assert.equal((await crearCobro({ creditoId: "004533", montoCentavos: 7, medio: "qr" })).status, 201, "los cobros por QR siguen disponibles");
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

// ---------------------------------------------------------------------------------------------------------------
// App del gestor: ruta y visitas
// ---------------------------------------------------------------------------------------------------------------

async function simular(cuerpo: Record<string, unknown>, clave = JURADO) {
  return api("/api/app/simular", { clave, cuerpo });
}

async function ruta(gestor = "g1") {
  const r = await api(`/api/app/ruta?gestor=${gestor}`, { clave: JURADO });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  return r.datos as { gestor: Record<string, any>; resumen: Record<string, number>; visitas: Array<Record<string, any>> };
}

test("la ruta del gestor trae lo exigible de hoy, deja fuera lo que aún no vence y marca lo cobrado", async () => {
  const antes = await ruta();
  assert.equal(antes.gestor.nombre, "Mariana R.");
  const ids = antes.visitas.map((v) => v.creditoId);
  assert.ok(ids.includes("004512"), "el crédito de la demo vence hoy");
  assert.ok(!ids.includes("004563"), "un crédito al corriente no está en la ruta");
  const rosa = antes.visitas.find((v) => v.creditoId === "004512") as Record<string, any>;
  assert.deepEqual([rosa.acreditado, rosa.visita, rosa.estado.situacion, rosa.estado.exigibleCentavos], ["Rosa M.", "pendiente", "vence-hoy", 45_000]);
  assert.equal(antes.resumen.total, antes.visitas.length);

  const { cobro } = (await crearCobro({ creditoId: "004512", montoCentavos: 45_000, medio: "qr" })).datos;
  assert.equal((await simular({ tipo: "cobro", cobroId: cobro.id })).status, 200);

  const despues = await ruta();
  const cobrada = despues.visitas.find((v) => v.creditoId === "004512") as Record<string, any>;
  assert.deepEqual([cobrada.visita, cobrada.cobradoHoyCentavos, cobrada.estado.exigibleCentavos], ["cobrado", 45_000, 0]);
  assert.equal(despues.resumen.hechas, antes.resumen.hechas + 1);
  assert.equal(despues.resumen.cobradoCentavos, antes.resumen.cobradoCentavos + 45_000);
  assert.equal((await api("/api/app/ruta?gestor=nadie", { clave: JURADO })).status, 404);
});

test("el gestor registra una promesa de pago: queda en la ficha con fecha, monto y ubicación, y la ruta la muestra", async () => {
  const hoy = (await api("/api/app/sesion", { clave: JURADO })).datos.hoy as string;
  const r = await api("/api/app/gestiones", {
    clave: JURADO,
    cuerpo: { creditoId: "004563", resultado: "promesa", promesaFecha: hoy, promesaCentavos: 52_000, nota: "  Paga saliendo del trabajo  ", latitud: 21.02, longitud: -89.63 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.deepEqual([r.datos.gestion.resultado, r.datos.gestion.nota, r.datos.gestion.promesaCentavos], ["promesa", "Paga saliendo del trabajo", 52_000]);

  const ficha = await detalle("004563");
  assert.deepEqual([ficha.gestiones[0].resultado, ficha.gestiones[0].gestor], ["promesa", "Mariana R."]);
  // Un crédito visitado hoy entra a la ruta aunque su cuota aún no venza.
  const visita = (await ruta()).visitas.find((v) => v.creditoId === "004563") as Record<string, any>;
  assert.deepEqual([visita.visita, visita.ultimaVisita.promesaCentavos], ["promesa", 52_000]);

  const mala = await api("/api/app/gestiones", { clave: JURADO, cuerpo: { creditoId: "004541", resultado: "promesa" } });
  assert.equal(mala.status, 400);
  const sinCredito = await api("/api/app/gestiones", { clave: JURADO, cuerpo: { creditoId: "NOEXISTE", resultado: "sin-dinero" } });
  assert.equal(sinCredito.status, 404);
});

// ---------------------------------------------------------------------------------------------------------------
// Portal: resumen, cartera, conciliación y cuadre con pey
// ---------------------------------------------------------------------------------------------------------------

test("el resumen del portal trae la cobranza de hoy, la cartera, la semana y a cada gestor", async () => {
  const r = await api("/api/app/resumen", { clave: JURADO });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  const d = r.datos;
  assert.ok(d.hoy.cobradoCentavos > 0 && d.hoy.pagos > 0);
  assert.equal(d.cartera.creditos, 24);
  assert.equal(d.semana.length, 7);
  assert.equal(d.semana.at(-1).cobradoCentavos, d.hoy.cobradoCentavos, "el último día de la semana es hoy");
  assert.deepEqual(d.gestores.map((g: any) => g.nombre), ["Mariana R.", "Diego T.", "Karla S."]);
  assert.ok(d.ultimosPagos.length > 0 && d.ultimosPagos.length <= 8);
  assert.equal(typeof d.pagosReales, "number");
});

test("la cartera se puede buscar por nombre o número, filtrar por situación y paginar", async () => {
  const todos = await api("/api/app/cartera", { clave: JURADO });
  assert.deepEqual([todos.status, todos.datos.total, todos.datos.creditos.length, todos.datos.paginas], [200, 24, 10, 3]);
  const porNombre = await api("/api/app/cartera?buscar=rosa", { clave: JURADO });
  assert.deepEqual(porNombre.datos.creditos.map((c: any) => c.id), ["004512"]);
  const porNumero = await api("/api/app/cartera?buscar=0046", { clave: JURADO });
  assert.ok(porNumero.datos.creditos.every((c: any) => c.id.includes("0046")) && porNumero.datos.total >= 6);
  const atrasados = await api("/api/app/cartera?situacion=atrasado", { clave: JURADO });
  assert.ok(atrasados.datos.total >= 3 && atrasados.datos.creditos.every((c: any) => c.estado.situacion === "atrasado"));
  const pagina3 = await api("/api/app/cartera?pagina=3", { clave: JURADO });
  assert.equal(pagina3.datos.creditos.length, 4);
  assert.doesNotMatch(JSON.stringify(todos.datos), /"telefono":"\d{10}"/, "la cartera no expone celulares completos");
});

test("una excepción aparece en la conciliación y se resuelve asignándola a un crédito, una sola vez", async () => {
  const sim = await simular({ tipo: "sin-referencia", montoCentavos: 38_000 });
  assert.equal(sim.status, 200, JSON.stringify(sim.datos));
  assert.deepEqual([sim.datos.estado, sim.datos.motivo], ["excepcion", "sin-identificar"]);
  const tx = sim.datos.transactionId as string;

  const lista = await api("/api/app/conciliacion?estado=excepcion", { clave: JURADO });
  const excepcion = lista.datos.pagos.find((p: any) => p.transactionId === tx);
  assert.deepEqual([excepcion.estado, excepcion.motivo, excepcion.aplicadoCentavos, excepcion.creditoId], ["excepcion", "sin-identificar", 0, null]);

  const antes = await detalle("004563");
  const resuelto = await api(`/api/app/excepciones/${tx}/resolver`, { clave: JURADO, cuerpo: { creditoId: "004563" } });
  assert.deepEqual([resuelto.status, resuelto.datos.aplicadoCentavos, resuelto.datos.pendienteCentavos], [200, 38_000, 0]);
  const despues = await detalle("004563");
  assert.equal(despues.credito.estado.saldoCentavos, antes.credito.estado.saldoCentavos - 38_000);
  assert.equal(despues.pagos[0].estado, "aplicado");

  assert.equal((await api(`/api/app/excepciones/${tx}/resolver`, { clave: JURADO, cuerpo: { creditoId: "004563" } })).status, 409);
  assert.equal((await api("/api/app/excepciones/NOEXISTE/resolver", { clave: JURADO, cuerpo: { creditoId: "004563" } })).status, 404);
});

test("asignar una excepción a un crédito que no existe no aplica nada y la excepción sigue abierta", async () => {
  const tx = (await simular({ tipo: "sin-referencia", montoCentavos: 12_300 })).datos.transactionId as string;
  const r = await api(`/api/app/excepciones/${tx}/resolver`, { clave: JURADO, cuerpo: { creditoId: "NOEXISTE" } });
  assert.deepEqual([r.status, r.datos.error], [404, "No existe ese crédito."]);
  assert.equal((await api(`/api/app/excepciones/${tx}/resolver`, { clave: JURADO, cuerpo: { creditoId: "crédito inválido" } })).status, 400);

  const abiertas = (await api("/api/app/conciliacion?estado=excepcion", { clave: JURADO })).datos.pagos;
  const sigue = abiertas.find((p: any) => p.transactionId === tx);
  assert.deepEqual([sigue.estado, sigue.aplicadoCentavos, sigue.creditoId], ["excepcion", 0, null]);
  const demasiado = await simular({ tipo: "sin-referencia", montoCentavos: 10_000_001 });
  assert.deepEqual([demasiado.status, demasiado.datos.error], [400, "El monto simulado debe estar entre $0.01 y $100,000.00."]);
});

test("cuadre con pey: detecta el pago cuyo aviso se perdió, lo recupera consultando a pey y el día vuelve a cuadrar", async () => {
  // Cartera limpia: los avisos directos de las pruebas anteriores no pasaron por el libro simulado de pey.
  assert.equal((await api("/api/app/reiniciar", { clave: ADMIN, metodo: "POST" })).status, 200);

  const uno = (await crearCobro({ creditoId: "004533", montoCentavos: 125_000, medio: "qr" })).datos.cobro;
  assert.equal((await simular({ tipo: "cobro", cobroId: uno.id })).status, 200);
  let corte = (await api("/api/app/corte?pey=1", { clave: JURADO })).datos;
  assert.deepEqual([corte.pey.cuadra, corte.pey.qadra.pagos, corte.pey.pey.pagos, corte.pey.faltanEnQadra.length], [true, 1, 1, 0]);
  assert.equal(corte.recibidoCentavos, corte.aplicadoCentavos + corte.porRevisarCentavos, "lo recibido siempre es lo aplicado más lo que está por revisar");

  const dos = (await crearCobro({ creditoId: "004546", montoCentavos: 148_000, medio: "qr" })).datos.cobro;
  const perdido = await simular({ tipo: "cobro", cobroId: dos.id, conAviso: false });
  assert.deepEqual([perdido.status, perdido.datos.avisoPerdido], [200, true]);
  assert.equal((await api(`/api/app/cobros/${dos.id}`, { clave: JURADO })).datos.cobro.estado, "pendiente", "sin aviso, Qadra no sabe del pago");

  corte = (await api("/api/app/corte?pey=1", { clave: JURADO })).datos;
  assert.equal(corte.pey.cuadra, false);
  assert.deepEqual(corte.pey.faltanEnQadra, [{ transactionId: perdido.datos.transactionId, montoCentavos: 148_000 }]);

  const recuperado = await api("/api/app/corte/recuperar", { clave: JURADO, cuerpo: { transactionId: perdido.datos.transactionId } });
  assert.deepEqual([recuperado.status, recuperado.datos.duplicado, recuperado.datos.estado], [200, false, "aplicado"]);
  assert.equal((await api(`/api/app/cobros/${dos.id}`, { clave: JURADO })).datos.cobro.estado, "pagado");
  const pago = (await detalle("004546")).pagos[0];
  assert.deepEqual([pago.transactionId, pago.recuperado], [perdido.datos.transactionId, true]);

  corte = (await api("/api/app/corte?pey=1", { clave: JURADO })).datos;
  assert.deepEqual([corte.pey.cuadra, corte.pey.qadra.pagos, corte.pey.pey.pagos], [true, 2, 2]);

  const otraVez = await api("/api/app/corte/recuperar", { clave: JURADO, cuerpo: { transactionId: perdido.datos.transactionId } });
  assert.deepEqual([otraVez.status, otraVez.datos.duplicado], [200, true]);
  assert.equal((await api("/api/app/corte/recuperar", { clave: JURADO, cuerpo: { transactionId: "NO-EXISTE-EN-PEY" } })).status, 404);
});

test("los pagos del día se exportan en CSV para el sistema de la financiera", async () => {
  const r = await fetch(`${BASE}/api/app/pagos.csv`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="qadra-pagos-\d{4}-\d{2}-\d{2}\.csv"/);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "empieza con la marca BOM para que Excel lea los acentos");
  const texto = new TextDecoder().decode(bytes);
  assert.ok(texto.startsWith("fecha,hora,id_credito,acreditado,cuota,monto_aplicado,"), texto.slice(0, 120));
  assert.match(texto, /,004533,Jorge P\.,5,1250\.00,/);
  assert.match(texto, /,004546,Pedro A\.,3,1480\.00,/);
});

// ---------------------------------------------------------------------------------------------------------------
// Canal en vivo
// ---------------------------------------------------------------------------------------------------------------

test("el canal en vivo pide un boleto de un solo canal y entrega cada pago al instante", async () => {
  assert.equal((await api("/api/app/boleto?canal=portal")).status, 401);
  assert.equal((await api("/api/app/boleto?canal=otro", { clave: JURADO })).status, 400);
  const { datos } = await api("/api/app/boleto?canal=portal", { clave: JURADO });
  assert.match(datos.boleto, /^\d{10}\.[A-Za-z0-9_-]{43}$/);

  assert.equal((await fetch(`${BASE}/api/app/en-vivo?canal=portal&boleto=falso`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/app/en-vivo?canal=gestor&boleto=${datos.boleto}`)).status, 401, "el boleto es de otro canal");
  assert.equal((await fetch(`${BASE}/api/app/en-vivo?canal=portal&boleto=${datos.boleto}`)).status, 426, "falta el Upgrade a WebSocket");

  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/app/en-vivo?canal=portal&boleto=${datos.boleto}`);
  await new Promise((ok, mal) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => mal(new Error("no abrió el canal en vivo")), { once: true });
  });
  const evento = new Promise<Record<string, any>>((ok, mal) => {
    const limite = setTimeout(() => mal(new Error("no llegó el pago en 6 s")), 6_000);
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (m.tipo !== "pago" || m.creditoId !== "004541") return;
      clearTimeout(limite);
      ok(m);
    });
  });
  const { cobro } = (await crearCobro({ creditoId: "004541", montoCentavos: 1, medio: "qr" })).datos;
  await simular({ tipo: "cobro", cobroId: cobro.id });
  const pago = await evento;
  ws.close();
  assert.deepEqual([pago.montoCentavos, pago.estado, pago.acreditado, pago.cobroId], [1, "aplicado", "Elena G.", cobro.id]);
  assert.match(pago.claveRastreo, /…/, "en vivo la clave de rastreo va recortada");
});

// ---------------------------------------------------------------------------------------------------------------
// Público: demo de la landing y página de pago
// ---------------------------------------------------------------------------------------------------------------

test("la demo pública muestra el QR fijo de un centavo sin pedir clave y cada pago se abona al crédito", async () => {
  const antes = await api("/api/demo");
  assert.equal(antes.status, 200, JSON.stringify(antes.datos));
  assert.deepEqual([antes.datos.simulacion, antes.datos.qr.montoCentavos, antes.datos.qr.simulado, antes.datos.credito.id], [true, 1, true, "004512"]);
  assert.equal(antes.datos.financiera.nombre, "Financiera Jacaranda");

  const pago = await api("/api/demo/simular", { metodo: "POST" });
  assert.deepEqual([pago.status, pago.datos.estado], [200, "aplicado"]);
  const despues = await api("/api/demo");
  assert.equal(despues.datos.pagosHoy, antes.datos.pagosHoy + 1);
  assert.equal(despues.datos.credito.cuota.pagadoCentavos, antes.datos.credito.cuota.pagadoCentavos + 1);
  assert.equal(despues.datos.ultimos[0].montoCentavos, 1);
  assert.doesNotMatch(JSON.stringify(despues.datos), /cuentaFin|transactionId/, "la demo pública no expone datos del pagador");
  const fijo = (await detalle("004512")).pagos[0];
  assert.deepEqual([fijo.via, fijo.montoCentavos], ["qr-fijo", 1]);
});

test("la página de pago se abre con el link del cobro, no muestra el nombre del acreditado y entrega el recibo", async () => {
  const { cobro, linkPago } = (await crearCobro({ creditoId: "004518", montoCentavos: 45_000, medio: "qr" })).datos;
  assert.equal(linkPago, `${BASE}/pagar/?c=${cobro.token}`);

  const pagina = await api(`/api/pago/${cobro.token}`);
  assert.equal(pagina.status, 200, JSON.stringify(pagina.datos));
  assert.deepEqual([pagina.datos.cobro.estado, pagina.datos.cobro.montoCentavos, pagina.datos.cobro.creditoId], ["pendiente", 45_000, "004518"]);
  assert.doesNotMatch(JSON.stringify(pagina.datos), /Lupita/, "sin nombre del acreditado");
  assert.equal((await api("/api/pago/token-que-no-existe-000000000000")).status, 404);

  const pago = await api(`/api/pago/${cobro.token}/simular`, { metodo: "POST" });
  assert.deepEqual([pago.status, pago.datos.estado], [200, "aplicado"]);
  const pagada = await api(`/api/pago/${cobro.token}`);
  assert.equal(pagada.datos.cobro.estado, "pagado");
  assert.match(pagada.datos.recibo.claveRastreo, /^SIM[0-9A-F]{12}$/, "quien pagó ve su clave de rastreo completa");
  assert.equal(pagada.datos.recibo.restaCuotaCentavos, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Reinicio de la demo y puesta al día
// ---------------------------------------------------------------------------------------------------------------

/** Dispara el cron del Worker local (wrangler dev --test-scheduled). */
async function correrCron() {
  const r = await fetch(`${BASE}/__scheduled?cron=*%2F5+*+*+*+*`);
  assert.equal(r.status, 200, "el cron local no respondió");
}

/** Escribe directo en la base local de `wrangler dev`. El SQL no lleva comillas dobles. */
function sql(comando: string) {
  execSync(`npx wrangler d1 execute qadra --local --command "${comando}"`, { stdio: "ignore", env: { ...process.env, CI: "1" } });
}

test("un cobro pendiente sobrevive al reinicio de la cartera de ejemplo: quien ya tiene el QR todavía puede pagar", async () => {
  const { cobro } = (await crearCobro({ creditoId: "004533", montoCentavos: 125_000, medio: "qr" })).datos;
  assert.equal((await api("/api/app/reiniciar", { clave: ADMIN, metodo: "POST" })).status, 200);

  const despues = await api(`/api/app/cobros/${cobro.id}`, { clave: JURADO });
  assert.deepEqual([despues.status, despues.datos.cobro.estado], [200, "pendiente"]);
  assert.deepEqual((await simular({ tipo: "cobro", cobroId: cobro.id })).datos.estado, "aplicado");
  assert.equal((await detalle("004533")).credito.estado.cuotaActual.numero, 6, "el pago se aplicó a la cartera recién cargada");
});

test("poner la demo al día varias veces no repite los pagos de ejemplo de los otros gestores", async () => {
  await correrCron();
  const antes = (await api("/api/app/resumen", { clave: JURADO })).datos.hoy;
  await correrCron();
  await correrCron();
  const despues = (await api("/api/app/resumen", { clave: JURADO })).datos.hoy;
  assert.deepEqual([despues.deEjemplo, despues.pagos], [antes.deEjemplo, antes.pagos]);
});

// ---------------------------------------------------------------------------------------------------------------
// Cartera por archivo (al final: reemplaza la cartera de ejemplo)
// ---------------------------------------------------------------------------------------------------------------

test("el administrador crea el QR fijo de un crédito; el jurado no puede", async () => {
  assert.equal((await api("/api/app/creditos/004533/qr-fijo", { clave: JURADO, metodo: "POST" })).status, 403);
  const r = await api("/api/app/creditos/004533/qr-fijo", { clave: ADMIN, metodo: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual([r.datos.qrFijo.simulado, typeof r.datos.qrFijo.qrString], [true, "string"]);
  assert.deepEqual((await detalle("004533")).qrFijo, r.datos.qrFijo);
});

test("la cartera se valida antes de importarla, solo el administrador la reemplaza y se puede volver a la de ejemplo", async () => {
  const plantilla = await fetch(`${BASE}/api/app/cartera/plantilla.csv`, { headers: { Authorization: `Bearer ${JURADO}` } });
  assert.equal(plantilla.status, 200);
  const csv = await plantilla.text();

  const conErrores = await api("/api/app/cartera/validar", { clave: JURADO, texto: csv.replace("450.00", "gratis") });
  assert.deepEqual([conErrores.status, conErrores.datos.ok, conErrores.datos.errores[0].columna], [200, false, "monto_cuota"]);
  const valida = await api("/api/app/cartera/validar", { clave: JURADO, texto: csv });
  assert.deepEqual([valida.datos.ok, valida.datos.resumen.validas, valida.datos.vistaPrevia[0].id], [true, 2, "A-1001"]);

  assert.equal((await api("/api/app/cartera/importar", { clave: JURADO, texto: csv })).status, 403);
  assert.equal((await api("/api/app/cartera/importar", { clave: ADMIN, texto: csv.replace("450.00", "gratis") })).status, 400);
  const importada = await api("/api/app/cartera/importar", { clave: ADMIN, texto: csv });
  assert.deepEqual([importada.status, importada.datos.creditos, importada.datos.gestores], [200, 2, 2]);

  const cartera = await api("/api/app/cartera", { clave: JURADO });
  assert.deepEqual(cartera.datos.creditos.map((c: any) => c.id).sort(), ["A-1001", "A-1002"]);
  assert.equal((await api("/api/demo")).datos.credito, null, "con otra cartera, la demo pública avisa que no está disponible");

  // Al cambiar de día solo se regenera la cartera de ejemplo: una cartera importada no se borra sola.
  sql("UPDATE ajustes SET valor = '2000-01-01' WHERE clave = 'dia'");
  await correrCron();
  assert.deepEqual((await api("/api/app/cartera", { clave: JURADO })).datos.total, 2);

  assert.equal((await api("/api/app/reiniciar", { clave: ADMIN, metodo: "POST" })).status, 200);
  assert.equal((await api("/api/app/cartera", { clave: JURADO })).datos.total, 24);
});
