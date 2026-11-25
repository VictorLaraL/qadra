// Lo que comparten la app del gestor, el portal, la página de pago y la landing.

export const $ = (selector, raiz = document) => raiz.querySelector(selector);
export const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

const ZONA = "America/Mexico_City";
const moneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const formatoHora = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: ZONA });
const formatoDia = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const formatoDiaLargo = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** 45000 -> "$450.00" */
export const pesos = (centavos) => moneda.format((centavos ?? 0) / 100);
/** Instante ISO -> "10:42 a. m." (hora de la Ciudad de México) */
export const hora = (iso) => formatoHora.format(new Date(iso));
/** "2026-11-25" -> "mié 25 nov" */
export const diaCorto = (dia) => formatoDia.format(new Date(`${dia}T00:00:00Z`)).replace(/\./g, "");
/** "2026-11-25" -> "miércoles, 25 de noviembre" */
export const diaLargo = (dia) => formatoDiaLargo.format(new Date(`${dia}T00:00:00Z`));

const ENTIDADES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapa texto para meterlo en HTML. Todo dato que venga del servidor pasa por aquí. */
export const esc = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) => ENTIDADES[c]);

export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Isotipo de Qadra en SVG: la Q cuadrada con la palomita del pago confirmado. */
export function isotipo(tamano = 32, { claro = false } = {}) {
  const id = `q${Math.random().toString(36).slice(2, 8)}`;
  const inicio = claro ? "#2A64A8" : "#12305A";
  return (
    `<svg class="isotipo" width="${tamano}" height="${tamano}" viewBox="0 0 64 64" aria-hidden="true">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${inicio}"/>` +
    `<stop offset=".55" stop-color="#178373"/><stop offset="1" stop-color="#2BB582"/></linearGradient></defs>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(1 2)">` +
    `<rect x="7" y="6" width="42" height="42" rx="13" stroke="url(#${id})" stroke-width="7"/>` +
    `<polyline points="17,27.5 24.5,35 38,20.5" stroke="#19C37D" stroke-width="6.5"/>` +
    `<path d="M37 47C40 55 47 58.5 58 57" stroke="#2BB582" stroke-width="6.5"/></g></svg>`
  );
}

export class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

/**
 * Cliente del API. `clave` es una función para leer siempre la clave vigente.
 * Lanza ErrorApi con el mensaje del servidor; si no hay red, con status 0.
 */
export function crearApi(clave = () => "") {
  return async function api(ruta, { metodo, cuerpo, texto } = {}) {
    const encabezados = {};
    if (clave()) encabezados.Authorization = `Bearer ${clave()}`;
    if (cuerpo !== undefined) encabezados["content-type"] = "application/json";
    if (texto !== undefined) encabezados["content-type"] = "text/csv";
    let respuesta;
    try {
      respuesta = await fetch(ruta, {
        method: metodo ?? (cuerpo !== undefined || texto !== undefined ? "POST" : "GET"),
        headers: encabezados,
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : texto,
      });
    } catch {
      throw new ErrorApi(0, "Sin conexión. Revisa tu señal e intenta de nuevo.");
    }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new ErrorApi(respuesta.status, datos.error ?? "Algo salió mal. Intenta de nuevo.");
    return datos;
  };
}

/**
 * Canal en vivo con reconexión. `direccion` regresa (o promete) la URL del WebSocket cada vez que hay que conectar,
 * porque los boletos del personal vencen en un minuto.
 * @returns {{cerrar: () => void}}
 */
export function enVivo(direccion, alMensaje, alEstado = () => {}) {
  let ws = null;
  let cerrado = false;
  let espera = 1000;
  let latido = 0;
  let reintento = 0;

  async function conectar() {
    if (cerrado) return;
    try {
      const url = await direccion();
      if (cerrado) return;
      ws = new WebSocket(url);
    } catch {
      return reintentar();
    }
    ws.addEventListener("open", () => {
      espera = 1000;
      alEstado(true);
      latido = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25_000);
    });
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      try {
        alMensaje(JSON.parse(e.data));
      } catch {
        // mensaje que no es JSON: se ignora
      }
    });
    ws.addEventListener("close", reintentar);
    ws.addEventListener("error", () => ws.close());
  }

  function reintentar() {
    clearInterval(latido);
    if (cerrado) return;
    alEstado(false);
    clearTimeout(reintento);
    reintento = setTimeout(conectar, espera);
    espera = Math.min(espera * 2, 20_000);
  }

  conectar();
  return {
    cerrar() {
      cerrado = true;
      clearInterval(latido);
      clearTimeout(reintento);
      ws?.close();
    },
  };
}

/** URL del WebSocket para una ruta del mismo sitio. */
export const direccionWs = (ruta) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${ruta}`;

let cajaDeAvisos = null;
/** Aviso breve en la parte baja de la pantalla. tipo: "" | "bien" | "mal" */
export function aviso(texto, tipo = "") {
  if (!cajaDeAvisos) {
    cajaDeAvisos = document.createElement("div");
    cajaDeAvisos.className = "avisos";
    cajaDeAvisos.setAttribute("role", "status");
    cajaDeAvisos.setAttribute("aria-live", "polite");
    document.body.append(cajaDeAvisos);
  }
  const el = document.createElement("div");
  el.className = `aviso ${tipo}`;
  el.textContent = texto;
  cajaDeAvisos.append(el);
  setTimeout(() => el.classList.add("sale"), 3600);
  setTimeout(() => el.remove(), 4000);
}

let audio = null;
/** Firma sonora de "Pagado": dos tonos cortos y una vibración, para saberlo sin mirar la pantalla. */
export function sonarPagado() {
  try {
    navigator.vibrate?.([60, 50, 90]);
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const ahora = audio.currentTime;
    [880, 1318.5].forEach((frecuencia, i) => {
      const oscilador = audio.createOscillator();
      const volumen = audio.createGain();
      oscilador.type = "sine";
      oscilador.frequency.value = frecuencia;
      const inicio = ahora + i * 0.13;
      volumen.gain.setValueAtTime(0.0001, inicio);
      volumen.gain.exponentialRampToValueAtTime(0.18, inicio + 0.02);
      volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.16);
      oscilador.connect(volumen).connect(audio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + 0.18);
    });
  } catch {
    // sin audio disponible: no pasa nada
  }
}

/** Textos de la situación de un crédito. */
export function situacion(estado) {
  if (estado.situacion === "atrasado") return { clase: "atraso", texto: `${plural(estado.diasAtraso, "día", "días")} de atraso` };
  if (estado.situacion === "vence-hoy") return { clase: "hoy", texto: "Vence hoy" };
  if (estado.situacion === "liquidado") return { clase: "bien", texto: "Liquidado" };
  return { clase: "bien", texto: "Al corriente" };
}

export const NOMBRE_DE_MEDIO = { qr: "CoDi QR", pn: "CoDi al celular", push: "CoDi al celular" };
export const NOMBRE_DE_VISITA = {
  pendiente: "Pendiente",
  cobrado: "Cobrado",
  pago: "Pagó",
  promesa: "Promesa de pago",
  "no-localizado": "No localizado",
  "sin-dinero": "Sin dinero hoy",
  otro: "Otro",
};

/** Copia texto al portapapeles; regresa false si el navegador no lo permite. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
