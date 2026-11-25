// Rutas públicas (sin clave): la demo en vivo de la landing y la página de pago que recibe el acreditado.
//
// GET  /api/demo                    crédito de la demo, su QR fijo de un centavo y los últimos pagos (sin datos del pagador)
// GET  /api/demo/en-vivo            WebSocket: avisa cada pago al QR de la demo
// POST /api/demo/simular            solo en simulación: paga el QR de la demo
// GET  /api/pago/:token             un cobro, para quien tiene su link: monto, QR, estado y recibo
// GET  /api/pago/:token/en-vivo     WebSocket: avisa cuando ese cobro se paga
// POST /api/pago/:token/simular     solo en simulación: paga ese cobro

import { estadoCredito } from "../core/conciliacion.ts";
import { CREDITO_DEMO, FINANCIERA } from "../core/ejemplo.ts";
import { diaCdmx, inicioDelDiaCdmx } from "../core/fechas.ts";
import { enmascararRastreo } from "../core/validaciones.ts";
import { asegurarQrFijo, cobroPorToken, estadoDelCobro, reciboDelCobro, type FilaQrFijo } from "./cobros.ts";
import { credito, cuotasDe } from "./db.ts";
import type { Canal } from "./difusor.ts";
import { huellaIp, modoSimulacion } from "./entorno.ts";
import type { Avisador } from "./eventos.ts";
import { json, log } from "./http.ts";
import { consumir, LIMITES } from "./limites.ts";
import { ErrorPey } from "./pey.ts";
import { ponerAlDia } from "./semilla.ts";
import { simularPago } from "./simular.ts";

/** Monto del QR fijo de la demo pública: un centavo, para que cualquiera lo pruebe con su banco. */
const MONTO_DEMO_CENTAVOS = 1;
const TOKEN_DE_COBRO = /^[A-Za-z0-9_-]{32}$/;
const SOLO_SIMULACION = "Los pagos simulados solo existen en modo simulación.";

async function qrDeLaDemo(env: Env): Promise<{ fijo: FilaQrFijo | null; error: string | null }> {
  try {
    return { fijo: await asegurarQrFijo(env, CREDITO_DEMO, MONTO_DEMO_CENTAVOS), error: null };
  } catch (error) {
    // Sin API key (y sin simulación) o con pey caído: la landing lo dice en lugar de romperse.
    log("demo_sin_qr", { mensaje: error instanceof Error ? error.message : String(error) });
    return { fijo: null, error: error instanceof ErrorPey && error.tipo === "SIN_CONFIGURAR" ? "La demo aún no tiene configurada su cuenta de pey." : "No se pudo preparar el QR de la demo. Intenta en unos minutos." };
  }
}

async function demo(env: Env): Promise<Response> {
  const hoy = diaCdmx();
  const fila = await credito(env.DB, CREDITO_DEMO);
  const base = { simulacion: modoSimulacion(env), financiera: FINANCIERA, hoy };
  if (!fila) return json({ ...base, credito: null, qr: null, aviso: "La cartera de ejemplo no está cargada en este momento.", pagosHoy: 0, pagosReales: 0, ultimos: [] });

  const [cuotas, { fijo, error }, consultas] = await Promise.all([
    cuotasDe(env.DB, CREDITO_DEMO),
    qrDeLaDemo(env),
    env.DB.batch([
      env.DB
        .prepare(
          `SELECT monto_centavos, medio, banco, clave_rastreo, fecha_pago, origen FROM pagos
           WHERE credito_id = ? AND via = 'qr-fijo' ORDER BY recibido_en DESC LIMIT 5`,
        )
        .bind(CREDITO_DEMO),
      env.DB.prepare("SELECT COUNT(*) AS n FROM pagos WHERE credito_id = ? AND via = 'qr-fijo' AND fecha_pago >= ?").bind(CREDITO_DEMO, inicioDelDiaCdmx()),
      env.DB.prepare("SELECT COUNT(*) AS n FROM recibidos WHERE origen = 'codi'"),
    ]),
  ]);
  const [ultimos, hoyN, reales] = consultas as [
    D1Result<{ monto_centavos: number; medio: string; banco: string | null; clave_rastreo: string | null; fecha_pago: string; origen: string }>,
    D1Result<{ n: number }>,
    D1Result<{ n: number }>,
  ];
  const estado = estadoCredito(cuotas, hoy);

  return json({
    ...base,
    credito: {
      id: fila.id,
      acreditado: fila.acreditado,
      producto: fila.producto,
      grupo: fila.grupo,
      colonia: fila.colonia,
      situacion: estado.situacion,
      saldoCentavos: estado.saldoCentavos,
      cuotasPagadas: estado.cuotasPagadas,
      cuotasTotales: estado.cuotasTotales,
      cuota: estado.cuotaActual,
    },
    qr: fijo?.qr_string ? { qrString: fijo.qr_string, montoCentavos: fijo.monto_centavos, simulado: fijo.simulado === 1 } : null,
    aviso: fijo?.qr_string ? null : (error ?? "El QR de la demo se está preparando. Vuelve a cargar en unos segundos."),
    pagosHoy: hoyN.results[0].n,
    pagosReales: reales.results[0].n,
    ultimos: ultimos.results.map((p) => ({
      montoCentavos: p.monto_centavos,
      medio: p.medio,
      banco: p.banco,
      claveRastreo: enmascararRastreo(p.clave_rastreo),
      fecha: p.fecha_pago,
      origen: p.origen,
    })),
  });
}

