// Cartera de ejemplo de la demo: se regenera cada día y, durante el día, "ocurren" los pagos y visitas de los otros
// gestores. Así la demo pública siempre tiene una ruta que cobrar y un portal con movimiento, sin datos reales.
//
// Esto es comportamiento de la DEMO: una financiera real no borra su cartera cada día. Por eso el cambio de día solo
// regenera la cartera de ejemplo; una cartera importada se queda hasta que el administrador reinicia la demo. Los
// pagos CoDi reales de días anteriores quedan en el libro `recibidos`, que nunca se borra.

import { datosDeEjemplo } from "../core/ejemplo.ts";
import { diaCdmx } from "../core/fechas.ts";
import type { PagoRecibido } from "../core/pagos.ts";
import { conciliarPago, type PagoConciliado } from "./conciliar.ts";
import { insertarFilas, sentenciasDeCartera } from "./db.ts";
import { log } from "./http.ts";

export interface FilaEjemplo {
  id: string;
  hora: string;
  credito_id: string;
  gestor_id: string;
  tipo: "pago" | "gestion";
  monto_centavos: number;
  medio: "qr" | "pn";
  banco: string;
  resultado: string;
  nota: string | null;
}

/** Aviso de algo que acaba de pasar en la cartera, para difundirlo en vivo. */
export type Novedad =
  | { tipo: "pago"; pago: PagoConciliado }
  | { tipo: "visita"; creditoId: string; gestorId: string | null; resultado: string; origen: "app" | "ejemplo"; fecha: string };

/**
 * Borra la cartera y carga la de ejemplo con fechas relativas a `hoy`.
 * `conservarCobrosVigentes` solo debe ser true cuando lo que se reemplaza es la misma cartera de ejemplo: sus créditos
 * conservan el número, así que un cobro pendiente sigue siendo válido. Sobre una cartera importada serían cobros
 * de créditos que ya no existen.
 */
export async function sembrar(db: D1Database, hoy: string, ahora: Date, opciones: { conservarCobrosVigentes: boolean }): Promise<void> {
  const datos = datosDeEjemplo(hoy);
  await db.batch([
    ...sentenciasDeCartera(db, datos.gestores, datos.creditos, ahora.toISOString(), opciones),
    db.prepare("DELETE FROM historico"),
    db.prepare("DELETE FROM limites"),
    ...insertarFilas(
      db,
      "ejemplos",
      ["id", "hora", "credito_id", "gestor_id", "tipo", "monto_centavos", "medio", "banco", "resultado", "nota"],
      datos.eventos.map((e) => [e.id, e.hora, e.creditoId, e.gestorId, e.tipo, e.montoCentavos, e.medio, e.banco, e.resultado, e.nota]),
    ),
    ...insertarFilas(
      db,
      "historico",
      ["dia", "cobrado_centavos", "pagos"],
      datos.historico.map((h) => [h.dia, h.cobradoCentavos, h.pagos]),
    ),
    db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('cartera', 'ejemplo') ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"),
  ]);
}

/** Pago de ejemplo con la misma forma que uno real. Su identificador es fijo, así que no se puede aplicar dos veces. */
function pagoDeEjemplo(e: FilaEjemplo): PagoRecibido {
  return {
    webhookId: `ejemplo:${e.id}`,
    tipo: e.medio,
    transactionId: e.id,
    montoCentavos: e.monto_centavos,
    concepto: `Abono credito ${e.credito_id}`,
    codiQrId: null,
    numRef: null,
    claveRastreo: `EJEMPLO${e.id.slice(-2)}${e.hora.slice(11, 16).replace(":", "")}`,
    banco: e.banco,
    cuentaFin: null,
    fechaPago: e.hora,
    metadata: {},
  };
}

const EVENTOS_POR_VUELTA = 40;
/** Veces que se intenta un evento de ejemplo antes de descartarlo. */
export const INTENTOS_DE_EJEMPLO = 3;

type Avisar = (n: Novedad) => void;
type AplicadorDeEjemplo = (db: D1Database, e: FilaEjemplo, ahora: Date, avisar: Avisar) => Promise<void>;

