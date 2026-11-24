import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { dispatchCohortAdmissionCampaign } from "@/lib/campanhas/educacao-campanhas";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/education/cohorts/[id]/campaign
 * Dispara o previsualiza una campaña de WhatsApp para la convocatoria de admisiones de una cohorte.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "education" });
  if (!authz.ok) return authz.response;

  try {
    const { id: cohortId } = await props.params;
    const body = (await req.json().catch(() => ({}))) as {
      target_contact_ids?: string[];
      dry_run?: boolean;
    };

    const supabase = await createClient();
    const result = await dispatchCohortAdmissionCampaign(supabase, {
      cohortId,
      organizationId: authz.orgId,
      targetContactIds: body.target_contact_ids,
      dryRun: body.dry_run ?? true,
    });

    return ok(result, { requestId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "internal_error";
    return fail(message, "CAMPAIGN_DISPATCH_FAILED", 500, { requestId });
  }
}
