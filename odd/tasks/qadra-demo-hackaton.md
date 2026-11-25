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
| T8 | S5, S6 | inline | hecho | Unitarias 94/94, e2e 31/31, `tsc` limpio; servidor local en el puerto 8790 |
| T9 | S2, S3 | inline | hecho | `README.md` con un diagrama Mermaid, `docs/entrega.md` (descripción 483 palabras, instrucciones 606) |
| T10 | S4, S7 | inline | hecho | D1 `qadra` (WNAM) con migraciones 0001 y 0002; Worker en https://qadra.victormlaralopez.workers.dev. En producción: landing, app, portal y página de pago 200; clave `demo` da rol jurado; cobro → pago simulado → pagado; cuadre con el libro simulado "cuadra" |
| T11 | S2, S7 | inline | pendiente | |

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
