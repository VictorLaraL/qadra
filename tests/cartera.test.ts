import { test } from "node:test";
import assert from "node:assert/strict";
import { aCsv, generarCuotas, leerCsv, PLANTILLA_CARTERA, validarCartera } from "../src/core/cartera.ts";
import { validarCobro } from "../src/core/validaciones.ts";

const HOY = "2026-11-25";
const ENCABEZADO =
  "id_credito,acreditado,telefono,producto,grupo,colonia,domicilio,gestor,monto_cuota,cuotas_totales,cuotas_pagadas,frecuencia,proximo_vencimiento";
const FILA = "004512,Rosa M.,9991234567,Grupal semanal,Las Flores,Chuburná,Calle 21 #104,Mariana R.,450.00,16,7,semanal,2026-11-25";

test("leerCsv separa por comas y respeta comillas, comas internas y comillas dobles", () => {
  const filas = leerCsv('a,b,c\r\n1,"Calle 21, #104","Dijo ""hola"""\r\n');
  assert.deepEqual(filas, [
    ["a", "b", "c"],
    ["1", "Calle 21, #104", 'Dijo "hola"'],
  ]);
});

test("leerCsv quita la marca BOM, acepta saltos de línea de Windows y dentro de comillas, y omite renglones vacíos", () => {
  const filas = leerCsv('﻿a,b\r\n1,"dos\nrenglones"\r\n\r\n2,3\n\n');
  assert.deepEqual(filas, [
    ["a", "b"],
    ["1", "dos\nrenglones"],
    ["2", "3"],
  ]);
});

