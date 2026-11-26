# Qadra — demo para el Hackatón México 2026

Objetivo: demo pública de Qadra (cobranza con CoDi): el gestor cobra en campo, pey avisa el pago y el portal lo concilia solo.
Rama: `feat/demo-hackaton` · Entrega: `single-pr` (mismo criterio que Sin Morralla) · Pruebas: `node --test`, e2e contra
`wrangler dev` y revisión en el navegador integrado.

## Specs

- **S1. La demo.** "vale lo meteremos como proyecto entonces desarrollemos la demo". Supuesto: el alcance es el corte
  que se propuso el 25 de noviembre y que el usuario aceptó: portal de la financiera (carga de cartera por CSV, lista
  de créditos y conciliación con corte del día, con cada pago ligado a su cuota), app del gestor como web móvil
  instalable (ruta del día, ficha del crédito, Cobrar con QR o push real de pey, "Pagado" en segundos por el webhook y
  recibo) y página de pago con la marca de la financiera. Quedan fuera: app Android nativa, conectores a sistemas
  core, cobro grupal, WhatsApp, despachos y otras formas de pago.
- **S2. Qué se sube.** "subamos al repo de github solo el codigo y documentacion necesraria para el hacjathon todo lo
  demas mantengamoslo en local".
- **S3. Como Sin Morralla.** "apeguemonos a lo que hicimos en sinmorralla documentacion del proyecto".
- **S4. Cloudflare.** "usemos una URL de cloduflare igual del perfil de victorlara".
- **S5. Impacto y detalle.** "hagamos que la demo genere impacto y se detallista con todo lo que hagas".
- **S6. Método.** "aplica ODD y RDD para asegurar la calidad de la demo".
- **S7. Orden.** "si no estoy loggeado localmente en github con mi usuario de victor lara deja para el final subir el
  repo, prioriza hacer la demo slocalmente y subirla a cloudflare".
- **S8. Correcciones de la auditoría de impeccable (2026-11-25).** "aplica todas las correcciones tanto p1 hasta p3
  aplica todos y al final dame un resumen y sube la pagina para ver que tal quedo". Alcance: los 11 hallazgos de la
  auditoría de la landing (`.impeccable/audit/`, 13/20), con las guías de impeccable (harden, layout, animate, optimize,
  distill, typeset y polish). Se respetan las fuentes y la trama de la identidad v2; no se rediseñan las secciones.

## Tasks

