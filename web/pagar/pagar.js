// Página de pago que recibe el acreditado por link. Lleva la marca de la financiera.
// Datos: GET /api/pago/:token (público para quien tiene el link). El pago llega en vivo por WebSocket.

import { $, aviso, copiar, crearApi, direccionWs, enVivo, esc, hora, pesos, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";

const token = new URLSearchParams(location.search).get("c") ?? "";
const api = crearApi();
const caja = $("#pago");
let datos = null;
let reloj = 0;
let consulta = 0;

const palomita = '<svg viewBox="0 0 52 52" aria-hidden="true"><polyline points="12,27 22,37 40,17"/></svg>';

function recibo() {
  const { cobro, recibo: r } = datos;
  const ultima = r.cuotas.at(-1);
  const aplicado = !ultima
    ? "Tu pago se recibió y está en revisión."
    : ultima.liquida && r.restaCuotaCentavos === 0
      ? `Cuota ${r.cuotas.map((q) => q.numero).join(" y ")} pagada completa`
      : `Abono a tu cuota ${ultima.numero} · te faltan ${pesos(r.restaCuotaCentavos)}`;
  return `<section class="tarjeta pagado">
    <div class="palomita">${palomita}</div>
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
  return `<section class="tarjeta centro">
    <h1>Este cobro ya venció</h1>
    <p>Por seguridad, cada cobro dura 10 minutos. Pídele uno nuevo a tu gestor o a tu sucursal.</p>
  </section>`;
}

function pintar() {
  clearInterval(reloj);
  const estado = datos.cobro.estado;
  caja.innerHTML = estado === "pagado" && datos.recibo ? recibo() : estado === "vencido" ? vencido() : pendiente();
  if (estado !== "pendiente") return clearInterval(consulta);

  const qr = $("#qr");
  if (qr && datos.cobro.qrString) qr.innerHTML = svgQr(datos.cobro.qrString);
  const cuenta = () => {
    const faltan = Math.max(0, Math.floor((Date.parse(datos.cobro.venceEn) - Date.now()) / 1000));
    const el = $("#cuenta");
    if (el) el.textContent = `Vence en ${Math.floor(faltan / 60)}:${String(faltan % 60).padStart(2, "0")}`;
    if (faltan === 0) cargar();
  };
  cuenta();
  reloj = setInterval(cuenta, 1000);
}

async function cargar() {
  const antes = datos?.cobro.estado;
  try {
    datos = await api(`/api/pago/${encodeURIComponent(token)}`);
  } catch (error) {
    if (!datos) {
      caja.innerHTML = `<section class="tarjeta centro"><h1>${error.status === 404 ? "Este link de pago no existe" : "No pudimos cargar tu pago"}</h1>
        <p>${error.status === 404 ? "Revisa que el link esté completo o pide uno nuevo a tu gestor." : esc(error.message)}</p></section>`;
    }
    return;
  }
  if (datos.cobro.estado === antes) return;
  if (antes === "pendiente" && datos.cobro.estado === "pagado") sonarPagado();
  $("#financiera").textContent = datos.financiera.nombre;
  $("#lema").textContent = datos.financiera.lema;
  $("#aviso-ficticia").textContent = `${datos.financiera.nombre} es una empresa ficticia creada para esta demostración.`;
  pintar();
}

caja.addEventListener("click", async (evento) => {
  const accion = evento.target.closest("[data-accion]")?.dataset.accion;
  if (accion === "guardar-qr") descargarPng(datos.cobro.qrString, `pago-credito-${datos.cobro.creditoId}.png`);
  if (accion === "copiar-clave") aviso((await copiar(datos.recibo.claveRastreo)) ? "Clave de rastreo copiada." : datos.recibo.claveRastreo, "bien");
  if (accion === "simular") {
    const boton = evento.target;
    boton.disabled = true;
    boton.textContent = "Simulando el pago…";
    try {
      await api(`/api/pago/${encodeURIComponent(token)}/simular`, { metodo: "POST" });
      await cargar();
    } catch (error) {
      aviso(error.message, "mal");
      boton.disabled = false;
      boton.textContent = "Simular el pago";
    }
  }
});

if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
  caja.innerHTML = '<section class="tarjeta centro"><h1>Este link de pago no existe</h1><p>Revisa que el link esté completo o pide uno nuevo a tu gestor.</p></section>';
} else {
  await cargar();
  if (datos?.cobro.estado === "pendiente") {
    // El aviso llega en vivo; la consulta cada 4 segundos es el respaldo por si la conexión en vivo se corta.
    enVivo(() => direccionWs(`/api/pago/${encodeURIComponent(token)}/en-vivo`), cargar);
    consulta = setInterval(cargar, 4000);
  }
}
