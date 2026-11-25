// Qadra — Worker de Cloudflare.
// Los archivos de /web se sirven como assets; este Worker atiende /api y /webhooks, y cada 5 minutos pone al día la
// cartera de ejemplo de la demo.

import { manejarApp } from "./app.ts";
import { crearAvisador } from "./eventos.ts";
import { json, log } from "./http.ts";
import { ponerAlDia } from "./semilla.ts";
import { manejarAviso } from "./webhook.ts";

export { Difusor } from "./difusor.ts";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const avisar = crearAvisador(env, ctx);

    try {
      if (url.pathname === "/api/salud") return json({ ok: true, servicio: "qadra" });
      if (url.pathname === "/webhooks/pey" && request.method === "POST") return await manejarAviso(request, env, avisar);
      if (url.pathname.startsWith("/api/app/")) return await manejarApp(request, env, url, avisar);
      return json({ error: "No encontrado" }, 404);
    } catch (error) {
      log("error", { ruta: url.pathname, mensaje: error instanceof Error ? error.message : String(error) });
      return json({ ok: false, error: "Error interno" }, 500);
    }
  },

  async scheduled(_controlador, env, ctx): Promise<void> {
    await ponerAlDia(env, crearAvisador(env, ctx), { forzar: true });
  },
} satisfies ExportedHandler<Env>;