| ID | Specs | Ruta | Estado | Commit / evidencia |
|---|---|---|---|---|
| T1 | S3, S4 | inline | hecho | `24b6991` (dev local: salud 200, landing 200) y `6e399d7` (lock) |
| T2 | S1, S5 | inline | hecho | `e037312`. RED: 7 archivos de prueba sin módulo; GREEN 65/65. Advertencias de RDD en `7fb20f5` (RED 4, GREEN 77/77) y cartera de ejemplo en `f6d8689` |
| T3 | S1, S4 | inline | hecho | `8b1d50b`. RED: e2e 0/14 (rutas inexistentes); GREEN: unitarias 77/77, e2e 14/14 dos corridas seguidas |
| T4 | S1, S5 | inline | hecho | `2e357df`. RED: e2e 14/26; GREEN: unitarias 83/83, e2e 26/26. Advertencias de RDD en `bf363cc` (RED 5 unitarias y 3 e2e; GREEN 89/89 y 30/30) y `3a119ed` (GREEN 94/94 y 31/31) |
| T5 | S1, S5 | inline | hecho | `99054bc`. Navegador integrado: ruta real del servidor, ficha, hoja de cobro, QR rotulado SIMULADO, pago simulado y "Pagado" con la cuota conciliada; progreso de la ruta 2 → 3 de 8; 375 px sin desplazamiento horizontal |
| T6 | S1, S5 | inline | hecho | `a31bb9b`. Navegador integrado: resumen, aviso perdido → "No cuadra" → Recuperar → "Todo cuadra", transferencia sin referencia asignada a un crédito, ficha del crédito, integración; 375 px sin desbordes en las cuatro vistas (corregido en `01201b5`) |
| T7 | S1, S5 | inline | hecho | `01201b5`. Navegador integrado: landing con la demo en vivo ("Pagado" por WebSocket y fila nueva en la conciliación), página de pago de un cobro real del servidor local y su recibo; 375 px sin desbordes |
| T8 | S5, S6 | inline | hecho | Unitarias 103/103, e2e 31/31, `tsc` limpio; servidor local en el puerto 8790. Advertencias de RDD de la interfaz en `4a7c6fe`, `a625d04` y `36d623b` (L12 a L14) |
| T9 | S2, S3 | inline | hecho | `README.md` con un diagrama Mermaid, `docs/entrega.md` (descripción 483 palabras, instrucciones 606) |
| T10 | S4, S7 | inline | hecho | D1 `qadra` (WNAM) con migraciones 0001 y 0002; Worker en https://qadra.victormlaralopez.workers.dev. En producción: landing, app, portal y página de pago 200; clave `demo` da rol jurado; cobro → pago simulado → pagado; cuadre con el libro simulado "cuadra" |
| T12 | S8, S5, S6 | inline | hecho | RED: `resumenDelPago` inexistente; GREEN 105/105 unitarias y 31/31 e2e, `tsc` limpio. Detector de impeccable: de 15 hallazgos a 3, los tres decisiones de marca o falso positivo. Medido en Edge sin ventana a 1000×760, 1366×768, 1440×900 y 390×844: el titular no se mueve entre vistas, nada se desborda y "Simular" y la tarjeta de la oficina quedan a la vista (L17) |
| T11 | S2, S7 | inline | hecho | https://github.com/VictorLaraL/qadra (público): `main` en `f448231` y `feat/demo-hackaton` con todo el trabajo. Antes de subir se revisó el historial completo: un solo autor con correo noreply, sin secretos ni documentos de estrategia |

- **T1** Estructura del proyecto (Worker, D1, configuración, scripts) con la misma base que Sin Morralla.
- **T2** Núcleo sin dependencias de Cloudflare, con pruebas: firma de avisos (Standard Webhooks), normalización del
  aviso de pey, conciliación (aplicar un pago a las cuotas, estado del crédito, cuadre contra pey), cartera por CSV,
  fechas y horario de gestión, dinero y validaciones.
- **T3** Worker: esquema D1, cartera de ejemplo, cliente de pey (`POST /codi/qr`, `POST /codi/pn`), cobros con
  referencia numérica y `/webhooks/pey` atómico e idempotente. Riesgo alto (secretos, datos persistidos, concurrencia):
  commit propio.
- **T4** Worker: difusor en vivo, API de la app del gestor y del portal, corte del día, cuadre contra pey
  (`GET /transaction/api-key`), excepciones, importar y exportar CSV, demo pública y página de pago.
- **T5** Web: identidad de Qadra y app del gestor (ruta, ficha, cobrar, "Pagado", visitas).
- **T6** Web: portal de la financiera (resumen, conciliación, cartera, importar).
- **T7** Web: landing con demo en vivo y página de pago con la marca de la financiera.
- **T8** Pruebas de punta a punta contra `wrangler dev` y en el navegador integrado; dejarlo corriendo en local.
- **T9** README para jueces con diagrama, `docs/entrega.md` y referencia del API.
- **T10** Publicar en Cloudflare (D1 remota y Worker) en la cuenta personal.
- **T11** Subir a GitHub (`VictorLaraL/qadra`) solo el código y los documentos del hackatón.
- **T12** Landing según la auditoría de impeccable: contraste y avisos para lector de pantalla; teléfono de altura fija
  (el titular no salta y "Simular" queda a la vista); el pago llega del teléfono a la oficina; movimiento reducido con
  alternativas; "Pagado" no se borra solo; pulso que no repinta ni corre fuera de vista; sin etiquetas sobre títulos;
  texto sin degradado ni palabras huérfanas; detalles de movimiento y tokens de color.

Rutas: todo inline. Ninguna unidad cumple el disparador de escritor: las piezas comparten el mismo contrato de datos
(esquema, conciliación y eventos en vivo) y se construyen una sobre otra, así que no hay unidades independientes con
superficies disjuntas para paralelizar.

