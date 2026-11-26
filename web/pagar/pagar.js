// Página de pago que recibe el acreditado por link. Lleva la marca de la financiera.
// Datos: GET /api/pago/:token (público para quien tiene el link). El pago llega en vivo por WebSocket y, de respaldo,
// la página consulta cada pocos segundos mientras el cobro siga abierto.

import { $, aviso, copiar, crearApi, direccionWs, enVivo, esc, hora, PALOMITA, pesos, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";
import { cuotasPagadas, pantallaDePago } from "/reglas.js";

const CONSULTA_MS = 4000; // respaldo del canal en vivo mientras el cobro sigue abierto
const REINTENTO_INICIAL_MS = 2000; // si la página no pudo cargar, vuelve a intentar sola, cada vez más espaciado
const REINTENTO_MAXIMO_MS = 30_000;
const NO_EXISTE = '<section class="tarjeta centro"><h1>Este link de pago no existe</h1><p>Revisa que el link esté completo o pide uno nuevo a tu gestor.</p></section>';

const token = new URLSearchParams(location.search).get("c") ?? "";
const api = crearApi();
const caja = $("#pago");
let datos = null;
let pintada = ""; // la pantalla que está a la vista; solo se vuelve a dibujar cuando cambia
let reloj = 0;
let consulta = 0;
let canal = null;
let turno = 0; // cada consulta toma un turno: solo la más reciente pinta y programa la siguiente
let esperaDeReintento = REINTENTO_INICIAL_MS;

function recibo() {
  const { cobro, recibo: r } = datos;
  const ultima = r.cuotas.at(-1);
  const aplicado = !ultima
    ? "Tu pago se recibió y está en revisión."
    : ultima.liquida && r.restaCuotaCentavos === 0
      ? cuotasPagadas(r.cuotas.map((q) => q.numero))
      : `Abono a tu cuota ${ultima.numero} · te faltan ${pesos(r.restaCuotaCentavos)}`;
  return `<section class="tarjeta pagado">
    <div class="palomita">${PALOMITA}</div>
    <h1>¡Pago recibido!</h1>
    <p class="monto grande">${pesos(r.montoCentavos)}</p>
    <dl class="datos">
      <div><dt>Crédito</dt><dd>${esc(cobro.creditoId)}</dd></div>
      <div><dt>Aplicado</dt><dd>${esc(aplicado)}</dd></div>
      <div><dt>Fecha y hora</dt><dd>${esc(new Date(r.fecha).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" }))} · ${esc(hora(r.fecha))}</dd></div>
      ${r.banco ? `<div><dt>Pagaste desde</dt><dd>${esc(r.banco)}</dd></div>` : ""}
      <div><dt>Clave de rastreo</dt><dd class="mono">${esc(r.claveRastreo ?? "—")}</dd></div>
    </dl>
    ${r.claveRastreo ? '<button class="boton suave ancho" data-accion="copiar-clave">Copiar clave de rastreo</button>' : ""}
    <p class="nota">Guarda tu clave de rastreo: es tu comprobante ante cualquier banco. No necesitas enviar captura a nadie.</p>
    ${r.origen !== "codi" ? '<p class="nota simulado">Pago simulado de la demostración: no se movió dinero real.</p>' : ""}
  </section>`;
}

/** El cobro ya está pagado pero el recibo aún no llega: no se enseña nada que se pueda volver a pagar. */
function confirmando() {
  return `<section class="tarjeta centro">
    <h1>Recibimos tu pago</h1>
    <p>Estamos preparando tu recibo. Esta página se actualiza sola en unos segundos.</p>
    <div class="esperando"><span class="pulso vivo"></span><b>Confirmando…</b></div>
  </section>`;
}

function pendiente() {
  const { cobro, simulacion } = datos;
  const esPush = cobro.medio === "push";
  return `<section class="tarjeta">
    <p class="antetitulo">Pago de tu crédito ${esc(cobro.creditoId)}</p>
    <p class="monto grande">${pesos(cobro.montoCentavos)}</p>
    <p class="sin-comision">Con CoDi, sin comisión · folio <span class="mono">${esc(cobro.folio)}</span></p>
    ${
      esPush
        ? '<div class="push"><b>Revisa la app de tu banco</b><p>Te enviamos una solicitud de cobro CoDi. Ábrela, revisa el monto y autoriza.</p></div>'
        : `<div class="qr ${cobro.simulado ? "simulado" : ""}" id="qr"></div>
           <ol class="pasos">
             <li>Abre la app de tu banco y entra a <b>CoDi</b>.</li>
             <li>Escanea este código. Si estás en este mismo celular, toca <b>Guardar QR</b> y ábrelo desde la app de tu banco.</li>
             <li>Revisa el nombre del beneficiario y el monto, y autoriza.</li>
           </ol>
           <button class="boton ancho" data-accion="guardar-qr">Guardar QR</button>`
    }
    <div class="esperando"><span class="pulso vivo"></span><b>Esperando tu pago…</b><span class="cuenta" id="cuenta"></span></div>
    ${simulacion ? '<button class="boton verde ancho" data-accion="simular">Simular el pago</button><p class="nota">Demostración en modo simulación: este cobro no mueve dinero real.</p>' : '<p class="nota">Demostración: el beneficiario que verás en tu banco es la cuenta de pruebas del proyecto.</p>'}
  </section>`;
}

function vencido() {
  // La vigencia la decide el servidor (viene en venceEn); aquí no se repite el número para que no se contradigan.
  return `<section class="tarjeta centro">
    <h1>Este cobro ya venció</h1>
    <p>Por seguridad, cada cobro tiene una vigencia corta. Pídele uno nuevo a tu gestor o a tu sucursal.</p>
  </section>`;
}

const PANTALLAS = { recibo, confirmando, pendiente, vencido };

function pintar(vista) {
  clearInterval(reloj);
  pintada = vista;
  $("#financiera").textContent = datos.financiera.nombre;
  $("#lema").textContent = datos.financiera.lema;
  $("#aviso-ficticia").textContent = `${datos.financiera.nombre} es una empresa ficticia creada para esta demostración.`;
  caja.innerHTML = PANTALLAS[vista]();
  if (vista !== "pendiente") return;

  const qr = $("#qr");
  if (qr && datos.cobro.qrString) qr.innerHTML = svgQr(datos.cobro.qrString);
  const cuenta = () => {
    const faltan = Math.max(0, Math.floor((Date.parse(datos.cobro.venceEn) - Date.now()) / 1000));
    const el = $("#cuenta");
    if (faltan > 0) {
      if (el) el.textContent = `Vence en ${Math.floor(faltan / 60)}:${String(faltan % 60).padStart(2, "0")}`;
      return;
    }
    // Llegó a cero según el reloj de este teléfono, que puede ir adelantado. Se pregunta una vez; de ahí en adelante
    // manda la consulta de respaldo (cada pocos segundos), no una por segundo.
    clearInterval(reloj);
    if (el) el.textContent = "Verificando…";
    cargar();
  };
  cuenta();
  reloj = setInterval(cuenta, 1000);
}

function sinCarga(mensaje) {
  pintada = "";
  caja.innerHTML = `<section class="tarjeta centro"><h1>No pudimos cargar tu pago</h1><p>${esc(mensaje)}</p>
    <p class="nota">Volvemos a intentar en unos segundos.</p>
    <button class="boton suave ancho" data-accion="reintentar">Reintentar ahora</button></section>`;
}

/** Consulta el cobro, pinta la pantalla que toca y deja programada la siguiente consulta mientras el cobro siga abierto. */
async function cargar() {
  const mio = ++turno;
  clearTimeout(consulta);
  let seguir = true;
  let espera = CONSULTA_MS;
  try {
    const nuevo = await api(`/api/pago/${encodeURIComponent(token)}`);
    if (mio !== turno) return; // ya salió una consulta más nueva: esa pinta y programa la siguiente
    const antes = datos?.cobro.estado;
    datos = nuevo;
    esperaDeReintento = REINTENTO_INICIAL_MS;
    const pantalla = pantallaDePago(nuevo.cobro.estado, Boolean(nuevo.recibo));
    seguir = pantalla.seguir;
    if (antes === "pendiente" && nuevo.cobro.estado === "pagado") sonarPagado();
    if (pantalla.vista !== pintada) pintar(pantalla.vista);
  } catch (error) {
    if (mio !== turno) return;
    if (error.status === 404) {
      seguir = false;
      clearInterval(reloj);
      pintada = "";
      caja.innerHTML = NO_EXISTE;
    } else if (!datos) {
      // Falla pasajera antes de tener nada que mostrar: se dice y se reintenta sola, cada vez más espaciado.
      sinCarga(error.message);
      espera = esperaDeReintento;
      esperaDeReintento = Math.min(esperaDeReintento * 2, REINTENTO_MAXIMO_MS);
    }
    // Con el cobro ya en pantalla una falla pasajera no cambia nada: se intenta de nuevo en la siguiente vuelta.
  }
  if (seguir) {
    // El aviso llega en vivo; la consulta periódica es el respaldo por si la conexión en vivo se corta.
    if (datos) canal ??= enVivo(() => direccionWs(`/api/pago/${encodeURIComponent(token)}/en-vivo`), cargar);
    consulta = setTimeout(cargar, espera);
  } else {
    canal?.cerrar();
    canal = null;
  }
}

caja.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("[data-accion]");
  const accion = boton?.dataset.accion;
  if (accion === "reintentar") cargar();
  if (accion === "guardar-qr") descargarPng(datos.cobro.qrString, `pago-credito-${datos.cobro.creditoId}.png`);
  if (accion === "copiar-clave") aviso((await copiar(datos.recibo.claveRastreo)) ? "Clave de rastreo copiada." : datos.recibo.claveRastreo, "bien");
  if (accion === "simular") {
    boton.disabled = true;
    boton.textContent = "Simulando el pago…";
    try {
      await api(`/api/pago/${encodeURIComponent(token)}/simular`, { metodo: "POST" });
      await cargar();
    } catch (error) {
      aviso(error.message, "mal");
      if (boton.isConnected) {
        boton.disabled = false;
        boton.textContent = "Simular el pago";
      }
    }
  }
});

// Al volver a la pestaña (por ejemplo, después de pagar en la app del banco) se consulta de inmediato.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && datos && pantallaDePago(datos.cobro.estado, Boolean(datos.recibo)).seguir) cargar();
});

if (/^[A-Za-z0-9_-]{32}$/.test(token)) cargar();
else caja.innerHTML = NO_EXISTE;
