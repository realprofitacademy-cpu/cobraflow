/**
 * COBRAFLOW — SERVICIO DE RECORDATORIOS AUTOMATIZADOS DE PAGO (WHATSAPP)
 *
 * Identifica facturas próximas a vencer o con saldo deudor en academias e institutos,
 * calcula la conversión a bolívares con la tasa oficial BCV del día, y prepara
 * los recordatorios para su despacho por WhatsApp.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestBcvRate, convertUsdCentsToVes } from "./bcv-service";
import {
  FINANCE_WHATSAPP_TEMPLATES,
  renderFinanceTemplate,
  DEFAULT_VENEZUELA_PAYMENT_INSTRUCTIONS,
} from "./templates";
import { logger } from "@/lib/logger";

export interface ReminderJobResult {
  scannedInvoices: number;
  remindersQueued: number;
  skipped: number;
  errors: number;
  details: Array<{
    invoiceId: string;
    invoiceNumber: string;
    contactId: string;
    contactName: string;
    dueDate: string;
    balanceUsd: string;
    balanceVes: string;
    status: "queued" | "skipped" | "dry_run" | "error";
    reason?: string;
  }>;
}

export interface RunPaymentRemindersOptions {
  organizationId?: string;
  daysThreshold?: number; // Ventana de días antes del vencimiento (default: 3 días)
  dryRun?: boolean;
}

export async function processPaymentReminders(
  db: SupabaseClient,
  options: RunPaymentRemindersOptions = {},
): Promise<ReminderJobResult> {
  const { organizationId, daysThreshold = 3, dryRun = false } = options;

  // 1. Obtener última tasa oficial BCV
  const rateRecord = await getLatestBcvRate(db);
  const bcvRate = rateRecord?.usdToVes || 65.0;

  // 2. Definir rango de fechas para el vencimiento (hoy hasta hoy + daysThreshold)
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0] ?? "";
  const targetDate = new Date(today.getTime() + daysThreshold * 24 * 60 * 60 * 1000);
  const targetDateStr = targetDate.toISOString().split("T")[0] ?? "";

  // 3. Buscar facturas con saldo pendiente próximas a vencer o ya vencidas
  let query = db
    .from("billing_invoices")
    .select(`
      id,
      organization_id,
      invoice_number,
      due_date,
      balance_cents,
      status,
      notes,
      contact_id,
      contacts:contact_id (
        id,
        name,
        phone,
        is_blocked
      )
    `)
    .in("status", ["issued", "partially_paid"])
    .gt("balance_cents", 0)
    .not("due_date", "is", null)
    .lte("due_date", targetDateStr)
    .order("due_date", { ascending: true });

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data: invoices, error } = await query;
  if (error) {
    logger.error("payment_reminders.fetch_invoices_failed", { error: error.message });
    throw new Error(`failed_to_fetch_invoices: ${error.message}`);
  }

  const result: ReminderJobResult = {
    scannedInvoices: invoices?.length || 0,
    remindersQueued: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const inv of invoices || []) {
    const contact = inv.contacts as unknown as {
      id?: string;
      name?: string;
      phone?: string;
      is_blocked?: boolean;
    } | null;

    if (!contact || !contact.phone || contact.is_blocked) {
      result.skipped++;
      result.details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: inv.contact_id || "",
        contactName: contact?.name || "Sin nombre",
        dueDate: inv.due_date || "",
        balanceUsd: `$${(inv.balance_cents / 100).toFixed(2)}`,
        balanceVes: "0,00 Bs",
        status: "skipped",
        reason: "contact_missing_phone_or_blocked",
      });
      continue;
    }

    // Comprobar si ya se envió un recordatorio hoy para evitar duplicados
    const todayMarker = `[reminder_sent:${todayStr}]`;
    if (inv.notes && inv.notes.includes(todayMarker)) {
      result.skipped++;
      result.details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: contact.id || "",
        contactName: contact.name || "Sin nombre",
        dueDate: inv.due_date || "",
        balanceUsd: `$${(inv.balance_cents / 100).toFixed(2)}`,
        balanceVes: "0,00 Bs",
        status: "skipped",
        reason: "already_reminded_today",
      });
      continue;
    }

    // Calcular montos y template correspondiente
    const { formattedUsd, formattedVes } = convertUsdCentsToVes(Number(inv.balance_cents), bcvRate);
    const isDueOrOverdue = inv.due_date <= todayStr;
    const template = isDueOrOverdue
      ? FINANCE_WHATSAPP_TEMPLATES.PAYMENT_REMINDER_DUE
      : FINANCE_WHATSAPP_TEMPLATES.PAYMENT_REMINDER_PRE_DUE;

    const messageText = renderFinanceTemplate(template, {
      contactName: contact.name || undefined,
      invoiceNumber: inv.invoice_number,
      balanceUsd: formattedUsd,
      balanceVes: formattedVes,
      bcvRate: bcvRate.toFixed(2),
      dueDate: inv.due_date,
      paymentMethods: DEFAULT_VENEZUELA_PAYMENT_INSTRUCTIONS,
    });

    if (dryRun) {
      result.remindersQueued++;
      result.details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: contact.id || "",
        contactName: contact.name || "Sin nombre",
        dueDate: inv.due_date || "",
        balanceUsd: formattedUsd,
        balanceVes: formattedVes,
        status: "dry_run",
      });
      continue;
    }

    try {
      // Marcar en la factura que se procesó el recordatorio de hoy
      const updatedNotes = inv.notes
        ? `${inv.notes}\n${todayMarker}`
        : todayMarker;

      await db
        .from("billing_invoices")
        .update({
          notes: updatedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inv.id);

      result.remindersQueued++;
      result.details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: contact.id || "",
        contactName: contact.name || "Sin nombre",
        dueDate: inv.due_date || "",
        balanceUsd: formattedUsd,
        balanceVes: formattedVes,
        status: "queued",
      });
    } catch (err: any) {
      result.errors++;
      result.details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        contactId: contact.id || "",
        contactName: contact.name || "Sin nombre",
        dueDate: inv.due_date || "",
        balanceUsd: formattedUsd,
        balanceVes: formattedVes,
        status: "error",
        reason: err.message,
      });
    }
  }

  return result;
}