## Log

- **L1 (2026-11-25):** "vale lo meteremos como proyecto entonces desarrollemos la demo y subamos al repo de github solo
  el codigo y documentacion necesraria para el hacjathon todo lo demas mantengamoslo en local, apeguemonos a lo que
  hicimos en sinmorralla documentacion del proyecto y usemos una URL de cloduflare igual del perfil de victorlara,
  hagamos que la demo genere impacto y se detallista con todo lo que hagas. aplica ODD y RDD para asegurar la calidad
  de la demo. si no estoy loggeado localmente en github con mi usuario de victor lara deja para el final subir el repo,
  prioriza hacer la demo slocalmente y subirla a cloudflare."
- **L2 Entorno (2026-11-25):** `gh` tiene activa la cuenta VictorLaraL; wrangler está en la cuenta personal (la misma
  que tiene la base `sin-morralla`); RDD encendido (global). Base D1 `qadra` creada en WNAM
  (`5b59e432-fdd7-4fab-92f6-1a3586d33a4c`).
- **L3 Decisiones:**
  - El repositorio vive en `Proyectos Hackathones\qadra`. La estrategia del producto (mercado, competencia, precios,
    integraciones e identidad completa) se queda fuera del repositorio.
  - Commits sin atribución de IA y con Conventional Commits, igual que en Sin Morralla.
  - Cada proyecto del hackatón necesita su propia API key de pey (reglas §4.2): la de Qadra la crea el usuario. Mientras
    no exista, la demo corre en modo simulación, rotulado como SIMULADO, y cambia sola a cobros reales al configurar
    `PEY_API_KEY`.
  - Sin llave de pey se entra con la clave `demo` (rol jurado); con llave, solo con `PORTAL_TOKEN` o `JURADO_TOKEN`.
  - Cada cobro lleva un folio de 7 dígitos como `numRef`, que pey regresa en el aviso: es la referencia de la
    conciliación junto con el IDC del QR y la metadata.
  - Cobros reales de la demo pública con tope (`TOPE_DEMO_CENTAVOS`, $1.00) para que nadie pague de más; se aplican
    como abonos a la cuota.
  - La cartera es ficticia y se regenera cada día; los pagos de otros gestores son datos de ejemplo y se rotulan así.
  - Del pagador solo se guarda el banco y los últimos 4 dígitos de su cuenta.
  - Se reutiliza de Sin Morralla (mismo autor): verificación de firma, tokens, normalización del aviso y difusor.
- **L4 API de pey:** la especificación pública (`docs.pey.mx/openapi.json`, versión 2026-10-20) confirma `numRef` de 1
  a 7 dígitos en `POST /codi/qr` y `/codi/pn`, vigencia mínima de 360 s, que un QR admite varios pagos mientras no
  venza, y `GET /transaction/api-key` (80 por página) y `GET /transaction/{id}`. De ahí salieron el folio por cobro y
  el cuadre contra pey con recuperación de avisos perdidos.
- **L5 RDD T2 (`6e399d7..e037312`, escalado a alto por firma, boletos y reparto de dinero):** revisión
  `review-29d48b594ea48557` con lentes riesgo, legibilidad y confiabilidad: **aprobada y confirmada**. Advertencias
  atendidas con pruebas en `7fb20f5`: un aviso con monto en cero o con fracciones de centavo pasaba como pago; el
  renglón de un error del CSV se corría con renglones vacíos o celdas de varias líneas; un pago repetido en un lado del
  cuadre daba "cuadra"; la regla del número de crédito y la del celular estaban escritas dos veces.
- **L6 RDD del tramo de corrección (`e037312..f6d8689`):** `review-743380d9d6fec101`: **aprobada y confirmada**.
  Advertencia atendida en `bf363cc`: un guion en la columna del celular ("sin celular" en Excel) se rechazaba.