/** Guarda el pago (si lo hay) y la visita de un evento de ejemplo. Repetirlo no duplica nada. */
async function aplicarEvento(db: D1Database, e: FilaEjemplo, ahora: Date, avisar: Avisar): Promise<void> {
  if (e.tipo === "pago") {
    // Mismo camino de conciliación que un pago real, pero con el crédito ya indicado.
    const conciliado = await conciliarPago(db, pagoDeEjemplo(e), { origen: "ejemplo", creditoId: e.credito_id, ahora });
    if (conciliado.nuevo) avisar({ tipo: "pago", pago: conciliado });
  }
  const visita = await db
    .prepare(
      `INSERT INTO gestiones (id, credito_id, gestor_id, resultado, nota, origen, creado_en) VALUES (?, ?, ?, ?, ?, 'ejemplo', ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(`ges_${e.id}`, e.credito_id, e.gestor_id, e.resultado, e.nota, e.hora)
    .run();
  if (visita.meta.changes === 1) avisar({ tipo: "visita", creditoId: e.credito_id, gestorId: e.gestor_id, resultado: e.resultado, origen: "ejemplo", fecha: e.hora });
}

/**
 * Hace que "ocurran" los eventos de ejemplo cuya hora ya pasó. Nunca lanza: una falla en la cartera de ejemplo no
 * debe tumbar la solicitud de quien está usando la app.
 *
 * Cada evento se marca como aplicado (1) solo después de quedar guardado. Si falla, se reintenta en la siguiente
 * vuelta, y tras INTENTOS_DE_EJEMPLO fallos se descarta (2) para que no se reintente sin fin ni estorbe a los demás.
 */
export async function aplicarEjemplos(db: D1Database, ahora: Date, avisar: Avisar, aplicar: AplicadorDeEjemplo = aplicarEvento): Promise<void> {
  let pendientes: FilaEjemplo[];
  try {
    const consulta = await db
      .prepare("SELECT * FROM ejemplos WHERE aplicado = 0 AND hora <= ? ORDER BY hora LIMIT ?")
      .bind(ahora.toISOString(), EVENTOS_POR_VUELTA)
      .all<FilaEjemplo>();
    pendientes = consulta.results;
  } catch (error) {
    log("ejemplos_sin_leer", { mensaje: error instanceof Error ? error.message : String(error) });
    return;
  }

  for (const e of pendientes) {
    try {
      await aplicar(db, e, ahora, avisar);
      await db.prepare("UPDATE ejemplos SET aplicado = 1 WHERE id = ?").bind(e.id).run();
    } catch (error) {
      log("ejemplo_fallido", { ejemplo: e.id, mensaje: error instanceof Error ? error.message : String(error) });
      await db
        .prepare("UPDATE ejemplos SET intentos = intentos + 1, aplicado = CASE WHEN intentos + 1 >= ? THEN 2 ELSE 0 END WHERE id = ?")
        .bind(INTENTOS_DE_EJEMPLO, e.id)
        .run()
        .catch(() => {}); // si ni siquiera esto se puede guardar, se intentará de nuevo en la siguiente vuelta
    }
  }
}

async function ajuste(db: D1Database, clave: string): Promise<string | null> {
  return (await db.prepare("SELECT valor FROM ajustes WHERE clave = ?").bind(clave).first<{ valor: string }>())?.valor ?? null;
}

// Cada instancia del Worker revisa la base a lo más cada 20 segundos.
const PAUSA_MS = 20_000;
let ultimaRevision = 0;

/**
 * Deja la demo al día: si cambió el día (hora de la Ciudad de México) vuelve a sembrar la cartera de ejemplo, y aplica
 * los eventos de ejemplo cuya hora ya pasó. La llaman el cron y las consultas de la app; es barata si no hay nada.
 */
export async function ponerAlDia(env: Env, avisar: (n: Novedad) => void, opciones: { forzar?: boolean; ahora?: Date } = {}): Promise<void> {
  const ahora = opciones.ahora ?? new Date();
  if (!opciones.forzar && ahora.getTime() - ultimaRevision < PAUSA_MS) return;
  ultimaRevision = ahora.getTime();

  const hoy = diaCdmx(ahora);
  // Solo una solicitud gana el cambio de día; las demás siguen de largo.
  const cambio = await env.DB.prepare(
    `INSERT INTO ajustes (clave, valor) VALUES ('dia', ?1)
     ON CONFLICT (clave) DO UPDATE SET valor = ?1 WHERE ajustes.valor <> ?1`,
  )
    .bind(hoy)
    .run();
  // Al cambiar de día solo se regenera la cartera de ejemplo. Una cartera importada no se borra sola.
  if (cambio.meta.changes === 1 && (await ajuste(env.DB, "cartera")) !== "importada") {
    await sembrarYSoltarSiFalla(env.DB, hoy, ahora, { conservarCobrosVigentes: true });
  }

  if ((await ajuste(env.DB, "cartera")) === "ejemplo") await aplicarEjemplos(env.DB, ahora, avisar);
}

/** Siembra la cartera de ejemplo; si falla, suelta el día para que la siguiente solicitud lo intente otra vez. */
async function sembrarYSoltarSiFalla(db: D1Database, hoy: string, ahora: Date, opciones: { conservarCobrosVigentes: boolean }): Promise<void> {
  try {
    await sembrar(db, hoy, ahora, opciones);
    log("cartera_sembrada", { dia: hoy, cobrosConservados: opciones.conservarCobrosVigentes });
  } catch (error) {
    await db.prepare("UPDATE ajustes SET valor = '' WHERE clave = 'dia'").run();
    ultimaRevision = 0;
    throw error;
  }
}

/** Vuelve a cargar la cartera de ejemplo ahora mismo (botón "Reiniciar demo" y pruebas), aunque haya una importada. */
export async function reiniciarDemo(env: Env, avisar: (n: Novedad) => void, ahora = new Date()): Promise<void> {
  const hoy = diaCdmx(ahora);
  // Los cobros pendientes solo se conservan si lo que había ya era la cartera de ejemplo (mismos créditos).
  const eraDeEjemplo = (await ajuste(env.DB, "cartera")) !== "importada";
  await env.DB.prepare("INSERT INTO ajustes (clave, valor) VALUES ('dia', ?1) ON CONFLICT (clave) DO UPDATE SET valor = ?1").bind(hoy).run();
  await sembrarYSoltarSiFalla(env.DB, hoy, ahora, { conservarCobrosVigentes: eraDeEjemplo });
  ultimaRevision = ahora.getTime();
  await aplicarEjemplos(env.DB, ahora, avisar);
}