async function limiteDeSimulacion(request: Request, env: Env): Promise<Response | null> {
  const persona = await huellaIp(request, env);
  return (await consumir(env.DB, `simulacion:${persona}`, LIMITES.simulacionPorPersona)) ? null : json({ error: "Demasiados pagos simulados en poco tiempo. Espera unos minutos." }, 429);
}

async function simularDemo(request: Request, env: Env, url: URL, avisar: Avisador): Promise<Response> {
  if (!modoSimulacion(env)) return json({ error: SOLO_SIMULACION }, 404);
  const excedido = await limiteDeSimulacion(request, env);
  if (excedido) return excedido;
  const { fijo } = await qrDeLaDemo(env);
  if (!fijo?.pey_id) return json({ error: "La demo no tiene QR en este momento." }, 503);
  return simularPago(env, url, { tipo: "qr", peyId: fijo.pey_id, folio: fijo.folio, cobroId: null, creditoId: fijo.credito_id, montoCentavos: fijo.monto_centavos }, { conAviso: true }, avisar);
}

async function verPago(env: Env, token: string): Promise<Response> {
  const cobro = await cobroPorToken(env.DB, token);
  if (!cobro) return json({ error: "Este link de pago no existe." }, 404);
  return json({
    simulacion: modoSimulacion(env),
    financiera: FINANCIERA,
    cobro: {
      folio: cobro.folio,
      // Solo el número de crédito: la página de pago no muestra el nombre del acreditado.
      creditoId: cobro.credito_id,
      montoCentavos: cobro.monto_centavos,
      medio: cobro.medio,
      estado: estadoDelCobro(cobro),
      qrString: cobro.qr_string,
      simulado: cobro.simulado === 1,
      venceEn: cobro.vence_en,
    },
    // Quien tiene el link es quien paga: ve su clave de rastreo completa como comprobante.
    recibo: await reciboDelCobro(env.DB, cobro, { rastreoCompleto: true }),
  });
}

async function simularCobro(request: Request, env: Env, url: URL, token: string, avisar: Avisador): Promise<Response> {
  if (!modoSimulacion(env)) return json({ error: SOLO_SIMULACION }, 404);
  const cobro = await cobroPorToken(env.DB, token);
  if (!cobro) return json({ error: "Este link de pago no existe." }, 404);
  if (estadoDelCobro(cobro) === "vencido") return json({ error: "Este cobro ya venció." }, 409);
  const excedido = await limiteDeSimulacion(request, env);
  if (excedido) return excedido;
  return simularPago(
    env,
    url,
    { tipo: cobro.medio === "push" ? "pn" : "qr", peyId: cobro.pey_id, folio: cobro.folio, cobroId: cobro.id, creditoId: cobro.credito_id, montoCentavos: cobro.monto_centavos },
    { conAviso: true },
    avisar,
  );
}

export async function manejarPublico(request: Request, env: Env, url: URL, avisar: Avisador, conectar: (canal: Canal) => Promise<Response>): Promise<Response> {
  const metodo = request.method;
  const ruta = url.pathname;

  if (ruta === "/api/demo/en-vivo" && metodo === "GET") return conectar("demo");
  if (ruta === "/api/demo" && metodo === "GET") {
    await ponerAlDia(env, avisar);
    return demo(env);
  }
  if (ruta === "/api/demo/simular" && metodo === "POST") return simularDemo(request, env, url, avisar);

  const m = /^\/api\/pago\/([^/]{1,80})(\/en-vivo|\/simular)?$/.exec(ruta);
  if (m) {
    const token = m[1];
    if (!TOKEN_DE_COBRO.test(token)) return json({ error: "Este link de pago no existe." }, 404);
    if (!m[2] && metodo === "GET") return verPago(env, token);
    if (m[2] === "/simular" && metodo === "POST") return simularCobro(request, env, url, token, avisar);
    if (m[2] === "/en-vivo" && metodo === "GET") {
      return (await cobroPorToken(env.DB, token)) ? conectar(`cobro:${token}`) : json({ error: "Este link de pago no existe." }, 404);
    }
  }
  return json({ error: "No encontrado" }, 404);
}
