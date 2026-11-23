import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { registerPayment } from "@/lib/finance/billing-service";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/finance/invoices/[id]/payments
 * Registra un abono o pago completo a una factura existente.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("agent", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const body = await req.json();
    const supabase = await createClient();

    const result = await registerPayment(supabase, {
      organizationId: authz.org.id,
      invoiceId: id,
      paymentMethod: body.paymentMethod,
      currency: body.currency,
      amountCents: body.amountCents,
      amountVes: body.amountVes,
      exchangeRateApplied: body.exchangeRateApplied,
      referenceNumber: body.referenceNumber,
      evidenceStoragePath: body.evidenceStoragePath,
      notes: body.notes,
      confirmedBy: authz.user.id,
    });

    return ok(result, { requestId, status: 201 });
  } catch (error: any) {
    return fail("payment_registration_failed", error.message || "Error al registrar el pago", 400, { requestId });
  }
}
