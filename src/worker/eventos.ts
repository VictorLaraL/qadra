// Difusión en vivo: convierte lo que pasa en la cartera en eventos para la app del gestor, el portal, la página de
// pago y la demo pública. Cada canal recibe solo lo que le corresponde ver.

import { enmascararRastreo } from "../core/validaciones.ts";
import type { PagoConciliado } from "./conciliar.ts";
import type { Canal } from "./difusor.ts";
import { log } from "./http.ts";
import type { Novedad } from "./semilla.ts";

export type Avisador = (novedad: Novedad) => void;

/** Evento de un pago para el personal de la financiera. La clave de rastreo va recortada. */
export function eventoDePago(p: PagoConciliado) {
  return {
    tipo: "pago",
    transactionId: p.transactionId,
    creditoId: p.creditoId,
    acreditado: p.acreditado,
    gestorId: p.gestorId,
    cobroId: p.cobroId,
    montoCentavos: p.montoCentavos,
    aplicadoCentavos: p.aplicadoCentavos,
    excedenteCentavos: p.excedenteCentavos,
    estado: p.estado,
    motivo: p.motivo,
    via: p.via,
    medio: p.medio,
    origen: p.origen,
    recuperado: p.recuperado,
    cuotas: p.aplicaciones,
    restaCuotaCentavos: p.restaCuotaCentavos,
    claveRastreo: enmascararRastreo(p.claveRastreo),
    banco: p.banco,
    cuentaFin: p.cuentaFin,
    fecha: p.fechaPago,
  };
}

/** Recibo para quien pagó desde la página de pago: su propia clave de rastreo va completa. */
export function reciboDePago(p: PagoConciliado) {
  return {
    tipo: "cobro",
    estado: "pagado",
    montoCentavos: p.montoCentavos,
    medio: p.medio,
    cuotas: p.aplicaciones,
    restaCuotaCentavos: p.restaCuotaCentavos,
    claveRastreo: p.claveRastreo,
    banco: p.banco,
    fecha: p.fechaPago,
    origen: p.origen,
  };
}

/** Lo que ve cualquier visitante de la landing cuando alguien paga el QR de la demo: nada que identifique al pagador. */
export function eventoPublico(p: PagoConciliado) {
  return {
    tipo: "pago",
    montoCentavos: p.montoCentavos,
    medio: p.medio,
    banco: p.banco,
    cuota: p.aplicaciones.at(-1)?.numero ?? null,
    restaCuotaCentavos: p.restaCuotaCentavos,
    claveRastreo: enmascararRastreo(p.claveRastreo),
    fecha: p.fechaPago,
    origen: p.origen,
  };
}

/**
 * Crea el avisador de una solicitud. Los envíos corren después de responder (waitUntil) y un fallo al difundir nunca
 * afecta a lo que ya quedó guardado: solo se registra.
 */
export function crearAvisador(env: Env, ctx: ExecutionContext): Avisador {
  const difusor = env.DIFUSOR.getByName("principal");
  const enviar = (canal: Canal, evento: Record<string, unknown>) => {
    ctx.waitUntil(difusor.difundir(canal, evento).catch((e: unknown) => log("aviso_en_vivo_fallido", { canal, mensaje: String(e) })));
  };
  return (novedad) => {
    if (novedad.tipo === "visita") {
      const evento = { ...novedad };
      enviar("portal", evento);
      enviar("gestor", evento);
      return;
    }
    const pago = novedad.pago;
    const evento = eventoDePago(pago);
    enviar("portal", evento);
    enviar("gestor", evento);
    if (pago.cobroToken) enviar(`cobro:${pago.cobroToken}`, reciboDePago(pago));
    if (pago.demo && pago.origen !== "ejemplo") enviar("demo", eventoPublico(pago));
  };
}
