// Portal de la financiera: resumen del día, conciliación con cuadre contra pey, cartera e integración por archivo.
// Los datos vienen de /api/app (ver src/worker/app.ts).

import { $, $$, aviso, copiar, crearApi, diaCorto, diaLargo, direccionWs, enVivo, esc, hora, isotipo, NOMBRE_DE_MEDIO, NOMBRE_DE_VISITA, pesos, plural, situacion } from "/comun.js";
import { svgQr } from "/qr.js";
import { etiquetaDeBarra } from "/reglas.js";

const LLAVE = "qadra.clave";
const RESALTADO_MS = 6000; // cuánto se resalta un pago recién llegado; igual que la animación .nuevo de portal.css
const MONTO_SIN_REFERENCIA = 38_000; // centavos de la transferencia sin referencia que se simula
const CLAVE_VENCIDA = "Tu clave ya no es válida. Entra de nuevo.";

/** Lo que el portal sabe de la cartera. Se arma de nuevo al salir, al importar y al reiniciar: no queda nada de antes. */
const datosEnBlanco = () => ({
  resumen: null,
  corte: null, // corte del día; con .pey cuando ya se comparó
  comparando: false,
  conciliacion: null,
  filtro: "", // "" | aplicado | excepcion
  paginaPagos: 1,
  cartera: null,
  buscar: "",
  situacion: "",
  paginaCartera: 1,
  ficha: null,
  archivo: null, // { nombre, texto, resultado }
  nuevos: new Set(), // pagos que acaban de llegar en vivo: se resaltan un momento
});

const e = { clave: "", sesion: null, vista: "resumen", ...datosEnBlanco() };
try {
  e.clave = JSON.parse(localStorage.getItem(LLAVE) ?? '""');
} catch {
  e.clave = "";
}

const api = crearApi(() => e.clave);
const vista = $("#vista");
const capa = $("#capa");
let canal = null;

// ------------------------------------------------------------------ Piezas

function etiquetaDeOrigen(p) {
  if (p.origen === "ejemplo") return '<span class="etiqueta lisa" title="Dato de ejemplo de otros gestores">Ejemplo</span>';
  if (p.origen === "simulado") return '<span class="etiqueta lisa espera" title="Pago simulado: no movió dinero real">Simulado</span>';
  return '<span class="etiqueta lisa bien" title="Pago CoDi real recibido por pey">CoDi real</span>';
}

function etiquetaDeEstado(p) {
  if (p.estado === "aplicado") return `<span class="etiqueta bien">${p.recuperado ? "Recuperado de pey" : p.resueltoEn ? "Aplicado a mano" : "Aplicado"}</span>`;
  return `<span class="etiqueta mal">${p.motivo === "excedente" ? "Sobrante por revisar" : "Sin identificar"}</span>`;
}

function cuotasDe(p) {
  if (!p.cuotas.length) return '<span class="nota">—</span>';
  return p.cuotas.map((c) => `Cuota ${c.numero}${c.liquida ? "" : " (abono)"}`).join(", ");
}

function paginacion(datos, accion) {
  if (datos.paginas <= 1) return "";
  return `<div class="paginas">
    <button class="boton chico secundario" data-accion="${accion}" data-pagina="${datos.pagina - 1}" ${datos.pagina <= 1 ? "disabled" : ""}>Anterior</button>
    <span>Página ${datos.pagina} de ${datos.paginas}</span>
    <button class="boton chico secundario" data-accion="${accion}" data-pagina="${datos.pagina + 1}" ${datos.pagina >= datos.paginas ? "disabled" : ""}>Siguiente</button>
  </div>`;
}

/** El cuadre del día: lo recibido es lo aplicado más lo que falta revisar, y todo coincide con lo que reporta pey. */
function cuadre() {
  const c = e.corte;
  if (!c) return '<section class="tarjeta cuadre"><p class="nota">Calculando el corte…</p></section>';
  const p = c.pey;
  let comparacion = `<div class="cuadre-pey pendiente">
      <div><b>¿Coincide con pey?</b><p class="nota">Qadra pide a pey las transacciones de hoy y las compara una por una con lo registrado.</p></div>
      <button class="boton" data-accion="comparar" ${e.comparando ? "disabled" : ""}>${e.comparando ? "Consultando a pey…" : "Comparar con pey"}</button>
    </div>`;
  if (p) {
    const detalles = [];
    for (const f of p.faltanEnQadra) {
      detalles.push(`<li><span><b class="monto">${pesos(f.montoCentavos)}</b> que pey cobró y Qadra no registró: el aviso no llegó.
        <span class="mono">${esc(f.transactionId)}</span></span>
        <button class="boton chico" data-accion="recuperar" data-tx="${esc(f.transactionId)}">Recuperar</button></li>`);
    }
    for (const f of p.faltanEnPey) detalles.push(`<li><span><b class="monto">${pesos(f.montoCentavos)}</b> que está en Qadra y pey no reporta. <span class="mono">${esc(f.transactionId)}</span></span></li>`);
    for (const f of p.montosDistintos) detalles.push(`<li><span>Montos distintos: Qadra ${pesos(f.qadraCentavos)} y pey ${pesos(f.peyCentavos)}. <span class="mono">${esc(f.transactionId)}</span></span></li>`);
    for (const id of p.repetidos) detalles.push(`<li><span>Pago repetido. <span class="mono">${esc(id)}</span></span></li>`);
    comparacion = `<div class="cuadre-pey ${p.cuadra ? "bien" : "mal"}">
        <div class="cuadre-lado"><small>${p.simulado ? "pey (libro simulado)" : "pey reporta"}</small><b class="monto">${pesos(p.pey.totalCentavos)}</b><span>${plural(p.pey.pagos, "pago", "pagos")}</span></div>
        <div class="cuadre-signo">${p.cuadra ? "=" : "≠"}</div>
        <div class="cuadre-lado"><small>Qadra registró</small><b class="monto">${pesos(p.qadra.totalCentavos)}</b><span>${plural(p.qadra.pagos, "pago", "pagos")}</span></div>
        <div class="cuadre-veredicto">${
          p.cuadra
            ? '<span class="sello bien">✓ Todo cuadra</span>'
            : `<span class="sello mal">No cuadra</span>`
        }<button class="enlace" data-accion="comparar">Volver a comparar</button></div>
      </div>
      ${detalles.length ? `<ul class="cuadre-detalles">${detalles.join("")}</ul>` : ""}
      ${p.completo ? "" : '<p class="nota">pey tiene más movimientos de los que se pudieron leer: la comparación es parcial.</p>'}
      <p class="nota">Los pagos de ejemplo de otros gestores no pasan por pey y no entran en esta comparación.</p>`;
  }
  return `<section class="tarjeta cuadre">
    <header><h2>Cuadre del día</h2><span class="nota">${esc(diaLargo(c.dia))}</span></header>
    <div class="ecuacion">
      <div><small>Recibido</small><b class="monto">${pesos(c.recibidoCentavos)}</b><span>${plural(c.pagos, "pago", "pagos")}</span></div>
      <i>=</i>
      <div><small>Aplicado a créditos</small><b class="monto verde">${pesos(c.aplicadoCentavos)}</b><span>en automático o asignado</span></div>
      <i>+</i>
      <div><small>Por revisar</small><b class="monto ${c.porRevisarCentavos ? "coral" : ""}">${pesos(c.porRevisarCentavos)}</b><span>${plural(c.excepciones, "excepción", "excepciones")}</span></div>
    </div>
    ${comparacion}
  </section>`;
}

