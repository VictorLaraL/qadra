import { test } from "node:test";
import assert from "node:assert/strict";
import { leerJson, leerTextoLimitado, tokenBearer } from "../src/worker/http.ts";

const URL_PRUEBA = "https://qadra.example/webhooks/pey";

/** Solicitud cuyo cuerpo llega en partes y sin Content-Length; cuenta cuántas partes se llegaron a pedir. */
function solicitudPorPartes(parte: Uint8Array, partes: number) {
  const estado = { pedidas: 0, cancelada: false };
  // highWaterMark 0: el flujo no adelanta ninguna parte; solo entrega cuando alguien lee.
  const cuerpo = new ReadableStream<Uint8Array>(
    {
      pull(control) {
        if (estado.pedidas >= partes) return control.close();
        estado.pedidas++;
        control.enqueue(parte);
      },
      cancel() {
        estado.cancelada = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(URL_PRUEBA, { method: "POST", body: cuerpo, duplex: "half" } as RequestInit);
  return { request, estado };
}

test("lee completo un cuerpo que cabe en el límite", async () => {
  const request = new Request(URL_PRUEBA, { method: "POST", body: '{"ok":true}' });
  assert.equal(await leerTextoLimitado(request, 64), '{"ok":true}');
  assert.equal(await leerTextoLimitado(new Request(URL_PRUEBA, { method: "POST" }), 64), "", "sin cuerpo");
});

test("con Content-Length mayor que el límite rechaza sin leer el cuerpo", async () => {
  const { request, estado } = solicitudPorPartes(new Uint8Array(10), 5);
  request.headers.set("content-length", "5000");
  assert.equal(await leerTextoLimitado(request, 1000), null);
  assert.equal(estado.pedidas, 0, "no se pidió ninguna parte del cuerpo");
});

test("sin Content-Length deja de leer en cuanto rebasa el límite", async () => {
  const { request, estado } = solicitudPorPartes(new Uint8Array(1024), 100_000); // hasta ~100 MB si se leyera todo
  assert.equal(await leerTextoLimitado(request, 4096), null);
  assert.ok(estado.pedidas <= 8, `leyó ${estado.pedidas} partes de 1 KB para un límite de 4 KB`);
  assert.equal(estado.cancelada, true, "se cancela el resto del envío");
});

test("el límite cuenta bytes, no caracteres", async () => {
  const eñes = "ñ".repeat(40); // 40 caracteres, 80 bytes
  assert.equal(await leerTextoLimitado(new Request(URL_PRUEBA, { method: "POST", body: eñes }), 80), eñes);
  assert.equal(await leerTextoLimitado(new Request(URL_PRUEBA, { method: "POST", body: eñes }), 79), null);
});

test("leerJson regresa null si el cuerpo no es JSON o no cabe", async () => {
  const con = (body: string, maximo?: number) => leerJson(new Request(URL_PRUEBA, { method: "POST", body }), maximo);
  assert.deepEqual(await con('{"creditoId":"004512"}'), { creditoId: "004512" });
  assert.equal(await con("no es json"), null);
  assert.equal(await con('{"relleno":"' + "x".repeat(100) + '"}', 50), null);
});

test("tokenBearer saca la clave del encabezado Authorization", () => {
  const con = (valor?: string) => tokenBearer(new Request(URL_PRUEBA, { headers: valor ? { authorization: valor } : {} }));
  assert.equal(con("Bearer clave-123"), "clave-123");
  assert.equal(con("Basic abc"), "");
  assert.equal(con(), "");
});
