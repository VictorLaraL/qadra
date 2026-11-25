// App del gestor de campo: ruta del día, ficha del crédito, cobro con CoDi y visita registrada.
// Una sola página; lo que se ve depende de `e.vista`. Los datos vienen de /api/app (ver src/worker/app.ts).

import { $, aviso, copiar, crearApi, diaLargo, direccionWs, enVivo, esc, hora, isotipo, NOMBRE_DE_VISITA, pesos, plural, situacion, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";

const app = $("#app");

// ------------------------------------------------------------------ Memoria del teléfono
const LLAVE = { clave: "qadra.clave", gestor: "qadra.gestor", cola: "qadra.cola", ruta: "qadra.ruta" };
function leer(llave, porDefecto) {
  try {
    const valor = localStorage.getItem(llave);
    return valor === null ? porDefecto : JSON.parse(valor);
  } catch {
    return porDefecto;
  }
}
function guardar(llave, valor) {
  try {
    localStorage.setItem(llave, JSON.stringify(valor));
  } catch {
    // sin espacio o en modo privado: la app sigue funcionando en línea
  }
}

// ------------------------------------------------------------------ Estado
const e = {
  vista: "cargando", // cargando | entrada | ruta | ficha | cobro | pagado
  hoja: null, // null | cobrar | visita | gestores
  clave: leer(LLAVE.clave, ""),
  publico: null, // /api/estado
  sesion: null,
  gestorId: leer(LLAVE.gestor, "g1"),
  ruta: null,
  rutaGuardada: false, // true = se está mostrando la última ruta guardada, sin conexión
  ficha: null,
  cobro: null,
  linkPago: "",
  recibo: null,
  enLinea: navigator.onLine,
  cola: leer(LLAVE.cola, []), // visitas registradas sin conexión, por enviar
  error: "",
  ocupado: false,
};

const api = crearApi(() => e.clave);
let canal = null;
let vigilancia = 0;
let reloj = 0;

// ------------------------------------------------------------------ Piezas de pantalla
const flecha = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const palomita = '<svg viewBox="0 0 52 52" aria-hidden="true"><polyline points="12,27 22,37 40,17"/></svg>';

function cinta() {
  if (!e.sesion) return "";
  return e.sesion.simulacion
    ? '<div class="cinta">Modo simulación · nada mueve dinero real</div>'
    : `<div class="cinta real">Cobros CoDi reales${e.sesion.topeCentavos ? ` · tope de la demo ${pesos(e.sesion.topeCentavos)}` : ""}</div>`;
}

function barra(titulo, { volver = false, derecha = "" } = {}) {
  return `<header class="barra">
    ${volver ? `<button class="barra-boton" data-accion="volver" aria-label="Volver">${flecha}</button>` : isotipo(28, { claro: true })}
    <span class="barra-titulo">${esc(titulo)}</span>
    ${derecha}
  </header>`;
}

function avisosDeEstado() {
  const partes = [];
  if (!e.enLinea) partes.push('<div class="franja">Sin conexión. Lo que registres se envía al reconectar.</div>');
  else if (e.rutaGuardada) partes.push('<div class="franja">Mostrando la última ruta guardada.</div>');
  if (e.cola.length) partes.push(`<div class="franja azul">${plural(e.cola.length, "visita", "visitas")} por enviar.</div>`);
  const h = e.sesion?.horario;
  if (h && !h.dentro) {
    partes.push(
      `<div class="franja">Fuera del horario de gestión (${h.desde}:00 a ${h.hasta}:00). ${h.estricto ? "No se pueden registrar cobros ni visitas." : "En la demo puedes continuar; en operación se bloquea."}</div>`,
    );
  }
  return partes.join("");
}

// ------------------------------------------------------------------ Vistas

function vistaEntrada() {
  const demo = e.publico?.claveDemo;
  return `<section class="entrada">
    <div class="entrada-marca">${isotipo(72)}<h1>Qadra</h1><p>Cobranza Inteligente</p></div>
    <form id="f-entrada" class="entrada-forma" novalidate>
      <label class="campo"><span>Clave de acceso</span>
        <input name="clave" type="password" autocomplete="current-password" autocapitalize="off" required /></label>
      <p class="error" ${e.error ? "" : "hidden"} role="alert">${esc(e.error)}</p>
      <button class="boton ancho" ${e.ocupado ? "disabled" : ""}>${e.ocupado ? "Entrando…" : "Entrar"}</button>
    </form>
    ${
      demo
        ? `<div class="entrada-demo"><button class="boton suave ancho" data-accion="entrar-demo">Entrar a la demo</button>
           <p class="nota">La demo está en modo simulación: los cobros son de mentira y se rotulan como simulados.</p></div>`
        : '<p class="nota">Usa la clave que recibiste para esta demo.</p>'
    }
    <p class="entrada-pie">App del gestor · ${esc(e.publico?.financiera?.nombre ?? "")}</p>
  </section>`;
}

function tarjetaDeVisita(v, indice) {
  const s = situacion(v.estado);
  const hecha = v.visita !== "pendiente";
  const derecha = hecha
    ? v.visita === "cobrado"
      ? `<b class="monto">${pesos(v.cobradoHoyCentavos)}</b><span class="etiqueta bien">Cobrado</span>`
      : `<b class="monto">${pesos(v.estado.exigibleCentavos)}</b><span class="etiqueta espera">${esc(NOMBRE_DE_VISITA[v.visita])}</span>`
    : `<b class="monto">${pesos(v.estado.exigibleCentavos)}</b><span class="etiqueta ${s.clase}">${esc(s.texto)}</span>`;
  return `<li><button class="visita ${hecha ? "hecha" : ""}" data-accion="abrir" data-id="${esc(v.creditoId)}">
    <span class="visita-orden">${hecha && v.visita === "cobrado" ? "✓" : indice + 1}</span>
    <span class="visita-quien"><b>${esc(v.acreditado)}</b><small>Crédito ${esc(v.creditoId)} · ${esc(v.colonia)}</small></span>
    <span class="visita-cuanto">${derecha}</span>
  </button></li>`;
}

function vistaRuta() {
  const r = e.ruta;
  if (!r) return barra("Ruta de hoy") + cinta() + avisosDeEstado() + '<p class="cargando">Cargando tu ruta…</p>';
  const porcentaje = r.resumen.total ? Math.round((r.resumen.hechas / r.resumen.total) * 100) : 0;
  return `${barra("Ruta de hoy", { derecha: `<span class="barra-progreso">${r.resumen.hechas} de ${r.resumen.total}</span>` })}
    ${cinta()}${avisosDeEstado()}
    <section class="resumen">
      <button class="resumen-gestor" data-accion="gestores">
        <span><b>${esc(r.gestor.nombre)}</b><small>${esc(r.gestor.zona ? `Zona ${r.gestor.zona} · ` : "")}${esc(diaLargo(e.sesion.hoy))}</small></span>
        <span class="resumen-cambiar">Cambiar</span>
      </button>
      <div class="resumen-cifras">
        <div><small>Cobrado hoy</small><strong class="monto">${pesos(r.resumen.cobradoCentavos)}</strong></div>
        <div><small>Por cobrar</small><strong class="monto">${pesos(r.resumen.porCobrarCentavos)}</strong></div>
      </div>
      <div class="avance" role="img" aria-label="${porcentaje}% de la ruta hecha"><i style="width:${porcentaje}%"></i></div>
    </section>
    <h2 class="titulo-lista">Visitas de hoy</h2>
    ${
      r.visitas.length
        ? `<ul class="visitas">${r.visitas.map(tarjetaDeVisita).join("")}</ul>`
        : '<p class="vacio">No hay cobros para hoy en esta ruta.</p>'
    }
    <footer class="pie"><span class="pulso ${e.enLinea && !e.rutaGuardada ? "vivo" : ""}"></span>
      ${e.enLinea ? "En línea" : "Sin conexión"} · <button class="enlace" data-accion="actualizar">Actualizar</button> ·
      <button class="enlace" data-accion="salir">Salir</button></footer>`;
}

function movimientos(f) {
  const pagos = f.pagos.map((p) => ({
    fecha: p.fechaPago,
    html: `<b class="monto">${pesos(p.montoCentavos)}</b> <span>${p.estado === "aplicado" ? `Pago aplicado${p.cuotas.length ? ` a cuota ${p.cuotas.map((c) => c.numero).join(" y ")}` : ""}` : "Pago por revisar"}</span>
           ${p.origen !== "codi" ? `<span class="etiqueta lisa">${p.origen === "ejemplo" ? "Ejemplo" : "Simulado"}</span>` : ""}`,
  }));
  const visitas = f.gestiones
    .filter((g) => g.resultado !== "pago")
    .map((g) => ({
      fecha: g.creadoEn,
      html: `<b>${esc(NOMBRE_DE_VISITA[g.resultado] ?? g.resultado)}</b>${g.promesaCentavos ? ` <span class="monto">${pesos(g.promesaCentavos)} para el ${esc(g.promesaFecha)}</span>` : ""}
             ${g.nota ? `<small>${esc(g.nota)}</small>` : ""}`,
    }));
  const lista = [...pagos, ...visitas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  if (!lista.length) return '<p class="nota">Sin movimientos todavía.</p>';
  return `<ul class="movimientos">${lista.map((m) => `<li><time>${esc(hora(m.fecha))}</time><div>${m.html}</div></li>`).join("")}</ul>`;
}

function calendario(f) {
  const hoy = e.sesion.hoy;
  return `<ol class="calendario">${f.cuotas
    .map((c) => {
      const pagada = c.pagadoCentavos >= c.montoCentavos;
      const clase = pagada ? "pagada" : c.pagadoCentavos > 0 ? "parcial" : c.vence < hoy ? "vencida" : c.vence === hoy ? "hoy" : "";
      const texto = pagada ? "pagada" : c.pagadoCentavos > 0 ? "con abono" : c.vence < hoy ? "vencida" : c.vence === hoy ? "vence hoy" : "por vencer";
      return `<li class="${clase}" title="Cuota ${c.numero} · ${esc(c.vence)} · ${texto}"><span class="solo-lectores">Cuota </span>${c.numero}<span class="solo-lectores">: ${texto}</span></li>`;
    })
    .join("")}</ol>
    <p class="leyenda"><i class="pagada"></i>Pagada <i class="parcial"></i>Con abono <i class="hoy"></i>Vence hoy <i class="vencida"></i>Vencida</p>`;
}

function vistaFicha() {
  const f = e.ficha;
  if (!f) return barra("Crédito", { volver: true }) + '<p class="cargando">Cargando el crédito…</p>';
  const c = f.credito;
  const s = situacion(c.estado);
  const actual = c.estado.cuotaActual;
  const abonado = actual ? Math.round((actual.pagadoCentavos / actual.montoCentavos) * 100) : 100;
  return `${barra(`Crédito ${c.id}`, { volver: true })}${cinta()}${avisosDeEstado()}
    <section class="ficha-cabeza">
      <span class="etiqueta ${s.clase}">${esc(s.texto)}</span>
      <h2>${esc(c.acreditado)}</h2>
      <p>${esc(c.producto)}${c.grupo ? ` · Grupo ${esc(c.grupo)}` : ""}</p>
      <p class="nota">${esc([c.domicilio, c.colonia].filter(Boolean).join(", "))}</p>
    </section>
    <section class="tarjeta exigible">
      <small>${c.estado.exigibleCentavos > 0 ? "Exigible hoy" : "Saldo del crédito"}</small>
      <strong class="monto">${pesos(c.estado.exigibleCentavos > 0 ? c.estado.exigibleCentavos : c.estado.saldoCentavos)}</strong>
      ${
        actual
          ? `<p>Cuota ${actual.numero} de ${c.estado.cuotasTotales} · vence ${actual.vence === e.sesion.hoy ? "hoy" : esc(actual.vence)}</p>
             <div class="avance" role="img" aria-label="${abonado}% de la cuota pagado"><i style="width:${abonado}%"></i></div>
             <p class="nota monto">Abonado ${pesos(actual.pagadoCentavos)} de ${pesos(actual.montoCentavos)}</p>`
          : "<p>Este crédito ya no debe nada.</p>"
      }
    </section>
    <div class="acciones">
      <button class="boton ancho" data-accion="hoja-cobrar" ${actual ? "" : "disabled"}>Cobrar con CoDi</button>
      <button class="boton secundario ancho" data-accion="hoja-visita">Registrar visita</button>
    </div>
    <section class="bloque"><h3>Movimientos</h3>${movimientos(f)}</section>
    <section class="bloque"><h3>Calendario de pagos</h3>${calendario(f)}</section>
    <p class="regla">Solo se contacta al titular del crédito, de 7:00 a 22:00. Nunca a familiares, vecinos ni referencias.</p>`;
}

function opcionesDeMonto() {
  const est = e.ficha.credito.estado;
  const tope = e.sesion.topeCentavos;
  const lista = [];
  if (tope > 0) lista.push({ id: "prueba", nombre: "Abono de prueba", centavos: 1 });
  if (est.exigibleCentavos > 0) lista.push({ id: "exigible", nombre: "Lo exigible hoy", centavos: est.exigibleCentavos });
  if (est.cuotaActual && est.cuotaActual.pendienteCentavos !== est.exigibleCentavos) {
    lista.push({ id: "cuota", nombre: `Lo que falta de la cuota ${est.cuotaActual.numero}`, centavos: est.cuotaActual.pendienteCentavos });
  }
  for (const o of lista) o.bloqueada = tope > 0 && o.centavos > tope;
  return lista;
}

function hojaCobrar() {
  const c = e.ficha.credito;
  const opciones = opcionesDeMonto();
  const elegida = opciones.find((o) => !o.bloqueada)?.id ?? "otro";
  const tope = e.sesion.topeCentavos;
  return `<div class="velo" data-accion="cerrar-hoja"></div>
  <form class="hoja" id="f-cobro" novalidate>
    <h3>Cobrar a ${esc(c.acreditado)}</h3>
    <fieldset class="opciones"><legend>¿Cuánto vas a cobrar?</legend>
      ${opciones
        .map(
          (o) => `<label class="opcion ${o.bloqueada ? "bloqueada" : ""}"><input type="radio" name="monto" value="${o.id}" data-centavos="${o.centavos}"
            ${o.id === elegida ? "checked" : ""} ${o.bloqueada ? "disabled" : ""} /><span>${esc(o.nombre)}</span><b class="monto">${pesos(o.centavos)}</b></label>`,
        )
        .join("")}
      <label class="opcion"><input type="radio" name="monto" value="otro" ${elegida === "otro" ? "checked" : ""} /><span>Otro monto</span>
        <input class="otro-monto monto" name="otro" inputmode="decimal" placeholder="0.00" aria-label="Otro monto en pesos" /></label>
    </fieldset>
    ${tope ? `<p class="nota">En esta demo pública cada cobro real tiene un tope de ${pesos(tope)} y se aplica como abono a la cuota.</p>` : ""}
    <fieldset class="opciones"><legend>¿Cómo paga?</legend>
      <label class="opcion alta"><input type="radio" name="medio" value="qr" checked /><span>QR en pantalla<small>Lo escanea con la app de su banco</small></span></label>
      <label class="opcion alta"><input type="radio" name="medio" value="push" /><span>Cobro a su celular<small>Le llega la solicitud a su app bancaria</small></span></label>
    </fieldset>
    <label class="campo" id="campo-celular" hidden><span>Celular del acreditado (10 dígitos)</span>
      <input name="telefono" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="999 123 4567" /></label>
    <p class="error" id="error-cobro" hidden role="alert"></p>
    <button class="boton ancho">Generar cobro</button>
    <button type="button" class="enlace centro" data-accion="cerrar-hoja">Cancelar</button>
  </form>`;
}

function hojaVisita() {
  const c = e.ficha.credito;
  const resultados = ["promesa", "no-localizado", "sin-dinero", "otro"];
  return `<div class="velo" data-accion="cerrar-hoja"></div>
  <form class="hoja" id="f-visita" novalidate>
    <h3>Visita a ${esc(c.acreditado)}</h3>
    <fieldset class="opciones"><legend>¿Qué pasó?</legend>
      ${resultados.map((r, i) => `<label class="opcion"><input type="radio" name="resultado" value="${r}" ${i === 0 ? "checked" : ""} /><span>${esc(NOMBRE_DE_VISITA[r])}</span></label>`).join("")}
    </fieldset>
    <div class="dos" id="campos-promesa">
      <label class="campo"><span>¿Cuándo paga?</span><input type="date" name="promesaFecha" min="${esc(e.sesion.hoy)}" value="${esc(e.sesion.hoy)}" /></label>
      <label class="campo"><span>¿Cuánto?</span><input name="promesaMonto" class="monto" inputmode="decimal" value="${(c.estado.exigibleCentavos / 100).toFixed(2)}" /></label>
    </div>
    <label class="campo"><span>Nota</span><textarea name="nota" maxlength="280" placeholder="Lo que conviene recordar de la visita"></textarea></label>
    <label class="casilla"><input type="checkbox" name="ubicacion" /> Guardar mi ubicación como evidencia de la visita</label>
    <p class="error" id="error-visita" hidden role="alert"></p>
    <button class="boton ancho">Guardar visita</button>
    <button type="button" class="enlace centro" data-accion="cerrar-hoja">Cancelar</button>
  </form>`;
}

function hojaGestores() {
  return `<div class="velo" data-accion="cerrar-hoja"></div>
  <div class="hoja"><h3>¿De quién es la ruta?</h3>
    <div class="opciones">${e.sesion.gestores
      .map((g) => `<button class="opcion boton-opcion ${g.id === e.gestorId ? "activa" : ""}" data-accion="elegir-gestor" data-id="${esc(g.id)}"><span>${esc(g.nombre)}<small>${esc(g.zona ? `Zona ${g.zona}` : "Gestor de campo")}</small></span></button>`)
      .join("")}</div>
    <button type="button" class="enlace centro" data-accion="cerrar-hoja">Cerrar</button></div>`;
}

function vistaCobro() {
  const c = e.cobro;
  const f = e.ficha.credito;
  const vencido = c.estado === "vencido";
  const medio =
    c.medio === "push"
      ? `<div class="push"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M19.5 7.5c1 1.2 1.5 2.7 1.5 4.5s-.5 3.3-1.5 4.5"/></svg>
           <p>Solicitud de cobro enviada al celular <b class="mono">••• ••• ${esc(c.telefonoFin)}</b></p></div>
         <p class="instruccion">Pide que abra la app de su banco: ahí verá la solicitud de cobro CoDi para autorizarla.</p>`
      : `<div class="qr ${c.simulado ? "simulado" : ""}" id="qr-cobro"></div>
         <p class="instruccion">Pide que abra la app de su banco, entre a <b>CoDi</b> y escanee este código.</p>`;
  return `${barra("Cobro en curso", { volver: true })}${cinta()}
    <section class="cobro">
      <p class="cobro-monto monto">${pesos(c.montoCentavos)}</p>
      <p class="cobro-quien">${esc(f.acreditado)} · Crédito ${esc(f.id)} · folio <span class="mono">${esc(c.folio)}</span></p>
      ${
        vencido
          ? '<div class="vencido"><b>Este cobro venció.</b><p>Genera uno nuevo para volver a intentarlo.</p></div><button class="boton ancho" data-accion="hoja-cobrar">Generar otro cobro</button>'
          : `${medio}
             <div class="esperando"><span class="pulso vivo"></span><b>Esperando el pago…</b><span class="cuenta" id="cuenta"></span></div>
             <div class="dos">
               <button class="boton suave" data-accion="compartir">Enviar link de pago</button>
               ${c.medio === "qr" ? '<button class="boton suave" data-accion="descargar">Guardar QR</button>' : '<button class="boton suave" data-accion="copiar-link">Copiar link</button>'}
             </div>
             ${e.sesion.simulacion ? '<button class="boton verde ancho" data-accion="simular">Simular que ya pagó</button><p class="nota centro">El pago simulado llega como un aviso firmado, por el mismo camino que uno real.</p>' : ""}
             <p class="nota centro">Su banco le mostrará el beneficiario y el monto antes de autorizar. El dinero llega directo a la cuenta de la financiera.</p>`
      }
    </section>`;
}

function vistaPagado() {
  const r = e.recibo;
  const f = e.ficha.credito;
  const ultima = r.cuotas.at(-1);
  const aplicado = !ultima
    ? "Pago recibido. Queda por revisar en el portal."
    : ultima.liquida && r.restaCuotaCentavos === 0
      ? `Cuota${r.cuotas.length > 1 ? "s" : ""} ${r.cuotas.map((q) => q.numero).join(" y ")} pagada${r.cuotas.length > 1 ? "s" : ""} completa${r.cuotas.length > 1 ? "s" : ""}`
      : `Abono a la cuota ${ultima.numero} · faltan ${pesos(r.restaCuotaCentavos)}`;
  return `${barra("Ruta de hoy", { derecha: e.ruta ? `<span class="barra-progreso">${e.ruta.resumen.hechas} de ${e.ruta.resumen.total}</span>` : "" })}${cinta()}
    <section class="pagado">
      <div class="palomita">${palomita}</div>
      <h2>Pagado</h2>
      <p class="pagado-monto monto">${pesos(r.montoCentavos)} con CoDi · ${esc(hora(r.fecha))}</p>
      <p class="pagado-quien">${esc(f.acreditado)} · Crédito ${esc(f.id)}</p>
      <dl class="recibo">
        <div><dt>Aplicado</dt><dd>${esc(aplicado)}</dd></div>
        <div><dt>Clave de rastreo</dt><dd class="mono">${esc(r.claveRastreo ?? "—")}</dd></div>
        ${r.banco ? `<div><dt>Banco de origen</dt><dd>${esc(r.banco)}</dd></div>` : ""}
      </dl>
      ${r.origen !== "codi" ? '<p class="nota centro">Pago simulado: no se movió dinero real.</p>' : ""}
      <button class="boton ancho" data-accion="siguiente">Siguiente visita</button>
      <button class="boton secundario ancho" data-accion="compartir-recibo">Enviar recibo</button>
    </section>`;
}

// ------------------------------------------------------------------ Pintar

function pintar() {
  const vistas = { entrada: vistaEntrada, ruta: vistaRuta, ficha: vistaFicha, cobro: vistaCobro, pagado: vistaPagado };
  const hojas = { cobrar: hojaCobrar, visita: hojaVisita, gestores: hojaGestores };
  if (e.vista === "cargando") return;
  // La pantalla es la que se desplaza; las hojas se quedan fijas sobre ella, dentro del marco del teléfono.
  const mismaVista = app.dataset.vista === e.vista;
  const posicion = $(".pantalla", app)?.scrollTop ?? 0;
  app.innerHTML = `<div class="pantalla">${vistas[e.vista]()}</div>${e.hoja ? hojas[e.hoja]() : ""}`;
  app.dataset.vista = e.vista;
  $(".pantalla", app).scrollTop = mismaVista ? posicion : 0;

  clearInterval(reloj);
  if (e.vista === "cobro" && e.cobro.estado === "pendiente") {
    const qr = $("#qr-cobro");
    if (qr && e.cobro.qrString) qr.innerHTML = svgQr(e.cobro.qrString);
    const cuenta = () => {
      const faltan = Math.max(0, Math.floor((Date.parse(e.cobro.venceEn) - Date.now()) / 1000));
      const el = $("#cuenta");
      if (el) el.textContent = `Vigente ${Math.floor(faltan / 60)}:${String(faltan % 60).padStart(2, "0")}`;
      if (faltan === 0) revisarCobro();
    };
    cuenta();
    reloj = setInterval(cuenta, 1000);
  }
  if (e.hoja) $(".hoja input:not([type=radio]):not([type=checkbox]):not([hidden])")?.blur();
}

function ir(vista, hoja = null) {
  e.vista = vista;
  e.hoja = hoja;
  e.error = "";
  if (vista !== "cobro") clearInterval(vigilancia);
  pintar();
}

// ------------------------------------------------------------------ Datos

async function cargarRuta({ silencio = false } = {}) {
  try {
    e.ruta = await api(`/api/app/ruta?gestor=${encodeURIComponent(e.gestorId)}`);
    e.rutaGuardada = false;
    guardar(LLAVE.ruta, { gestorId: e.gestorId, ruta: e.ruta });
  } catch (error) {
    if (error.status === 404 && e.sesion.gestores.length) {
      // El gestor guardado ya no existe (por ejemplo, se cargó otra cartera): se usa el primero.
      e.gestorId = e.sesion.gestores[0].id;
      guardar(LLAVE.gestor, e.gestorId);
      return cargarRuta({ silencio });
    }
    if (error.status === 401) return salir("Tu clave ya no es válida. Entra de nuevo.");
    const guardada = leer(LLAVE.ruta, null);
    if (error.status === 0 && guardada?.gestorId === e.gestorId) {
      e.ruta = guardada.ruta;
      e.rutaGuardada = true;
    } else if (!silencio) aviso(error.message, "mal");
  }
  if (e.vista === "ruta" || e.vista === "pagado") pintar();
}

async function abrirFicha(id) {
  e.ficha = null;
  ir("ficha");
  try {
    e.ficha = await api(`/api/app/creditos/${encodeURIComponent(id)}`);
    pintar();
  } catch (error) {
    aviso(error.message, "mal");
    ir("ruta");
  }
}

function abrirCanal() {
  canal?.cerrar();
  canal = enVivo(
    async () => direccionWs(`/api/app/en-vivo?canal=gestor&boleto=${(await api("/api/app/boleto?canal=gestor")).boleto}`),
    (m) => {
      if (m.tipo === "pago" && e.cobro && m.cobroId === e.cobro.id && e.vista === "cobro") return revisarCobro();
      if (m.tipo === "pago" && m.gestorId === e.gestorId && e.vista === "ruta") {
        aviso(`Pago recibido: ${pesos(m.montoCentavos)} · ${m.acreditado ?? "Crédito " + m.creditoId}`, "bien");
        cargarRuta({ silencio: true });
      }
    },
  );
}

async function entrar(clave) {
  e.clave = clave.trim();
  e.ocupado = true;
  e.error = "";
  pintar();
  try {
    e.sesion = await api("/api/app/sesion");
    guardar(LLAVE.clave, e.clave);
    if (!e.sesion.gestores.some((g) => g.id === e.gestorId)) e.gestorId = e.sesion.gestores[0]?.id ?? "g1";
    e.ocupado = false;
    ir("ruta");
    abrirCanal();
    await cargarRuta();
    enviarCola();
  } catch (error) {
    e.ocupado = false;
    e.clave = "";
    e.error = error.status === 401 ? "Esa clave no es correcta." : error.message;
    e.vista = "entrada";
    pintar();
  }
}

function salir(mensaje = "") {
  canal?.cerrar();
  clearInterval(vigilancia);
  e.clave = "";
  e.sesion = null;
  e.ruta = null;
  e.ficha = null;
  e.cobro = null;
  try {
    localStorage.removeItem(LLAVE.clave);
    localStorage.removeItem(LLAVE.ruta);
  } catch {
    // nada que borrar
  }
  ir("entrada");
  e.error = mensaje;
  pintar();
}

// ------------------------------------------------------------------ Cobro

function aCentavos(texto) {
  const limpio = String(texto).replace(/[\s$,]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(limpio) ? Math.round(Number(limpio) * 100) : null;
}

function errorDeHoja(id, mensaje) {
  const el = $(id);
  el.textContent = mensaje;
  el.hidden = false;
  el.scrollIntoView({ block: "nearest" });
}

async function generarCobro(forma) {
  const datos = new FormData(forma);
  const elegido = forma.querySelector('input[name="monto"]:checked');
  const montoCentavos = elegido?.value === "otro" ? aCentavos(datos.get("otro")) : Number(elegido?.dataset.centavos);
  if (!montoCentavos) return errorDeHoja("#error-cobro", "Escribe un monto mayor que cero, por ejemplo 150.00.");
  const medio = datos.get("medio");
  const boton = forma.querySelector("button.boton");
  boton.disabled = true;
  boton.textContent = medio === "push" ? "Enviando a su celular…" : "Generando QR…";
  try {
    const r = await api("/api/app/cobros", { cuerpo: { creditoId: e.ficha.credito.id, montoCentavos, medio, telefono: datos.get("telefono") } });
    e.cobro = r.cobro;
    e.linkPago = r.linkPago;
    ir("cobro");
    clearInterval(vigilancia);
    vigilancia = setInterval(revisarCobro, 3000); // por si el aviso en vivo no llega
  } catch (error) {
    boton.disabled = false;
    boton.textContent = "Generar cobro";
    errorDeHoja("#error-cobro", error.message);
  }
}

let revisando = false;
async function revisarCobro() {
  if (revisando || !e.cobro || e.vista !== "cobro") return;
  revisando = true;
  try {
    const r = await api(`/api/app/cobros/${e.cobro.id}`);
    if (r.cobro.estado === "pagado" && r.recibo) {
      clearInterval(vigilancia);
      e.cobro = r.cobro;
      e.recibo = r.recibo;
      sonarPagado();
      ir("pagado");
      cargarRuta({ silencio: true });
    } else if (r.cobro.estado !== e.cobro.estado) {
      e.cobro = r.cobro;
      if (r.cobro.estado === "vencido") clearInterval(vigilancia);
      pintar();
    }
  } catch {
    // sin señal: se vuelve a intentar en la siguiente vuelta
  } finally {
    revisando = false;
  }
}

async function compartir(titulo, texto, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title: titulo, text: texto, url });
      return;
    } catch {
      // la persona cerró el menú de compartir
    }
  }
  aviso((await copiar(url)) ? "Link copiado. Pégalo en WhatsApp o SMS." : url, "bien");
}

