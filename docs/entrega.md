# Entrega en pey.build

Textos listos para copiar en el formulario de entrega (bases §10.1). La postulación cierra el **10 de diciembre de
2026** y la entrega se puede editar hasta el **12 de diciembre de 2026 a las 23:59** (hora de la Ciudad de México).

| Campo (§10.1) | Qué poner | Estado |
|---|---|---|
| 1. Nombre y descripción (máx. 500 palabras) | Sección 1 de este documento (483 palabras) | Listo |
| 2. Demo pública | https://qadra.victormlaralopez.workers.dev | Publicada, en modo simulación |
| 2. Credenciales de prueba | App del gestor y portal con la clave de jurado (solo en el formulario, nunca en el repositorio) | Falta configurar `JURADO_TOKEN` |
| 3. Video (máx. 3 minutos, público) | Link del video | Por grabar |
| 4. Repositorio | https://github.com/VictorLaraL/qadra | Listo |
| 5. Componentes previos y de terceros | Sección 2 de este documento | Listo |
| 6. Instrucciones de prueba (máx. 1000 palabras) | Sección 3 de este documento (606 palabras). Describe la demo ya con cobros reales; hoy está en simulación | Poner la clave de jurado y revisar tras la prueba real |
| 7. Integrantes | Un integrante (cuenta personal) | Listo |

## Pendiente antes de entregar

Las bases piden un cobro CoDi **real** creado por API y que el proyecto reaccione a su resultado; una integración
simulada no cuenta. Hoy la demo pública corre en simulación, así que falta:

1. **Consultar a `legal@pey.mx` antes del 10 de diciembre** (bases §7.7): Qadra es una herramienta para financieras y
   los términos del API piden autorización para ese giro. En la demo no hay ninguna financiera real: la cartera es
   ficticia y los cobros caen en la cuenta de pruebas del proyecto. Declarar el tema en la postulación (§5.6).
2. **Crear en el portal de pey una API key propia para Qadra** (bases §4.2: cada proyecto usa sus propias
   credenciales; no sirve la de Sin Morralla) y registrar el webhook
   `https://qadra.victormlaralopez.workers.dev/webhooks/pey`.
3. **Configurar los secretos** en Cloudflare:

   ```bash
   npx wrangler secret put PEY_API_KEY
   npx wrangler secret put PEY_WEBHOOK_SECRET
   npx wrangler secret put PORTAL_TOKEN
   npx wrangler secret put JURADO_TOKEN
   ```

   Con `PEY_API_KEY` la simulación se apaga sola y la clave `demo` deja de servir.
4. **Probar con dinero real** ($0.01): el QR de la landing, un cobro por QR desde la app del gestor, un cobro al
   celular y **Comparar con pey** en el portal. Si algo de pey responde distinto a lo esperado, corregirlo antes de
   grabar.
5. **Actualizar** el estado en el README y los textos de este documento (sección 3, paso 1) con el resultado.

**Guion sugerido del video (§10.1.3: desde que se genera el cobro hasta que el proyecto reacciona):**

1. (0:00–0:20) El problema: cobrar un crédito cuesta comisión, horas de conciliación y efectivo en la calle.
2. (0:20–1:20) Pantalla dividida, app del gestor y portal: el gestor abre a Rosa M., toca **Cobrar con CoDi** y aparece
   el QR creado en pey. Se paga desde la app del banco. La app cambia a **Pagado** y el pago entra en vivo al portal,
   ya aplicado a su cuota.
3. (1:20–1:50) Cobro al celular: llega la solicitud a la app bancaria y se concilia igual.
4. (1:50–2:35) En el portal, **Comparar con pey**: "Todo cuadra". Luego una transferencia sin referencia que se asigna
   a un crédito con dos clics.
5. (2:35–3:00) Cierre: sin efectivo, sin comisión, sin conciliar a mano. El dinero nunca pasa por Qadra.