// ------------------------------------------------------------------ Resumen

function barras(semana) {
  const maximo = Math.max(...semana.map((d) => d.cobradoCentavos), 1);
  return `<div class="barras" role="img" aria-label="Cobranza de los últimos 7 días">${semana
    .map((d, i) => {
      const alto = Math.max(4, Math.round((d.cobradoCentavos / maximo) * 100));
      const hoy = i === semana.length - 1;
      return `<div class="barra-dia ${hoy ? "hoy" : ""}" title="${esc(diaCorto(d.dia))}: ${pesos(d.cobradoCentavos)} en ${plural(d.pagos, "pago", "pagos")}">
        <span class="monto">${etiquetaDeBarra(d.cobradoCentavos)}</span>
        <i style="height:${alto}%"></i><small>${hoy ? "Hoy" : esc(diaCorto(d.dia).split(" ")[0])}</small></div>`;
    })
    .join("")}</div>`;
}

function filaEnVivo(p) {
  return `<li class="${e.nuevos.has(p.transactionId) ? "nuevo" : ""}">
    <time>${esc(hora(p.fechaPago))}</time>
    <span class="quien"><b>${esc(p.acreditado ?? "Sin identificar")}</b><small>${p.creditoId ? `Crédito ${esc(p.creditoId)} · ` : ""}${esc(NOMBRE_DE_MEDIO[p.medio])}</small></span>
    <span class="cuanto"><b class="monto">${pesos(p.montoCentavos)}</b>${etiquetaDeOrigen(p)}</span>
  </li>`;
}

function vistaResumen() {
  const r = e.resumen;
  if (!r) return '<p class="cargando">Cargando el resumen…</p>';
  const avance = r.visitas.enRuta ? Math.round((r.visitas.hechas / r.visitas.enRuta) * 100) : 0;
  return `<div class="titulo-vista"><h1>Hoy, ${esc(diaLargo(e.sesion.hoy))}</h1>
      <p class="nota">${e.sesion.carteraDeEjemplo ? "Cartera de ejemplo: se regenera cada día y los pagos de otros gestores son datos de ejemplo." : "Cartera importada por archivo."}</p></div>
    <section class="fichas">
      <article class="tarjeta ficha-kpi principal"><small>Cobrado hoy</small><strong class="monto">${pesos(r.hoy.cobradoCentavos)}</strong>
        <p>${plural(r.hoy.pagos, "pago", "pagos")} · QR ${pesos(r.hoy.porMedio.qrCentavos)} · celular ${pesos(r.hoy.porMedio.pushCentavos)}</p></article>
      <article class="tarjeta ficha-kpi"><small>Conciliado sin intervención</small><strong>${r.hoy.conciliadosSolos === null ? "—" : `${r.hoy.conciliadosSolos}%`}</strong>
        <p>${r.hoy.excepciones ? `${plural(r.hoy.excepciones, "excepción", "excepciones")} por revisar` : "Ningún pago por revisar"}</p></article>
      <article class="tarjeta ficha-kpi"><small>Visitas de hoy</small><strong class="cifra">${r.visitas.hechas}<span> de ${r.visitas.enRuta}</span></strong>
        <div class="avance" role="img" aria-label="${avance}% de las visitas hechas"><i style="width:${avance}%"></i></div>
        <p>${plural(r.visitas.promesas, "promesa de pago", "promesas de pago")}</p></article>
      <article class="tarjeta ficha-kpi"><small>Por cobrar hoy</small><strong class="monto">${pesos(r.cartera.exigibleCentavos)}</strong>
        <p>${plural(r.cartera.atrasados, "crédito atrasado", "créditos atrasados")} · ${r.cartera.venceHoy} vencen hoy</p></article>
    </section>
    <div class="dos-columnas">
      ${cuadre()}
      <section class="tarjeta en-vivo">
        <header><h2>Pagos en vivo</h2><span class="nota">${r.pagosReales ? `${plural(r.pagosReales, "pago CoDi real", "pagos CoDi reales")} en total` : "Llegan al instante"}</span></header>
        ${r.ultimosPagos.length ? `<ul class="lista-vivo">${r.ultimosPagos.map(filaEnVivo).join("")}</ul>` : '<p class="nota">Aún no hay pagos hoy. Cobra algo en la app del gestor y aparecerá aquí.</p>'}
        <button class="enlace" data-accion="ir" data-vista="conciliacion">Ver toda la conciliación</button>
      </section>
    </div>
    <div class="dos-columnas">
      <section class="tarjeta">
        <header><h2>Gestores</h2><span class="nota">Visitas y cobranza de hoy</span></header>
        <div class="tabla-ancha"><table class="tabla"><thead><tr><th>Gestor</th><th>Visitas</th><th class="num">Cobrado</th><th class="num">Pagos</th></tr></thead><tbody>
          ${r.gestores
            .map((g) => {
              const p = g.enRuta ? Math.round((g.hechas / g.enRuta) * 100) : 0;
              return `<tr><td><b>${esc(g.nombre)}</b><small>${esc(g.zona ? `Zona ${g.zona}` : "")}</small></td>
                <td><div class="avance chico" role="img" aria-label="${p}%"><i style="width:${p}%"></i></div><small>${g.hechas} de ${g.enRuta}</small></td>
                <td class="num monto"><b>${pesos(g.cobradoCentavos)}</b></td><td class="num cifra">${g.pagos}</td></tr>`;
            })
            .join("")}
        </tbody></table></div>
      </section>
      <section class="tarjeta">
        <header><h2>Últimos 7 días</h2><span class="nota">Cobranza por día</span></header>
        ${barras(r.semana)}
      </section>
    </div>`;
}