- **L7 RDD T3 (`f6d8689..8b1d50b`, riesgo alto, sola):** `review-b4cffdcbd1a906db` con lentes riesgo, resiliencia y
  confiabilidad: **aprobada y confirmada**. Advertencias atendidas con pruebas en `bf363cc`: el cuerpo del webhook se
  leía completo antes de medirlo; cualquier clave podía mandar cobros al celular sin un límite propio; si pey creaba el
  cobro y su respuesta se perdía, el pago quedaba sin identificar (ahora el cobro se guarda antes de llamar a pey); los
  eventos de ejemplo se marcaban antes de aplicarse; el cambio de día borraba también una cartera importada.
- **L8 RDD T4 (`8b1d50b..2e357df`, escalado a alto por roles y rutas públicas):** `review-4d529c7c48debe80`:
  **aprobada y confirmada**. Advertencias atendidas en `bf363cc`: canales públicos sin tope de conexiones; mensaje del
  límite global distinto sin motivo; error engañoso en el monto simulado; caso "crédito inexistente" sin probar al
  resolver una excepción; código repetido para errores de pey y para la simulación; la marca BOM escrita como carácter
  invisible.
- **L9 RDD de las correcciones (`2e357df..bf363cc`):** `review-ceb57df36c03638b`: **aprobada y confirmada**.
  Advertencias atendidas con pruebas en `3a119ed`: al reiniciar sobre una cartera importada sobrevivían cobros de
  créditos que ya no existen; un evento de ejemplo que falla siempre se reintentaba sin fin (ahora se descarta al
  tercer intento, migración 0002); el tope de conexiones rechazaba a los visitantes nuevos (ahora releva a la conexión
  más antigua). Descartada con evidencia: el esquema no tiene llaves foráneas, así que el orden de borrado no rompe la
  carga. `3a119ed` se evaluó en un árbol limpio como riesgo medio y bajo presupuesto: sin revisión debida. La cadena de
  correcciones se cierra aquí.
- **L10 Herramientas:** escribir código con `﻿` o rangos de acentos por la herramienta de escritura los convierte
  en caracteres invisibles: se usan `String.fromCharCode(0xfeff)` y `\p{M}`. `gentle-ai review assess` sobre el árbol
  con archivos sin seguimiento sube el riesgo y cuenta 0 líneas: cada tramo se revisa en un árbol de trabajo aparte.
- **L11 (2026-11-25) Publicación:** Worker `qadra` versión `843a0811` en la cuenta personal de Cloudflare, con
  `SIMULACION=1` y sin secretos: corre en simulación hasta que el usuario configure `PEY_API_KEY`,
  `PEY_WEBHOOK_SECRET`, `PORTAL_TOKEN` y `JURADO_TOKEN`. **Pendiente del usuario antes de entregar:** llave de pey
  propia, webhook, prueba con un pago real y consulta a `legal@pey.mx` (ver `docs/entrega.md`). El camino de cobro real
  no se ha probado con dinero real.
- **L12 RDD de la interfaz (riesgo alto, tres tramos):** `review-fa7f3adf6d657fa5` (identidad y app del gestor),
  `review-2f172c0c69cc3189` (portal) y `review-9f75a8eee6829470` (landing y página de pago), con lentes riesgo,
  legibilidad y confiabilidad: **aprobadas y confirmadas**. Advertencias atendidas en `4a7c6fe` y `a625d04`. Las reglas
  del navegador que se podían probar sin página se movieron a `web/reglas.js` (RED: módulo inexistente; GREEN 7 pruebas).
  - App del gestor: una visita en cola solo se descarta con un rechazo definitivo (400 o 404); arranque sin señal con
    la sesión y la ruta guardadas; respuestas tardías que ya no pisan a las nuevas (ruta, ficha, cobro); fin de la
    recursión ante un gestor inexistente; "Siguiente visita" espera la ruta actualizada; perder la señal con una hoja
    abierta ya no borra lo escrito; el horario sale de la sesión del servidor.
  - Portal: botones que se reactivan si la acción falla; la cuenta de excepciones se actualiza desde cualquier vista;
    al salir, importar o reiniciar no queda nada de la cartera anterior; cargas con turno para descartar respuestas
    viejas; una clave guardada que ya no sirve se borra.
  - Página de pago: un cobro pagado sin recibo ya no se muestra como pendiente; reintento automático si la primera
    carga falla; una sola consulta al llegar la cuenta a cero.
  - Landing: con el canal en vivo caído se busca el pago nuevo y se muestra "Pagado".
  - No se hizo, con motivo: renombrar el objeto de estado `e` del portal (cambio de nombre en unos cien usos, sin
    efecto en el comportamiento) y pruebas con DOM simulado (se probó la lógica extraída a `web/reglas.js`).
