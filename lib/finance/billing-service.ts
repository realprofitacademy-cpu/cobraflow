/**
 * COBRAFLOW — MOTOR DE FACTURACIÓN Y PAGOS MULTIMONEDA (USD / VES)
 *
 * Administra facturas, partidas y pagos para academias y empresas de ventas.
 * Soporta conversión automática con tasa BCV, cálculo de IVA y conciliación de saldos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestBcvRate, convertUsdCentsToVes, convertVesToUsdCents } from "./bcv-service";
import { logger } from "@/lib/logger";

export interface InvoiceItemInput {
  description: string;
  quantity?: number;
  unitPriceCents: number;
}

export interface CreateInvoiceInput {
  organizationId: string;
  contactId?: string | null;
  leadId?: string | null;
  invoiceNumber?: string;
  currency?: "USD" | "VES";
  exchangeRateBcv?: number;
  taxRate?: number; // Ej: 0.16 para 16% IVA
  dueDate?: string | null;
  notes?: string | null;
  items: InvoiceItemInput[];
}

export interface InvoiceDetails {
  id: string;
  organizationId: string;
  contactId: string | null;
  leadId: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  status: "draft" | "issued" | "partially_paid" | "paid" | "voided" | "cancelled";
  currency: "USD" | "VES";
  exchangeRateBcv: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  totalVes: number;
  balanceVes: number;
  notes: string | null;
}

export interface RegisterPaymentInput {
  organizationId: string;
  invoiceId: string;
  contactId?: string | null;
  paymentMethod: "pago_movil" | "bank_transfer" | "zelle" | "cash" | "card" | "other";
  currency?: "USD" | "VES";
  amountCents?: number; // Monto en céntimos USD
  amountVes?: number;   // Monto en Bolívares
  exchangeRateApplied?: number;
  referenceNumber?: string | null;
  evidenceStoragePath?: string | null;
  notes?: string | null;
  confirmedBy?: string | null;
}

export interface PaymentDetails {
  id: string;
  organizationId: string;
  invoiceId: string;
  paymentMethod: string;
  currency: string;
  amountCents: number;
  amountVes: number;
  exchangeRateApplied: number;
  referenceNumber: string | null;
  status: string;
}

/**
 * Genera un número de factura consecutivo con prefijo de año (ej. INV-2026-0001).
 */
export async function generateInvoiceNumber(
  db: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `INV-${currentYear}-`;

  const { data } = await db
    .from("billing_invoices")
    .select("invoice_number")
    .eq("organization_id", organizationId)
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.invoice_number) {
    return `${prefix}0001`;
  }

  const lastSeqStr = data.invoice_number.replace(prefix, "");
  const lastSeq = parseInt(lastSeqStr, 10);
  const nextSeq = isNaN(lastSeq) ? 1 : lastSeq + 1;
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Emite una factura multimoneda con partidas y cálculo de saldo.
 */
