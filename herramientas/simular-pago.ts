// Manda un aviso de pago firmado, igual que los de pey, al servidor local.
// Uso: npm run simular:pago -- --folio 1234567 --monto 450
//      npm run simular:pago -- --monto 380            (sin referencia: queda como excepción)
//
// El folio es el del cobro (se ve en la app del gestor y en la página de pago). El secreto de firma se lee de .dev.vars.

import { parseArgs } from "node:util";
import { aCentavos } from "../src/core/dinero.ts";
import { avisoDePago, BASE, enviarAviso, leerDevVars } from "./comun.ts";

const { values } = parseArgs({
  options: { folio: { type: "string" }, monto: { type: "string" }, tipo: { type: "string", default: "qr" } },
});

const montoCentavos = aCentavos(values.monto ?? "");
if (!montoCentavos) {
  console.error("Falta el monto. Ejemplo: npm run simular:pago -- --folio 1234567 --monto 450");
  process.exit(1);
}
if (values.folio && !/^[1-9]\d{6}$/.test(values.folio)) {
  console.error("El folio de un cobro tiene 7 dígitos.");
  process.exit(1);
}
if (values.tipo !== "qr" && values.tipo !== "pn") {
  console.error('El tipo debe ser "qr" o "pn".');
  process.exit(1);
}

const secreto = leerDevVars().PEY_WEBHOOK_SECRET;
if (!secreto) {
  console.error("Falta PEY_WEBHOOK_SECRET en .dev.vars (copia .dev.vars.example).");
  process.exit(1);
}

const aviso = avisoDePago({ tipo: values.tipo, montoCentavos, folio: values.folio ? Number(values.folio) : undefined });
const respuesta = await enviarAviso(secreto, aviso);
console.log(`${BASE}/webhooks/pey -> ${respuesta.status}`, await respuesta.json());
console.log(`Transacción: ${aviso.transactionId} · clave de rastreo: ${aviso.metadata.trackingKey}`);
