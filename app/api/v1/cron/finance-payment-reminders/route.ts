/**
 * CRON FINANCE-PAYMENT-REMINDERS: Notificaciones automáticas de cobranza por WhatsApp.
 *
 * Se ejecuta por scheduler diario en horario hábil matutino (09:30).
 * Escanea facturas emitidas próximas a vencer o vencidas, calcula la tasa BCV del día
 * y despacha los mensajes personalizados a los clientes correspondientes.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPaymentReminders } from "@/lib/finance/payment-reminders";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  try {
    const isDryRun = req.nextUrl.searchParams.get("dry_run") === "true";
    const daysThreshold = Number(req.nextUrl.searchParams.get("days") || "3");

    const result = await processPaymentReminders(admin, {
      daysThreshold,
      dryRun: isDryRun,
    });

    logger.info("cron.finance_payment_reminders.finished", {
      scanned: result.scannedInvoices,
      queued: result.remindersQueued,
      skipped: result.skipped,
      errors: result.errors,
      requestId,
    });

    return ok(result, { requestId });
  } catch (error: any) {
    logger.error("cron.finance_payment_reminders.failed", { error: error.message, requestId });
    return fail("reminders_cron_failed", error.message || "Error procesando recordatorios de pago", 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
