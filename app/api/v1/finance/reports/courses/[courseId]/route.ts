import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getCourseFinancialReport } from "@/lib/finance/cohort-reports";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ courseId: string }>;
}

/**
 * GET /api/v1/finance/reports/courses/[courseId]
 * Genera el reporte financiero consolidado de un curso sumando todas sus cohortes.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const { courseId } = await params;
  const authz = await requireRole("viewer", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const supabase = await createClient();
    const rateParam = req.nextUrl.searchParams.get("bcv_rate");
    const customBcvRate = rateParam ? Number(rateParam) : undefined;

    const report = await getCourseFinancialReport(
      supabase,
      authz.org.orgId,
      courseId,
      customBcvRate,
    );

    return ok(report, { requestId });
  } catch (error: any) {
    const status = error.message?.includes("course_not_found") ? 404 : 500;
    return fail("report_failed", error.message || "Error al generar reporte de curso", status, { requestId });
  }
}
