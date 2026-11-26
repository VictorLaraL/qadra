// Landing: la demo en vivo. Un "teléfono" muestra el crédito de ejemplo con su QR CoDi fijo de un centavo;
// cuando alguien lo paga, pey avisa al Worker, el pago se concilia y aquí se ve "Pagado" al instante.

import { $, aviso, crearApi, direccionWs, enVivo, esc, hora, isotipo, NOMBRE_DE_MEDIO, PALOMITA, pesos, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";
import { huellaDePago } from "/reglas.js";

const api = crearApi();
const cuerpo = $("#td-cuerpo");
let demo = null;
let vista = "credito"; // credito | qr | pagado
let ultimoPago = null;
let regreso = 0;
let conectado = false; // si el canal en vivo está abierto; se declara aquí porque los botones lo consultan

const marca =() => `${isotipo(30, { claro: true })}<span><b>Qadra</b><small>Cobranza Inteligente</small></span>`;
$("#marca-nav").innerHTML = marca();
$("#marca-pie").innerHTML = marca();
$("#td-logo").innerHTML = isotipo(24, { claro: true });

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

function pintarTelefono() {
  if (!demo) return;
  if (!demo.credito || !demo.qr) {
    cuerpo.innerHTML = `<div class="td-aviso"><b>La demo en vivo no está disponible en este momento</b><p>${esc(demo.aviso ?? "")}</p>
      <a class="boton chico" href="/gestor/">Abrir la app del gestor</a></div>`;
    return;
  }
  const monto = pesos(demo.qr.montoCentavos);
  if (vista === "pagado" && ultimoPago) {
    // El número de cuota llega por el canal en vivo: solo se escribe en la página si de verdad es un número.
    const cuota = Number.isInteger(ultimoPago.cuota) && ultimoPago.cuota > 0 ? ultimoPago.cuota : null;
    cuerpo.innerHTML = `<div class="td-pagado">
      <div class="palomita">${PALOMITA}</div>
      <b class="td-titulo">Pagado</b>
      <p class="monto">${pesos(ultimoPago.montoCentavos)} con CoDi · ${esc(hora(ultimoPago.fecha))}</p>
      <dl>
        <div><dt>Aplicado</dt><dd>${cuota ? `Abono a la cuota ${cuota}` : "Por revisar"}</dd></div>
        <div><dt>Clave de rastreo</dt><dd class="mono">${esc(ultimoPago.claveRastreo ?? "—")}</dd></div>
        ${ultimoPago.banco ? `<div><dt>Banco</dt><dd>${esc(ultimoPago.banco)}</dd></div>` : ""}
      </dl>
      <button class="boton chico secundario" data-accion="otro">Cobrar otra vez</button>
    </div>`;
    return;
  }
  if (vista === "qr") {
    cuerpo.innerHTML = `${tarjetaDelCredito()}
      <div class="qr ${demo.qr.simulado ? "simulado" : ""}" id="qr-demo"></div>
      <p class="td-instruccion">${demo.simulacion ? "En simulación no hay nada que pagar: usa el botón." : `Abre la app de tu banco, entra a <b>CoDi</b> y escanea. Son <b>${monto}</b> reales.`}</p>
      <div class="td-esperando"><span class="pulso vivo"></span>Esperando el pago…</div>
      ${demo.simulacion ? '<button class="boton verde ancho" data-accion="simular">Simular el pago</button>' : '<button class="boton suave ancho" data-accion="guardar">Guardar QR (si estás en el celular)</button>'}`;
    $("#qr-demo").innerHTML = svgQr(demo.qr.qrString);
    return;
  }
  cuerpo.innerHTML = `${tarjetaDelCredito()}
    <button class="boton ancho td-cobrar" data-accion="cobrar">Cobrar ${monto} con CoDi</button>
    <p class="td-nota">${demo.simulacion ? "Demo en modo simulación: el pago es de mentira." : `Cobro real de ${monto}: paga con la app de tu banco y míralo conciliarse.`}</p>`;
}

function filaDePago(p, nuevo = false) {
  return `<li class="${nuevo ? "nuevo" : ""}"><time>${esc(hora(p.fecha))}</time>
    <span><b class="monto">${pesos(p.montoCentavos)}</b> ${esc(NOMBRE_DE_MEDIO[p.medio] ?? "CoDi")}${p.banco ? ` · ${esc(p.banco)}` : ""}<small class="mono">${esc(p.claveRastreo ?? "")}</small></span>
    <span class="etiqueta ${p.origen === "codi" ? "bien" : "espera"}">${p.origen === "codi" ? "Conciliado" : "Simulado"}</span></li>`;
}

function pintarOficina(nuevo = false) {
  if (!demo) return;
  $("#c-hoy").textContent = demo.pagosHoy;
  $("#caja-reales").hidden = demo.simulacion && !demo.pagosReales;
  $("#c-reales").textContent = demo.pagosReales;
  $("#credito-demo").textContent = demo.credito ? `Crédito ${demo.credito.id} · ${demo.credito.acreditado}` : "";
  if (demo.ultimos.length) $("#lista-demo").innerHTML = demo.ultimos.map((p, i) => filaDePago(p, nuevo && i === 0)).join("");
  $("#cta-demo").textContent = demo.simulacion ? "Probar la demo" : `Probar con ${pesos(demo.qr?.montoCentavos ?? 1)}`;
}

async function cargar({ nuevo = false } = {}) {
  try {
    demo = await api("/api/demo");
  } catch (error) {
    if (!demo) cuerpo.innerHTML = `<div class="td-aviso"><b>No se pudo cargar la demo</b><p>${esc(error.message)}</p></div>`;
    return;
  }
  pintarTelefono();
  pintarOficina(nuevo);
}

function alPagar(pago) {
  ultimoPago = pago;
  vista = "pagado";
  sonarPagado();
  cargar({ nuevo: true });
  clearTimeout(regreso);
  regreso = setTimeout(() => {
    vista = "credito";
    pintarTelefono();
  }, 12_000);
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
  if (vista === "pagado" && huellaDePago(ultimoPago) === huellaDePago(ultimo)) return; // ese pago ya está en pantalla
  alPagar({ ...ultimo, cuota: antes.cuota });
}

cuerpo.addEventListener("click", async (evento) => {
  const boton = evento.target.closest("[data-accion]");
  if (!boton) return;
  const accion = boton.dataset.accion;
  if (accion === "cobrar") {
    vista = "qr";
    pintarTelefono();
  }
  if (accion === "otro") {
    clearTimeout(regreso);
    vista = "qr";
    pintarTelefono();
  }
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
    conectado = estado;
    $("#pulso-demo").classList.toggle("vivo", estado);
    $("#estado-demo").textContent = estado ? "En vivo" : "Reconectando…";
  },
);
// Respaldo: mientras el canal en vivo esté caído, la página se pone al día sola y muestra "Pagado" si llegó un pago.
setInterval(() => {
  if (!conectado && !document.hidden) buscarPagoNuevo();
}, RESPALDO_MS);
// Al volver a la pestaña (por ejemplo, después de pagar en la app del banco en el mismo celular) el canal pudo haberse
// cerrado: se consulta de inmediato para no dejar a la persona viendo "Esperando el pago…".
document.addEventListener("visibilitychange", () => !document.hidden && buscarPagoNuevo());
