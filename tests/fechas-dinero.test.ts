import { test } from "node:test";
import assert from "node:assert/strict";
import { aCentavos, pesos } from "../src/core/dinero.ts";
import { dentroDeHorario, diaCdmx, diasEntre, esDia, inicioDelDiaCdmx, instanteCdmx, sumarDias, sumarMeses } from "../src/core/fechas.ts";

test("el día en la Ciudad de México va 6 horas detrás de UTC", () => {
  assert.equal(diaCdmx(new Date("2026-11-26T05:59:59Z")), "2026-11-25");
  assert.equal(diaCdmx(new Date("2026-11-26T06:00:00Z")), "2026-11-26");
  assert.equal(inicioDelDiaCdmx(new Date("2026-11-26T05:59:59Z")), "2026-11-25T06:00:00.000Z");
  assert.equal(instanteCdmx("2026-11-25", 10, 42), "2026-11-25T16:42:00.000Z");
});

test("sumar días y meses cruza meses y años, y respeta el fin de mes", () => {
  assert.equal(sumarDias("2026-11-25", 7), "2026-12-02");
  assert.equal(sumarDias("2026-12-28", 7), "2027-01-04");
  assert.equal(sumarDias("2026-11-25", -30), "2026-10-26");
  assert.equal(sumarMeses("2027-01-31", 1), "2027-02-28");
  assert.equal(sumarMeses("2026-11-30", 3), "2027-02-28");
  assert.equal(sumarMeses("2026-11-15", -2), "2026-09-15");
});

test("días entre dos fechas, con signo", () => {
  assert.equal(diasEntre("2026-11-11", "2026-11-25"), 14);
  assert.equal(diasEntre("2026-11-25", "2026-11-11"), -14);
  assert.equal(diasEntre("2026-11-25", "2026-11-25"), 0);
});

test("esDia acepta solo fechas reales en formato AAAA-MM-DD", () => {
  assert.equal(esDia("2026-11-25"), true);
  assert.equal(esDia("2028-02-29"), true, "año bisiesto");
  for (const malo of ["2026-02-30", "2026-13-01", "25/11/2026", "2026-1-5", "", null, 20261125]) {
    assert.equal(esDia(malo), false, `con ${JSON.stringify(malo)}`);
  }
});

test("el horario de gestión de cobranza es de 7:00 a 22:00, hora del centro", () => {
  const a = (hora: string) => dentroDeHorario(new Date(`2026-11-25T${hora}:00-06:00`));
  assert.equal(a("06:59"), false);
  assert.equal(a("07:00"), true);
  assert.equal(a("21:59"), true);
  assert.equal(a("22:00"), false);
  assert.equal(a("02:30"), false);
});

test("aCentavos entiende lo que se escribe en Excel y rechaza lo que no es dinero", () => {
  assert.equal(aCentavos("450"), 45_000);
  assert.equal(aCentavos("450.5"), 45_050);
  assert.equal(aCentavos(" $1,250.50 "), 125_050);
  assert.equal(aCentavos(0.01), 1);
  assert.equal(aCentavos(0.07), 7, "sin errores de punto flotante");
  assert.equal(aCentavos(1234.56), 123_456);
  for (const malo of ["", "cero", "-5", -5, "4.505", "1,25", "12,34.5", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
    assert.equal(aCentavos(malo), null, `con ${JSON.stringify(malo)}`);
  }
});

test("pesos da formato de moneda con separador de miles", () => {
  assert.equal(pesos(1), "$0.01");
  assert.equal(pesos(45_000), "$450.00");
  assert.equal(pesos(123_456_789), "$1,234,567.89");
  assert.equal(pesos(0), "$0.00");
});
