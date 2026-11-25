// API de la app del gestor y del portal (/api/app/...). Todo pide una clave de acceso (Authorization: Bearer).
//
// GET  /api/app/sesion              quién entró, modo de la demo y datos de la financiera
// GET  /api/app/creditos/:id        ficha del crédito
// POST /api/app/cobros              crea un cobro CoDi (QR o cobro al celular) en pey
// GET  /api/app/cobros/:id          estado del cobro y recibo si ya se pagó
// POST /api/app/reiniciar           vuelve a cargar la cartera de ejemplo (solo administrador)

import { estadoCredito } from "../core/conciliacion.ts";
import { FINANCIERA } from "../core/ejemplo.ts";
import { dentroDeHorario, diaCdmx, HORARIO_GESTION } from "../core/fechas.ts";
import { esIdCredito, validarCobro } from "../core/validaciones.ts";
import { cobroPorId, cobroVisible, crearCobro, reciboDelCobro, resumenDelCobro, VIGENCIA_SEG } from "./cobros.ts";
import { detalleDeCredito } from "./consultas.ts";
import { credito, cuotasDe, gestores } from "./db.ts";
import { horarioEstricto, huellaIp, modoSimulacion, rolDe, topeDemo, type Rol } from "./entorno.ts";
import type { Avisador } from "./eventos.ts";
import { json, log } from "./http.ts";
import { consumir, LIMITES } from "./limites.ts";
import { ErrorPey, mensajeDePey } from "./pey.ts";
import { ponerAlDia, reiniciarDemo } from "./semilla.ts";

const CUERPO_MAXIMO = 8 * 1024;

/** Lee un cuerpo JSON pequeño. Regresa null si es demasiado grande o no es JSON. */
export async function leerJson(request: Request, maximo = CUERPO_MAXIMO): Promise<unknown | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maximo) return null;
  const texto = await request.text();
  if (texto.length > maximo) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

export interface Contexto {
  request: Request;
  env: Env;
  url: URL;
  rol: Rol;
  avisar: Avisador;
}

const FUERA_DE_HORARIO = `Fuera del horario de gestión de cobranza (${HORARIO_GESTION.desde}:00 a ${HORARIO_GESTION.hasta}:00).`;

async function sesion({ env, rol }: Contexto): Promise<Response> {
  return json({
    rol,
    simulacion: modoSimulacion(env),
    topeCentavos: topeDemo(env),
    vigenciaSeg: VIGENCIA_SEG,
    hoy: diaCdmx(),
    financiera: FINANCIERA,
    gestores: await gestores(env.DB),
    horario: { dentro: dentroDeHorario(), desde: HORARIO_GESTION.desde, hasta: HORARIO_GESTION.hasta, estricto: horarioEstricto(env) },
    ...(rol === "admin" ? { configuracion: { pey: Boolean(env.PEY_API_KEY), webhook: Boolean(env.PEY_WEBHOOK_SECRET) } } : {}),
  });
}

async function nuevoCobro(c: Contexto): Promise<Response> {
  const { request, env, url } = c;
  const cuerpo = await leerJson(request);
  const datos = typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as Record<string, unknown>) : null;
  const creditoId = typeof datos?.creditoId === "string" ? datos.creditoId.trim() : "";
  if (!datos || !esIdCredito(creditoId)) return json({ error: "Falta el número de crédito." }, 400);

  const fila = await credito(env.DB, creditoId);
  if (!fila) return json({ error: "No existe ese crédito." }, 404);
  const saldoCentavos = estadoCredito(await cuotasDe(env.DB, creditoId), diaCdmx()).saldoCentavos;

  // "Usar el celular registrado": el número lo pone el servidor, la app nunca lo recibe completo.
  const telefono = datos.telefonoRegistrado === true ? fila.telefono : datos.telefono;
  const solicitud = validarCobro({ ...datos, creditoId, telefono }, { saldoCentavos, topeCentavos: topeDemo(env) });
  if (!solicitud.ok) return json({ error: solicitud.error }, 400);
  if (horarioEstricto(env) && !dentroDeHorario()) return json({ error: FUERA_DE_HORARIO }, 403);

  const persona = await huellaIp(request, env);
  const cabe = (await consumir(env.DB, `cobro:${persona}`, LIMITES.cobroPorPersona)) && (await consumir(env.DB, "cobro:todos", LIMITES.cobroGlobal));
  if (!cabe) return json({ error: "Demasiados cobros en poco tiempo. Espera unos minutos." }, 429);

  try {
    const { cobro, reutilizado } = await crearCobro(env, solicitud.valor, fila.gestor_id);
    if (!reutilizado) log("cobro_creado", resumenDelCobro(cobro));
    return json({ cobro: cobroVisible(cobro), reutilizado, linkPago: `${url.origin}/pagar/?c=${cobro.token}` }, reutilizado ? 200 : 201);
  } catch (error) {
    if (!(error instanceof ErrorPey) && !(error instanceof DOMException)) throw error;
    log("pey_fallo", { credito: creditoId, medio: solicitud.valor.medio, mensaje: error.message, tipo: error instanceof ErrorPey ? error.tipo : error.name });
    return json({ error: mensajeDePey(error) }, 502);
  }
}

async function verCobro({ env, rol }: Contexto, id: string): Promise<Response> {
  const cobro = await cobroPorId(env.DB, id);
  if (!cobro) return json({ error: "No existe ese cobro." }, 404);
  return json({ cobro: cobroVisible(cobro), recibo: await reciboDelCobro(env.DB, cobro, { rastreoCompleto: rol === "admin" }) });
}

async function verCredito({ env, rol }: Contexto, id: string): Promise<Response> {
  const detalle = esIdCredito(id) ? await detalleDeCredito(env.DB, id, diaCdmx(), rol) : null;
  return detalle ? json(detalle) : json({ error: "No existe ese crédito." }, 404);
}

const SOLO_ADMIN = "Esta acción es solo para el administrador de la financiera.";

export async function manejarApp(request: Request, env: Env, url: URL, avisar: Avisador): Promise<Response> {
  const rol = await rolDe(request, env);
  if (!rol) return json({ error: "Clave incorrecta." }, 401);
  const c: Contexto = { request, env, url, rol, avisar };
  const metodo = request.method;
  const ruta = url.pathname.slice("/api/app".length);

  if (metodo === "POST" && ruta === "/reiniciar") {
    if (rol !== "admin") return json({ error: SOLO_ADMIN }, 403);
    await reiniciarDemo(env, avisar);
    return json({ ok: true });
  }

  // Antes de leer: nuevo día y lo que ya hicieron los otros gestores de la cartera de ejemplo.
  await ponerAlDia(env, avisar);

  if (metodo === "GET" && ruta === "/sesion") return sesion(c);
  if (metodo === "POST" && ruta === "/cobros") return nuevoCobro(c);

  let m = /^\/cobros\/(cob_[0-9a-f]{12})$/.exec(ruta);
  if (m && metodo === "GET") return verCobro(c, m[1]);
  m = /^\/creditos\/([^/]{1,40})$/.exec(ruta);
  if (m && metodo === "GET") return verCredito(c, decodeURIComponent(m[1]));

  return json({ error: "No encontrado" }, 404);
}
