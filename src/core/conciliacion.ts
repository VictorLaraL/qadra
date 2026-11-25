// Conciliación: a qué cuotas se aplica un pago, cómo queda el crédito y si el día cuadra contra pey.
// Todo en centavos enteros y sin tocar la base de datos, para poder probarlo solo.

import { diasEntre } from "./fechas.ts";

export interface Cuota {
  numero: number;
  /** Día de vencimiento, AAAA-MM-DD. */
  vence: string;
  montoCentavos: number;
  pagadoCentavos: number;
}

export interface Aplicacion {
  /** Número de cuota que recibe el dinero. */
  numero: number;
  montoCentavos: number;
  /** true si con este abono la cuota queda pagada completa. */
  liquida: boolean;
}

export interface PlanAplicacion {
  aplicaciones: Aplicacion[];
  aplicadoCentavos: number;
  /** Lo que sobra después de cubrir todo el saldo del crédito. Nunca se aplica: queda para revisión. */
  excedenteCentavos: number;
}

/**
 * Reparte un pago entre las cuotas pendientes, de la más antigua a la más reciente.
 * Un monto que no es un entero positivo no se aplica.
 */
export function planAplicacion(cuotas: Cuota[], montoCentavos: number): PlanAplicacion {
  const plan: PlanAplicacion = { aplicaciones: [], aplicadoCentavos: 0, excedenteCentavos: 0 };
  if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) return plan;

  let restante = montoCentavos;
  const pendientes = cuotas.filter((c) => c.pagadoCentavos < c.montoCentavos).sort((a, b) => a.numero - b.numero);
  for (const cuota of pendientes) {
    if (restante === 0) break;
    const pendiente = cuota.montoCentavos - cuota.pagadoCentavos;
    const abono = Math.min(pendiente, restante);
    plan.aplicaciones.push({ numero: cuota.numero, montoCentavos: abono, liquida: abono === pendiente });
    plan.aplicadoCentavos += abono;
    restante -= abono;
  }
  plan.excedenteCentavos = restante;
  return plan;
}

export type Situacion = "al-corriente" | "vence-hoy" | "atrasado" | "liquidado";

export interface EstadoCredito {
  situacion: Situacion;
  /** Todo lo que falta por pagar del crédito. */
  saldoCentavos: number;
  /** Lo que ya debería estar pagado a hoy: cuotas vencidas más la que vence hoy. */
  exigibleCentavos: number;
  /** Días desde que venció la cuota pendiente más antigua (0 si no hay atraso). */
  diasAtraso: number;
  cuotasPagadas: number;
  cuotasTotales: number;
  /** La siguiente cuota por pagar, o null si el crédito está liquidado. */
  cuotaActual: (Cuota & { pendienteCentavos: number }) | null;
}

/** Resume un crédito a partir de sus cuotas y del día de hoy (AAAA-MM-DD). */
export function estadoCredito(cuotas: Cuota[], hoy: string): EstadoCredito {
  const ordenadas = [...cuotas].sort((a, b) => a.numero - b.numero);
  const pendientes = ordenadas.filter((c) => c.pagadoCentavos < c.montoCentavos);
  const pendienteDe = (c: Cuota) => c.montoCentavos - c.pagadoCentavos;

  const saldoCentavos = pendientes.reduce((suma, c) => suma + pendienteDe(c), 0);
  const exigibleCentavos = pendientes.filter((c) => c.vence <= hoy).reduce((suma, c) => suma + pendienteDe(c), 0);
  const primera = pendientes[0] ?? null;
  const diasAtraso = primera && primera.vence < hoy ? diasEntre(primera.vence, hoy) : 0;

  let situacion: Situacion = "al-corriente";
  if (!primera) situacion = "liquidado";
  else if (diasAtraso > 0) situacion = "atrasado";
  else if (exigibleCentavos > 0) situacion = "vence-hoy";

  return {
    situacion,
    saldoCentavos,
    exigibleCentavos,
    diasAtraso,
    cuotasPagadas: ordenadas.length - pendientes.length,
    cuotasTotales: ordenadas.length,
    cuotaActual: primera ? { ...primera, pendienteCentavos: pendienteDe(primera) } : null,
  };
}

export interface PagoComparable {
  transactionId: string;
  montoCentavos: number;
}

export interface Cuadre {
  /** true si pey y Qadra tienen exactamente los mismos pagos con los mismos montos. */
  cuadra: boolean;
  qadra: { pagos: number; totalCentavos: number };
  pey: { pagos: number; totalCentavos: number };
  /** Pagos que pey cobró y Qadra no registró: un aviso que no llegó. Se pueden recuperar. */
  faltanEnQadra: PagoComparable[];
  /** Pagos que Qadra tiene y pey no reporta. */
  faltanEnPey: PagoComparable[];
  montosDistintos: Array<{ transactionId: string; qadraCentavos: number; peyCentavos: number }>;
}

/** Compara los pagos CoDi registrados en Qadra con los que reporta pey para el mismo periodo. */
export function compararConPey(qadra: PagoComparable[], pey: PagoComparable[]): Cuadre {
  const total = (lista: PagoComparable[]) => lista.reduce((suma, p) => suma + p.montoCentavos, 0);
  const enQadra = new Map(qadra.map((p) => [p.transactionId, p.montoCentavos]));
  const enPey = new Map(pey.map((p) => [p.transactionId, p.montoCentavos]));

  const faltanEnQadra = pey.filter((p) => !enQadra.has(p.transactionId));
  const faltanEnPey = qadra.filter((p) => !enPey.has(p.transactionId));
  const montosDistintos = qadra
    .filter((p) => enPey.has(p.transactionId) && enPey.get(p.transactionId) !== p.montoCentavos)
    .map((p) => ({ transactionId: p.transactionId, qadraCentavos: p.montoCentavos, peyCentavos: enPey.get(p.transactionId) as number }));

  return {
    cuadra: faltanEnQadra.length === 0 && faltanEnPey.length === 0 && montosDistintos.length === 0,
    qadra: { pagos: qadra.length, totalCentavos: total(qadra) },
    pey: { pagos: pey.length, totalCentavos: total(pey) },
    faltanEnQadra,
    faltanEnPey,
    montosDistintos,
  };
}
