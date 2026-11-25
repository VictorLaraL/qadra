// Difusor: reparte eventos en vivo a quienes tienen abierta la app del gestor, el portal, una página de pago o la
// demo de la landing.
//
// Usa la API de WebSockets con hibernación: mientras nadie habla, el Durable Object duerme y no consume tiempo de
// cómputo. Hay una sola instancia ("principal") porque la demo tiene una sola financiera; con varias se usaría una
// instancia por financiera (getByName(financieraId)).

import { DurableObject } from "cloudflare:workers";

/**
 * Canales:
 * - `portal` y `gestor`: personal de la financiera (el Worker ya revisó su boleto).
 * - `demo`: demo pública de la landing (solo recibe datos sin información personal).
 * - `cobro:<token>`: quien tiene abierta la página de pago de ese cobro.
 */
export type Canal = "portal" | "gestor" | "demo" | `cobro:${string}`;

const CANAL_VALIDO = /^(portal|gestor|demo|cobro:[A-Za-z0-9_-]{16,64})$/;

export function esCanal(valor: string | null): valor is Canal {
  return valor !== null && CANAL_VALIDO.test(valor);
}

// Los canales públicos no piden clave, así que llevan tope de conexiones: nadie puede llenar el objeto que también
// atiende al personal. Una página de pago la abren el acreditado y, si acaso, el gestor.
const CONEXIONES_MAXIMAS = { demo: 300, cobro: 8, personal: 200 } as const;

export function topeDeConexiones(canal: Canal): number {
  if (canal === "demo") return CONEXIONES_MAXIMAS.demo;
  return canal.startsWith("cobro:") ? CONEXIONES_MAXIMAS.cobro : CONEXIONES_MAXIMAS.personal;
}

export class Difusor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Responde "ping" sin despertar al objeto.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Solo recibe upgrades que el Worker ya autorizó; el canal llega en el encabezado x-canal. */
  async fetch(request: Request): Promise<Response> {
    const canal = request.headers.get("x-canal");
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || !esCanal(canal)) {
      return new Response("Se espera un WebSocket", { status: 426 });
    }
    if (this.ctx.getWebSockets(canal).length >= topeDeConexiones(canal)) {
      return new Response("Demasiadas conexiones en este canal", { status: 503 });
    }
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    this.ctx.acceptWebSocket(servidor, [canal]);
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** Manda un evento a todos los conectados a un canal. Regresa a cuántos llegó. */
  async difundir(canal: Canal, evento: Record<string, unknown>): Promise<number> {
    const mensaje = JSON.stringify(evento);
    let enviados = 0;
    for (const ws of this.ctx.getWebSockets(canal)) {
      try {
        ws.send(mensaje);
        enviados++;
      } catch {
        // Conexión ya cerrada: el runtime la limpia.
      }
    }
    return enviados;
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code, "cerrado");
    } catch {
      // Ya estaba cerrada.
    }
  }
}
