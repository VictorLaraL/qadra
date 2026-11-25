// Cartera de ejemplo de la demo: una financiera ficticia con tres gestores en Mérida.
// Todo es inventado (nombres, créditos y domicilios) y se arma con fechas relativas a "hoy" para que la demo
// siempre tenga cuotas que vencen hoy, atrasos y pagos de otros gestores a lo largo del día.

import type { CreditoImportado, Frecuencia } from "./cartera.ts";
import { generarCuotas } from "./cartera.ts";
import { estadoCredito } from "./conciliacion.ts";
import { instanteCdmx, sumarDias } from "./fechas.ts";

export const FINANCIERA = {
  nombre: "Financiera Jacaranda",
  lema: "Crédito que crece contigo",
  /** Nombre con el que el banco muestra al beneficiario del cobro en la demo. */
  aviso: "Empresa ficticia para la demostración",
} as const;

export interface GestorEjemplo {
  id: string;
  nombre: string;
  zona: string;
}

export const GESTORES: GestorEjemplo[] = [
  { id: "g1", nombre: "Mariana R.", zona: "Poniente" },
  { id: "g2", nombre: "Diego T.", zona: "Oriente" },
  { id: "g3", nombre: "Karla S.", zona: "Sur" },
];

/** Crédito con el que funciona la demo pública de la landing (su QR fijo de un centavo). */
export const CREDITO_DEMO = "004512";

export interface CreditoEjemplo extends CreditoImportado {
  gestorId: string;
  orden: number;
  demo: boolean;
}

export interface EventoEjemplo {
  id: string;
  /** Instante (ISO) en que "ocurre" durante el día. */
  hora: string;
  creditoId: string;
  gestorId: string;
  tipo: "pago" | "gestion";
  /** Para tipo "pago": monto, medio y banco. Para "gestion": resultado y nota. */
  montoCentavos: number;
  medio: "qr" | "pn";
  banco: string;
  resultado: "pago" | "promesa" | "no-localizado" | "sin-dinero";
  nota: string | null;
}

export interface DatosDeEjemplo {
  gestores: GestorEjemplo[];
  creditos: CreditoEjemplo[];
  eventos: EventoEjemplo[];
  /** Cobranza de los 6 días anteriores, para la gráfica de la semana. */
  historico: Array<{ dia: string; cobradoCentavos: number; pagos: number }>;
}

// id, acreditado, producto, grupo, colonia, domicilio, cuota en pesos, cuotas totales, pagadas, frecuencia,
// días al próximo vencimiento (0 = vence hoy, negativo = atrasado, positivo = aún no vence).
type Fila = [string, string, string, string | null, string, string, number, number, number, Frecuencia, number];

const GRUPAL = "Grupal semanal";
const INDIVIDUAL = "Individual quincenal";

const CARTERA: Record<string, Fila[]> = {
  g1: [
    ["004512", "Rosa M.", GRUPAL, "Las Flores", "Chuburná", "Calle 21 #104 x 18 y 20", 450, 16, 7, "semanal", 0],
    ["004518", "Lupita C.", GRUPAL, "Las Flores", "Chuburná", "Calle 23 #88 x 20 y 22", 450, 16, 7, "semanal", 0],
    ["004527", "Carmen V.", GRUPAL, "Las Flores", "Chuburná", "Calle 19 #130 x 24 y 26", 380, 16, 6, "semanal", -7],
    ["004533", "Jorge P.", INDIVIDUAL, null, "Francisco de Montejo", "Calle 51 #312 x 46 y 48", 1250, 12, 4, "quincenal", 0],
    ["004541", "Elena G.", INDIVIDUAL, null, "Francisco de Montejo", "Calle 43 #207 x 50 y 52", 980, 12, 9, "quincenal", -3],
    ["004546", "Pedro A.", INDIVIDUAL, null, "Caucel", "Calle 31 #415 x 70 y 72", 1480, 10, 2, "quincenal", 0],
    ["004552", "Martha L.", GRUPAL, "Nueva Esperanza", "Caucel", "Calle 29 #96 x 66 y 68", 520, 16, 11, "semanal", -9],
    ["004559", "Silvia N.", GRUPAL, "Nueva Esperanza", "Caucel", "Calle 27 #54 x 64 y 66", 520, 16, 12, "semanal", 0],
    ["004563", "Ana T.", GRUPAL, "Nueva Esperanza", "Caucel", "Calle 33 #21 x 68 y 70", 520, 16, 12, "semanal", 3],
  ],
  g2: [
    ["004601", "Beatriz O.", GRUPAL, "Emprendedoras de Oriente", "Pacabtún", "Calle 14 #233 x 41 y 43", 410, 16, 5, "semanal", 0],
    ["004604", "Teresa F.", GRUPAL, "Emprendedoras de Oriente", "Pacabtún", "Calle 16 #180 x 39 y 41", 410, 16, 5, "semanal", 0],
    ["004609", "Norma J.", GRUPAL, "Emprendedoras de Oriente", "Pacabtún", "Calle 12 #77 x 45 y 47", 410, 16, 5, "semanal", 0],
    ["004615", "Raúl D.", INDIVIDUAL, null, "Vergel", "Calle 6 #510 x 13 y 15", 1650, 12, 7, "quincenal", 0],
    ["004622", "Miguel Á.", INDIVIDUAL, null, "Vergel", "Calle 8 #342 x 17 y 19", 1120, 12, 3, "quincenal", -5],
    ["004628", "Gloria P.", GRUPAL, "Manos Unidas", "Kanasín", "Calle 20 #65 x 23 y 25", 360, 16, 9, "semanal", 0],
    ["004634", "Patricia E.", GRUPAL, "Manos Unidas", "Kanasín", "Calle 22 #118 x 27 y 29", 360, 16, 9, "semanal", -14],
    ["004640", "Iván R.", INDIVIDUAL, null, "Kanasín", "Calle 18 #201 x 21 y 23", 890, 12, 10, "quincenal", 6],
  ],
  g3: [
    ["004702", "Leticia B.", GRUPAL, "Mujeres del Sur", "San José Tecoh", "Calle 131 #402 x 62 y 64", 480, 16, 8, "semanal", 0],
    ["004707", "Rocío H.", GRUPAL, "Mujeres del Sur", "San José Tecoh", "Calle 133 #276 x 60 y 62", 480, 16, 8, "semanal", 0],
    ["004713", "Dolores Q.", GRUPAL, "Mujeres del Sur", "San José Tecoh", "Calle 129 #150 x 58 y 60", 480, 16, 7, "semanal", -7],
    ["004719", "Héctor S.", INDIVIDUAL, null, "Mulsay", "Calle 75 #318 x 100 y 102", 1350, 12, 6, "quincenal", 0],
    ["004724", "Óscar M.", INDIVIDUAL, null, "Mulsay", "Calle 79 #91 x 104 y 106", 1560, 10, 1, "quincenal", 0],
    ["004731", "Julio C.", INDIVIDUAL, null, "Emiliano Zapata Sur", "Calle 92 #540 x 153 y 155", 940, 12, 5, "quincenal", -2],
    ["004736", "Andrés V.", GRUPAL, "Mujeres del Sur", "Emiliano Zapata Sur", "Calle 94 #63 x 157 y 159", 480, 16, 15, "semanal", 0],
  ],
};

