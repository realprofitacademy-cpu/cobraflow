import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getLatestBcvRate, syncBcvRate } from "@/lib/finance/bcv-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/finance/bcv-rate
 * Obtiene la última tasa oficial BCV registrada en el sistema.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const supabase = await createClient();
    const rate = await getLatestBcvRate(supabase);

    if (!rate) {
      return fail("not_found", "No hay tasas BCV registradas aún en el sistema.", 404, { requestId });
    }

    return ok(rate, { requestId });
  } catch (error: any) {
    return fail("internal_error", error.message || "Error al obtener la tasa BCV", 500, { requestId });
  }
}

/**
 * POST /api/v1/finance/bcv-rate
 * Sincroniza o actualiza manualmente la tasa BCV del día (solo administradores).
 */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = await createClient();

    const rate = await syncBcvRate(supabase, {
      rateDate: body.rateDate,
      overrideRate: body.overrideRate ? Number(body.overrideRate) : undefined,
      source: body.source,
    });

    return ok(rate, { requestId, status: 201 });
  } catch (error: any) {
    return fail("bcv_sync_failed", error.message || "Error al sincronizar la tasa BCV", 400, { requestId });
  }
}
