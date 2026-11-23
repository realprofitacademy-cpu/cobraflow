/**
 * CRON BCV-SYNC: Sincronización diaria automatizada de la tasa oficial del Banco Central de Venezuela.
 *
 * Se ejecuta vía scheduler/cron autenticado con autorizaCron().
 * Extrae la tasa del día de APIs públicas con fallback institucional y la persiste en exchange_rates_bcv.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLiveBcvRate, syncBcvRate } from "@/lib/finance/bcv-service";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  try {
    // 1. Obtener tasa en vivo desde los proveedores BCV
    const live = await fetchLiveBcvRate();
    if (!live) {
      logger.warn("cron.bcv_sync.live_fetch_returned_null", { requestId });
      return ok({ status: "skipped", reason: "no_live_rate_available" }, { requestId });
    }

    // 2. Persistir tasa con fecha actual
    const today = new Date().toISOString().split("T")[0];
    const record = await syncBcvRate(admin, {
      rateDate: today,
      overrideRate: live.usdToVes,
      source: live.source,
    });

    logger.info("cron.bcv_sync.success", {
      rateDate: today,
      usdToVes: live.usdToVes,
      source: live.source,
      requestId,
    });

    return ok({ status: "synced", record }, { requestId });
  } catch (error: any) {
    logger.error("cron.bcv_sync.error", { error: error.message, requestId });
    return fail("bcv_sync_failed", error.message || "Error durante la sincronización BCV", 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
