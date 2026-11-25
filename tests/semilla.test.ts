import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarEjemplos, INTENTOS_DE_EJEMPLO, type FilaEjemplo } from "../src/worker/semilla.ts";

type Fila = FilaEjemplo & { aplicado: number; intentos: number };

function evento(id: string): Fila {
  return {
    id,
    hora: "2026-11-25T14:00:00.000Z",
    credito_id: "004601",
    gestor_id: "g2",
    tipo: "pago",
    monto_centavos: 41_000,
    medio: "qr",
    banco: "BBVA México",
    resultado: "pago",
    nota: null,
    aplicado: 0,
    intentos: 0,
  };
}

// Base de mentira con lo único que usa aplicarEjemplos: leer los eventos pendientes y marcarlos.
function baseFalsa(filas: Fila[]) {
  return {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      let args: unknown[] = [];
      const sentencia = {
        bind: (...valores: unknown[]) => {
          args = valores;
          return sentencia;
        },
        all: async () => ({ results: s.startsWith("SELECT * FROM ejemplos") ? filas.filter((f) => f.aplicado === 0).map((f) => ({ ...f })) : [] }),
        run: async () => {
          const fila = filas.find((f) => f.id === args.at(-1)) as Fila;
          if (s.startsWith("UPDATE ejemplos SET aplicado = 1")) fila.aplicado = 1;
          else if (s.startsWith("UPDATE ejemplos SET intentos = intentos + 1")) {
            fila.intentos++;
            if (fila.intentos >= (args[0] as number)) fila.aplicado = 2;
          } else throw new Error(`Sentencia no esperada: ${s}`);
          return { meta: { changes: 1 } };
        },
      };
      return sentencia;
    },
  } as unknown as D1Database;
}

const AHORA = new Date("2026-11-25T20:00:00.000Z");

test("si un evento de ejemplo falla, los demás se aplican y la función no lanza", async () => {
  const filas = [evento("EJ-01"), evento("EJ-02"), evento("EJ-03")];
  const aplicados: string[] = [];
  await aplicarEjemplos(baseFalsa(filas), AHORA, () => {}, async (_db, e) => {
    if (e.id === "EJ-02") throw new Error("la base no respondió");
    aplicados.push(e.id);
  });
  assert.deepEqual(aplicados, ["EJ-01", "EJ-03"]);
  assert.deepEqual(
    filas.map((f) => [f.id, f.aplicado, f.intentos]),
    [
      ["EJ-01", 1, 0],
      ["EJ-02", 0, 1],
      ["EJ-03", 1, 0],
    ],
  );
});

test("un evento que falla se reintenta en la siguiente vuelta y se aplica cuando ya se puede", async () => {
  const filas = [evento("EJ-01")];
  let falla = true;
  const aplicar = async () => {
    if (falla) throw new Error("fallo pasajero");
  };
  await aplicarEjemplos(baseFalsa(filas), AHORA, () => {}, aplicar);
  falla = false;
  await aplicarEjemplos(baseFalsa(filas), AHORA, () => {}, aplicar);
  assert.deepEqual([filas[0].aplicado, filas[0].intentos], [1, 1]);
});

test("un evento que falla siempre se descarta tras varios intentos y deja de estorbar a los demás", async () => {
  const filas = [evento("EJ-MALO"), evento("EJ-02")];
  let intentosAlMalo = 0;
  const aplicar = async (_db: D1Database, e: FilaEjemplo) => {
    if (e.id !== "EJ-MALO") return;
    intentosAlMalo++;
    throw new Error("siempre falla");
  };
  for (let vuelta = 0; vuelta < INTENTOS_DE_EJEMPLO + 3; vuelta++) await aplicarEjemplos(baseFalsa(filas), AHORA, () => {}, aplicar);
  assert.equal(intentosAlMalo, INTENTOS_DE_EJEMPLO, "ya no se vuelve a intentar");
  assert.deepEqual(
    filas.map((f) => f.aplicado),
    [2, 1],
    "2 = descartado, 1 = aplicado",
  );
});
