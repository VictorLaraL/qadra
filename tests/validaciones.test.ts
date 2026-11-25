import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enmascararRastreo,
  enmascararTelefono,
  paginaPedida,
  totalPaginas,
  validarCobro,
  validarGestion,
} from "../src/core/validaciones.ts";

const LIMITES = { saldoCentavos: 125_000, topeCentavos: 0 };
const HOY = "2026-11-25";

test("un cobro por QR válido regresa sus datos limpios", () => {
  assert.deepEqual(validarCobro({ creditoId: " 004512 ", montoCentavos: 45_000, medio: "qr" }, LIMITES), {
    ok: true,
    valor: { creditoId: "004512", montoCentavos: 45_000, medio: "qr", telefono: null },
  });
});

test("un cobro push necesita un celular de 10 dígitos; se aceptan espacios y guiones", () => {
  const con = (telefono: unknown) => validarCobro({ creditoId: "004512", montoCentavos: 1, medio: "push", telefono }, LIMITES);
  assert.deepEqual(con("999 123-4567"), { ok: true, valor: { creditoId: "004512", montoCentavos: 1, medio: "push", telefono: "9991234567" } });
  for (const malo of [undefined, "", "99912", "99912345678", "+529991234567", 9991234567]) {
    const r = con(malo);
    assert.equal(r.ok, false, `con ${JSON.stringify(malo)}`);
    assert.match(r.ok ? "" : r.error, /10 dígitos/);
  }
});

test("el monto debe ser un entero de centavos mayor que cero y no pasar del saldo del crédito", () => {
  const con = (montoCentavos: unknown) => validarCobro({ creditoId: "004512", montoCentavos, medio: "qr" }, LIMITES);
  for (const malo of [0, -1, 1.5, "100", null, Number.NaN]) {
    assert.equal(con(malo).ok, false, `con ${JSON.stringify(malo)}`);
  }
  const deMas = con(125_001);
  assert.equal(deMas.ok, false);
  assert.match(deMas.ok ? "" : deMas.error, /saldo del crédito \(\$1,250\.00\)/);
  assert.equal(con(125_000).ok, true);
});

test("con tope de demo, un cobro real no puede pasar de ese tope", () => {
  const limites = { saldoCentavos: 125_000, topeCentavos: 100 };
  assert.equal(validarCobro({ creditoId: "004512", montoCentavos: 100, medio: "qr" }, limites).ok, true);
  const r = validarCobro({ creditoId: "004512", montoCentavos: 101, medio: "qr" }, limites);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /tope de \$1\.00/);
});

test("un cobro con crédito, medio o cuerpo inválidos se rechaza", () => {
  assert.equal(validarCobro(null, LIMITES).ok, false);
  assert.equal(validarCobro("texto", LIMITES).ok, false);
  assert.equal(validarCobro({ creditoId: "", montoCentavos: 1, medio: "qr" }, LIMITES).ok, false);
  assert.equal(validarCobro({ creditoId: "x'; DROP TABLE", montoCentavos: 1, medio: "qr" }, LIMITES).ok, false);
  assert.equal(validarCobro({ creditoId: "004512", montoCentavos: 1, medio: "tarjeta" }, LIMITES).ok, false);
});

test("una visita registra su resultado, la nota recortada y la ubicación si viene completa", () => {
  assert.deepEqual(
    validarGestion({ creditoId: "004512", resultado: "no-localizado", nota: "  Nadie abrió  ", latitud: 21.0, longitud: -89.62 }, HOY),
    {
      ok: true,
      valor: {
        creditoId: "004512",
        resultado: "no-localizado",
        nota: "Nadie abrió",
        promesaFecha: null,
        promesaCentavos: null,
        latitud: 21.0,
        longitud: -89.62,
      },
    },
  );
  const sinUbicacion = validarGestion({ creditoId: "004512", resultado: "sin-dinero", latitud: 21.0 }, HOY);
  assert.equal(sinUbicacion.ok && sinUbicacion.valor.latitud, null, "media ubicación no se guarda");
  const fueraDeRango = validarGestion({ creditoId: "004512", resultado: "sin-dinero", latitud: 121, longitud: -89 }, HOY);
  assert.equal(fueraDeRango.ok && fueraDeRango.valor.longitud, null);
});

test("una promesa de pago necesita monto y una fecha de hoy a 60 días", () => {
  const con = (extra: object) => validarGestion({ creditoId: "004512", resultado: "promesa", ...extra }, HOY);
  assert.deepEqual(con({ promesaFecha: "2026-11-28", promesaCentavos: 45_000 }).ok, true);
  assert.equal(con({ promesaFecha: HOY, promesaCentavos: 1 }).ok, true);
  for (const malo of [
    {},
    { promesaFecha: "2026-11-28" },
    { promesaCentavos: 45_000 },
    { promesaFecha: "2026-11-24", promesaCentavos: 45_000 },
    { promesaFecha: "2027-01-25", promesaCentavos: 45_000 },
    { promesaFecha: "28/11/2026", promesaCentavos: 45_000 },
    { promesaFecha: "2026-11-28", promesaCentavos: 0 },
  ]) {
    assert.equal(con(malo).ok, false, `con ${JSON.stringify(malo)}`);
  }
});

test("una visita con resultado desconocido, nota demasiado larga u 'otro' sin nota se rechaza", () => {
  assert.equal(validarGestion({ creditoId: "004512", resultado: "amenazado" }, HOY).ok, false);
  assert.equal(validarGestion({ creditoId: "004512", resultado: "sin-dinero", nota: "x".repeat(281) }, HOY).ok, false);
  assert.equal(validarGestion({ creditoId: "004512", resultado: "otro" }, HOY).ok, false);
  assert.equal(validarGestion({ creditoId: "004512", resultado: "otro", nota: "Pidió hablar con sucursal" }, HOY).ok, true);
  assert.equal(validarGestion(undefined, HOY).ok, false);
});

test("la clave de rastreo y el celular se muestran recortados", () => {
  assert.equal(enmascararRastreo("MBAN01002611250012345"), "MBAN01…2345");
  assert.equal(enmascararRastreo("0192191042"), "0192…1042");
  assert.equal(enmascararRastreo("ABC"), "•••");
  assert.equal(enmascararRastreo(null), null);
  assert.equal(enmascararTelefono("9991234567"), "••• ••• 4567");
  assert.equal(enmascararTelefono(null), null);
});

test("paginación: la página pedida empieza en 1 y el total nunca es menor que 1", () => {
  assert.equal(paginaPedida("3"), 3);
  for (const malo of [undefined, "0", "-2", "abc", "1.5", "99999"]) assert.equal(paginaPedida(malo), 1, `con ${malo}`);
  assert.equal(totalPaginas(0, 10), 1);
  assert.equal(totalPaginas(10, 10), 1);
  assert.equal(totalPaginas(11, 10), 2);
});
