// API de la app del gestor y del portal (/api/app/...). Todo pide una clave de acceso (Authorization: Bearer),
// menos abrir el canal en vivo, que pide un boleto de corta vida.
//
// Sesión y canal en vivo
//   GET  /api/app/sesion                    quién entró, modo de la demo y datos de la financiera
//   GET  /api/app/boleto?canal=             boleto de 60 s para abrir el canal en vivo "portal" o "gestor"
//   GET  /api/app/en-vivo?canal=&boleto=    WebSocket con cada pago y visita al instante
// App del gestor
//   GET  /api/app/ruta?gestor=              ruta del día
//   GET  /api/app/creditos/:id              ficha del crédito
//   POST /api/app/cobros                    crea un cobro CoDi (QR o cobro al celular) en pey
//   GET  /api/app/cobros/:id                estado del cobro y recibo si ya se pagó
//   POST /api/app/gestiones                 registra una visita (promesa, no localizado...)
// Portal
//   GET  /api/app/resumen                   cobranza de hoy, cartera, semana y gestores
//   GET  /api/app/cartera                   créditos con búsqueda, filtro y páginas
//   GET  /api/app/conciliacion              pagos de hoy y excepciones
//   GET  /api/app/corte?pey=1               corte del día y cuadre contra pey
//   POST /api/app/corte/recuperar           trae de pey un pago cuyo aviso no llegó
//   POST /api/app/excepciones/:tx/resolver  aplica una excepción a un crédito
//   GET  /api/app/pagos.csv                 pagos de hoy para el sistema de la financiera
//   GET  /api/app/cartera/plantilla.csv     plantilla de cartera
//   POST /api/app/cartera/validar           revisa un CSV de cartera sin cargarlo
//   POST /api/app/cartera/importar          reemplaza la cartera (solo administrador)
//   POST /api/app/creditos/:id/qr-fijo      crea el QR fijo de un crédito (solo administrador)
//   POST /api/app/reiniciar                 vuelve a cargar la cartera de ejemplo (solo administrador)
//   POST /api/app/simular                   pagos simulados (solo en modo simulación)

import { aCsv, BOM, PLANTILLA_CARTERA, validarCartera } from "../core/cartera.ts";
import { estadoCredito } from "../core/conciliacion.ts";
import { pesos } from "../core/dinero.ts";
import { FINANCIERA } from "../core/ejemplo.ts";
import { dentroDeHorario, diaCdmx, HORARIO_GESTION } from "../core/fechas.ts";
import { normalizarPago } from "../core/pagos.ts";
import { firmarBoleto, generarId, verificarBoleto } from "../core/tokens.ts";
import { esIdCredito, paginaPedida, validarCobro, validarGestion } from "../core/validaciones.ts";
import { asegurarQrFijo, cobroPorId, cobroVisible, crearCobro, estadoDelCobro, reciboDelCobro, resumenDelCobro, VIGENCIA_SEG } from "./cobros.ts";
import { conciliarPago, resolverExcepcion } from "./conciliar.ts";
import { detalleDeCredito } from "./consultas.ts";
import { credito, cuotasDe, gestores, sentenciasDeCartera, type CreditoPorCargar } from "./db.ts";
import { horarioEstricto, modoSimulacion, rolDe, secretoBoletos, topeDemo, type Rol } from "./entorno.ts";
import type { Avisador } from "./eventos.ts";
import { json, leerJson, leerTextoLimitado, log } from "./http.ts";
import { limiteGlobal, limitePorPersona, LIMITES } from "./limites.ts";
import { consultarTransaccion, ErrorPey, mensajeDePey } from "./pey.ts";
import { ponerAlDia, reiniciarDemo } from "./semilla.ts";
import { limiteDeSimulacion, pagoDelCobro, simularPago, SOLO_SIMULACION } from "./simular.ts";
import { carteraDelPortal, COLUMNAS_DE_PAGOS, conciliacionDelDia, corteDelDia, pagosParaExportar, resumenDelPortal, rutaDelGestor } from "./tableros.ts";

export interface Contexto {
  request: Request;
  env: Env;
  url: URL;
  rol: Rol;
  avisar: Avisador;
}