export async function createInvoice(
  db: SupabaseClient,
  input: CreateInvoiceInput,
): Promise<InvoiceDetails> {
  if (!input.items || input.items.length === 0) {
    throw new Error("invoice_items_required: la factura debe tener al menos una partida.");
  }

  // 1. Resolver tasa BCV activa
  let rate = input.exchangeRateBcv;
  if (!rate || rate <= 0) {
    const latestRateRecord = await getLatestBcvRate(db);
    rate = latestRateRecord?.usdToVes || 65.0; // fallback base si aún no hay registros
  }

  // 2. Calcular importes
  let subtotalCents = 0;
  const processedItems = input.items.map((item) => {
    const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const totalItemCents = Math.round(item.unitPriceCents * qty);
    subtotalCents += totalItemCents;
    return {
      description: item.description,
      quantity: qty,
      unit_price_cents: item.unitPriceCents,
      total_cents: totalItemCents,
      organization_id: input.organizationId,
    };
  });

  const taxRate = input.taxRate && input.taxRate > 0 ? input.taxRate : 0;
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;
  const balanceCents = totalCents;

  const invoiceNumber = input.invoiceNumber || (await generateInvoiceNumber(db, input.organizationId));
  const currency = input.currency || "USD";

  // 3. Insertar factura
  const { data: invoice, error: invoiceErr } = await db
    .from("billing_invoices")
    .insert({
      organization_id: input.organizationId,
      contact_id: input.contactId ?? null,
      lead_id: input.leadId ?? null,
      invoice_number: invoiceNumber,
      status: "issued",
      currency,
      exchange_rate_bcv: rate,
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents,
      paid_cents: 0,
      balance_cents: balanceCents,
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (invoiceErr || !invoice) {
    throw new Error(`invoice_creation_failed: ${invoiceErr?.message || "sin datos devueltos"}`);
  }

  // 4. Insertar partidas
  const itemsWithInvoiceId = processedItems.map((it) => ({
    ...it,
    invoice_id: invoice.id,
  }));

  const { error: itemsErr } = await db.from("billing_items").insert(itemsWithInvoiceId);
  if (itemsErr) {
    logger.error("[billing-service] Error guardando partidas de factura", {
      invoiceId: invoice.id,
      error: itemsErr.message,
    });
  }

  const { amountVes: totalVes } = convertUsdCentsToVes(totalCents, rate);
  const { amountVes: balanceVes } = convertUsdCentsToVes(balanceCents, rate);

  return {
    id: invoice.id,
    organizationId: invoice.organization_id,
    contactId: invoice.contact_id,
    leadId: invoice.lead_id,
    invoiceNumber: invoice.invoice_number,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    status: invoice.status,
    currency: invoice.currency,
    exchangeRateBcv: Number(invoice.exchange_rate_bcv),
    subtotalCents: Number(invoice.subtotal_cents),
    taxCents: Number(invoice.tax_cents),
    totalCents: Number(invoice.total_cents),
    paidCents: Number(invoice.paid_cents),
    balanceCents: Number(invoice.balance_cents),
    totalVes,
    balanceVes,
    notes: invoice.notes,
  };
}

/**
 * Registra un pago (USD en efectivo/Zelle o VES por Pago Móvil/Transferencia)
 * y actualiza el balance y estado de la factura correspondiente.
 */
export async function registerPayment(
  db: SupabaseClient,
  input: RegisterPaymentInput,
): Promise<{ payment: PaymentDetails; updatedInvoice: InvoiceDetails }> {
  // 1. Obtener la factura
  const { data: invoice, error: invoiceErr } = await db
    .from("billing_invoices")
    .select()
    .eq("id", input.invoiceId)
    .eq("organization_id", input.organizationId)
    .single();

  if (invoiceErr || !invoice) {
    throw new Error(`invoice_not_found: factura ${input.invoiceId} no encontrada`);
  }

  if (invoice.status === "paid") {
    throw new Error("invoice_already_paid: la factura ya se encuentra pagada en su totalidad.");
  }
  if (invoice.status === "voided" || invoice.status === "cancelled") {
    throw new Error(`invoice_invalid_state: no se pueden registrar pagos a una factura ${invoice.status}.`);
  }

  // 2. Determinar tasa de cambio para el pago
  const exchangeRate = input.exchangeRateApplied && input.exchangeRateApplied > 0
    ? input.exchangeRateApplied
    : Number(invoice.exchange_rate_bcv);

  let amountCents = 0;
  let amountVes = 0;

  if (input.currency === "VES" || (input.amountVes && input.amountVes > 0)) {
    amountVes = input.amountVes || 0;
    const conv = convertVesToUsdCents(amountVes, exchangeRate);
    amountCents = conv.amountCentsUsd;
  } else {
    amountCents = input.amountCents || 0;
    const conv = convertUsdCentsToVes(amountCents, exchangeRate);
    amountVes = conv.amountVes;
  }

  if (amountCents <= 0) {
    throw new Error("payment_amount_invalid: el monto del pago debe ser mayor a cero.");
  }

  // 3. Insertar pago confirmado
  const { data: payment, error: payErr } = await db
    .from("billing_payments")
    .insert({
      organization_id: input.organizationId,
      invoice_id: invoice.id,
      contact_id: input.contactId || invoice.contact_id,
      payment_method: input.paymentMethod,
      currency: input.currency || "USD",
      amount_cents: amountCents,
      amount_ves: amountVes,
      exchange_rate_applied: exchangeRate,
      reference_number: input.referenceNumber ?? null,
      evidence_storage_path: input.evidenceStoragePath ?? null,
      status: "confirmed",
      confirmed_by: input.confirmedBy ?? null,
      confirmed_at: new Date().toISOString(),
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (payErr || !payment) {
    throw new Error(`payment_registration_failed: ${payErr?.message || "error al insertar pago"}`);
  }

  // 4. Calcular nuevo balance y estado de la factura
  const newPaidCents = Number(invoice.paid_cents) + amountCents;
  const newBalanceCents = Math.max(0, Number(invoice.total_cents) - newPaidCents);
  const newStatus = newBalanceCents === 0 ? "paid" : "partially_paid";

  const { data: updated, error: updateErr } = await db
    .from("billing_invoices")
    .update({
      paid_cents: newPaidCents,
      balance_cents: newBalanceCents,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id)
    .eq("organization_id", input.organizationId)
    .select()
    .single();

  if (updateErr || !updated) {
    throw new Error(`invoice_update_failed: ${updateErr?.message}`);
  }

  const { amountVes: totalVes } = convertUsdCentsToVes(Number(updated.total_cents), exchangeRate);
  const { amountVes: balanceVes } = convertUsdCentsToVes(newBalanceCents, exchangeRate);

  const updatedInvoice: InvoiceDetails = {
    id: updated.id,
    organizationId: updated.organization_id,
    contactId: updated.contact_id,
    leadId: updated.lead_id,
    invoiceNumber: updated.invoice_number,
    issueDate: updated.issue_date,
    dueDate: updated.due_date,
    status: updated.status,
    currency: updated.currency,
    exchangeRateBcv: Number(updated.exchange_rate_bcv),
    subtotalCents: Number(updated.subtotal_cents),
    taxCents: Number(updated.tax_cents),
    totalCents: Number(updated.total_cents),
    paidCents: Number(updated.paid_cents),
    balanceCents: Number(updated.balance_cents),
    totalVes,
    balanceVes,
    notes: updated.notes,
  };

  const paymentDetails: PaymentDetails = {
    id: payment.id,
    organizationId: payment.organization_id,
    invoiceId: payment.invoice_id,
    paymentMethod: payment.payment_method,
    currency: payment.currency,
    amountCents: Number(payment.amount_cents),
    amountVes: Number(payment.amount_ves),
    exchangeRateApplied: Number(payment.exchange_rate_applied),
    referenceNumber: payment.reference_number,
    status: payment.status,
  };

  return { payment: paymentDetails, updatedInvoice };
}

/**
 * Anula una factura que no ha sido pagada.
 */
export async function voidInvoice(
  db: SupabaseClient,
  organizationId: string,
  invoiceId: string,
  reason?: string,
): Promise<void> {
  const { data: invoice } = await db
    .from("billing_invoices")
    .select("status, paid_cents")
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .single();

  if (!invoice) throw new Error("invoice_not_found");
  if (invoice.paid_cents > 0) {
    throw new Error("cannot_void_invoice_with_payments: no se puede anular una factura con pagos registrados.");
  }

  await db
    .from("billing_invoices")
    .update({
      status: "voided",
      balance_cents: 0,
      notes: reason ? `Anulada: ${reason}` : "Anulada",
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId);
}