test("leerCsv detecta el punto y coma que usa Excel en español, y el tabulador", () => {
  assert.deepEqual(leerCsv("a;b;c\n1;2,5;3"), [
    ["a", "b", "c"],
    ["1", "2,5", "3"],
  ]);
  assert.deepEqual(leerCsv("a\tb\n1\t2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("una cartera válida regresa sus créditos con montos en centavos", () => {
  const r = validarCartera(`${ENCABEZADO}\n${FILA}`, HOY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.creditos, [
    {
      id: "004512",
      acreditado: "Rosa M.",
      telefono: "9991234567",
      producto: "Grupal semanal",
      grupo: "Las Flores",
      colonia: "Chuburná",
      domicilio: "Calle 21 #104",
      gestor: "Mariana R.",
      montoCuotaCentavos: 45_000,
      cuotasTotales: 16,
      cuotasPagadas: 7,
      frecuencia: "semanal",
      proximoVencimiento: "2026-11-25",
    },
  ]);
  assert.deepEqual(r.resumen, { filas: 1, validas: 1, conErrores: 0, gestores: ["Mariana R."], saldoCentavos: 9 * 45_000 });
});

test("los encabezados se aceptan con mayúsculas, acentos y espacios, y en cualquier orden", () => {
  const texto =
    "Próximo Vencimiento;ID Crédito;Acreditado;Producto;Colonia;Gestor;Monto Cuota;Cuotas Totales;Cuotas Pagadas;Frecuencia\n" +
    "25/11/2026;A-1;Luis H.;Individual quincenal;Centro;Diego T.;$1,250.50;12;0;Quincenal";
  const r = validarCartera(texto, HOY);
  assert.equal(r.ok, true, JSON.stringify(r.errores));
  assert.equal(r.creditos[0].proximoVencimiento, "2026-11-25", "acepta DD/MM/AAAA");
  assert.equal(r.creditos[0].montoCuotaCentavos, 125_050);
  assert.equal(r.creditos[0].frecuencia, "quincenal");
  assert.deepEqual([r.creditos[0].telefono, r.creditos[0].grupo, r.creditos[0].domicilio], [null, null, null]);
});

test("si faltan columnas obligatorias no se revisa nada más y se dice cuáles faltan", () => {
  const r = validarCartera("id_credito,acreditado\n1,Rosa", HOY);
  assert.equal(r.ok, false);
  assert.deepEqual(r.columnasFaltantes, [
    "producto",
    "colonia",
    "gestor",
    "monto_cuota",
    "cuotas_totales",
    "cuotas_pagadas",
    "frecuencia",
    "proximo_vencimiento",
  ]);
  assert.deepEqual(r.creditos, []);
});

test("cada error dice el renglón del archivo, la columna y qué se esperaba", () => {
  const malas = [
    FILA, // renglón 2: válido
    FILA, // renglón 3: crédito repetido
    FILA.replace("004512", "B2").replace("450.00", "cero"),
    FILA.replace("004512", "B3").replace(",16,7,", ",16,17,"),
    FILA.replace("004512", "B4").replace("2026-11-25", "2026-02-30"),
    FILA.replace("004512", "B5").replace("9991234567", "99912"),
    FILA.replace("004512", "B6").replace(",semanal,", ",diario,"),
    FILA.replace("004512", "").replace("Rosa M.", ""),
  ];
  const r = validarCartera([ENCABEZADO, ...malas].join("\n"), HOY);
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.errores.map((e) => `${e.fila}:${e.columna}`),
    ["3:id_credito", "4:monto_cuota", "5:cuotas_pagadas", "6:proximo_vencimiento", "7:telefono", "8:frecuencia", "9:id_credito", "9:acreditado"],
  );
  assert.match(r.errores[0].mensaje, /repetido/i);
  assert.match(r.errores[2].mensaje, /no puede ser mayor/i);
  assert.match(r.errores[4].mensaje, /10 dígitos/);
  assert.equal(r.creditos.length, 1, "solo se regresan los renglones válidos");
  assert.deepEqual({ filas: r.resumen.filas, validas: r.resumen.validas, conErrores: r.resumen.conErrores }, { filas: 8, validas: 1, conErrores: 7 });
});

test("el renglón del error es el del archivo aunque haya renglones vacíos o celdas de varias líneas", () => {
  const texto = [
    ENCABEZADO, // renglón 1
    "", // 2: vacío
    FILA.replace("Calle 21 #104", '"Calle 21 #104\nentre 18 y 20"'), // 3 y 4: una celda con salto de línea
    "", // 5: vacío
    FILA.replace("004512", "B2").replace("450.00", "cero"), // 6
  ].join("\n");
  const r = validarCartera(texto, HOY);
  assert.deepEqual(
    r.errores.map((e) => `${e.fila}:${e.columna}`),
    ["6:monto_cuota"],
  );
  assert.equal(r.creditos[0].domicilio, "Calle 21 #104\nentre 18 y 20");
});

test("la regla del número de crédito y del celular es la misma al importar y al cobrar", () => {
  const casos: Array<[string, boolean]> = [
    ["A-1001", true],
    ["004512", true],
    ["crédito 1", false],
    ["1234567890123", false],
  ];
  for (const [id, valido] of casos) {
    const importado = validarCartera([ENCABEZADO, FILA.replace("004512", id)].join("\n"), HOY).ok;
    const cobrable = validarCobro({ creditoId: id, montoCentavos: 1, medio: "qr" }, { saldoCentavos: 1, topeCentavos: 0 }).ok;
    assert.deepEqual([importado, cobrable], [valido, valido], id);
  }
  const conCelular = validarCartera([ENCABEZADO, FILA.replace("9991234567", "999 123-4567")].join("\n"), HOY);
  assert.equal(conCelular.creditos[0]?.telefono, "9991234567");
});

test("un archivo vacío, sin renglones de datos o con más de 500 créditos se rechaza con un mensaje claro", () => {
  assert.match(validarCartera("", HOY).errores[0].mensaje, /vacío/i);
  assert.match(validarCartera(ENCABEZADO, HOY).errores[0].mensaje, /no tiene créditos/i);
  const muchas = Array.from({ length: 501 }, (_, i) => FILA.replace("004512", `C${i}`));
  const r = validarCartera([ENCABEZADO, ...muchas].join("\n"), HOY);
  assert.equal(r.ok, false);
  assert.match(r.errores[0].mensaje, /500/);
});

test("la plantilla descargable pasa la validación", () => {
  const r = validarCartera(PLANTILLA_CARTERA, HOY);
  assert.equal(r.ok, true, JSON.stringify(r.errores));
  assert.ok(r.creditos.length >= 2);
});

test("generarCuotas: las pagadas quedan atrás, la siguiente vence en la fecha indicada y el resto sigue cada semana", () => {
  const [credito] = validarCartera(`${ENCABEZADO}\n${FILA}`, HOY).creditos;
  const cuotas = generarCuotas(credito);
  assert.equal(cuotas.length, 16);
  assert.deepEqual(cuotas[6], { numero: 7, vence: "2026-11-18", montoCentavos: 45_000, pagadoCentavos: 45_000 });
  assert.deepEqual(cuotas[7], { numero: 8, vence: "2026-11-25", montoCentavos: 45_000, pagadoCentavos: 0 });
  assert.deepEqual(cuotas[15], { numero: 16, vence: "2027-01-20", montoCentavos: 45_000, pagadoCentavos: 0 });
  assert.equal(cuotas[0].vence, "2026-10-07");
});

test("generarCuotas: quincenal avanza 15 días y mensual respeta el fin de mes", () => {
  const base = validarCartera(`${ENCABEZADO}\n${FILA}`, HOY).creditos[0];
  const quincenal = generarCuotas({ ...base, frecuencia: "quincenal", cuotasTotales: 3, cuotasPagadas: 1, proximoVencimiento: "2026-11-25" });
  assert.deepEqual(
    quincenal.map((c) => c.vence),
    ["2026-11-10", "2026-11-25", "2026-12-10"],
  );
  const mensual = generarCuotas({ ...base, frecuencia: "mensual", cuotasTotales: 4, cuotasPagadas: 0, proximoVencimiento: "2027-01-31" });
  assert.deepEqual(
    mensual.map((c) => c.vence),
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
  );
});

test("generarCuotas: un crédito liquidado deja todas sus cuotas pagadas", () => {
  const base = validarCartera(`${ENCABEZADO}\n${FILA}`, HOY).creditos[0];
  const cuotas = generarCuotas({ ...base, cuotasTotales: 2, cuotasPagadas: 2 });
  assert.deepEqual(
    cuotas.map((c) => [c.vence, c.pagadoCentavos]),
    [
      ["2026-11-11", 45_000],
      ["2026-11-18", 45_000],
    ],
  );
});

test("aCsv entrecomilla lo necesario, desactiva fórmulas y abre bien en Excel", () => {
  const csv = aCsv(
    ["credito", "nota", "monto"],
    [
      ["004512", 'Dijo "sí", mañana', 450.5],
      ["B2", "=HYPERLINK(1)", null],
    ],
  );
  assert.equal(csv, '﻿credito,nota,monto\r\n004512,"Dijo ""sí"", mañana",450.5\r\nB2,\'=HYPERLINK(1),\r\n');
  assert.deepEqual(leerCsv(csv)[1], ["004512", 'Dijo "sí", mañana', "450.5"]);
});