// ------------------------------------------------------------------ Conciliación

function vistaConciliacion() {
  const c = e.conciliacion;
  const filtros = [
    ["", "Todos"],
    ["aplicado", "Aplicados"],
    ["excepcion", "Por revisar"],
  ];
  return `<div class="titulo-vista fila"><div><h1>Conciliación</h1><p class="nota">Cada pago llega identificado con su crédito y su cuota. Aquí solo hay que mirar las excepciones.</p></div>
      <div class="acciones-vista">
        <button class="boton chico secundario" data-accion="exportar">Exportar pagos (CSV)</button>
      </div></div>
    ${cuadre()}
    ${
      e.sesion.simulacion
        ? `<section class="tarjeta pruebas"><div><b>Prueba la conciliación</b><p class="nota">En simulación puedes provocar los casos difíciles sin dinero real.</p></div>
            <button class="boton chico suave" data-accion="sim-sin-referencia">Simular transferencia sin referencia</button>
            <button class="boton chico suave" data-accion="sim-aviso-perdido">Simular un aviso de pago que se pierde</button></section>`
        : ""
    }
    <section class="tarjeta">
      <header><h2>Pagos de hoy</h2>
        <div class="filtros" role="group" aria-label="Filtrar pagos">${filtros.map(([valor, nombre]) => `<button class="${e.filtro === valor ? "activo" : ""}" data-accion="filtro" data-valor="${valor}">${nombre}</button>`).join("")}</div></header>
      ${
        !c
          ? '<p class="cargando">Cargando los pagos…</p>'
          : !c.pagos.length
            ? `<p class="vacio">${e.filtro === "excepcion" ? "No hay pagos por revisar. Todo está aplicado." : "Aún no hay pagos hoy."}</p>`
            : `<div class="tabla-ancha"><table class="tabla"><thead><tr><th>Hora</th><th>Crédito</th><th class="num">Monto</th><th>Aplicado a</th><th>Medio y banco</th><th>Clave de rastreo</th><th>Estado</th><th></th></tr></thead><tbody>
              ${c.pagos
                .map(
                  (p) => `<tr class="${e.nuevos.has(p.transactionId) ? "nuevo" : ""}">
                  <td class="cifra">${esc(hora(p.fechaPago))}</td>
                  <td>${p.creditoId ? `<b>${esc(p.acreditado ?? "")}</b><small>Crédito ${esc(p.creditoId)}</small>` : '<span class="nota">Sin crédito</span>'}</td>
                  <td class="num monto"><b>${pesos(p.montoCentavos)}</b>${p.excedenteCentavos ? `<small>${pesos(p.excedenteCentavos)} sin aplicar</small>` : ""}</td>
                  <td>${cuotasDe(p)}</td>
                  <td>${esc(NOMBRE_DE_MEDIO[p.medio])}<small>${esc([p.banco, p.cuentaFin ? `cuenta ••${p.cuentaFin}` : ""].filter(Boolean).join(" · "))}</small></td>
                  <td class="mono">${esc(p.claveRastreo ?? "—")}</td>
                  <td>${etiquetaDeEstado(p)} ${etiquetaDeOrigen(p)}</td>
                  <td>${p.estado === "excepcion" ? `<button class="boton chico" data-accion="asignar" data-tx="${esc(p.transactionId)}" data-monto="${p.excedenteCentavos}">Asignar</button>` : ""}</td>
                </tr>`,
                )
                .join("")}
            </tbody></table></div>${paginacion(c, "pagina-pagos")}`
      }
    </section>`;
}

// ------------------------------------------------------------------ Cartera

function vistaCartera() {
  const c = e.cartera;
  const situaciones = [
    ["", "Todas"],
    ["atrasado", "Atrasados"],
    ["vence-hoy", "Vencen hoy"],
    ["al-corriente", "Al corriente"],
    ["liquidado", "Liquidados"],
  ];
  return `<div class="titulo-vista"><h1>Cartera</h1><p class="nota">Los saldos son los del sistema de la financiera; Qadra solo registra los pagos y las visitas.</p></div>
    <section class="tarjeta">
      <header class="barra-cartera">
        <label class="buscador"><span class="solo-lectores">Buscar crédito</span><input id="buscar" type="search" placeholder="Buscar por nombre, número, grupo o colonia" value="${esc(e.buscar)}" /></label>
        <label class="solo-lectores" for="situacion">Situación</label>
        <select id="situacion">${situaciones.map(([valor, nombre]) => `<option value="${valor}" ${e.situacion === valor ? "selected" : ""}>${nombre}</option>`).join("")}</select>
      </header>
      ${
        !c
          ? '<p class="cargando">Cargando la cartera…</p>'
          : !c.creditos.length
            ? '<p class="vacio">Ningún crédito coincide con la búsqueda.</p>'
            : `<p class="totales nota">${plural(c.total, "crédito", "créditos")} · saldo ${pesos(c.totales.saldoCentavos)} · exigible hoy ${pesos(c.totales.exigibleCentavos)}</p>
              <div class="tabla-ancha"><table class="tabla clicable"><thead><tr><th>Crédito</th><th>Producto</th><th>Gestor</th><th>Situación</th><th class="num">Exigible hoy</th><th class="num">Saldo</th></tr></thead><tbody>
              ${c.creditos
                .map((k) => {
                  const s = situacion(k.estado);
                  return `<tr data-accion="ficha" data-id="${esc(k.id)}" tabindex="0">
                    <td><b>${esc(k.acreditado)}</b><small>${esc(k.id)} · ${esc(k.colonia)}</small></td>
                    <td>${esc(k.producto)}<small>${esc(k.grupo ? `Grupo ${k.grupo}` : "")}</small></td>
                    <td>${esc(k.gestor ?? "—")}</td>
                    <td><span class="etiqueta ${s.clase}">${esc(s.texto)}</span><small>Cuota ${k.estado.cuotaActual ? k.estado.cuotaActual.numero : k.estado.cuotasTotales} de ${k.estado.cuotasTotales}</small></td>
                    <td class="num monto"><b>${pesos(k.estado.exigibleCentavos)}</b></td><td class="num monto">${pesos(k.estado.saldoCentavos)}</td></tr>`;
                })
                .join("")}
              </tbody></table></div>${paginacion(c, "pagina-cartera")}`
      }
    </section>`;
}

