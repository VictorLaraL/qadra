// App del gestor de campo: ruta del día, ficha del crédito, cobro con CoDi y visita registrada.
// Una sola página; lo que se ve depende de `e.vista`. Los datos vienen de /api/app (ver src/worker/app.ts).

import { $, aviso, copiar, crearApi, diaLargo, direccionWs, enVivo, esc, hora, isotipo, NOMBRE_DE_VISITA, PALOMITA, pesos, plural, situacion, sonarPagado } from "/comun.js";
import { descargarPng, svgQr } from "/qr.js";
import { aCentavos, cuotasPagadas, destinoDeVisitaEnCola, esDeOtraSesion, estadoDeCuota } from "/reglas.js";

const app = $("#app");

// ------------------------------------------------------------------ Memoria del teléfono
// La sesión y la ruta se guardan para poder abrir la app sin señal; la cola son las visitas que faltan por enviar.
const LLAVE = { clave: "qadra.clave", gestor: "qadra.gestor", cola: "qadra.cola", ruta: "qadra.ruta", sesion: "qadra.sesion" };
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
  sesionGuardada: false, // true = la app abrió sin señal con la última sesión guardada en el teléfono
  gestorId: leer(LLAVE.gestor, "g1"),
  ruta: null,
  rutaGuardada: false, // true = se está mostrando la última ruta guardada, sin conexión
  errorDeRuta: "", // por qué no hay ruta que mostrar (sin señal y sin ruta guardada, por ejemplo)
  ficha: null,
  cobro: null,
  linkPago: "",
  recibo: null,
  enLinea: navigator.onLine,
  // Visitas registradas sin conexión, por enviar. Cada una lleva la huella de la clave que la guardó (nunca la clave):
  // en un teléfono compartido solo se envían solas las de quien está en sesión. Las de versiones anteriores no traen dueño.
  cola: leer(LLAVE.cola, []).map((x) => (x?.visita ? x : { dueno: "", visita: x })),
  huellaDeClave: "", // huella de la clave en sesión, para saber cuáles visitas de la cola son suyas
  error: "",
  ocupado: false,
};

const api = crearApi(() => e.clave);
let canal = null;
let vigilancia = 0;
let reloj = 0;

// ------------------------------------------------------------------ Piezas de pantalla
const flecha = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
// Con tope de demo los cobros son reales: se ofrece el abono más chico que acepta CoDi, para probar sin gastar.
const ABONO_DE_PRUEBA_CENTAVOS = 1;

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

const visitasMias = () => e.cola.filter((x) => !esDeOtraSesion(x.dueno, e.huellaDeClave));
const visitasAjenas = () => e.cola.filter((x) => esDeOtraSesion(x.dueno, e.huellaDeClave));

function avisosDeEstado() {
  const partes = [];
  if (!e.enLinea) partes.push('<div class="franja">Sin conexión. Lo que registres se envía al reconectar.</div>');
  else if (e.rutaGuardada) partes.push('<div class="franja">Mostrando la última ruta guardada.</div>');
  else if (e.sesionGuardada) partes.push('<div class="franja">El servidor no responde: la app trabaja con lo guardado en este teléfono.</div>');
  const mias = visitasMias().length;
  const ajenas = visitasAjenas().length;
  if (mias) partes.push(`<div class="franja azul">${plural(mias, "visita", "visitas")} por enviar.</div>`);
  if (ajenas) {
    partes.push(
      `<div class="franja azul">${ajenas === 1 ? "1 visita guardada" : `${ajenas} visitas guardadas`} con otra clave en este teléfono. <button class="enlace" data-accion="revisar-cola">Revisar</button></div>`,
    );
  }
  const h = e.sesion?.horario;
  // Con la sesión guardada no se sabe la hora del servidor: el aviso de horario se muestra solo con datos frescos.
  if (h && !h.dentro && !e.sesionGuardada) {
    partes.push(
      `<div class="franja">Fuera del horario de gestión (${h.desde}:00 a ${h.hasta}:00). ${h.estricto ? "No se pueden registrar cobros ni visitas." : "En la demo puedes continuar; en operación se bloquea."}</div>`,
    );
  }
  return `<div id="estado">${partes.join("")}</div>`;
}

/**
 * Actualiza solo las franjas de estado, sin volver a dibujar la pantalla: si se va la señal mientras el gestor llena
 * una visita, lo que lleva escrito no se pierde.
 */
