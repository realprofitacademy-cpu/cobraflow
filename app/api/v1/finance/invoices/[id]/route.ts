import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { voidInvoice } from "@/lib/finance/billing-service";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/finance/invoices/[id]
 * Obtiene el detalle completo de una factura con sus partidas y pagos.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("viewer", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const supabase = await createClient();

    const { data: invoice, error } = await supabase
      .from("billing_invoices")
      .select(`
        id,
        invoice_number,
        issue_date,
        due_date,
        status,
        currency,
        exchange_rate_bcv,
        subtotal_cents,
        tax_cents,
        total_cents,
        paid_cents,
        balance_cents,
        notes,
        created_at,
        contacts ( id, name, phone, document_id ),
        billing_items ( id, description, quantity, unit_price_cents, total_cents ),
        billing_payments ( id, payment_method, currency, amount_cents, amount_ves, exchange_rate_applied, reference_number, status, payment_date )
      `)
      .eq("id", id)
      .eq("organization_id", authz.org.orgId)
      .single();

    if (error || !invoice) {
      return fail("not_found", "Factura no encontrada.", 404, { requestId });
    }

    return ok(invoice, { requestId });
  } catch (error: any) {
    return fail("internal_error", error.message || "Error al obtener la factura", 500, { requestId });
  }
}

/**
 * PATCH /api/v1/finance/invoices/[id]
 * Anula una factura (solo administradores, no debe tener pagos registrados).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("admin", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = await createClient();

    await voidInvoice(supabase, authz.org.orgId, id, body.reason);

    return ok({ message: "Factura anulada con éxito.", id }, { requestId });
  } catch (error: any) {
    const status = error.message?.includes("cannot_void") ? 409 : 400;
    return fail("invoice_void_failed", error.message || "Error al anular la factura", status, { requestId });
  }
}
