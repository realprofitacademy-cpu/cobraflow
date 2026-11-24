/**
 * COBRAFLOW — PLANTILLAS DE MENSAJES DE WHATSAPP PARA EDUCACIÓN Y COBRANZAS
 *
 * Plantillas preconfiguradas y optimizadas para academias y empresas en Venezuela:
 *  - Lanzamiento de cohortes y admisiones
 *  - Recordatorios preventivos y de vencimiento con tasa oficial BCV
 *  - Confirmación de recepción de pago y recibo digital
 */

export interface FinanceTemplateVars {
  contactName?: string;
  courseName?: string;
  cohortName?: string;
  startDate?: string;
  invoiceNumber?: string;
  amountUsd?: string;
  amountVes?: string;
  balanceUsd?: string;
  balanceVes?: string;
  bcvRate?: string;
  dueDate?: string;
  paymentMethods?: string;
  studentCode?: string;
  receiptNumber?: string;
}

export const FINANCE_WHATSAPP_TEMPLATES = {
  /**
   * 1. Convocatoria y Admisión a Cohorte
   */
  ADMISSIONS_LAUNCH: `¡Hola {{contactName}}! 👋 Te escribimos de CobraFlow Academy.

Nos complace anunciarte que abrimos inscripciones para el curso *{{courseName}}* (Turma: {{cohortName}}).

📅 *Inicio:* {{startDate}}
💵 *Inversión:* {{amountUsd}} (~{{amountVes}} a tasa BCV {{bcvRate}} Bs/$)

Los cupos son limitados. Si deseas asegurar tu lugar o conocer el contenido programático, responde a este mensaje y con gusto te asistiremos. 🚀`,

  /**
   * 2. Recordatorio Preventivo de Pago (3 días antes)
   */
  PAYMENT_REMINDER_PRE_DUE: `Hola {{contactName}} 👋 Esperamos que estés muy bien.

Te recordamos que la factura *{{invoiceNumber}}* correspondiente a *{{courseName}}* vence el próximo *{{dueDate}}*.

💰 *Monto a pagar:* {{balanceUsd}}
🇻🇪 *Equivalente en Bolívares hoy:* {{balanceVes}} (Tasa oficial BCV: {{bcvRate}} Bs/$)

💳 *Métodos de pago disponibles:*
{{paymentMethods}}

Una vez realizado tu pago, por favor envíanos el comprobante o número de referencia por aquí para conciliarlo de inmediato. ¡Muchas gracias!`,

  /**
   * 3. Recordatorio de Vencimiento de Factura (Día de vencimiento o vencida)
   */
  PAYMENT_REMINDER_DUE: `Hola {{contactName}}, te saludamos de administración.

Te informamos que tu factura *{{invoiceNumber}}* por concepto de *{{courseName}}* presenta un saldo pendiente de *{{balanceUsd}}* (*{{balanceVes}}* a tasa BCV de hoy {{bcvRate}} Bs/$).

Por favor realiza tu abono hoy para mantener activo tu estatus en la cohorte {{cohortName}}.

📌 *Datos para Pago Móvil / Transferencia:*
{{paymentMethods}}

Quedamos atentos a tu comprobante de pago. ¡Gracias por tu compromiso!`,

  /**
   * 4. Confirmación y Recibo de Pago
   */
  PAYMENT_CONFIRMATION: `¡Pago confirmado con éxito, {{contactName}}! 🎉

Hemos recibido y conciliado tu abono de *{{amountUsd}}* (*{{amountVes}}*).

📄 *Factura:* {{invoiceNumber}}
🔢 *Referencia:* {{receiptNumber}}
📊 *Saldo pendiente:* {{balanceUsd}} ({{balanceVes}})
🎓 *Estatus de alumno ({{studentCode}}):* Activo en {{cohortName}}

¡Gracias por formar parte de nuestra academia! Si tienes cualquier consulta estamos a tu orden.`,
};

/**
 * Métodos de pago por defecto para negocios y academias en Venezuela.
 */
export const DEFAULT_VENEZUELA_PAYMENT_INSTRUCTIONS = `• *Pago Móvil:* Banco Banesco (0134) | CI/RIF: J-501234567 | Telf: 0412-1234567
• *Transferencia Bancaria:* Banesco Cuenta Corriente: 0134-0000-00-0000000000
• *Zelle:* pagos@cobraflow.academy
• *Efectivo:* En sede administrativa`;

/**
 * Renderiza una plantilla sustituyendo variables con formato seguro.
 */
export function renderFinanceTemplate(template: string, vars: FinanceTemplateVars): string {
  let output = template;

  const replacements: Record<string, string> = {
    "{{contactName}}": vars.contactName || "Estimado(a) alumno(a)",
    "{{courseName}}": vars.courseName || "Curso Profesional",
    "{{cohortName}}": vars.cohortName || "Cohorte Actual",
    "{{startDate}}": vars.startDate || "Próximamente",
    "{{invoiceNumber}}": vars.invoiceNumber || "INV-0000",
    "{{amountUsd}}": vars.amountUsd || "$0.00",
    "{{amountVes}}": vars.amountVes || "0,00 Bs",
    "{{balanceUsd}}": vars.balanceUsd || "$0.00",
    "{{balanceVes}}": vars.balanceVes || "0,00 Bs",
    "{{bcvRate}}": vars.bcvRate || "65.00",
    "{{dueDate}}": vars.dueDate || "Hoy",
    "{{paymentMethods}}": vars.paymentMethods || DEFAULT_VENEZUELA_PAYMENT_INSTRUCTIONS,
    "{{studentCode}}": vars.studentCode || "ALU-000",
    "{{receiptNumber}}": vars.receiptNumber || "REF-000",
  };

  for (const [key, val] of Object.entries(replacements)) {
    output = output.replaceAll(key, val);
  }

  return output;
}
