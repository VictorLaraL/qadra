import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { crearCobro } from "../src/worker/cobros.ts";
import { ErrorPey } from "../src/worker/pey.ts";

// Base de datos de mentira que solo apunta, en orden, qué se hizo. Así se prueba el orden entre guardar el cobro y
// llamar a pey sin levantar un Worker.
function baseFalsa(registro: string[]) {
  const nombre = (sql: string): string => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT * FROM cobros WHERE credito_id")) return "buscar-vigente";
    if (s.startsWith("SELECT 1 AS x FROM cobros WHERE folio")) return "folio-libre";
    if (s.startsWith("INSERT INTO cobros")) return "guardar-cobro";
    if (s.startsWith("UPDATE cobros SET pey_id")) return "completar-cobro";
    if (s.startsWith("DELETE FROM cobros WHERE id")) return "borrar-cobro";
    return `otra: ${s.slice(0, 40)}`;
  };
  return {
    prepare(sql: string) {
      const sentencia = {
        bind: () => sentencia,
        first: async () => {
          registro.push(nombre(sql));
          return null;
        },
        run: async () => {
          registro.push(nombre(sql));
          return { meta: { changes: 1 } };
        },
      };
      return sentencia;
    },
  };
}

function entorno(registro: string[]) {
  return { DB: baseFalsa(registro), PEY_API_KEY: "llave-de-prueba", SIMULACION: "1" } as unknown as Env;
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Sustituye a pey: apunta la llamada y responde lo que se le pida. */
function pey(registro: string[], responder: () => Response | Promise<Response>) {
  const llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    registro.push("pey");
    llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body ?? "{}")) });
    return responder();
  }) as typeof fetch;
  return llamadas;
}

const QR = { creditoId: "004512", montoCentavos: 45_000, medio: "qr" as const, telefono: null };

test("el cobro se guarda antes de pedirlo a pey y se completa con el IDC que pey regresa", async () => {
  const registro: string[] = [];
  const llamadas = pey(registro, () => Response.json({ id: "IDC123", qrString: '{"TYP":1}' }, { status: 201 }));
  const { cobro, reutilizado } = await crearCobro(entorno(registro), QR, "g1");

  assert.deepEqual(registro, ["buscar-vigente", "folio-libre", "guardar-cobro", "pey", "completar-cobro"]);
  assert.deepEqual([reutilizado, cobro.pey_id, cobro.qr_string, cobro.estado, cobro.simulado], [false, "IDC123", '{"TYP":1}', "pendiente", 0]);
  const pedido = llamadas[0];
  assert.equal(pedido.url, "https://api.pey.mx/codi/qr");
  assert.deepEqual(
    { amount: pedido.cuerpo.amount, concept: pedido.cuerpo.concept, expiration: pedido.cuerpo.expiration, numRef: pedido.cuerpo.numRef, metadata: pedido.cuerpo.metadata },
    { amount: 450, concept: "Abono credito 004512", expiration: 600, numRef: String(cobro.folio), metadata: { cobro: cobro.id, credito: "004512" } },
  );
});

test("si pey no responde a tiempo, el cobro queda guardado: un pago tardío se podrá identificar por su folio", async () => {
  const registro: string[] = [];
  pey(registro, () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  await assert.rejects(crearCobro(entorno(registro), QR, "g1"), { name: "TimeoutError" });
  assert.deepEqual(registro, ["buscar-vigente", "folio-libre", "guardar-cobro", "pey"], "no se borra: no se sabe si pey lo creó");
});

test("si pey rechaza el cobro, no queda ningún cobro guardado", async () => {
  const registro: string[] = [];
  pey(registro, () => Response.json({ error: { message: "Amount must be a number greater than 0", type: "INVALID_AMOUNT" } }, { status: 400 }));
  await assert.rejects(crearCobro(entorno(registro), QR, "g1"), (error: unknown) => {
    assert.ok(error instanceof ErrorPey);
    assert.deepEqual([error.status, error.tipo], [400, "INVALID_AMOUNT"]);
    return true;
  });
  assert.deepEqual(registro, ["buscar-vigente", "folio-libre", "guardar-cobro", "pey", "borrar-cobro"]);
});

test("si pey responde con un error suyo (5xx), no se sabe si creó el cobro: se conserva", async () => {
  const registro: string[] = [];
  pey(registro, () => Response.json({ error: { message: "Error creating CoDi QR", type: "INTERNAL_SERVER_ERROR" } }, { status: 500 }));
  await assert.rejects(crearCobro(entorno(registro), QR, "g1"), { name: "ErrorPey", status: 500 });
  assert.deepEqual(registro, ["buscar-vigente", "folio-libre", "guardar-cobro", "pey"]);
});

test("sin API key y sin simulación no se llama a pey y no queda ningún cobro guardado", async () => {
  const registro: string[] = [];
  pey(registro, () => Response.json({}));
  const sinLlave = { ...entorno(registro), PEY_API_KEY: "", SIMULACION: "0" } as unknown as Env;
  await assert.rejects(crearCobro(sinLlave, QR, "g1"), { name: "ErrorPey", tipo: "SIN_CONFIGURAR" });
  assert.deepEqual(registro, ["buscar-vigente", "folio-libre", "guardar-cobro", "borrar-cobro"]);
});

test("el cobro al celular manda el número a pey, guarda solo sus últimos 4 dígitos y no reutiliza cobros", async () => {
  const registro: string[] = [];
  const llamadas = pey(registro, () => Response.json({ transactionId: "01TXPUSH", codiId: "12345678901234567890" }));
  const { cobro } = await crearCobro(entorno(registro), { ...QR, medio: "push", telefono: "9991234567" }, "g1");

  assert.deepEqual(registro, ["folio-libre", "guardar-cobro", "pey", "completar-cobro"]);
  assert.equal(llamadas[0].url, "https://api.pey.mx/codi/pn");
  assert.equal(llamadas[0].cuerpo.phoneNumber, "9991234567");
  assert.deepEqual([cobro.pey_id, cobro.telefono_fin, cobro.qr_string], ["01TXPUSH", "4567", null]);
  assert.doesNotMatch(JSON.stringify(cobro), /9991234567/);
});
