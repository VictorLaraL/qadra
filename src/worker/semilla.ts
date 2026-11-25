// Cartera de ejemplo de la demo: se regenera cada día y, durante el día, "ocurren" los pagos y visitas de los otros
// gestores. Así la demo pública siempre tiene una ruta que cobrar y un portal con movimiento, sin datos reales.

import { datosDeEjemplo } from "../core/ejemplo.ts";
import { diaCdmx } from "../core/fechas.ts";
import type { PagoRecibido } from "../core/pagos.ts";
import { conciliarPago, type PagoConciliado } from "./conciliar.ts";
import { insertarFilas, sentenciasDeCartera } from "./db.ts";
import { log } from "./http.ts";

interface FilaEjemplo {
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
export type Novedad = { tipo: "pago"; pago: PagoConciliado } | { tipo: "visita"; creditoId: string; gestorId: string | null; resultado: string; origen: "app" | "ejemplo"; fecha: string };

/** Borra la cartera y carga la de ejemplo con fechas relativas a `hoy`. */
export async function sembrar(db: D1Database, hoy: string, ahora: Date): Promise<void> {
  const datos = datosDeEjemplo(hoy);
  await db.batch([
    ...sentenciasDeCartera(db, datos.gestores, datos.creditos, ahora.toISOString()),
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

/** Hace que "ocurran" los eventos de ejemplo cuya hora ya pasó. Cada evento se toma una sola vez. */
async function aplicarEjemplos(db: D1Database, ahora: Date, avisar: (n: Novedad) => void): Promise<number> {
  const { results } = await db
    .prepare("UPDATE ejemplos SET aplicado = 1 WHERE aplicado = 0 AND hora <= ? RETURNING *")
    .bind(ahora.toISOString())
    .all<FilaEjemplo>();
  const pendientes = [...results].sort((a, b) => a.hora.localeCompare(b.hora));

  for (const e of pendientes) {
    if (e.tipo === "pago") {
      const pago: PagoRecibido = {
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
      // Mismo camino de conciliación que un pago real, pero con el crédito ya indicado.
      const conciliado = await conciliarPago(db, pago, { origen: "ejemplo", creditoId: e.credito_id, ahora });
      if (conciliado.nuevo) avisar({ tipo: "pago", pago: conciliado });
    }
    await db
      .prepare(
        `INSERT INTO gestiones (id, credito_id, gestor_id, resultado, nota, origen, creado_en) VALUES (?, ?, ?, ?, ?, 'ejemplo', ?)
         ON CONFLICT (id) DO NOTHING`,
      )
      .bind(`ges_${e.id}`, e.credito_id, e.gestor_id, e.resultado, e.nota, e.hora)
      .run();
    avisar({ tipo: "visita", creditoId: e.credito_id, gestorId: e.gestor_id, resultado: e.resultado, origen: "ejemplo", fecha: e.hora });
  }
  return pendientes.length;
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
  // Solo una solicitud gana el cambio de día y siembra; las demás siguen de largo.
  const cambio = await env.DB.prepare(
    `INSERT INTO ajustes (clave, valor) VALUES ('dia', ?1)
     ON CONFLICT (clave) DO UPDATE SET valor = ?1 WHERE ajustes.valor <> ?1`,
  )
    .bind(hoy)
    .run();
  if (cambio.meta.changes === 1) {
    try {
      await sembrar(env.DB, hoy, ahora);
      log("cartera_sembrada", { dia: hoy });
    } catch (error) {
      // Si la siembra falla, se suelta el día para que la siguiente solicitud lo intente otra vez.
      await env.DB.prepare("UPDATE ajustes SET valor = '' WHERE clave = 'dia'").run();
      ultimaRevision = 0;
      throw error;
    }
  }

  const cartera = await env.DB.prepare("SELECT valor FROM ajustes WHERE clave = 'cartera'").first<{ valor: string }>();
  if (cartera?.valor === "ejemplo") await aplicarEjemplos(env.DB, ahora, avisar);
}

/** Vuelve a sembrar la cartera de ejemplo ahora mismo (botón "Reiniciar demo" y pruebas). */
export async function reiniciarDemo(env: Env, avisar: (n: Novedad) => void, ahora = new Date()): Promise<void> {
  await env.DB.prepare("INSERT INTO ajustes (clave, valor) VALUES ('dia', '') ON CONFLICT (clave) DO UPDATE SET valor = ''").run();
  await ponerAlDia(env, avisar, { forzar: true, ahora });
}
