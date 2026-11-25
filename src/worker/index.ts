// Qadra — Worker de Cloudflare.
// Los archivos de /web se sirven como assets; este Worker atiende /api y /webhooks.

import { json } from "./http.ts";

export { Difusor } from "./difusor.ts";

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/salud") return json({ ok: true, servicio: "qadra" });
    return json({ error: "No encontrado" }, 404);
  },
} satisfies ExportedHandler<Env>;
