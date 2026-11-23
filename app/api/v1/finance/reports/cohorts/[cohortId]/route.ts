import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getCohortFinancialReport } from "@/lib/finance/cohort-reports";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ cohortId: string }>;
}

/**
 * GET /api/v1/finance/reports/cohorts/[cohortId]
 * Genera el reporte financiero de una cohorte con métricas bimonetarias (USD y VES a BCV).
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const { cohortId } = await params;
  const authz = await requireRole("viewer", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const supabase = await createClient();
    const rateParam = req.nextUrl.searchParams.get("bcv_rate");
    const customBcvRate = rateParam ? Number(rateParam) : undefined;

    const report = await getCohortFinancialReport(
      supabase,
      authz.org.id,
      cohortId,
      customBcvRate,
    );

    return ok(report, { requestId });
  } catch (error: any) {
    const status = error.message?.includes("cohort_not_found") ? 404 : 500;
    return fail("report_failed", error.message || "Error al generar reporte de cohorte", status, { requestId });
  }
}
