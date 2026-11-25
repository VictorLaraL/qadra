// Convierte el aviso de pago de pey en un objeto propio, en centavos y con lo necesario para conciliar.
// Documentado en docs.pey.mx/docs/webhooks/codi/qr y /codi/pn (versión 2026-10-20 del API).

export interface PagoRecibido {
  webhookId: string;
  /** qr = pagaron un QR; pn = aceptaron un cobro enviado al celular (push). */
  tipo: "qr" | "pn";
  transactionId: string;
  montoCentavos: number;
  concepto: string;
  /** IDC del QR pagado (solo en pagos por QR). */
  codiQrId: string | null;
  /** Referencia numérica que mandamos al crear el cobro (nuestro folio) y que Banxico regresa. */
  numRef: string | null;
  /** Clave de rastreo SPEI: el comprobante del pago ante cualquier banco. */
  claveRastreo: string | null;
  /** Banco desde el que se pagó. */
  banco: string | null;
  /** Últimos 4 dígitos de la cuenta que pagó. La CLABE completa no se guarda. */
  cuentaFin: string | null;
  fechaPago: string;
  /** Metadata que mandamos al crear el cobro (cobro y crédito), tal como la regresa pey. */
  metadata: Record<string, unknown>;
}

type Objeto = Record<string, unknown>;

function esObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return valor === undefined || valor === null || valor === "" ? null : String(valor);
}

const TIPO_PAGO = /^codi\.(qr|pn)\.payment_received$/;

/** Claves de institución de Banxico (catálogo del SPEI) de los bancos más comunes. */
const BANCOS: Record<string, string> = {
  "40002": "Banamex",
  "40012": "BBVA México",
  "40014": "Santander",
  "40021": "HSBC",
  "40030": "BanBajío",
  "40036": "Inbursa",
  "40044": "Scotiabank",
  "40058": "Banregio",
  "40072": "Banorte",
  "40127": "Banco Azteca",
  "40137": "BanCoppel",
  "90638": "Nu México",
  "90646": "STP",
  "90661": "Klar",
  "90722": "Mercado Pago",
  "90723": "Cuenca",
  "90728": "Spin by OXXO",
};

/** Nombre del banco a partir de su clave de Banxico; si no está en la lista, se muestra la clave. */
export function nombreBanco(codigo: unknown): string | null {
  const clave = String(codigo ?? "").trim();
  if (!/^\d{3,6}$/.test(clave)) return null;
  return BANCOS[clave] ?? `Banco ${clave}`;
}

/** Cuerpo del evento: los campos van en la raíz (como en la documentación) o dentro de `data`. */
function cuerpoDelAviso(aviso: Objeto): Objeto {
  return esObjeto(aviso.data) ? { ...aviso.data, type: aviso.type ?? aviso.data.type } : aviso;
}

/** true si el evento dice ser un pago CoDi recibido, aunque le falten datos. */
export function esEventoDePago(aviso: unknown): boolean {
  return esObjeto(aviso) && TIPO_PAGO.test(String(cuerpoDelAviso(aviso).type ?? ""));
}

/**
 * Regresa null si el evento no es un pago CoDi recibido o le faltan datos.
 * Acepta los campos en la raíz (como en la documentación) o dentro de `data`.
 */
export function normalizarPago(webhookId: string, aviso: unknown, ahora = new Date()): PagoRecibido | null {
  if (!esObjeto(aviso)) return null;
  const datos = cuerpoDelAviso(aviso);

  const coincidencia = TIPO_PAGO.exec(String(datos.type ?? ""));
  if (!coincidencia) return null;

  const transactionId = texto(datos.transactionId);
  // Solo un número, o un texto decimal simple ("13.50"). Number() convierte null, "", true o [5] en números
  // y un aviso sin monto válido no debe registrarse como pago.
  const crudo = datos.amount;
  const montoValido = typeof crudo === "number" || (typeof crudo === "string" && /^\s*\d+(\.\d+)?\s*$/.test(crudo));
  if (!montoValido) return null;
  const monto = Number(crudo);
  if (!transactionId || !Number.isFinite(monto) || monto < 0) return null;

  const metadataPey = esObjeto(datos.metadata) ? datos.metadata : {};
  let nuestra: unknown = metadataPey.externalMetadata ?? {};
  if (typeof nuestra === "string") {
    try {
      nuestra = JSON.parse(nuestra);
    } catch {
      nuestra = {};
    }
  }

  // pey manda segundos Unix. Si llega algo fuera de rango (milisegundos, negativo, futuro lejano),
  // se usa la hora de recepción para no guardar fechas absurdas.
  const segundos = Number(datos.datePaid);
  const desde2020 = Date.UTC(2020, 0, 1) / 1000;
  const hastaManana = ahora.getTime() / 1000 + 86_400;
  const fechaPago = Number.isFinite(segundos) && segundos >= desde2020 && segundos <= hastaManana ? new Date(segundos * 1000) : ahora;

  const clabe = String(metadataPey.clabe ?? "").replace(/\D/g, "");

  return {
    webhookId,
    tipo: coincidencia[1] as "qr" | "pn",
    transactionId,
    montoCentavos: Math.round(monto * 100),
    concepto: String(datos.concept ?? ""),
    codiQrId: texto(datos.codiQrId),
    numRef: texto(datos.numRef),
    claveRastreo: texto(metadataPey.trackingKey),
    banco: nombreBanco(metadataPey.bankCode),
    cuentaFin: clabe.length >= 4 ? clabe.slice(-4) : null,
    fechaPago: fechaPago.toISOString(),
    metadata: esObjeto(nuestra) ? nuestra : {},
  };
}
