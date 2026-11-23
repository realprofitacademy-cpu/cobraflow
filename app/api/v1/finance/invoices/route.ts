import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createInvoice } from "@/lib/finance/billing-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/finance/invoices
 * Lista las facturas de la organización con filtros opcionales.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const supabase = await createClient();
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status");
    const contactId = searchParams.get("contact_id");
    const leadId = searchParams.get("lead_id");
    const limit = Math.min(Number(searchParams.get("limit") || "50"), 100);
    const offset = Number(searchParams.get("offset") || "0");

    let query = supabase
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
        contacts ( id, name, phone ),
        billing_items ( id, description, quantity, unit_price_cents, total_cents )
      `, { count: "exact" })
      .eq("organization_id", authz.org.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (contactId) query = query.eq("contact_id", contactId);
    if (leadId) query = query.eq("lead_id", leadId);

    const { data: invoices, count, error } = await query;
    if (error) throw error;

    return ok(invoices || [], {
      requestId,
      meta: {
        total: count,
        has_more: count ? offset + (invoices?.length || 0) < count : false,
      },
    });
  } catch (error: any) {
    return fail("internal_error", error.message || "Error al listar facturas", 500, { requestId });
  }
}

/**
 * POST /api/v1/finance/invoices
 * Crea una nueva factura multimoneda.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "finance" });
  if (!authz.ok) return authz.response;

  try {
    const body = await req.json();
    const supabase = await createClient();

    const invoice = await createInvoice(supabase, {
      organizationId: authz.org.id,
      contactId: body.contactId,
      leadId: body.leadId,
      invoiceNumber: body.invoiceNumber,
      currency: body.currency,
      exchangeRateBcv: body.exchangeRateBcv,
      taxRate: body.taxRate,
      dueDate: body.dueDate,
      notes: body.notes,
      items: body.items,
    });

    return ok(invoice, { requestId, status: 201 });
  } catch (error: any) {
    return fail("invoice_creation_failed", error.message || "Error al crear la factura", 400, { requestId });
  }
}
