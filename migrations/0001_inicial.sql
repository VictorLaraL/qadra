-- Qadra: esquema inicial.
-- El dinero va en centavos enteros y las fechas como texto ISO (UTC) o como día AAAA-MM-DD (hora de la Ciudad de México).

CREATE TABLE gestores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  zona TEXT NOT NULL DEFAULT ''
);

CREATE TABLE creditos (
  id TEXT PRIMARY KEY,                 -- número de crédito de la financiera
  acreditado TEXT NOT NULL,
  telefono TEXT,                       -- celular de 10 dígitos, opcional (para el cobro al celular)
  producto TEXT NOT NULL,
  grupo TEXT,
  colonia TEXT NOT NULL,
  domicilio TEXT,
  gestor_id TEXT,
  orden INTEGER NOT NULL DEFAULT 0,    -- lugar en la ruta de su gestor
  demo INTEGER NOT NULL DEFAULT 0,     -- 1 = crédito de la demo pública de la landing
  creado_en TEXT NOT NULL
);
CREATE INDEX creditos_por_gestor ON creditos (gestor_id, orden);

-- El CHECK de pagado <= monto es la última defensa de la conciliación: si dos pagos intentan cubrir la misma cuota al
-- mismo tiempo, el segundo falla completo y se vuelve a calcular (src/worker/conciliar.ts).
CREATE TABLE cuotas (
  credito_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  vence TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
  pagado_centavos INTEGER NOT NULL DEFAULT 0 CHECK (pagado_centavos >= 0),
  PRIMARY KEY (credito_id, numero),
  CHECK (pagado_centavos <= monto_centavos)
);

-- Un cobro es una solicitud de pago CoDi creada en pey: un QR con vigencia o un cobro enviado al celular.
CREATE TABLE cobros (
  id TEXT PRIMARY KEY,
  folio INTEGER NOT NULL UNIQUE,       -- 7 dígitos: viaja a Banxico como numRef y regresa en el aviso
  token TEXT NOT NULL UNIQUE,          -- link de la página de pago
  credito_id TEXT NOT NULL,
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
  medio TEXT NOT NULL CHECK (medio IN ('qr', 'push')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
  pey_id TEXT,                         -- IDC del QR, o transactionId del cobro push
  qr_string TEXT,
  telefono_fin TEXT,                   -- últimos 4 dígitos del celular (el número completo no se guarda)
  gestor_id TEXT,
  simulado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  vence_en TEXT NOT NULL,
  pagado_en TEXT,
  transaction_id TEXT
);
CREATE INDEX cobros_por_pey ON cobros (pey_id);
CREATE INDEX cobros_por_credito ON cobros (credito_id, estado, monto_centavos);

-- QR fijo de un crédito (su "tarjetón"): no vence y acepta muchos pagos. No se borra en el reinicio diario.
CREATE TABLE qr_fijos (
  credito_id TEXT PRIMARY KEY,
  pey_id TEXT UNIQUE,                  -- NULL mientras se está creando en pey
  qr_string TEXT,
  monto_centavos INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  simulado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);

CREATE TABLE pagos (
  transaction_id TEXT PRIMARY KEY,     -- identificador de pey: un pago se registra una sola vez
  webhook_id TEXT NOT NULL,
  medio TEXT NOT NULL CHECK (medio IN ('qr', 'pn')),
  via TEXT NOT NULL CHECK (via IN ('cobro', 'qr-fijo', 'sin-referencia')),
  cobro_id TEXT,
  credito_id TEXT,
  gestor_id TEXT,
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
  aplicado_centavos INTEGER NOT NULL DEFAULT 0 CHECK (aplicado_centavos >= 0),
  estado TEXT NOT NULL CHECK (estado IN ('aplicado', 'excepcion')),
  motivo TEXT CHECK (motivo IN ('sin-identificar', 'excedente')),
  concepto TEXT,
  num_ref TEXT,
  clave_rastreo TEXT,
  banco TEXT,
  cuenta_fin TEXT,
  origen TEXT NOT NULL CHECK (origen IN ('codi', 'simulado', 'ejemplo')),
  recuperado INTEGER NOT NULL DEFAULT 0, -- 1 = no llegó el aviso y se recuperó consultando a pey
  fecha_pago TEXT NOT NULL,
  recibido_en TEXT NOT NULL,
  resuelto_en TEXT,
  CHECK (aplicado_centavos <= monto_centavos)
);
CREATE INDEX pagos_por_fecha ON pagos (fecha_pago);
CREATE INDEX pagos_por_credito ON pagos (credito_id, fecha_pago);

CREATE TABLE aplicaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  credito_id TEXT NOT NULL,
  cuota_numero INTEGER NOT NULL,
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
  liquida INTEGER NOT NULL DEFAULT 0,
  aplicado_en TEXT NOT NULL
);
CREATE INDEX aplicaciones_por_pago ON aplicaciones (transaction_id);
CREATE INDEX aplicaciones_por_credito ON aplicaciones (credito_id, aplicado_en);