// ------------------------------------------------------------------ Visitas (con cola sin conexión)

function ubicacion() {
  return new Promise((resolver) => {
    if (!navigator.geolocation) return resolver(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ latitud: p.coords.latitude, longitud: p.coords.longitude }),
      () => resolver(null),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}

async function guardarVisita(forma) {
  const datos = new FormData(forma);
  const resultado = datos.get("resultado");
  const visita = { creditoId: e.ficha.credito.id, resultado, nota: String(datos.get("nota") ?? "") };
  if (resultado === "promesa") {
    visita.promesaFecha = datos.get("promesaFecha");
    visita.promesaCentavos = aCentavos(datos.get("promesaMonto"));
    if (!visita.promesaCentavos) return errorDeHoja("#error-visita", "Escribe cuánto prometió pagar.");
  }
  if (resultado === "otro" && !visita.nota.trim()) return errorDeHoja("#error-visita", "Escribe una nota que explique qué pasó.");
  const boton = forma.querySelector("button.boton");
  boton.disabled = true;
  boton.textContent = "Guardando…";
  if (datos.get("ubicacion")) Object.assign(visita, (await ubicacion()) ?? {});

  try {
    await api("/api/app/gestiones", { cuerpo: visita });
    aviso("Visita guardada.", "bien");
  } catch (error) {
    if (error.status !== 0) {
      boton.disabled = false;
      boton.textContent = "Guardar visita";
      return errorDeHoja("#error-visita", error.message);
    }
    e.cola.push(visita);
    guardar(LLAVE.cola, e.cola);
    aviso("Sin señal. Guardamos la visita y la enviamos al reconectar.");
  }
  e.hoja = null;
  await abrirFichaSilenciosa();
  cargarRuta({ silencio: true });
}

async function abrirFichaSilenciosa() {
  try {
    e.ficha = await api(`/api/app/creditos/${encodeURIComponent(e.ficha.credito.id)}`);
  } catch {
    // se queda la ficha que ya estaba en pantalla
  }
  pintar();
}

let enviando = false;
async function enviarCola() {
  if (enviando || !e.cola.length || !e.sesion) return;
  enviando = true;
  const pendientes = [...e.cola];
  let enviadas = 0;
  for (const visita of pendientes) {
    try {
      await api("/api/app/gestiones", { cuerpo: visita });
      enviadas++;
    } catch (error) {
      if (error.status === 0) break; // sigue sin señal: se intenta después
      // el servidor la rechazó (por ejemplo, el crédito ya no existe): no tiene caso reintentar
    }
    e.cola = e.cola.filter((v) => v !== visita);
    guardar(LLAVE.cola, e.cola);
  }
  enviando = false;
  if (enviadas) {
    aviso(`${plural(enviadas, "visita enviada", "visitas enviadas")}.`, "bien");
    cargarRuta({ silencio: true });
  }
  if (e.vista === "ruta") pintar();
}

// ------------------------------------------------------------------ Eventos

const acciones = {
  "entrar-demo": () => entrar("demo"),
  actualizar: async () => {
    await cargarRuta();
    aviso(e.rutaGuardada ? "Sin conexión: sigue la última ruta guardada." : "Ruta actualizada.");
  },
  salir: () => salir(),
  abrir: (el) => abrirFicha(el.dataset.id),
  volver: () => {
    if (e.vista === "cobro") return ir("ficha"), abrirFichaSilenciosa();
    ir("ruta");
    cargarRuta({ silencio: true });
  },
  gestores: () => ((e.hoja = "gestores"), pintar()),
  "elegir-gestor": (el) => {
    e.gestorId = el.dataset.id;
    guardar(LLAVE.gestor, e.gestorId);
    e.ruta = null;
    ir("ruta");
    cargarRuta();
  },
  "hoja-cobrar": () => ir("ficha", "cobrar"),
  "hoja-visita": () => ((e.hoja = "visita"), pintar()),
  "cerrar-hoja": () => ((e.hoja = null), pintar()),
  compartir: () => compartir("Link de pago", `Paga aquí tu abono de ${pesos(e.cobro.montoCentavos)} con CoDi, sin comisión:`, e.linkPago),
  "copiar-link": async () => aviso((await copiar(e.linkPago)) ? "Link de pago copiado." : e.linkPago, "bien"),
  descargar: () => descargarPng(e.cobro.qrString, `qadra-cobro-${e.cobro.folio}.png`),
  simular: async (el) => {
    el.disabled = true;
    el.textContent = "Simulando el pago…";
    try {
      await api("/api/app/simular", { cuerpo: { tipo: "cobro", cobroId: e.cobro.id } });
      revisarCobro();
    } catch (error) {
      aviso(error.message, "mal");
      el.disabled = false;
      el.textContent = "Simular que ya pagó";
    }
  },
  siguiente: () => {
    const siguiente = e.ruta?.visitas.find((v) => v.visita === "pendiente");
    if (siguiente) return abrirFicha(siguiente.creditoId);
    ir("ruta");
    aviso("Ruta terminada. Buen trabajo.", "bien");
  },
  "compartir-recibo": () => compartir("Recibo de pago", `Recibo de tu pago de ${pesos(e.recibo.montoCentavos)}:`, `${location.origin}/pagar/?c=${e.cobro.token}`),
};

app.addEventListener("click", (evento) => {
  const el = evento.target.closest("[data-accion]");
  if (!el) return;
  acciones[el.dataset.accion]?.(el);
});

app.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const forma = evento.target;
  if (forma.id === "f-entrada") entrar(new FormData(forma).get("clave") ?? "");
  if (forma.id === "f-cobro") generarCobro(forma);
  if (forma.id === "f-visita") guardarVisita(forma);
});