function refrescarEstado() {
  const el = $("#estado");
  if (el) el.outerHTML = avisosDeEstado();
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
  if (!r) {
    const cuerpo = e.errorDeRuta
      ? `<div class="vacio"><p>${esc(e.errorDeRuta)}</p>
           <p><button class="boton chico" data-accion="actualizar">Reintentar</button> <button class="enlace" data-accion="salir">Salir</button></p></div>`
      : '<p class="cargando">Cargando tu ruta…</p>';
    return barra("Ruta de hoy") + cinta() + avisosDeEstado() + cuerpo;
  }
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
      const { clase, texto } = estadoDeCuota(c, hoy);
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
  const h = e.sesion.horario; // el horario de gestión lo dicta el servidor: aquí solo se repite
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
    <p class="regla">Solo se contacta al titular del crédito${h ? `, de ${h.desde}:00 a ${h.hasta}:00` : ""}. Nunca a familiares, vecinos ni referencias.</p>`;
}

function opcionesDeMonto() {
  const est = e.ficha.credito.estado;
  const tope = e.sesion.topeCentavos;
  const lista = [];
  if (tope > 0) lista.push({ id: "prueba", nombre: "Abono de prueba", centavos: ABONO_DE_PRUEBA_CENTAVOS });
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

/** Visitas que guardó otra clave en este teléfono: quien entró decide si son suyas (se envían) o se borran. */
function hojaColaAjena() {
  const n = visitasAjenas().length;
  return `<div class="velo" data-accion="cerrar-hoja"></div>
  <div class="hoja" role="dialog" aria-label="Visitas guardadas con otra clave"><h3>${n === 1 ? "Hay 1 visita guardada con otra clave" : `Hay ${n} visitas guardadas con otra clave`}</h3>
    <p class="nota">Se registraron en este teléfono, sin conexión, con una clave distinta a la tuya. Si son tuyas (por ejemplo, te cambiaron la clave), envíalas. Si son de otra persona, no las envíes con tu clave.</p>
    <button class="boton ancho" data-accion="adoptar-cola">Son mías: enviarlas</button>
    <button type="button" class="boton secundario ancho" data-accion="borrar-cola-ajena">No son mías: borrarlas</button>
    <button type="button" class="enlace centro" data-accion="cerrar-hoja">Decidir después</button></div>`;
}

/** Salir con visitas sin enviar: la persona decide si se queda (se envían solas) o si sale y se borran. */
function hojaSalida() {
  const n = visitasMias().length;
  return `<div class="velo" data-accion="cerrar-hoja"></div>
  <div class="hoja" role="dialog" aria-label="Visitas sin enviar"><h3>${n === 1 ? "Hay 1 visita sin enviar" : `Hay ${n} visitas sin enviar`}</h3>
    <p class="nota">No se pudieron enviar en este momento. Si te quedas, se envían solas al recuperar la señal. Si sales, se borran de este teléfono para que no las envíe la siguiente persona que lo use.</p>
    <button class="boton ancho" data-accion="cerrar-hoja">Quedarme</button>
    <button type="button" class="enlace centro" data-accion="salir-borrando">Salir y borrar ${n === 1 ? "la visita" : "las visitas"}</button></div>`;
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
      ? cuotasPagadas(r.cuotas.map((q) => q.numero))
      : `Abono a la cuota ${ultima.numero} · faltan ${pesos(r.restaCuotaCentavos)}`;
  return `${barra("Ruta de hoy", { derecha: e.ruta ? `<span class="barra-progreso">${e.ruta.resumen.hechas} de ${e.ruta.resumen.total}</span>` : "" })}${cinta()}
    <section class="pagado">
      <div class="palomita">${PALOMITA}</div>
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
  const hojas = { cobrar: hojaCobrar, visita: hojaVisita, gestores: hojaGestores, salida: hojaSalida, "cola-ajena": hojaColaAjena };
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

const CLAVE_VENCIDA = "Tu clave ya no es válida. Entra de nuevo.";

let turnoDeRuta = 0; // cada carga de la ruta toma un turno: solo la más reciente puede pintar
let rutaEnCurso = Promise.resolve("fallo");

/**
 * Carga la ruta del gestor elegido. Promete cómo le fue:
 * "ok" (ruta fresca), "guardada" (sin conexión: se muestra la última), "fallo" o "relevada" (otra carga más nueva
 * tomó su lugar, o la sesión se cerró mientras tanto).
 */
function cargarRuta(opciones) {
  rutaEnCurso = pedirRuta(opciones);
  return rutaEnCurso;
}

async function pedirRuta({ silencio = false, reintento = false } = {}) {
  const turno = ++turnoDeRuta;
  const gestorId = e.gestorId;
  let resultado = "fallo";
  try {
    const ruta = await api(`/api/app/ruta?gestor=${encodeURIComponent(gestorId)}`);
    if (turno !== turnoDeRuta || !e.sesion) return "relevada";
    e.ruta = ruta;
    e.rutaGuardada = false;
    e.errorDeRuta = "";
    guardar(LLAVE.ruta, { gestorId, ruta });
    resultado = "ok";
  } catch (error) {
    if (turno !== turnoDeRuta || !e.sesion) return "relevada";
    if (error.status === 401) {
      salir(CLAVE_VENCIDA);
      return "fallo";
    }
    const primero = e.sesion.gestores[0]?.id;
    if (error.status === 404 && !reintento && primero && primero !== gestorId) {
      // El gestor guardado ya no existe (por ejemplo, se cargó otra cartera): se usa el primero, y solo una vez.
      e.gestorId = primero;
      guardar(LLAVE.gestor, primero);
      return pedirRuta({ silencio, reintento: true });
    }
    const guardada = leer(LLAVE.ruta, null);
    if (error.status === 0 && guardada?.gestorId === gestorId) {
      e.ruta = guardada.ruta;
      e.rutaGuardada = true;
      e.errorDeRuta = "";
      resultado = "guardada";
    } else {
      if (!e.ruta) e.errorDeRuta = error.status === 0 ? "Sin conexión, y este teléfono no tiene guardada la ruta de este gestor." : error.message;
      if (!silencio) aviso(error.message, "mal");
    }
  }
  if (e.vista === "ruta" || e.vista === "pagado") pintar();
  return resultado;
}

let fichaPedida = "";
async function abrirFicha(id) {
  e.ficha = null;
  fichaPedida = id;
  ir("ficha");
  // Si la persona regresa y abre otro crédito, la respuesta de este ya no aplica.
  const sigueAqui = () => e.vista === "ficha" && e.ficha === null && fichaPedida === id;
  try {
    const ficha = await api(`/api/app/creditos/${encodeURIComponent(id)}`);
    if (!sigueAqui()) return;
    e.ficha = ficha;
    pintar();
  } catch (error) {
    if (!sigueAqui()) return;
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
    e.sesionGuardada = false;
    guardar(LLAVE.clave, e.clave);
    guardar(LLAVE.sesion, e.sesion);
  } catch (error) {
    // Sin señal al abrir la app: si este teléfono ya había entrado con esta misma clave, se trabaja con lo guardado
    // (la ruta sale de la memoria del teléfono y las visitas se van a la cola).
    const guardada = error.status === 0 && e.clave && e.clave === leer(LLAVE.clave, "") ? leer(LLAVE.sesion, null) : null;
    if (!guardada?.gestores) {
      if (error.status === 401) olvidarSesion(); // la clave guardada dejó de servir: no se vuelve a intentar sola
      e.ocupado = false;
      e.clave = "";
      e.error = error.status === 401 ? "Esa clave no es correcta." : error.message;
      e.vista = "entrada";
      return pintar();
    }
    e.sesion = guardada;
    e.sesionGuardada = true;
  }
  if (!e.sesion.gestores.some((g) => g.id === e.gestorId)) e.gestorId = e.sesion.gestores[0]?.id ?? "g1";
  e.huellaDeClave = await huellaDe(e.clave);
  e.ocupado = false;
  ir("ruta");
  abrirCanal();
  await cargarRuta({ silencio: e.sesionGuardada });
  if (!e.sesion) return;
  enviarCola(); // solo salen las visitas que guardó esta misma clave
  if (visitasAjenas().length && e.vista === "ruta" && !e.hoja) {
    e.hoja = "cola-ajena"; // las de otra clave se le preguntan a quien entró
    pintar();
  }
}

/**
 * Huella de la clave para marcar de quién es cada visita de la cola sin guardar la clave: los primeros 16 caracteres
 * de su SHA-256. Si el navegador no puede calcularla regresa "", y entonces ninguna visita se da por propia.
 */
async function huellaDe(clave) {
  try {
    const resumen = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qadra.cola:${clave}`));
    return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return "";
  }
}

/** Al volver la señal se pide la sesión otra vez: la guardada puede ser de ayer (fecha, horario, gestores). */
async function refrescarSesion() {
  try {
    const sesion = await api("/api/app/sesion");
    if (!e.sesion) return;
    e.sesion = sesion;
    e.sesionGuardada = false;
    guardar(LLAVE.sesion, sesion);
  } catch (error) {
    if (error.status === 401 && e.sesion) salir(CLAVE_VENCIDA);
  }
}

function olvidarSesion() {
  try {
    for (const llave of [LLAVE.clave, LLAVE.sesion, LLAVE.ruta]) localStorage.removeItem(llave);
  } catch {
    // nada que borrar
  }
}

/**
 * Cierra la sesión y borra del teléfono la clave, la sesión y la ruta. La cola de visitas no se toca aquí:
 * - en una salida forzada (la clave dejó de servir) se conserva, porque la misma persona vuelve a entrar y son evidencia
 *   de su trabajo;
 * - en la salida que pide la persona, cerrarSesion ya la envió o le preguntó antes de borrarla.
 */
function salir(mensaje = "") {
  canal?.cerrar();
  clearInterval(vigilancia);
  turnoDeRuta++; // lo que venga en camino ya no se pinta
  Object.assign(e, { clave: "", huellaDeClave: "", sesion: null, sesionGuardada: false, ruta: null, rutaGuardada: false, errorDeRuta: "", ficha: null, cobro: null, recibo: null, linkPago: "" });
  olvidarSesion();
  ir("entrada");
  e.error = mensaje;
  pintar();
}

/**
 * La salida que pide la persona. Antes se intenta mandar lo que esté en la cola; si algo no se pudo enviar, se le
 * pregunta: en un teléfono compartido, las visitas de una persona no deben salir con la clave de la siguiente.
 */
async function cerrarSesion() {
  await enviarCola();
  if (!e.sesion) return; // la sesión se cerró sola mientras se enviaba (clave vencida)
  if (visitasMias().length) {
    e.hoja = "salida";
    return pintar();
  }
  salir();
}

/** Guarda la cola en el teléfono tal como quedó. */
function guardarCola(cola) {
  e.cola = cola;
  guardar(LLAVE.cola, e.cola);
}

function salirBorrandoLaCola() {
  guardarCola(visitasAjenas()); // solo se borran las propias; las de otra clave las decide su dueño
  salir();
}

/** Quien entró dice que las visitas guardadas con otra clave son suyas: pasan a su nombre y se envían. */
function adoptarColaAjena() {
  guardarCola(e.cola.map((x) => (esDeOtraSesion(x.dueno, e.huellaDeClave) ? { ...x, dueno: e.huellaDeClave } : x)));
  e.hoja = null;
  pintar();
  if (visitasAjenas().length) return aviso("Este navegador no pudo comprobar tu clave: las visitas siguen guardadas.", "mal");
  enviarCola();
}

function borrarColaAjena() {
  const borradas = visitasAjenas().length;
  guardarCola(visitasMias());
  e.hoja = null;
  pintar();
  aviso(borradas === 1 ? "Se borró 1 visita guardada con otra clave." : `Se borraron ${borradas} visitas guardadas con otra clave.`);
}

// ------------------------------------------------------------------ Cobro

function errorDeHoja(id, mensaje) {
  const el = $(id);
  if (!el) return aviso(mensaje, "mal"); // la hoja ya se cerró: el error se dice de todos modos
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
  const creditoId = e.ficha.credito.id;
  const boton = forma.querySelector("button.boton");
  boton.disabled = true;
  boton.textContent = medio === "push" ? "Enviando a su celular…" : "Generando QR…";
  try {
    const r = await api("/api/app/cobros", { cuerpo: { creditoId, montoCentavos, medio, telefono: datos.get("telefono") } });
    if (e.vista !== "ficha" || e.ficha?.credito.id !== creditoId) {
      // La persona se fue a otra pantalla mientras se creaba: el cobro existe, así que se le avisa en vez de imponérselo.
      if (e.sesion) aviso(`El cobro del crédito ${creditoId} se generó (folio ${r.cobro.folio}). Ábrelo de nuevo para cobrarlo.`);
      return;
    }
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
  const id = e.cobro.id;
  try {
    const r = await api(`/api/app/cobros/${id}`);
    // Mientras llegaba la respuesta la persona pudo salir de este cobro o generar otro: esa respuesta ya no aplica.
    if (e.vista !== "cobro" || e.cobro?.id !== id) return;
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
    guardarCola([...e.cola, { dueno: e.huellaDeClave, visita }]);
    aviso("Sin señal. Guardamos la visita y la enviamos al reconectar.");
  }
  if (!e.sesion) return;
  // La hoja solo se cierra si la persona sigue en el crédito de esta visita.
  if (e.vista === "ficha" && e.ficha?.credito.id === visita.creditoId) {
    e.hoja = null;
    await abrirFichaSilenciosa();
  }
  if (e.sesion) cargarRuta({ silencio: true });
}

/** Pone al día la ficha abierta sin avisar si falla. No pisa otra ficha ni una hoja que la persona esté llenando. */
async function abrirFichaSilenciosa() {
  const id = e.ficha?.credito.id;
  if (!id) return;
  try {
    const ficha = await api(`/api/app/creditos/${encodeURIComponent(id)}`);
    if (e.ficha?.credito.id === id) e.ficha = ficha;
  } catch {
    // se queda la ficha que ya estaba en pantalla
  }
  if (e.vista === "ficha" && !e.hoja) pintar();
}

let envioEnCurso = null;
/**
 * Manda las visitas guardadas sin conexión por la clave que está en sesión (las de otra clave no salen solas).
 * Si ya hay un envío en curso, promete ese mismo.
 */
function enviarCola() {
  if (!e.sesion || !visitasMias().length) return Promise.resolve();
  envioEnCurso ??= vaciarCola().finally(() => (envioEnCurso = null));
  return envioEnCurso;
}

async function vaciarCola() {
  let enviadas = 0;
  let rechazadas = 0;
  let claveVencida = false;
  for (const guardada of visitasMias()) {
    try {
      await api("/api/app/gestiones", { cuerpo: guardada.visita });
      enviadas++;
    } catch (error) {
      // Qué se hace con la visita y con el resto de la cola lo dice una sola regla (web/reglas.js).
      const destino = destinoDeVisitaEnCola(error.status);
      claveVencida ||= destino.claveVencida;
      if (destino.conservar) {
        if (destino.seguir) continue;
        break;
      }
      rechazadas++; // el servidor dijo que no es válida (o el crédito ya no existe): reintentar no la arregla
    }
    guardarCola(e.cola.filter((x) => x !== guardada));
  }
  if (enviadas) aviso(`${plural(enviadas, "visita enviada", "visitas enviadas")}.`, "bien");
  if (rechazadas) aviso(rechazadas === 1 ? "El servidor rechazó 1 visita guardada: no se registró." : `El servidor rechazó ${rechazadas} visitas guardadas: no se registraron.`, "mal");
  if (!e.sesion) return;
  if (claveVencida) return salir(`${CLAVE_VENCIDA} Tus visitas siguen guardadas en este teléfono.`);
  if (e.hoja === "salida" && !visitasMias().length) e.hoja = null; // ya no hay nada que preguntar antes de salir
  if (enviadas) cargarRuta({ silencio: true });
  if (e.vista === "ruta") pintar();
  else refrescarEstado();
}

// ------------------------------------------------------------------ Eventos

const acciones = {
  "entrar-demo": () => entrar("demo"),
  actualizar: async (el) => {
    el.disabled = true;
    if (e.sesionGuardada) await refrescarSesion();
    if (!e.sesion) return;
    const resultado = await cargarRuta();
    // Si falló, cargarRuta ya dijo por qué: aquí solo se confirma lo que sí pasó.
    if (resultado === "ok") aviso("Ruta actualizada.", "bien");
    if (resultado === "guardada") aviso("Sin conexión: sigue la última ruta guardada.");
    if (el.isConnected) el.disabled = false;
    if (e.sesion) enviarCola();
  },
  salir: (el) => {
    el.disabled = true;
    cerrarSesion();
  },
  "salir-borrando": salirBorrandoLaCola,
  "revisar-cola": () => ((e.hoja = "cola-ajena"), pintar()),
  "adoptar-cola": adoptarColaAjena,
  "borrar-cola-ajena": borrarColaAjena,
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
    Object.assign(e, { ruta: null, rutaGuardada: false, errorDeRuta: "" });
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
  siguiente: async (el) => {
    el.disabled = true;
    await rutaEnCurso; // la ruta se está poniendo al día con el pago recién recibido
    if (e.vista !== "pagado") return;
    // Si la ruta no alcanzó a actualizarse (sin señal), al menos no se regresa al crédito que se acaba de cobrar.
    const cobrado = e.ficha?.credito.id;
    const siguiente = e.ruta?.visitas.find((v) => v.visita === "pendiente" && v.creditoId !== cobrado);
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

window.addEventListener("online", async () => {
  e.enLinea = true;
  if (!e.sesion) return;
  refrescarEstado();
  await refrescarSesion();
  if (!e.sesion) return;
  cargarRuta({ silencio: true });
  enviarCola();
});
window.addEventListener("offline", () => {
  e.enLinea = false;
  if (!e.sesion) return;
  // Con una hoja abierta solo cambian las franjas: no se borra lo que el gestor lleva escrito.
  if (e.hoja) refrescarEstado();
  else pintar();
});
document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !e.sesion) return;
  if (e.sesionGuardada) await refrescarSesion();
  if (e.sesion && e.vista === "ruta") cargarRuta({ silencio: true });
  if (e.sesion) enviarCola();
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