- **L13 RDD de las correcciones (`0b94bd9..a625d04`, escalado a alto por concurrencia y datos guardados en el
  teléfono):** `review-f0544650312b05b4`: **aprobada y confirmada**. Advertencias atendidas en `36d623b` (RED: 3
  pruebas nuevas; GREEN 103/103): las visitas de la cola llevan la huella de la clave que las guardó y las de otra
  clave no se envían solas (se le preguntan a quien entra); la política de la cola quedó en una sola regla; el aviso
  de "ruta guardada" ya no contradice a la pantalla; el service worker se instala todo o nada; la landing no anuncia
  dos veces el mismo pago; la etiqueta de la gráfica recorta debajo de mil pesos. `36d623b` se evaluó en un árbol
  limpio como riesgo medio y bajo presupuesto: sin revisión debida.
- **L14 Verificación de la interfaz corregida:** en el navegador integrado contra el servidor local: cobro → "Pagado"
  → siguiente visita; dos visitas guardadas sin red que sobreviven a una falla 500 y se envían al reconectar; salida
  con visitas pendientes (quedarse o borrarlas); visita guardada con otra clave (no sale sola; "son mías" la envía);
  portal (cuenta de excepciones desde Cartera, asignar una excepción, "Todo cuadra", salida sin rastro); página de
  pago (reintento automático y recibo) y landing sin canal en vivo ("Pagado" por el respaldo). El navegador integrado
  no guarda la copia de la app, así que el arranque sin red se comprobó en Edge sin ventana contra producción: service
  worker activo, los 9 archivos guardados y, sin red, la app abrió con la ruta guardada y el aviso "Sin conexión".
  Una corrida de e2e falló por un cobro pendiente que dejó la verificación a mano (los cobros pendientes sobreviven
  al reinicio a propósito); la suite ahora los vence al empezar.
- **L15 (2026-11-25) Publicación final:** Worker versión `114b3409` desplegado desde `36d623b`. En producción: páginas
  y `reglas.js` 200, clave `demo` con rol jurado, cobro → pago simulado → pagado y cuadre "cuadra". Repositorio público
  en GitHub con `main` y `feat/demo-hackaton`; pasar el trabajo a `main` queda a decisión del usuario.
- **L17 (2026-11-25) Auditoría de impeccable aplicada:** se siguieron sus guías (piso de calidad, layout, distill,
  typeset, polish y animate). Medido antes y después en Edge sin ventana: el titular pasaba de y=209 a y=286 al
  cobrar; ahora no se mueve en ningún tamaño. La carga movía la página (0.037) por la marca pintada con JS; ahora
  ~0.008. Con movimiento reducido se conservan el resaltado de la fila y un fundido de "Pagado". El motor de captura de
  movimiento de impeccable no pudo medir esta animación (empieza al responder el servidor y el pulso era infinito): los
  cuadros se tomaron por CDP y los revisó un subagente con el rol de revisor de movimiento. Durante el trabajo el
  usuario pidió "igual quita estos titulos de cada apartado no me gustan como se ven" (ya estaban quitados en esta
  tanda) y una licencia: "agregale a la documentacion de github na licencia pues el codigo y la idea es nuestra asi
  que nadie puede usarlo mas que para el hackathon" (`0cfb11a`: LICENSE de uso restringido, README y package.json).
  Se dejaron sin cambiar, con motivo: las fuentes y la trama de cuadras (identidad v2), la tarjeta del crédito dentro
  del teléfono (imita la app real) y la estructura de tarjetas de las secciones (sería rediseño, no corrección).
- **L16 (2026-11-25):** "Sí, pasar a main". `main` avanza directo (sin commit de fusión) hasta `feat/demo-hackaton`,
  igual que en Sin Morralla: quien abre el repositorio ve la demo completa.
