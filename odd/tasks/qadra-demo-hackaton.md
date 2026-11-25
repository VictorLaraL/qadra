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
| T1 | S3, S4 | inline | en curso | |
| T2 | S1, S5 | inline | pendiente | |
| T3 | S1, S4 | inline | pendiente | |
| T4 | S1, S5 | inline | pendiente | |
| T5 | S1, S5 | inline | pendiente | |
| T6 | S1, S5 | inline | pendiente | |
| T7 | S1, S5 | inline | pendiente | |
| T8 | S5, S6 | inline | pendiente | |
| T9 | S2, S3 | inline | pendiente | |
| T10 | S4, S7 | inline | pendiente | |
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
    integraciones e identidad completa) se queda en `Documents\Qadra\Docs`, fuera del repositorio.
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