app.addEventListener("change", (evento) => {
  const el = evento.target;
  if (el.name === "medio") $("#campo-celular").hidden = el.value !== "push";
  if (el.name === "resultado") $("#campos-promesa").hidden = el.value !== "promesa";
});

app.addEventListener("focusin", (evento) => {
  if (evento.target.classList?.contains("otro-monto")) evento.target.closest("label").querySelector('input[type="radio"]').checked = true;
});

window.addEventListener("online", () => {
  e.enLinea = true;
  if (e.sesion) {
    cargarRuta({ silencio: true });
    enviarCola();
  }
});
window.addEventListener("offline", () => {
  e.enLinea = false;
  if (e.sesion) pintar();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && e.sesion && e.vista === "ruta") cargarRuta({ silencio: true });
});

// ------------------------------------------------------------------ Arranque

async function iniciar() {
  $("#lado-marca").innerHTML = `${isotipo(34, { claro: true })}<span><b>Qadra</b><small>Cobranza Inteligente</small></span>`;
  $("#lado-qr").innerHTML = svgQr(`${location.origin}/gestor/`);
  try {
    e.publico = await crearApi()("/api/estado");
  } catch {
    e.publico = null;
  }
  if (e.clave) return entrar(e.clave);
  ir("entrada");
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/gestor/sw.js").catch(() => {});
iniciar();