// Lo que pasa en el día con los otros gestores: hora, minuto, crédito, medio, banco y resultado.
// Un pago cubre lo exigible del crédito a esa hora.
type Guion = [number, number, string, "qr" | "pn", string, EventoEjemplo["resultado"], string | null];

const GUION: Guion[] = [
  [8, 12, "004601", "qr", "BBVA México", "pago", null],
  [8, 31, "004604", "qr", "Banco Azteca", "pago", null],
  [8, 54, "004702", "pn", "Banorte", "pago", null],
  [9, 12, "004518", "qr", "BBVA México", "pago", null],
  [9, 26, "004707", "qr", "BanCoppel", "pago", null],
  [9, 47, "004559", "pn", "Santander", "pago", null],
  [10, 5, "004615", "qr", "Banamex", "pago", null],
  [10, 20, "004622", "qr", "", "promesa", "Paga el viernes al recibir su quincena."],
  [10, 48, "004719", "qr", "Nu México", "pago", null],
  [11, 5, "004713", "qr", "", "no-localizado", "No había nadie; se dejó aviso con el titular por mensaje."],
  [11, 32, "004628", "pn", "Mercado Pago", "pago", null],
  [12, 14, "004609", "qr", "BBVA México", "pago", null],
  [12, 40, "004634", "qr", "", "sin-dinero", "Pide volver mañana después de las 5."],
  [13, 22, "004724", "qr", "HSBC", "pago", null],
  [15, 8, "004731", "pn", "Banorte", "pago", null],
  [16, 37, "004736", "qr", "Spin by OXXO", "pago", null],
];

// Cobranza de los últimos días (centavos y número de pagos), del más reciente al más antiguo.
const SEMANA: Array<[number, number]> = [
  [2_287_000, 38],
  [1_956_500, 33],
  [2_412_000, 41],
  [1_698_000, 28],
  [2_130_500, 36],
  [1_845_000, 31],
];

/** Arma la cartera de ejemplo con fechas relativas a `hoy` (AAAA-MM-DD, hora de la Ciudad de México). */
export function datosDeEjemplo(hoy: string): DatosDeEjemplo {
  const creditos: CreditoEjemplo[] = [];
  for (const gestor of GESTORES) {
    CARTERA[gestor.id].forEach((f, indice) => {
      const [id, acreditado, producto, grupo, colonia, domicilio, cuota, totales, pagadas, frecuencia, dias] = f;
      creditos.push({
        id,
        acreditado,
        telefono: null,
        producto,
        grupo,
        colonia,
        domicilio,
        gestor: gestor.nombre,
        gestorId: gestor.id,
        montoCuotaCentavos: cuota * 100,
        cuotasTotales: totales,
        cuotasPagadas: pagadas,
        frecuencia,
        proximoVencimiento: sumarDias(hoy, dias),
        orden: indice + 1,
        demo: id === CREDITO_DEMO,
      });
    });
  }

  const porId = new Map(creditos.map((c) => [c.id, c]));
  const eventos: EventoEjemplo[] = GUION.map(([hora, minuto, creditoId, medio, banco, resultado, nota], indice) => {
    const credito = porId.get(creditoId) as CreditoEjemplo;
    const exigible = estadoCredito(generarCuotas(credito), hoy).exigibleCentavos;
    return {
      id: `EJ-${hoy}-${String(indice + 1).padStart(2, "0")}`,
      hora: instanteCdmx(hoy, hora, minuto),
      creditoId,
      gestorId: credito.gestorId,
      tipo: resultado === "pago" ? "pago" : "gestion",
      montoCentavos: resultado === "pago" ? exigible : 0,
      medio,
      banco,
      resultado,
      nota,
    };
  });

  const historico = SEMANA.map(([cobradoCentavos, pagos], indice) => ({ dia: sumarDias(hoy, -(indice + 1)), cobradoCentavos, pagos }));

  return { gestores: GESTORES, creditos, eventos, historico };
}
