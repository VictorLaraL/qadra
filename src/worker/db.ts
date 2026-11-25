// Acceso a D1: cartera, cuotas y cargas completas. La conciliación de pagos vive en conciliar.ts.

import type { CreditoImportado } from "../core/cartera.ts";
import { generarCuotas } from "../core/cartera.ts";
import { estadoCredito, type Cuota, type EstadoCredito } from "../core/conciliacion.ts";

export interface FilaCredito {
  id: string;
  acreditado: string;
  telefono: string | null;
  producto: string;
  grupo: string | null;
  colonia: string;
  domicilio: string | null;
  gestor_id: string | null;
  orden: number;
  demo: number;
  creado_en: string;
}

export interface FilaGestor {
  id: string;
  nombre: string;
  zona: string;
}

interface FilaCuota {
  credito_id: string;
  numero: number;
  vence: string;
  monto_centavos: number;
  pagado_centavos: number;
}

export interface CreditoConEstado extends FilaCredito {
  estado: EstadoCredito;
}

const aCuota = (f: FilaCuota): Cuota => ({ numero: f.numero, vence: f.vence, montoCentavos: f.monto_centavos, pagadoCentavos: f.pagado_centavos });

export function credito(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM creditos WHERE id = ?").bind(id).first<FilaCredito>();
}

export async function cuotasDe(db: D1Database, creditoId: string): Promise<Cuota[]> {
  const { results } = await db.prepare("SELECT * FROM cuotas WHERE credito_id = ? ORDER BY numero").bind(creditoId).all<FilaCuota>();
  return results.map(aCuota);
}

export async function gestores(db: D1Database): Promise<FilaGestor[]> {
  return (await db.prepare("SELECT * FROM gestores ORDER BY id").all<FilaGestor>()).results;
}

/**
 * Créditos con su estado calculado a hoy (saldo, exigible, atraso), de toda la cartera o de un gestor.
 * El estado se calcula con la misma función probada del núcleo, no con SQL aparte.
 */
export async function creditosConEstado(db: D1Database, hoy: string, gestorId?: string): Promise<CreditoConEstado[]> {
  const filtro = gestorId ? "WHERE gestor_id = ?1" : "";
  const consultas = [
    db.prepare(`SELECT * FROM creditos ${filtro} ORDER BY gestor_id, orden, id`),
    db.prepare(`SELECT * FROM cuotas ${gestorId ? "WHERE credito_id IN (SELECT id FROM creditos WHERE gestor_id = ?1)" : ""} ORDER BY credito_id, numero`),
  ].map((c) => (gestorId ? c.bind(gestorId) : c));
  const [creditos, cuotas] = (await db.batch(consultas)) as [D1Result<FilaCredito>, D1Result<FilaCuota>];

  const porCredito = new Map<string, Cuota[]>();
  for (const f of cuotas.results) {
    const lista = porCredito.get(f.credito_id) ?? [];
    lista.push(aCuota(f));
    porCredito.set(f.credito_id, lista);
  }
  return creditos.results.map((c) => ({ ...c, estado: estadoCredito(porCredito.get(c.id) ?? [], hoy) }));
}

// D1 admite hasta 100 parámetros por sentencia: las cargas se parten en lotes.
const PARAMETROS_MAXIMOS = 100;

/** Sentencias INSERT de varias filas, en lotes que respetan el límite de parámetros de D1. */
export function insertarFilas(db: D1Database, tabla: string, columnas: string[], filas: unknown[][]): D1PreparedStatement[] {
  const porLote = Math.floor(PARAMETROS_MAXIMOS / columnas.length);
  const sentencias: D1PreparedStatement[] = [];
  for (let i = 0; i < filas.length; i += porLote) {
    const lote = filas.slice(i, i + porLote);
    const marcas = lote.map(() => `(${columnas.map(() => "?").join(", ")})`).join(", ");
    sentencias.push(db.prepare(`INSERT INTO ${tabla} (${columnas.join(", ")}) VALUES ${marcas}`).bind(...lote.flat()));
  }
  return sentencias;
}

export interface CreditoPorCargar extends CreditoImportado {
  gestorId: string;
  orden: number;
  demo: boolean;
}

/**
 * Sentencias que borran la cartera con todo lo que cuelga de ella (cobros, pagos, visitas) y cargan una nueva.
 * No toca `recibidos` (pagos reales ya procesados) ni `qr_fijos`.
 *
 * Con `conservarCobrosVigentes` (cuando se vuelve a cargar la misma cartera de ejemplo) los cobros pendientes que
 * aún no vencen se quedan: quien ya tiene el QR en la mano todavía puede pagarlo y su pago se concilia.
 */
export function sentenciasDeCartera(
  db: D1Database,
  listaGestores: FilaGestor[],
  creditos: CreditoPorCargar[],
  ahora: string,
  opciones: { conservarCobrosVigentes?: boolean } = {},
): D1PreparedStatement[] {
  const borrar = ["aplicaciones", "pagos", "gestiones", "ejemplos", "cuotas", "creditos", "gestores", "pey_simulado"].map((t) => db.prepare(`DELETE FROM ${t}`));
  const filasCuotas = creditos.flatMap((c) => generarCuotas(c).map((q) => [c.id, q.numero, q.vence, q.montoCentavos, q.pagadoCentavos]));
  return [
    ...borrar,
    opciones.conservarCobrosVigentes
      ? db.prepare("DELETE FROM cobros WHERE NOT (estado = 'pendiente' AND vence_en > ?)").bind(ahora)
      : db.prepare("DELETE FROM cobros"),
    db.prepare("DELETE FROM recibidos WHERE origen <> 'codi'"),
    ...insertarFilas(
      db,
      "gestores",
      ["id", "nombre", "zona"],
      listaGestores.map((g) => [g.id, g.nombre, g.zona]),
    ),
    ...insertarFilas(
      db,
      "creditos",
      ["id", "acreditado", "telefono", "producto", "grupo", "colonia", "domicilio", "gestor_id", "orden", "demo", "creado_en"],
      creditos.map((c) => [c.id, c.acreditado, c.telefono, c.producto, c.grupo, c.colonia, c.domicilio, c.gestorId, c.orden, c.demo ? 1 : 0, ahora]),
    ),
    ...insertarFilas(db, "cuotas", ["credito_id", "numero", "vence", "monto_centavos", "pagado_centavos"], filasCuotas),
  ];
}