No muestres en el video el comprobante del banco sin tapar nombres, números de cuenta ni la clave de rastreo.

---

## 1. Nombre y descripción

**Qadra — Que todo cuadre**

Las financieras que prestan a personas (microcrédito, crédito de consumo, empeño) cobran miles de pagos pequeños cada
semana, y cobrarlos sale caro. Cada pago en tienda o por transferencia referenciada lleva comisión. Las transferencias
a una cuenta general se concilian a mano, buscando en Excel quién pagó. Y los gestores que cobran en campo cargan
efectivo, con el riesgo que eso trae para ellos y para la financiera.

**Qadra** es un módulo de cobranza con CoDi que se pone encima del sistema que la financiera ya usa:

1. El gestor abre su **ruta del día** en el celular y entra al crédito que va a cobrar.
2. Toca **Cobrar con CoDi** y elige: un **QR en su pantalla** o una **solicitud de cobro al celular** del acreditado.
   También puede mandarle un **link de pago** con la marca de la financiera.
3. El acreditado paga desde la app de su banco, **sin comisión**. El dinero va por SPEI directo a la cuenta de la
   financiera: ni el gestor ni Qadra lo tocan.
4. En segundos el gestor ve **Pagado**, y el pago ya está aplicado a la cuota correcta.

**Para la financiera** hay un portal con la cobranza del día en vivo, la conciliación, las excepciones y la cartera.

**Cada pago se concilia solo.** Cada cobro lleva un folio que viaja a Banxico como `numRef` y regresa en el aviso de
pey. Con ese folio, el identificador del QR y la metadata, Qadra sabe de qué crédito es el pago y lo reparte entre sus
cuotas. Un pago se aplica una sola vez aunque el aviso se repita, y una cuota nunca queda pagada de más aunque lleguen
dos pagos a la vez. Lo que no se puede identificar queda como excepción y se asigna con dos clics: nada se pierde.

**El día cuadra contra pey.** El portal pide a pey las transacciones del día y las compara con lo registrado. Si pey
cobró algo que Qadra no tiene, el aviso se perdió: Qadra lo muestra y recupera el pago consultando la transacción.

**Por qué CoDi y pey.** CoDi no cobra comisión, está en la app de todos los bancos y confirma en segundos. Del API de
pey usamos `POST /codi/qr` (cobros con vigencia y QR fijo por crédito), `POST /codi/pn` (cobro al celular), los
webhooks `codi.qr.payment_received` y `codi.pn.payment_received`, y `GET /transaction/api-key` y
`GET /transaction/{id}` para el cuadre y la recuperación.

**Cobranza con reglas.** El gestor no toca dinero, solo se contacta al titular y el horario de gestión se revisa en el
servidor. Del pagador solo se guardan el banco y los últimos cuatro dígitos de su cuenta.

**La demo** usa una financiera y una cartera ficticias. En la landing hay un teléfono con el QR fijo de un crédito de
ejemplo: quien lo paga ve "Pagado" y el pago conciliado en vivo.

## 2. Componentes previos y de terceros

- **Sin Morralla** (mismo autor, repositorio público https://github.com/VictorLaraL/sin-morralla, otro proyecto de este
  hackatón): se reutilizó sin cambios la verificación de firma de los avisos (`src/core/firma.ts`) y se adaptaron la
  lectura del aviso de pago, los tokens y boletos, el difusor en vivo y el dibujo del QR. Qadra usa credenciales de pey
  propias.
- **Todo lo demás** se escribió para Qadra a partir del 25 de noviembre de 2026 (primer commit: `f448231`).
- **Terceros:** [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT, incluido en
  `web/vendor`); `standardwebhooks` solo en pruebas; Wrangler y TypeScript como herramientas; tipografías de Google
  Fonts.

## 3. Instrucciones para probar el proyecto

**1. La demo de la landing (1 minuto)**

