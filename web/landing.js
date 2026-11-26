// Landing: la demo en vivo. Un "teléfono" muestra el crédito de ejemplo con su QR CoDi fijo de un centavo;
// cuando alguien lo paga, pey avisa al Worker, el pago se concilia y aquí se ve "Pagado" al instante y, enseguida, el
// mismo pago ya aplicado en la tarjeta de la oficina y en "Conciliación en vivo".

import { $, aviso, crearApi, direccionWs, enVivo, esc, hora, NOMBRE_DE_MEDIO, PALOMITA, pesos, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";
import { huellaDePago, resumenDelPago } from "/reglas.js";

const api = crearApi();
const cuerpo = $("#td-cuerpo");
const oficina = $("#td-oficina");
const movimientoReducido = matchMedia("(prefers-reduced-motion: reduce)");
let demo = null;
let vista = "credito"; // credito | qr | pagado
let ultimoPago = null;
let conectado = false; // si el canal en vivo está abierto; se declara aquí porque los botones lo consultan

// "Pagado" se dibuja en ~650 ms (estilos.css: brota y traza); la oficina recibe el pago justo al terminar.
const OFICINA_TRAS_PAGADO_MS = 600;

// ------------------------------------------------------------------ Teléfono

function tarjetaDelCredito() {
  const c = demo.credito;
  const q = c.cuota;
  const avance = q ? Math.min(100, Math.round((q.pagadoCentavos / q.montoCentavos) * 100)) : 100;
  return `<div class="td-credito">
    <small>Crédito ${esc(c.id)} · ${esc(c.producto)}</small>
    <b>${esc(c.acreditado)}</b>
    <span>${q ? `Cuota ${q.numero} de ${c.cuotasTotales} · ${pesos(q.montoCentavos)}` : "Crédito liquidado"}</span>
    ${q ? `<div class="avance" role="img" aria-label="${avance}% de la cuota abonado"><i style="width:${Math.max(avance, 2)}%"></i></div><span class="monto">Abonado ${pesos(q.pagadoCentavos)}</span>` : ""}
  </div>`;
}

function creditoCompacto() {
  const c = demo.credito;
  const q = c.cuota;
  return `<div class="td-credito compacto">
    <div><b>${esc(c.acreditado)}</b><small>Crédito ${esc(c.id)}${q ? ` · cuota ${q.numero} de ${c.cuotasTotales}` : ""}</small></div>
    <b class="monto">${pesos(demo.qr.montoCentavos)}</b>
  </div>`;
}

function htmlDelTelefono() {
  if (!demo.credito || !demo.qr) {
    return `<div class="td-aviso"><b>La demo en vivo no está disponible en este momento</b><p>${esc(demo.aviso ?? "")}</p>
      <a class="boton chico" href="/gestor/">Abrir la app del gestor</a></div>`;
  }
  const monto = pesos(demo.qr.montoCentavos);
  if (vista === "pagado" && ultimoPago) {
    const r = resumenDelPago(ultimoPago);
    return `<div class="td-pagado">
        <div class="palomita">${PALOMITA}</div>
        <b class="td-titulo">Pagado</b>
        <p class="monto">${pesos(ultimoPago.montoCentavos)} con CoDi · ${esc(hora(ultimoPago.fecha))}</p>
        <dl>
          <div><dt>Aplicado</dt><dd>${esc(r.aplicado)}</dd></div>
          <div><dt>Clave de rastreo</dt><dd class="mono">${esc(ultimoPago.claveRastreo ?? "—")}</dd></div>
          ${ultimoPago.banco ? `<div><dt>Banco</dt><dd>${esc(ultimoPago.banco)}</dd></div>` : ""}
        </dl>
      </div>
      <div class="td-accion"><button class="boton chico secundario ancho" data-accion="otro">Cobrar otra vez</button></div>`;
  }
  if (vista === "qr") {
    return `${creditoCompacto()}
      <div class="qr ${demo.qr.simulado ? "simulado" : ""}" id="qr-demo"></div>
      <p class="td-instruccion">${demo.simulacion ? "En simulación no hay nada que pagar: usa el botón." : `Abre la app de tu banco, entra a <b>CoDi</b> y escanea. Son <b>${monto}</b> reales.`}</p>
      <div class="td-accion">
        <div class="td-esperando"><span class="pulso vivo"></span>Esperando el pago…</div>
        ${demo.simulacion ? '<button class="boton verde ancho" data-accion="simular">Simular el pago</button>' : '<button class="boton suave ancho" data-accion="guardar">Guardar QR (si estás en el celular)</button>'}
      </div>`;
  }
  const segundoPaso = demo.simulacion ? "<b>Simula el pago</b>: llega un aviso firmado, igual que uno de pey." : "<b>Págalo</b> desde la app de tu banco, con CoDi.";
  return `${tarjetaDelCredito()}
    <ol class="td-pasos">
      <li><span>Toca <b>Cobrar</b>: Qadra crea el cobro en pey con un folio.</span></li>
      <li><span>${segundoPaso}</span></li>
      <li><span>Mira <b>Pagado</b> aquí y el pago ya aplicado en la oficina.</span></li>
    </ol>
    <div class="td-accion">
      <button class="boton ancho td-cobrar" data-accion="cobrar">Cobrar ${monto} con CoDi</button>
      <p class="td-nota">${demo.simulacion ? "Demo en modo simulación: el pago es de mentira." : `Cobro real de ${monto}: paga con la app de tu banco y míralo conciliarse.`}</p>
    </div>`;
}

let pintado = ""; // lo que ya está en el teléfono: no se vuelve a dibujar (ni a animar) lo mismo
function pintarTelefono() {
  if (!demo) return;
  const html = htmlDelTelefono();
  if (html === pintado) return; // una consulta que no trae nada nuevo no reinicia "Pagado" ni el botón ocupado
  const cambioDeVista = cuerpo.dataset.vista !== vista;
  pintado = html;
  cuerpo.innerHTML = html;
  cuerpo.dataset.vista = vista;
  // Solo un cambio de pantalla entra con fundido; si cambian datos en la misma pantalla, no hay animación.
  cuerpo.classList.toggle("entra", cambioDeVista);
  const qr = $("#qr-demo");
  if (qr) qr.innerHTML = svgQr(demo.qr.qrString);
}

let turnoDeAnuncio = 0;
/** Aviso corto para lector de pantalla. Se vacía antes para que el mismo texto se vuelva a leer. */
function anunciar(texto) {
  const region = $("#anuncio-demo");
  const turno = ++turnoDeAnuncio;
  region.textContent = "";
  setTimeout(() => turno === turnoDeAnuncio && (region.textContent = texto), 60);
}

/** El punto "En vivo" late tres veces: al conectarse y cada vez que llega un pago. El resto del tiempo está quieto. */
function latir() {
  const punto = $("#pulso-demo");
  punto.classList.remove("latido");
  void punto.offsetWidth; // reinicia la animación aunque ya estuviera latiendo
  punto.classList.add("latido");
}
$("#pulso-demo").addEventListener("animationend", (evento) => evento.currentTarget.classList.remove("latido"));

// ------------------------------------------------------------------ La oficina

let oficinaEspera = 0;
/** La tarjeta de la oficina recibe el pago cuando "Pagado" termina de dibujarse. */
function oficinaRecibe(pago) {
  clearTimeout(oficinaEspera);
  const r = resumenDelPago(pago);
  oficinaEspera = setTimeout(
    () => {
      $("#oficina-titulo").textContent = `Portal de la financiera · ${hora(pago.fecha)}`;
      $("#oficina-texto").textContent = `Conciliado: ${r.oficina}`;
      oficina.classList.add("recibido");
      oficina.classList.remove("llega");
      void oficina.offsetWidth;
      oficina.classList.add("llega");
    },
    movimientoReducido.matches ? 0 : OFICINA_TRAS_PAGADO_MS,
  );
}

// El resaltado de la fila nueva dura 6 s: se guarda hasta que "Conciliación en vivo" esté a la vista, para que no pase
// mientras nadie la mira (en escritorio la tarjeta queda abajo del teléfono).
let conciliacionVisible = false;
let resaltePendiente = false;
function resaltarFilaNueva() {
  $("#lista-demo li:not(.nota)")?.classList.add("nuevo");
  resaltePendiente = false;
}
new IntersectionObserver(
  ([entrada]) => {
    conciliacionVisible = entrada.isIntersecting;
    if (conciliacionVisible && resaltePendiente) resaltarFilaNueva();
  },
  { threshold: 0.5 },
).observe($("#conciliacion"));

// Lo que se repite (el punto de "Esperando el pago…") se detiene mientras la demo está fuera de la pantalla.
new IntersectionObserver(([entrada]) => document.body.classList.toggle("demo-fuera", !entrada.isIntersecting)).observe($("#demo"));

function filaDePago(p) {
  return `<li><time>${esc(hora(p.fecha))}</time>
    <span><b class="monto">${pesos(p.montoCentavos)}</b> ${esc(NOMBRE_DE_MEDIO[p.medio] ?? "CoDi")}${p.banco ? ` · ${esc(p.banco)}` : ""}<small class="mono">${esc(p.claveRastreo ?? "")}</small></span>
    <span class="etiqueta ${p.origen === "codi" ? "bien" : "espera"}">${p.origen === "codi" ? "Conciliado" : "Simulado"}</span></li>`;
}

function pintarOficina(nuevo = false) {
  if (!demo) return;
  $("#c-hoy").textContent = demo.pagosHoy;
  $("#caja-reales").hidden = demo.simulacion && !demo.pagosReales;
  $("#c-reales").textContent = demo.pagosReales;
  $("#credito-demo").textContent = demo.credito ? `Crédito ${demo.credito.id} · ${demo.credito.acreditado}` : "";
  if (!demo.ultimos.length) return;
  $("#lista-demo").innerHTML = demo.ultimos.map(filaDePago).join("");
  if (!nuevo) return;
  if (conciliacionVisible) resaltarFilaNueva();
  else resaltePendiente = true;
}

// ------------------------------------------------------------------ Datos y pagos

async function cargar({ nuevo = false } = {}) {
  try {
    demo = await api("/api/demo");
  } catch (error) {
    if (!demo) {
      pintado = "";
      cuerpo.innerHTML = `<div class="td-aviso"><b>No se pudo cargar la demo</b><p>${esc(error.message)}</p></div>`;
    }
    return;
  }
  pintarTelefono();
  pintarOficina(nuevo);
}

let anunciado = ""; // huella del último pago que ya se mostró como "Pagado": el mismo pago no se anuncia dos veces

/** Llegó un pago: "Pagado" en el teléfono, el pago en la oficina y el aviso para lector de pantalla. Se queda en
 * pantalla hasta que la persona cobre otra vez: el recibo no se borra solo mientras alguien lo lee. */
function alPagar(pago) {
  ultimoPago = pago;
  anunciado = huellaDePago(pago);
  vista = "pagado";
  sonarPagado();
  latir();
  anunciar(resumenDelPago(pago).anuncio);
  oficinaRecibe(pago);
  cargar({ nuevo: true });
}

const ESPERA_CON_CANAL_MS = 2500; // margen para que "Pagado" llegue solo por el canal en vivo
const ESPERA_SIN_CANAL_MS = 600; // sin canal no hay a quién esperar: se consulta casi de inmediato
const RESPALDO_MS = 10_000; // cada cuánto se pone al día la página mientras el canal en vivo está caído

/** Lo que se sabe de la demo en este momento: el último pago (para reconocer uno nuevo) y la cuota a la que se abona. */
const fotoDeLaDemo = () => ({ cargada: Boolean(demo), huella: huellaDePago(demo?.ultimos?.[0]), cuota: demo?.credito?.cuota?.numero ?? null });

/**
 * Respaldo del canal en vivo. "Pagado" llega normalmente por el canal; cuando no está (se cayó, o el navegador lo cerró
 * mientras la persona pagaba en la app de su banco), se consulta la demo y se muestra "Pagado" solo si de verdad
 * apareció un pago que no estaba en la foto de antes.
 */
async function buscarPagoNuevo(antes = fotoDeLaDemo()) {
  await cargar();
  const ultimo = demo?.ultimos?.[0];
  if (!antes.cargada || !ultimo || huellaDePago(ultimo) === antes.huella) return;
  // Ese pago ya se anunció (por el canal en vivo o por una consulta anterior), aunque la foto de antes estuviera vieja.
  if (huellaDePago(ultimo) === anunciado) return;
  alPagar({ ...ultimo, cuota: antes.cuota });
}

function mostrarQr() {
  vista = "qr";
  pintarTelefono();
  if (demo?.qr) anunciar(`Se muestra el QR de cobro de ${pesos(demo.qr.montoCentavos)}.`);
}

cuerpo.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("[data-accion]");
  if (!boton) return;
  const accion = boton.dataset.accion;
  if (accion === "cobrar" || accion === "otro") mostrarQr();
  if (accion === "guardar") descargarPng(demo.qr.qrString, "qadra-demo-codi.png");
  if (accion === "simular") {
    boton.disabled = true;
    boton.textContent = "Simulando el pago…";
    const antes = fotoDeLaDemo(); // lo que había antes de simular
    try {
      await api("/api/demo/simular", { metodo: "POST" });
      // Si "Pagado" no llegó por el canal en vivo, se busca el pago nuevo consultando.
      setTimeout(() => vista === "qr" && buscarPagoNuevo(antes), conectado ? ESPERA_CON_CANAL_MS : ESPERA_SIN_CANAL_MS);
    } catch (error) {
      aviso(error.message, "mal");
      boton.disabled = false;
      boton.textContent = "Simular el pago";
    }
  }
});

await cargar();
$("#texto-cierre").textContent = demo?.simulacion
  ? 'La demo está en modo simulación: entra a la app del gestor y al portal con la clave "demo".'
  : "Entra a la app del gestor y al portal con la clave de jurado del formulario de entrega.";

enVivo(
  () => direccionWs("/api/demo/en-vivo"),
  (m) => m.tipo === "pago" && alPagar(m),
  (estado) => {
    const antes = conectado;
    conectado = estado;
    $("#pulso-demo").classList.toggle("vivo", estado);
    $("#estado-demo").textContent = estado ? "En vivo" : "Reconectando…";
    if (estado && !antes) latir();
  },
);
// Respaldo: mientras el canal en vivo esté caído, la página se pone al día sola y muestra "Pagado" si llegó un pago.
setInterval(() => {
  if (!conectado && !document.hidden) buscarPagoNuevo();
}, RESPALDO_MS);
// Al volver a la pestaña (por ejemplo, después de pagar en la app del banco en el mismo celular) el canal pudo haberse
// cerrado: se consulta de inmediato para no dejar a la persona viendo "Esperando el pago…".
document.addEventListener("visibilitychange", () => !document.hidden && buscarPagoNuevo());