const FUERA_DE_HORARIO = `Fuera del horario de gestión de cobranza (${HORARIO_GESTION.desde}:00 a ${HORARIO_GESTION.hasta}:00).`;
const SOLO_ADMIN = "Esta acción es solo para el administrador de la financiera.";
const DEMASIADOS_COBROS = "Demasiados cobros en poco tiempo. Espera unos minutos.";
const DEMASIADOS_PUSH = "Demasiados cobros al celular en poco tiempo. Cobra con QR o espera unos minutos.";
const DEMASIADAS_CONSULTAS_A_PEY = "Demasiadas consultas a pey. Espera unos minutos.";
const CSV_MAXIMO = 300 * 1024;
const BOLETO_SEG = 60;
/** Tope de una transferencia simulada sin referencia: $100,000.00. Es dinero de mentira, pero evita cifras absurdas en la demo. */
const MONTO_SIMULADO_MAXIMO = 10_000_000;

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function csv(nombre: string, contenido: string): Response {
  return new Response(contenido, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" },
  });
}

/**
 * Corre algo que habla con pey. Si pey falla o no responde, regresa 502 con un mensaje para la persona y deja el
 * detalle en el registro; cualquier otro error sigue su camino.
 */
async function conPey(accion: () => Promise<Response>, contexto: Record<string, unknown>): Promise<Response> {
  try {
    return await accion();
  } catch (error) {
    if (!(error instanceof ErrorPey) && !(error instanceof DOMException)) throw error;
    log("pey_fallo", { ...contexto, mensaje: error.message, tipo: error instanceof ErrorPey ? error.tipo : error.name });
    return json({ error: mensajeDePey(error) }, 502);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sesión y canal en vivo
// ---------------------------------------------------------------------------------------------------------------

async function sesion({ env, rol }: Contexto): Promise<Response> {
  const cartera = await env.DB.prepare("SELECT valor FROM ajustes WHERE clave = 'cartera'").first<{ valor: string }>();
  return json({
    rol,
    simulacion: modoSimulacion(env),
    topeCentavos: topeDemo(env),
    vigenciaSeg: VIGENCIA_SEG,
    hoy: diaCdmx(),
    financiera: FINANCIERA,
    carteraDeEjemplo: cartera?.valor !== "importada",
    gestores: await gestores(env.DB),
    horario: { dentro: dentroDeHorario(), desde: HORARIO_GESTION.desde, hasta: HORARIO_GESTION.hasta, estricto: horarioEstricto(env) },
    ...(rol === "admin" ? { configuracion: { pey: Boolean(env.PEY_API_KEY), webhook: Boolean(env.PEY_WEBHOOK_SECRET) } } : {}),
  });
}

async function boleto({ env, url }: Contexto): Promise<Response> {
  const canal = url.searchParams.get("canal");
  if (canal !== "portal" && canal !== "gestor") return json({ error: "Canal desconocido." }, 400);
  const vence = Math.floor(Date.now() / 1000) + BOLETO_SEG;
  return json({ boleto: await firmarBoleto(secretoBoletos(env), canal, vence), canal, venceSeg: vence });
}

/** Abre el canal en vivo del personal. No lleva clave: el boleto firmado es la autorización. */
export async function abrirCanalDelPersonal(env: Env, url: URL, conectar: (canal: "portal" | "gestor") => Promise<Response>): Promise<Response> {
  const canal = url.searchParams.get("canal");
  if (canal !== "portal" && canal !== "gestor") return json({ error: "Canal desconocido." }, 400);
  const valido = await verificarBoleto(secretoBoletos(env), canal, url.searchParams.get("boleto") ?? "");
  return valido ? conectar(canal) : json({ error: "Boleto inválido o vencido." }, 401);
}

// ---------------------------------------------------------------------------------------------------------------
// App del gestor
// ---------------------------------------------------------------------------------------------------------------

async function verRuta({ env, url }: Contexto): Promise<Response> {
  const datos = await rutaDelGestor(env.DB, diaCdmx(), url.searchParams.get("gestor") ?? "");
  return datos ? json(datos) : json({ error: "No existe ese gestor." }, 404);
}

async function verCredito({ env, rol }: Contexto, id: string): Promise<Response> {
  const detalle = esIdCredito(id) ? await detalleDeCredito(env.DB, id, diaCdmx(), rol) : null;
  return detalle ? json(detalle) : json({ error: "No existe ese crédito." }, 404);
}

async function nuevoCobro({ request, env, url }: Contexto): Promise<Response> {
  const datos = objeto(await leerJson(request));
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

  const excedido =
    (solicitud.valor.medio === "push"
      ? ((await limitePorPersona(request, env, "push", LIMITES.pushPorPersona, DEMASIADOS_PUSH)) ?? (await limiteGlobal(env, "push", LIMITES.pushGlobal, DEMASIADOS_PUSH)))
      : null) ??
    (await limitePorPersona(request, env, "cobro", LIMITES.cobroPorPersona, DEMASIADOS_COBROS)) ??
    (await limiteGlobal(env, "cobro", LIMITES.cobroGlobal, DEMASIADOS_COBROS));
  if (excedido) return excedido;

  return conPey(
    async () => {
      const { cobro, reutilizado } = await crearCobro(env, solicitud.valor, fila.gestor_id);
      if (!reutilizado) log("cobro_creado", resumenDelCobro(cobro));
      return json({ cobro: cobroVisible(cobro), reutilizado, linkPago: `${url.origin}/pagar/?c=${cobro.token}` }, reutilizado ? 200 : 201);
    },
    { accion: "cobro", credito: creditoId, medio: solicitud.valor.medio },
  );
}

async function verCobro({ env, rol }: Contexto, id: string): Promise<Response> {
  const cobro = await cobroPorId(env.DB, id);
  if (!cobro) return json({ error: "No existe ese cobro." }, 404);
  return json({ cobro: cobroVisible(cobro), recibo: await reciboDelCobro(env.DB, cobro, { rastreoCompleto: rol === "admin" }) });
}

async function nuevaGestion({ request, env, avisar }: Contexto): Promise<Response> {
  const solicitud = validarGestion(await leerJson(request), diaCdmx());
  if (!solicitud.ok) return json({ error: solicitud.error }, 400);
  const g = solicitud.valor;
  const fila = await credito(env.DB, g.creditoId);
  if (!fila) return json({ error: "No existe ese crédito." }, 404);
  if (horarioEstricto(env) && !dentroDeHorario()) return json({ error: FUERA_DE_HORARIO }, 403);
  const excedido = await limitePorPersona(request, env, "visita", LIMITES.visitaPorPersona, "Demasiadas visitas registradas en poco tiempo. Espera unos minutos.");
  if (excedido) return excedido;

  const gestion = { id: generarId("ges"), ...g, gestorId: fila.gestor_id, origen: "app", creadoEn: new Date().toISOString() };
  await env.DB.prepare(
    `INSERT INTO gestiones (id, credito_id, gestor_id, resultado, nota, promesa_fecha, promesa_centavos, latitud, longitud, origen, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?)`,
  )
    .bind(gestion.id, g.creditoId, fila.gestor_id, g.resultado, g.nota, g.promesaFecha, g.promesaCentavos, g.latitud, g.longitud, gestion.creadoEn)
    .run();
  avisar({ tipo: "visita", creditoId: g.creditoId, gestorId: fila.gestor_id, resultado: g.resultado, origen: "app", fecha: gestion.creadoEn });
  return json({ gestion }, 201);
}

// ---------------------------------------------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------------------------------------------

async function verCorte({ env, url }: Contexto): Promise<Response> {
  const conPeyPedido = url.searchParams.get("pey") === "1";
  if (!conPeyPedido) return json(await corteDelDia(env, diaCdmx(), { conPey: false, simulado: modoSimulacion(env) }));
  const excedido = await limiteGlobal(env, "cuadre", LIMITES.cuadreGlobal, DEMASIADAS_CONSULTAS_A_PEY);
  if (excedido) return excedido;
  return conPey(async () => json(await corteDelDia(env, diaCdmx(), { conPey: true, simulado: modoSimulacion(env) })), { accion: "cuadre" });
}

async function recuperar({ request, env, avisar }: Contexto): Promise<Response> {
  const datos = objeto(await leerJson(request));
  const transactionId = typeof datos?.transactionId === "string" ? datos.transactionId.trim() : "";
  if (!/^[\w:.-]{4,64}$/.test(transactionId)) return json({ error: "Falta la transacción por recuperar." }, 400);
  const excedido = await limiteGlobal(env, "cuadre", LIMITES.cuadreGlobal, DEMASIADAS_CONSULTAS_A_PEY);
  if (excedido) return excedido;

  return conPey(
    async () => {
      const transaccion = await consultarTransaccion(env, transactionId);
      const pago = transaccion ? normalizarPago(`recuperado:${transactionId}`, transaccion.aviso) : null;
      if (!pago) return json({ error: "pey no tiene un pago CoDi con esa transacción." }, 404);

      const conciliado = await conciliarPago(env.DB, pago, { origen: modoSimulacion(env) ? "simulado" : "codi", recuperado: true });
      if (conciliado.nuevo) {
        log("pago_recuperado", { transactionId, credito: conciliado.creditoId, estado: conciliado.estado });
        avisar({ tipo: "pago", pago: conciliado });
      }
      return json({ ok: true, duplicado: !conciliado.nuevo, estado: conciliado.estado, motivo: conciliado.motivo, creditoId: conciliado.creditoId });
    },
    { accion: "recuperar", transactionId },
  );
}

async function resolver({ request, env }: Contexto, transactionId: string): Promise<Response> {
  const datos = objeto(await leerJson(request));
  const creditoId = typeof datos?.creditoId === "string" ? datos.creditoId.trim() : "";
  if (!esIdCredito(creditoId)) return json({ error: "Elige el crédito al que se aplica el pago." }, 400);
  const r = await resolverExcepcion(env.DB, transactionId, creditoId);
  if (!r.ok) return json({ error: r.error }, r.status);
  log("excepcion_resuelta", { transactionId, credito: creditoId, aplicadoCentavos: r.aplicadoCentavos, pendienteCentavos: r.pendienteCentavos });
  return json(r);
}

/** Convierte los créditos de un archivo en lo que se carga: un gestor por nombre y el orden de su ruta. */
function prepararCartera(creditos: ReturnType<typeof validarCartera>["creditos"]) {
  const idDeGestor = new Map<string, string>();
  const orden = new Map<string, number>();
  const porCargar: CreditoPorCargar[] = creditos.map((c) => {
    if (!idDeGestor.has(c.gestor)) idDeGestor.set(c.gestor, `g${idDeGestor.size + 1}`);
    const gestorId = idDeGestor.get(c.gestor) as string;
    orden.set(gestorId, (orden.get(gestorId) ?? 0) + 1);
    return { ...c, gestorId, orden: orden.get(gestorId) as number, demo: false };
  });
  const listaGestores = [...idDeGestor].map(([nombre, id]) => ({ id, nombre, zona: "" }));
  return { porCargar, listaGestores };
}

async function cartera({ request, env, rol }: Contexto, accion: "validar" | "importar"): Promise<Response> {
  if (accion === "importar" && rol !== "admin") return json({ error: SOLO_ADMIN }, 403);
  const excedido = await limitePorPersona(request, env, "archivo", LIMITES.archivoPorPersona, "Demasiados archivos en poco tiempo. Espera unos minutos.");
  if (excedido) return excedido;
  const texto = await leerTextoLimitado(request, CSV_MAXIMO);
  if (texto === null) return json({ error: "El archivo pesa más de 300 KB." }, 413);

  const resultado = validarCartera(texto, diaCdmx());
  const respuesta = {
    ok: resultado.ok,
    columnasFaltantes: resultado.columnasFaltantes,
    errores: resultado.errores.slice(0, 50),
    erroresTotales: resultado.errores.length,
    resumen: resultado.resumen,
    vistaPrevia: resultado.creditos.slice(0, 8),
  };
  if (accion === "validar") return json(respuesta);
  if (!resultado.ok) return json({ ...respuesta, error: "El archivo tiene errores. Corrígelos y vuelve a subirlo." }, 400);

  const { porCargar, listaGestores } = prepararCartera(resultado.creditos);
  await env.DB.batch([
    ...sentenciasDeCartera(env.DB, listaGestores, porCargar, new Date().toISOString()),
    env.DB.prepare("DELETE FROM historico"),
    env.DB.prepare("INSERT INTO ajustes (clave, valor) VALUES ('cartera', 'importada') ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor"),
  ]);
  log("cartera_importada", { creditos: porCargar.length, gestores: listaGestores.length });
  return json({ ok: true, creditos: porCargar.length, gestores: listaGestores.length });
}

async function qrFijo({ env, rol }: Contexto, creditoId: string): Promise<Response> {
  if (rol !== "admin") return json({ error: SOLO_ADMIN }, 403);
  const fila = esIdCredito(creditoId) ? await credito(env.DB, creditoId) : null;
  if (!fila) return json({ error: "No existe ese crédito." }, 404);
  const actual = estadoCredito(await cuotasDe(env.DB, creditoId), diaCdmx()).cuotaActual;
  if (!actual) return json({ error: "Ese crédito ya está liquidado." }, 409);
  // El QR fijo lleva el monto de la cuota; en la demo pública, sin pasar del tope.
  const tope = topeDemo(env);
  const monto = tope > 0 ? Math.min(actual.montoCentavos, tope) : actual.montoCentavos;
  return conPey(
    async () => {
      const fijo = await asegurarQrFijo(env, creditoId, monto);
      if (!fijo?.qr_string) return json({ error: "El QR se está creando. Intenta en unos segundos." }, 409);
      return json({ qrFijo: { qrString: fijo.qr_string, montoCentavos: fijo.monto_centavos, simulado: fijo.simulado === 1 } });
    },
    { accion: "qr-fijo", credito: creditoId },
  );
}

async function simular({ request, env, url, avisar }: Contexto): Promise<Response> {
  if (!modoSimulacion(env)) return json({ error: SOLO_SIMULACION }, 404);
  const datos = objeto(await leerJson(request));
  if (!datos) return json({ error: "Faltan los datos del pago simulado." }, 400);
  const excedido = await limiteDeSimulacion(request, env);
  if (excedido) return excedido;

  if (datos.tipo === "sin-referencia") {
    const monto = datos.montoCentavos;
    if (typeof monto !== "number" || !Number.isInteger(monto) || monto <= 0 || monto > MONTO_SIMULADO_MAXIMO) {
      return json({ error: `El monto simulado debe estar entre $0.01 y ${pesos(MONTO_SIMULADO_MAXIMO)}.` }, 400);
    }
    return simularPago(env, url, { tipo: "qr", peyId: null, folio: null, cobroId: null, creditoId: null, montoCentavos: monto }, { conAviso: true }, avisar);
  }
  if (datos.tipo === "cobro" && typeof datos.cobroId === "string") {
    const cobro = await cobroPorId(env.DB, datos.cobroId);
    if (!cobro) return json({ error: "No existe ese cobro." }, 404);
    if (estadoDelCobro(cobro) === "vencido") return json({ error: "Ese cobro ya venció. Crea uno nuevo." }, 409);
    return simularPago(env, url, pagoDelCobro(cobro), { conAviso: datos.conAviso !== false }, avisar);
  }
  return json({ error: "No se reconoce el tipo de pago simulado." }, 400);
}

// ---------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------

export async function manejarApp(request: Request, env: Env, url: URL, avisar: Avisador): Promise<Response> {
  const rol = await rolDe(request, env);
  if (!rol) return json({ error: "Clave incorrecta." }, 401);
  const c: Contexto = { request, env, url, rol, avisar };
  const metodo = request.method;
  /** Lo que sigue a /api/app en la dirección, por ejemplo "/cobros". */
  const subruta = url.pathname.slice("/api/app".length);

  if (metodo === "POST" && subruta === "/reiniciar") {
    if (rol !== "admin") return json({ error: SOLO_ADMIN }, 403);
    await reiniciarDemo(env, avisar);
    return json({ ok: true });
  }

  // Antes de leer: nuevo día y lo que ya hicieron los otros gestores de la cartera de ejemplo.
  await ponerAlDia(env, avisar);

  if (metodo === "GET") {
    const p = url.searchParams;
    if (subruta === "/sesion") return sesion(c);
    if (subruta === "/boleto") return boleto(c);
    if (subruta === "/ruta") return verRuta(c);
    if (subruta === "/resumen") return json(await resumenDelPortal(env.DB, diaCdmx(), rol));
    if (subruta === "/cartera") {
      return json(await carteraDelPortal(env.DB, diaCdmx(), { buscar: (p.get("buscar") ?? "").slice(0, 60), situacion: p.get("situacion") ?? "", pagina: paginaPedida(p.get("pagina")) }));
    }
    if (subruta === "/conciliacion") return json(await conciliacionDelDia(env.DB, rol, { estado: p.get("estado") ?? "", pagina: paginaPedida(p.get("pagina")) }));
    if (subruta === "/corte") return verCorte(c);
    if (subruta === "/pagos.csv") return csv(`qadra-pagos-${diaCdmx()}.csv`, aCsv(COLUMNAS_DE_PAGOS, await pagosParaExportar(env.DB, rol)));
    if (subruta === "/cartera/plantilla.csv") return csv("qadra-plantilla-cartera.csv", BOM + PLANTILLA_CARTERA);
  }

  if (metodo === "POST") {
    if (subruta === "/cobros") return nuevoCobro(c);
    if (subruta === "/gestiones") return nuevaGestion(c);
    if (subruta === "/corte/recuperar") return recuperar(c);
    if (subruta === "/cartera/validar") return cartera(c, "validar");
    if (subruta === "/cartera/importar") return cartera(c, "importar");
    if (subruta === "/simular") return simular(c);
  }

  let m = /^\/cobros\/(cob_[0-9a-f]{12})$/.exec(subruta);
  if (m && metodo === "GET") return verCobro(c, m[1]);
  m = /^\/creditos\/([^/]{1,40})\/qr-fijo$/.exec(subruta);
  if (m && metodo === "POST") return qrFijo(c, decodeURIComponent(m[1]));
  m = /^\/creditos\/([^/]{1,40})$/.exec(subruta);
  if (m && metodo === "GET") return verCredito(c, decodeURIComponent(m[1]));
  m = /^\/excepciones\/([\w:.-]{4,64})\/resolver$/.exec(subruta);
  if (m && metodo === "POST") return resolver(c, m[1]);

  return json({ error: "No encontrado" }, 404);
}