1. Abre https://qadra.victormlaralopez.workers.dev. El teléfono muestra un crédito de ejemplo.
2. Presiona **Cobrar $0.01 con CoDi**: aparece su QR CoDi, creado con el API de pey (`POST /codi/qr`).
3. Abre la app de tu banco, entra a CoDi y escanea el QR. Si estás en el celular, presiona **Guardar QR** y ábrelo desde
   la app del banco. Revisa el monto ($0.01) y paga. El beneficiario que muestra tu banco es la cuenta de pruebas del
   proyecto.
4. En segundos pey avisa al Worker por webhook; el Worker verifica la firma, concilia el pago contra la cuota y lo manda
   en vivo a la página. Verás **Pagado** en el teléfono y el pago en "Conciliación en vivo".

**2. La app del gestor**

1. Abre https://qadra.victormlaralopez.workers.dev/gestor/ y entra con la clave de jurado: `[CLAVE DE JURADO]`. En una
   computadora se ve dentro de un marco de teléfono; también puedes escanear el QR de la izquierda para abrirla en tu
   celular.
2. Abre un crédito de la ruta y toca **Cobrar con CoDi**. Elige **Abono de prueba $0.01** (en la demo pública cada cobro
   real tiene un tope de $1.00) y **QR en pantalla**. Paga el QR desde tu banco: la app cambia a **Pagado**, con la
   cuota a la que se aplicó y la clave de rastreo.
3. Repite con **Cobro a su celular** y tu número de 10 dígitos: te llega la solicitud de cobro a tu app bancaria.
4. Toca **Enviar link de pago** para ver la página que recibe el acreditado, con la marca de la financiera.
5. En otro crédito toca **Registrar visita** y guarda una promesa de pago.

**3. El portal de la financiera**

1. Abre https://qadra.victormlaralopez.workers.dev/portal/ con la misma clave y déjalo abierto mientras cobras en la
   app: cada pago llega en vivo.
2. En **Resumen** presiona **Comparar con pey**: Qadra pide a pey las transacciones de hoy (`GET /transaction/api-key`)
   y las compara con las registradas.
3. En **Conciliación** verás cada pago con su crédito, su cuota, el banco y la clave de rastreo (recortada para el
   jurado). **Exportar pagos (CSV)** descarga el archivo para el sistema de la financiera.
4. En **Cartera** abre cualquier crédito para ver su calendario y sus movimientos.
5. En **Integración** descarga la plantilla, cambia un dato y súbela: la validación señala el renglón y la columna de
   cada error. Importar y reiniciar la demo es solo del administrador.

**4. El recorrido completo en tu computadora (5 minutos, sin dinero real)**

Requisitos: Node.js 22.18 o más reciente.

```
git clone https://github.com/VictorLaraL/qadra.git
cd qadra
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

- Abre http://localhost:8790 y entra a la app del gestor y al portal con las claves de tu `.dev.vars`. Sin API key de
  pey todo corre en simulación: cada pantalla trae un botón para simular el pago, que manda un aviso firmado al mismo
  `/webhooks/pey` que usa pey. Todo lo simulado dice SIMULADO.
- En el portal, **Conciliación** trae dos pruebas: **Simular un aviso de pago que se pierde** (el cuadre lo detecta y
  **Recuperar** lo trae) y **Simular transferencia sin referencia** (queda por revisar y se asigna a un crédito).
- Pruebas automáticas: `npm test` (101 unitarias) y `npm run e2e` con `npm run dev` corriendo en otra terminal (31 de
  punta a punta: firmas, pagos repetidos y simultáneos, excepciones, cuadre, canal en vivo y carga de cartera).

**Dónde mirar en el código:** `src/worker/pey.ts` (llamadas a pey), `src/worker/cobros.ts` (el cobro se guarda antes de
llamar a pey), `src/worker/webhook.ts` y `src/core/firma.ts` (aviso firmado), `src/worker/conciliar.ts` y
`src/core/conciliacion.ts` (reparto entre cuotas, una sola vez) y `src/worker/tableros.ts` (cuadre contra pey).
