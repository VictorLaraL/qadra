// Consultas de lectura para la app del gestor y el portal. Todo lo que sale de aquí ya va listo para mostrarse:
// en camelCase y con los datos sensibles recortados según el rol.

import { estadoCredito } from "../core/conciliacion.ts";
import { enmascararRastreo, enmascararTelefono } from "../core/validaciones.ts";
import { credito, cuotasDe } from "./db.ts";
import type { Rol } from "./entorno.ts";

export interface FilaPago {
  transaction_id: string;
  medio: "qr" | "pn";
  via: string;
  cobro_id: string | null;
  credito_id: string | null;
  gestor_id: string | null;
  monto_centavos: number;
  aplicado_centavos: number;
  estado: "aplicado" | "excepcion";
  motivo: string | null;
  concepto: string | null;
  num_ref: string | null;
  clave_rastreo: string | null;
  banco: string | null;
  cuenta_fin: string | null;
  origen: "codi" | "simulado" | "ejemplo";
  recuperado: number;
  fecha_pago: string;
  recibido_en: string;
  resuelto_en: string | null;
}

export interface FilaAplicacion {
  transaction_id: string;
  cuota_numero: number;
  monto_centavos: number;
  liquida: number;
}

export type CuotasPorPago = Map<string, Array<{ numero: number; montoCentavos: number; liquida: boolean }>>;

export function agruparAplicaciones(filas: FilaAplicacion[]): CuotasPorPago {
  const mapa: CuotasPorPago = new Map();
  for (const a of filas) {
    const lista = mapa.get(a.transaction_id) ?? [];
    lista.push({ numero: a.cuota_numero, montoCentavos: a.monto_centavos, liquida: a.liquida === 1 });
    mapa.set(a.transaction_id, lista);
  }
  for (const lista of mapa.values()) lista.sort((x, y) => x.numero - y.numero);
  return mapa;
}

/** Un pago listo para mostrar. El jurado ve la clave de rastreo recortada; el administrador, completa. */
export function pagoVisible(p: FilaPago, cuotas: CuotasPorPago, rol: Rol, extra: { acreditado?: string | null } = {}) {
  return {
    transactionId: p.transaction_id,
    creditoId: p.credito_id,
    acreditado: extra.acreditado ?? null,
    gestorId: p.gestor_id,
    cobroId: p.cobro_id,
    montoCentavos: p.monto_centavos,
    aplicadoCentavos: p.aplicado_centavos,
    excedenteCentavos: p.monto_centavos - p.aplicado_centavos,
    medio: p.medio,
    via: p.via,
    estado: p.estado,
    motivo: p.motivo,
    origen: p.origen,
    recuperado: p.recuperado === 1,
    numRef: p.num_ref,
    claveRastreo: rol === "admin" ? p.clave_rastreo : enmascararRastreo(p.clave_rastreo),
    banco: p.banco,
    cuentaFin: p.cuenta_fin,
    fechaPago: p.fecha_pago,
    resueltoEn: p.resuelto_en,
    cuotas: cuotas.get(p.transaction_id) ?? [],
  };
}

/** Ficha completa de un crédito: estado a hoy, calendario, últimos pagos y visitas, y su QR fijo si lo tiene. */
export async function detalleDeCredito(db: D1Database, id: string, hoy: string, rol: Rol) {
  const fila = await credito(db, id);
  if (!fila) return null;

  const [cuotas, pagos, aplicaciones, gestiones, gestor, qrFijo] = await Promise.all([
    cuotasDe(db, id),
    db.prepare("SELECT * FROM pagos WHERE credito_id = ? ORDER BY recibido_en DESC, fecha_pago DESC LIMIT 12").bind(id).all<FilaPago>(),
    db.prepare("SELECT transaction_id, cuota_numero, monto_centavos, liquida FROM aplicaciones WHERE credito_id = ? ORDER BY id DESC LIMIT 80").bind(id).all<FilaAplicacion>(),
    db
      .prepare(
        `SELECT g.id, g.resultado, g.nota, g.promesa_fecha, g.promesa_centavos, g.origen, g.creado_en, ge.nombre AS gestor
         FROM gestiones g LEFT JOIN gestores ge ON ge.id = g.gestor_id WHERE g.credito_id = ? ORDER BY g.creado_en DESC LIMIT 10`,
      )
      .bind(id)
      .all<{ id: string; resultado: string; nota: string | null; promesa_fecha: string | null; promesa_centavos: number | null; origen: string; creado_en: string; gestor: string | null }>(),
    fila.gestor_id ? db.prepare("SELECT nombre FROM gestores WHERE id = ?").bind(fila.gestor_id).first<{ nombre: string }>() : null,
    db.prepare("SELECT qr_string, monto_centavos, simulado FROM qr_fijos WHERE credito_id = ? AND pey_id IS NOT NULL").bind(id).first<{ qr_string: string; monto_centavos: number; simulado: number }>(),
  ]);

  const porPago = agruparAplicaciones(aplicaciones.results);
  return {
    credito: {
      id: fila.id,
      acreditado: fila.acreditado,
      producto: fila.producto,
      grupo: fila.grupo,
      colonia: fila.colonia,
      domicilio: fila.domicilio,
      gestorId: fila.gestor_id,
      gestor: gestor?.nombre ?? null,
      // El celular nunca sale completo: la app pide usar "el celular registrado" y el servidor lo pone.
      telefono: enmascararTelefono(fila.telefono),
      demo: fila.demo === 1,
      estado: estadoCredito(cuotas, hoy),
    },
    cuotas,
    pagos: pagos.results.map((p) => pagoVisible(p, porPago, rol, { acreditado: fila.acreditado })),
    gestiones: gestiones.results.map((g) => ({
      id: g.id,
      resultado: g.resultado,
      nota: g.nota,
      promesaFecha: g.promesa_fecha,
      promesaCentavos: g.promesa_centavos,
      gestor: g.gestor,
      origen: g.origen,
      creadoEn: g.creado_en,
    })),
    qrFijo: qrFijo ? { qrString: qrFijo.qr_string, montoCentavos: qrFijo.monto_centavos, simulado: qrFijo.simulado === 1 } : null,
  };
}