CREATE TABLE gestiones (
  id TEXT PRIMARY KEY,
  credito_id TEXT NOT NULL,
  gestor_id TEXT,
  resultado TEXT NOT NULL CHECK (resultado IN ('pago', 'promesa', 'no-localizado', 'sin-dinero', 'otro')),
  nota TEXT,
  promesa_fecha TEXT,
  promesa_centavos INTEGER,
  latitud REAL,
  longitud REAL,
  origen TEXT NOT NULL DEFAULT 'app' CHECK (origen IN ('app', 'ejemplo')),
  creado_en TEXT NOT NULL
);
CREATE INDEX gestiones_por_credito ON gestiones (credito_id, creado_en);
CREATE INDEX gestiones_por_fecha ON gestiones (creado_en);

-- Libro de pagos ya procesados. Sobrevive al reinicio diario de la cartera de ejemplo: evita aplicar dos veces un pago
-- real si pey repite un aviso al día siguiente, y lleva la cuenta histórica de pagos CoDi reales.
CREATE TABLE recibidos (
  transaction_id TEXT PRIMARY KEY,
  reclamo TEXT NOT NULL,               -- intento que lo registró (ver conciliar.ts)
  monto_centavos INTEGER NOT NULL,
  origen TEXT NOT NULL,
  fecha_pago TEXT NOT NULL
);

-- Lo que hacen los otros gestores durante el día en la cartera de ejemplo (pagos y visitas).
CREATE TABLE ejemplos (
  id TEXT PRIMARY KEY,
  hora TEXT NOT NULL,
  credito_id TEXT NOT NULL,
  gestor_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pago', 'gestion')),
  monto_centavos INTEGER NOT NULL DEFAULT 0,
  medio TEXT NOT NULL,
  banco TEXT NOT NULL DEFAULT '',
  resultado TEXT NOT NULL,
  nota TEXT,
  aplicado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ejemplos_pendientes ON ejemplos (aplicado, hora);

-- Cobranza de los días anteriores, para la gráfica de la semana.
CREATE TABLE historico (
  dia TEXT PRIMARY KEY,
  cobrado_centavos INTEGER NOT NULL,
  pagos INTEGER NOT NULL
);

-- Libro de pey en modo simulación: lo que "pey cobró", para probar el cuadre y la recuperación de avisos perdidos.
CREATE TABLE pey_simulado (
  transaction_id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('qr', 'pn')),
  pey_id TEXT,
  num_ref TEXT,
  cobro_id TEXT,
  credito_id TEXT,
  monto_centavos INTEGER NOT NULL,
  banco_codigo INTEGER NOT NULL,
  clave_rastreo TEXT NOT NULL,
  fecha_seg INTEGER NOT NULL
);

-- Contadores de uso por ventana de tiempo (límites de abuso).
CREATE TABLE limites (
  clave TEXT PRIMARY KEY,
  cuenta INTEGER NOT NULL,
  ventana INTEGER NOT NULL
);

CREATE TABLE ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