function panelDeCredito() {
  const f = e.ficha;
  if (!f) return "";
  const c = f.credito;
  const s = situacion(c.estado);
  const hoy = e.sesion.hoy;
  const movimientos = [
    ...f.pagos.map((p) => ({ fecha: p.fechaPago, html: `<b class="monto">${pesos(p.montoCentavos)}</b> ${p.estado === "aplicado" ? `aplicado a ${cuotasDe(p).toLowerCase()}` : "por revisar"} ${etiquetaDeOrigen(p)}` })),
    ...f.gestiones.filter((g) => g.resultado !== "pago").map((g) => ({ fecha: g.creadoEn, html: `<b>${esc(NOMBRE_DE_VISITA[g.resultado] ?? g.resultado)}</b>${g.promesaCentavos ? ` ${pesos(g.promesaCentavos)} para el ${esc(g.promesaFecha)}` : ""}${g.gestor ? ` · ${esc(g.gestor)}` : ""}${g.nota ? `<small>${esc(g.nota)}</small>` : ""}` })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return `<div class="velo" data-accion="cerrar-capa"></div>
  <aside class="panel" role="dialog" aria-label="Crédito ${esc(c.id)}">
    <header><div><span class="etiqueta ${s.clase}">${esc(s.texto)}</span><h2>${esc(c.acreditado)}</h2><p class="nota">Crédito ${esc(c.id)} · ${esc(c.producto)}${c.grupo ? ` · Grupo ${esc(c.grupo)}` : ""}</p></div>
      <button class="cerrar" data-accion="cerrar-capa" aria-label="Cerrar">×</button></header>
    <div class="panel-cifras">
      <div><small>Exigible hoy</small><b class="monto">${pesos(c.estado.exigibleCentavos)}</b></div>
      <div><small>Saldo</small><b class="monto">${pesos(c.estado.saldoCentavos)}</b></div>
      <div><small>Cuotas pagadas</small><b class="cifra">${c.estado.cuotasPagadas} de ${c.estado.cuotasTotales}</b></div>
    </div>
    <p class="nota">${esc([c.domicilio, c.colonia].filter(Boolean).join(", "))} · Gestor: ${esc(c.gestor ?? "sin asignar")}</p>
    <h3>Calendario</h3>
    <ol class="calendario">${f.cuotas
      .map((q) => {
        const pagada = q.pagadoCentavos >= q.montoCentavos;
        const clase = pagada ? "pagada" : q.pagadoCentavos > 0 ? "parcial" : q.vence < hoy ? "vencida" : q.vence === hoy ? "hoy" : "";
        return `<li class="${clase}" title="Cuota ${q.numero} · vence ${esc(q.vence)} · pagado ${pesos(q.pagadoCentavos)} de ${pesos(q.montoCentavos)}">${q.numero}</li>`;
      })
      .join("")}</ol>
    <h3>Movimientos</h3>
    ${movimientos.length ? `<ul class="movimientos">${movimientos.map((m) => `<li><time>${esc(hora(m.fecha))}</time><div>${m.html}</div></li>`).join("")}</ul>` : '<p class="nota">Sin movimientos todavía.</p>'}
    <h3>QR fijo del crédito</h3>
    ${
      f.qrFijo
        ? `<div class="qr-fijo"><div class="qr ${f.qrFijo.simulado ? "simulado" : ""}" id="qr-fijo"></div>
            <p>Un QR CoDi que no vence y acepta muchos pagos de <b class="monto">${pesos(f.qrFijo.montoCentavos)}</b>. Va impreso en el tarjetón del acreditado: puede pagar aunque el gestor no tenga señal, y cada pago se concilia con este crédito.</p></div>`
        : `<p class="nota">Este crédito aún no tiene QR fijo.</p>
           ${e.sesion.rol === "admin" ? '<button class="boton chico" data-accion="crear-qr-fijo">Crear QR fijo en pey</button>' : '<p class="nota">Solo el administrador puede crearlo.</p>'}`
    }
  </aside>`;
}

// ------------------------------------------------------------------ Integración

function resultadoDelArchivo() {
  const a = e.archivo;
  if (!a) return "";
  const r = a.resultado;
  const cabecera = `<p><b>${esc(a.nombre)}</b> · ${plural(r.resumen.filas, "renglón", "renglones")}</p>`;
  if (!r.ok) {
    return `<div class="resultado mal">${cabecera}<p class="error">${r.erroresTotales === 1 ? "Hay 1 problema" : `Hay ${r.erroresTotales} problemas`} por corregir. Nada se cargó.</p>
      <table class="tabla"><thead><tr><th>Renglón</th><th>Columna</th><th>Qué corregir</th></tr></thead><tbody>
      ${r.errores.map((x) => `<tr><td class="cifra">${x.fila || "—"}</td><td class="mono">${esc(x.columna || "archivo")}</td><td>${esc(x.mensaje)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  return `<div class="resultado bien">${cabecera}
    <p><span class="sello bien">✓ Archivo válido</span> ${plural(r.resumen.validas, "crédito", "créditos")} · ${plural(r.resumen.gestores.length, "gestor", "gestores")} · saldo ${pesos(r.resumen.saldoCentavos)}</p>
    <table class="tabla"><thead><tr><th>Crédito</th><th>Acreditado</th><th>Gestor</th><th class="num">Cuota</th><th>Pagadas</th><th>Próximo vencimiento</th></tr></thead><tbody>
    ${r.vistaPrevia.map((k) => `<tr><td class="mono">${esc(k.id)}</td><td>${esc(k.acreditado)}</td><td>${esc(k.gestor)}</td><td class="num monto">${pesos(k.montoCuotaCentavos)}</td><td class="cifra">${k.cuotasPagadas} de ${k.cuotasTotales}</td><td>${esc(k.proximoVencimiento)}</td></tr>`).join("")}
    </tbody></table>
    ${
      e.sesion.rol === "admin"
        ? '<button class="boton" data-accion="importar">Importar y reemplazar la cartera</button><p class="nota">Se borra la cartera actual con sus cobros y pagos. Puedes volver a la cartera de ejemplo con "Reiniciar demo".</p>'
        : '<p class="nota">Como jurado puedes validar cualquier archivo; reemplazar la cartera es solo para el administrador.</p>'
    }</div>`;
}

function vistaIntegracion() {
  const s = e.sesion;
  const webhook = `${location.origin}/webhooks/pey`;
  return `<div class="titulo-vista"><h1>Integración</h1><p class="nota">Qadra no reemplaza el sistema de la financiera: toma de él la cartera y le devuelve cada pago identificado.</p></div>
    <div class="dos-columnas parejas">
      <section class="tarjeta">
        <header><h2>Cartera por archivo</h2><span class="nota">CSV, lo que exporta Excel</span></header>
        <p>Para la financiera que no tiene un sistema con API. El archivo se revisa completo antes de cargarse y cada error dice el renglón y la columna.</p>
        <div class="fila-botones">
          <button class="boton chico secundario" data-accion="plantilla">Descargar plantilla</button>
          <label class="boton chico">Elegir archivo CSV<input type="file" id="archivo" accept=".csv,text/csv" hidden /></label>
        </div>
        ${resultadoDelArchivo()}
      </section>
      <section class="tarjeta">
        <header><h2>Pagos hacia tu sistema</h2><span class="nota">Un renglón por cuota pagada</span></header>
        <p>Los pagos del día salen con crédito, cuota, monto aplicado, clave de rastreo y banco, listos para cargarse en el sistema de la financiera.</p>
        <div class="fila-botones"><button class="boton chico secundario" data-accion="exportar">Exportar pagos de hoy (CSV)</button></div>
        <h3>Conexión con pey</h3>
        <ul class="conexiones">
          <li><span class="mono">POST /codi/qr</span> crea el QR de cada cobro y el QR fijo de cada crédito.</li>
          <li><span class="mono">POST /codi/pn</span> manda la solicitud de cobro al celular.</li>
          <li><span class="mono">webhook codi.*.payment_received</span> avisa cada pago; Qadra verifica la firma y lo concilia.</li>
          <li><span class="mono">GET /transaction/api-key</span> y <span class="mono">/transaction/{id}</span> cuadran el día y recuperan avisos perdidos.</li>
        </ul>
      </section>
    </div>
    ${
      s.rol === "admin"
        ? `<div class="dos-columnas parejas">
            <section class="tarjeta">
              <header><h2>Cuenta de pey</h2><span class="etiqueta ${s.simulacion ? "espera" : "bien"}">${s.simulacion ? "Simulación" : "Cobros reales"}</span></header>
              <ul class="lista-config">
                <li><span class="etiqueta ${s.configuracion.pey ? "bien" : "espera"}">${s.configuracion.pey ? "Configurada" : "Falta"}</span> <span class="mono">PEY_API_KEY</span> API key de pey de este proyecto.</li>
                <li><span class="etiqueta ${s.configuracion.webhook ? "bien" : "espera"}">${s.configuracion.webhook ? "Configurado" : "Falta"}</span> <span class="mono">PEY_WEBHOOK_SECRET</span> secreto con el que pey firma los avisos.</li>
              </ul>
              <p class="nota">Webhook que se registra en el portal de pey:</p>
              <div class="copiable"><span class="mono">${esc(webhook)}</span><button class="boton chico suave" data-accion="copiar" data-texto="${esc(webhook)}">Copiar</button></div>
              <p class="nota">${s.simulacion ? "Al configurar PEY_API_KEY la simulación se apaga sola y los cobros pasan a ser reales." : `Cada cobro real de la demo tiene un tope de ${pesos(s.topeCentavos)}.`}</p>
            </section>
            <section class="tarjeta">
              <header><h2>Reiniciar la demo</h2></header>
              <p>Vuelve a cargar la cartera de ejemplo con las fechas de hoy. Los cobros pendientes de la cartera de ejemplo se conservan.</p>
              <div class="fila-botones"><button class="boton chico secundario" data-accion="reiniciar">Reiniciar demo</button></div>
            </section>
          </div>`
        : ""
    }`;
}

// ------------------------------------------------------------------ Pintar y cargar

const VISTAS = { resumen: vistaResumen, conciliacion: vistaConciliacion, cartera: vistaCartera, integracion: vistaIntegracion };

/** La cuenta de excepciones de la pestaña Conciliación: sale del resumen y se ve desde cualquier vista. */
function pintarInsignia() {
  const excepciones = e.resumen?.hoy.excepciones ?? 0;
  const cuenta = $("#cuenta-excepciones");
  cuenta.hidden = !excepciones;
  cuenta.textContent = excepciones;
}

function pintar() {
  if (!e.sesion) return; // sin sesión no hay nada de la cartera que mostrar
  const campo = document.activeElement?.id === "buscar" ? document.activeElement : null;
  // Lo que la persona lleva escrito en el buscador manda sobre lo último que se buscó.
  const escrito = campo ? { valor: campo.value, cursor: campo.selectionStart } : null;
  vista.innerHTML = VISTAS[e.vista]();
  for (const b of $$(".pestanas button")) b.toggleAttribute("aria-current", b.dataset.vista === e.vista);
  pintarInsignia();
  const nuevo = escrito && $("#buscar");
  if (nuevo) {
    nuevo.value = escrito.valor;
    nuevo.focus();
    nuevo.setSelectionRange(escrito.cursor, escrito.cursor);
  }
}

function pintarPanel() {
  capa.innerHTML = panelDeCredito();
  const qr = $("#qr-fijo");
  if (qr && e.ficha?.qrFijo) qr.innerHTML = svgQr(e.ficha.qrFijo.qrString);
}

let turnoDeCarga = 0; // cada carga toma un turno: si llega otra más nueva, la vieja ya no escribe ni pinta

/**
 * Trae del servidor lo que necesita la vista en pantalla. Con `conResumen` trae además el resumen aunque la vista no
 * lo use, para que la cuenta de excepciones de la pestaña esté al día cuando llega un pago en vivo.
 */
async function cargar({ conResumen = false } = {}) {
  if (!e.sesion) return;
  const turno = ++turnoDeCarga;
  const vigente = () => turno === turnoDeCarga && e.sesion;
  const que = e.vista;
  try {
    if (que === "resumen" || que === "conciliacion" || conResumen) {
      const [resumen, corte] = await Promise.all([api("/api/app/resumen"), api("/api/app/corte")]);
      if (!vigente()) return;
      e.resumen = resumen;
      // Se conserva la comparación con pey mientras el corte no cambie.
      e.corte = e.corte?.pey && e.corte.recibidoCentavos === corte.recibidoCentavos && e.corte.pagos === corte.pagos ? { ...corte, pey: e.corte.pey } : corte;
    }
    if (que === "conciliacion") {
      const conciliacion = await api(`/api/app/conciliacion?estado=${e.filtro}&pagina=${e.paginaPagos}`);
      if (!vigente()) return;
      e.conciliacion = conciliacion;
    }
    if (que === "cartera") {
      const cartera = await api(`/api/app/cartera?buscar=${encodeURIComponent(e.buscar)}&situacion=${e.situacion}&pagina=${e.paginaCartera}`);
      if (!vigente()) return;
      e.cartera = cartera;
    }
  } catch (error) {
    if (!vigente()) return;
    if (error.status === 401) return salir(CLAVE_VENCIDA);
    aviso(error.message, "mal");
  }
  // Integración no muestra datos que cambien con un pago: no se vuelve a dibujar para no estorbar a quien revisa un archivo.
  if (que === e.vista && que !== "integracion") pintar();
  else pintarInsignia();
}

function ir(nombre) {
  e.vista = nombre;
  pintar();
  cargar();
  window.scrollTo({ top: 0 });
}

async function comparar() {
  e.comparando = true;
  pintar();
  try {
    const corte = await api("/api/app/corte?pey=1");
    if (!e.sesion) return;
    turnoDeCarga++; // una carga que venía en camino traería el corte de antes de comparar
    e.corte = corte;
  } catch (error) {
    if (!e.sesion) return;
    if (error.status === 401) return salir(CLAVE_VENCIDA);
    aviso(error.message, "mal");
  } finally {
    e.comparando = false;
  }
  pintar();
}

let refresco = 0;
/** Pone al día la pantalla poco después de un evento en vivo (varios eventos seguidos, una sola carga). */
function refrescarPronto() {
  clearTimeout(refresco);
  refresco = setTimeout(() => cargar({ conResumen: true }), 350);
}

async function descargar(ruta, nombre) {
  try {
    const respuesta = await fetch(ruta, { headers: { Authorization: `Bearer ${e.clave}` } });
    if (!respuesta.ok) throw new Error("No se pudo descargar el archivo.");
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(await respuesta.blob());
    enlace.download = /filename="([^"]+)"/.exec(respuesta.headers.get("content-disposition") ?? "")?.[1] ?? nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
  } catch (error) {
    aviso(error.message, "mal");
  }
}

// ------------------------------------------------------------------ Asignar una excepción

function dialogoAsignar(tx, montoCentavos) {
  capa.innerHTML = `<div class="velo" data-accion="cerrar-capa"></div>
    <div class="dialogo" role="dialog" aria-label="Asignar pago">
      <h2>Asignar ${pesos(montoCentavos)} a un crédito</h2>
      <p class="nota">Busca el crédito al que corresponde este pago. Se aplica a sus cuotas pendientes, de la más antigua a la más reciente.</p>
      <label class="campo"><span>Crédito</span><input id="buscar-credito" type="search" placeholder="Nombre o número de crédito" autocomplete="off" /></label>
      <ul class="resultados" id="resultados"><li class="nota">Escribe para buscar.</li></ul>
      <button class="enlace" data-accion="cerrar-capa">Cancelar</button>
    </div>`;
  const campo = $("#buscar-credito");
  const resultados = $("#resultados");
  let espera = 0;
  let busqueda = 0; // solo la búsqueda más reciente escribe sus resultados
  campo.focus();
  campo.addEventListener("input", () => {
    clearTimeout(espera);
    const turno = ++busqueda;
    espera = setTimeout(async () => {
      const texto = campo.value.trim();
      if (!texto) return (resultados.innerHTML = '<li class="nota">Escribe para buscar.</li>');
      try {
        const r = await api(`/api/app/cartera?buscar=${encodeURIComponent(texto)}`);
        // Llegó tarde (ya se escribió otra cosa) o el diálogo se cerró: no se toca nada.
        if (turno !== busqueda || !resultados.isConnected) return;
        resultados.innerHTML = r.creditos.length
          ? r.creditos
              .slice(0, 6)
              .map((k) => `<li><button data-accion="resolver" data-tx="${esc(tx)}" data-id="${esc(k.id)}" ${k.estado.saldoCentavos ? "" : "disabled"}>
                <span><b>${esc(k.acreditado)}</b><small>Crédito ${esc(k.id)} · saldo ${pesos(k.estado.saldoCentavos)}</small></span><span class="etiqueta ${situacion(k.estado).clase}">${esc(situacion(k.estado).texto)}</span></button></li>`)
              .join("")
          : '<li class="nota">Ningún crédito coincide.</li>';
      } catch (error) {
        if (turno === busqueda && resultados.isConnected) aviso(error.message, "mal");
      }
    }, 220);
  });
}

// ------------------------------------------------------------------ Acciones

/** Corre una acción y, si falla, lo dice. Si la clave dejó de servir, cierra la sesión. */
async function conAviso(accion) {
  try {
    await accion();
  } catch (error) {
    if (error.status === 401 && e.sesion) return salir(CLAVE_VENCIDA);
    aviso(error.message, "mal");
  }
}

/**
 * Corre una acción con su botón apagado para que no se dispare dos veces. Si falla, el botón vuelve a quedar como
 * estaba para poder reintentar; si sale bien, la pantalla se vuelve a dibujar y el botón ya no importa.
 */
async function conBoton(el, textoOcupado, accion) {
  const texto = el.textContent;
  el.disabled = true;
  if (textoOcupado) el.textContent = textoOcupado;
  try {
    await accion();
  } catch (error) {
    if (el.isConnected) {
      el.disabled = false;
      el.textContent = texto;
    }
    if (error.status === 401 && e.sesion) return salir(CLAVE_VENCIDA);
    aviso(error.message, "mal");
  }
}

/** Después de importar o reiniciar la cartera es otra: se pide la sesión de nuevo y no se conserva nada de la anterior. */
async function estrenarCartera(vistaInicial) {
  const sesion = await api("/api/app/sesion");
  if (!e.sesion) return;
  turnoDeCarga++;
  turnoDeFicha++;
  Object.assign(e, datosEnBlanco(), { sesion });
  capa.innerHTML = "";
  ir(vistaInicial);
}

let turnoDeFicha = 0; // solo el último crédito pedido abre su panel

const acciones = {
  ir: (el) => ir(el.dataset.vista),
  comparar,
  recuperar: (el) =>
    conBoton(el, "Recuperando…", async () => {
      const r = await api("/api/app/corte/recuperar", { cuerpo: { transactionId: el.dataset.tx } });
      aviso(r.duplicado ? "Ese pago ya estaba registrado." : `Pago recuperado de pey${r.creditoId ? ` y aplicado al crédito ${r.creditoId}` : ""}.`, "bien");
      await cargar();
      await comparar();
    }),
  filtro: (el) => {
    e.filtro = el.dataset.valor;
    e.paginaPagos = 1;
    cargar();
  },
  "pagina-pagos": (el) => {
    e.paginaPagos = Number(el.dataset.pagina);
    cargar();
  },
  "pagina-cartera": (el) => {
    e.paginaCartera = Number(el.dataset.pagina);
    cargar();
  },
  exportar: () => descargar("/api/app/pagos.csv", "qadra-pagos.csv"),
  plantilla: () => descargar("/api/app/cartera/plantilla.csv", "qadra-plantilla-cartera.csv"),
  "sim-sin-referencia": () =>
    conAviso(async () => {
      await api("/api/app/simular", { cuerpo: { tipo: "sin-referencia", montoCentavos: MONTO_SIN_REFERENCIA } });
      aviso(`Llegó una transferencia de ${pesos(MONTO_SIN_REFERENCIA)} sin referencia: quedó por revisar.`);
      e.filtro = "excepcion";
      e.paginaPagos = 1;
      await cargar();
    }),
  "sim-aviso-perdido": () =>
    conAviso(async () => {
      const candidatos = await api("/api/app/cartera?situacion=vence-hoy");
      const credito = candidatos.creditos[0] ?? (await api("/api/app/cartera?situacion=atrasado")).creditos[0];
      if (!credito) return aviso("No hay créditos con algo por cobrar hoy.", "mal");
      const { cobro } = await api("/api/app/cobros", { cuerpo: { creditoId: credito.id, montoCentavos: credito.estado.exigibleCentavos, medio: "qr" } });
      await api("/api/app/simular", { cuerpo: { tipo: "cobro", cobroId: cobro.id, conAviso: false } });
      aviso(`${credito.acreditado} pagó ${pesos(cobro.montoCentavos)}, pero el aviso de pey no llegó. Compara con pey para encontrarlo.`);
      await comparar();
    }),
  asignar: (el) => dialogoAsignar(el.dataset.tx, Number(el.dataset.monto)),
  resolver: (el) =>
    conAviso(async () => {
      const r = await api(`/api/app/excepciones/${encodeURIComponent(el.dataset.tx)}/resolver`, { cuerpo: { creditoId: el.dataset.id } });
      capa.innerHTML = "";
      aviso(r.pendienteCentavos ? `Se aplicaron ${pesos(r.aplicadoCentavos)}; sobran ${pesos(r.pendienteCentavos)} por revisar.` : `Pago aplicado al crédito ${el.dataset.id}.`, "bien");
      await cargar();
    }),
  ficha: (el) =>
    conAviso(async () => {
      const turno = ++turnoDeFicha;
      const ficha = await api(`/api/app/creditos/${encodeURIComponent(el.dataset.id)}`);
      // Si mientras tanto se pidió otro crédito, se cerró el panel o se salió, esta respuesta ya no abre nada.
      if (turno !== turnoDeFicha || !e.sesion) return;
      e.ficha = ficha;
      pintarPanel();
    }),
  // Cierra lo que esté en la capa: el panel de un crédito o el diálogo de asignar (botón, fondo o tecla Escape).
  "cerrar-capa": () => {
    turnoDeFicha++;
    e.ficha = null;
    capa.innerHTML = "";
  },
  "crear-qr-fijo": (el) =>
    conBoton(el, "Creando el QR en pey…", async () => {
      // El crédito se anota antes de esperar: si la persona cierra el panel o abre otro, el QR se crea para el que pidió.
      const id = e.ficha.credito.id;
      const ruta = `/api/app/creditos/${encodeURIComponent(id)}`;
      await api(`${ruta}/qr-fijo`, { metodo: "POST" });
      const ficha = await api(ruta);
      if (e.ficha?.credito.id !== id) return aviso(`QR fijo creado para el crédito ${id}.`, "bien");
      e.ficha = ficha;
      pintarPanel();
    }),
  importar: (el) =>
    conBoton(el, "Importando…", async () => {
      const r = await api("/api/app/cartera/importar", { texto: e.archivo.texto });
      aviso(`Cartera importada: ${plural(r.creditos, "crédito", "créditos")} de ${plural(r.gestores, "gestor", "gestores")}.`, "bien");
      await estrenarCartera("cartera");
    }),
  reiniciar: (el) =>
    conBoton(el, "Reiniciando…", async () => {
      await api("/api/app/reiniciar", { metodo: "POST" });
      aviso("Demo reiniciada con la cartera de ejemplo de hoy.", "bien");
      await estrenarCartera("resumen");
    }),
  copiar: async (el) => aviso((await copiar(el.dataset.texto)) ? "Copiado." : el.dataset.texto, "bien"),
};

document.addEventListener("click", (evento) => {
  const el = evento.target.closest("[data-accion]");
  if (el && !el.disabled) acciones[el.dataset.accion]?.(el);
  const pestana = evento.target.closest(".pestanas button");
  if (pestana) ir(pestana.dataset.vista);
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && capa.innerHTML) acciones["cerrar-capa"]();
  if (evento.key === "Enter" && evento.target.matches?.("tr[data-accion]")) acciones.ficha(evento.target);
});

let esperaDeBusqueda = 0;
vista.addEventListener("input", (evento) => {
  if (evento.target.id !== "buscar") return;
  clearTimeout(esperaDeBusqueda);
  esperaDeBusqueda = setTimeout(() => {
    e.buscar = evento.target.value;
    e.paginaCartera = 1;
    cargar();
  }, 250);
});

vista.addEventListener("change", async (evento) => {
  if (evento.target.id === "situacion") {
    e.situacion = evento.target.value;
    e.paginaCartera = 1;
    cargar();
  }
  if (evento.target.id === "archivo" && evento.target.files[0]) {
    const archivo = evento.target.files[0];
    if (archivo.size > 300 * 1024) return aviso("El archivo pesa más de 300 KB.", "mal");
    await conAviso(async () => {
      const texto = await archivo.text();
      e.archivo = { nombre: archivo.name, texto, resultado: await api("/api/app/cartera/validar", { texto }) };
      pintar();
    });
  }
});

// ------------------------------------------------------------------ Entrada y salida

function abrirCanal() {
  canal?.cerrar();
  canal = enVivo(
    async () => direccionWs(`/api/app/en-vivo?canal=portal&boleto=${(await api("/api/app/boleto?canal=portal")).boleto}`),
    (m) => {
      if (m.tipo === "pago") {
        e.nuevos.add(m.transactionId);
        setTimeout(() => e.nuevos.delete(m.transactionId), RESALTADO_MS);
        if (m.origen !== "ejemplo") aviso(m.estado === "aplicado" ? `Pago conciliado: ${pesos(m.montoCentavos)} · ${m.acreditado ?? ""}` : `Pago por revisar: ${pesos(m.montoCentavos)}`, m.estado === "aplicado" ? "bien" : "");
      }
      refrescarPronto();
    },
    (conectado) => {
      const el = $("#vivo");
      el.querySelector(".pulso").classList.toggle("vivo", conectado);
      el.lastElementChild.textContent = conectado ? "En vivo" : "Reconectando…";
    },
  );
}

async function entrar(clave) {
  e.clave = clave.trim();
  const error = $("#entrada-error");
  error.hidden = true;
  try {
    e.sesion = await api("/api/app/sesion");
  } catch (fallo) {
    e.clave = "";
    if (fallo.status === 401) olvidarClave(); // una clave guardada que ya no sirve no se vuelve a intentar sola
    error.textContent = fallo.status === 401 ? "Esa clave no es correcta." : fallo.message;
    error.hidden = false;
    $("#entrada").hidden = false;
    $("#marco").hidden = true;
    return;
  }
  try {
    localStorage.setItem(LLAVE, JSON.stringify(e.clave));
  } catch {
    // modo privado: la sesión dura lo que la pestaña
  }
  const s = e.sesion;
  $("#entrada").hidden = true;
  $("#marco").hidden = false;
  $("#financiera").innerHTML = `<b>${esc(s.financiera.nombre)}</b><small>${esc(s.financiera.aviso)}</small>`;
  $("#rol").textContent = s.rol === "admin" ? "Administrador" : "Jurado";
  $("#cinta").innerHTML = s.simulacion
    ? '<div class="cinta">Modo simulación · los pagos son de mentira y se rotulan como simulados</div>'
    : `<div class="cinta real">Cobros CoDi reales${s.topeCentavos ? ` · tope de la demo: ${pesos(s.topeCentavos)} por cobro` : ""}</div>`;
  abrirCanal();
  ir("resumen");
}

function olvidarClave() {
  try {
    localStorage.removeItem(LLAVE);
  } catch {
    // nada que borrar
  }
}

function salir(mensaje = "") {
  canal?.cerrar();
  clearTimeout(refresco);
  clearTimeout(esperaDeBusqueda);
  turnoDeCarga++; // lo que venga en camino ya no escribe ni pinta
  turnoDeFicha++;
  olvidarClave();
  // Al salir no queda nada de la cartera en la página: ni datos, ni búsquedas, ni filtros.
  Object.assign(e, { clave: "", sesion: null, vista: "resumen" }, datosEnBlanco());
  vista.innerHTML = "";
  capa.innerHTML = "";
  $("#marco").hidden = true;
  $("#entrada").hidden = false;
  const error = $("#entrada-error");
  error.textContent = mensaje;
  error.hidden = !mensaje;
}

$("#f-entrada").addEventListener("submit", (evento) => {
  evento.preventDefault();
  entrar(new FormData(evento.target).get("clave") ?? "");
});
$("#entrar-demo").addEventListener("click", () => entrar("demo"));
$("#salir").addEventListener("click", () => salir());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && e.sesion) cargar();
});

// Cada isotipo lleva su propio degradado: si dos compartieran id y el primero estuviera oculto, el segundo no se pintaría.
const marca = () => `${isotipo(30)}<span><b>Qadra</b><small>Cobranza Inteligente</small></span>`;
$("#entrada-marca").innerHTML = marca();
$("#tope-marca").innerHTML = marca();
crearApi()("/api/estado")
  .then((estado) => ($("#entrada-demo").hidden = !estado.claveDemo))
  .catch(() => {});
if (e.clave) entrar(e.clave);
else $("#entrada").hidden = false;
