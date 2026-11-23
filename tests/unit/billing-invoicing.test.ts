import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createInvoice,
  registerPayment,
  voidInvoice,
  generateInvoiceNumber,
} from "@/lib/finance/billing-service";

describe("CobraFlow — Motor de Facturación y Pagos Multimoneda", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const orgId = "11111111-1111-4111-8111-111111111111";
  const contactId = "22222222-2222-4222-8222-222222222222";
  const invoiceId = "33333333-3333-4333-8333-333333333333";

  it("genera número correlativo de factura secuencialmente", async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { invoice_number: "INV-2026-0042" },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const nextNumber = await generateInvoiceNumber(mockDb as never, orgId);
    expect(nextNumber).toBe("INV-2026-0043");
  });

  it("emite factura con partidas, cálculo de subtotal, IVA y saldo en USD y VES", async () => {
    const mockInvoiceInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: invoiceId,
            organization_id: orgId,
            contact_id: contactId,
            lead_id: null,
            invoice_number: "INV-2026-0001",
            issue_date: "2026-11-23T10:00:00Z",
            due_date: "2026-11-30T23:59:59Z",
            status: "issued",
            currency: "USD",
            exchange_rate_bcv: 65.5,
            subtotal_cents: 10000, // $100.00
            tax_cents: 1600,       // 16% IVA = $16.00
            total_cents: 11600,    // $116.00
            paid_cents: 0,
            balance_cents: 11600,
            notes: "Inscripción Curso Desarrollo Web",
          },
          error: null,
        }),
      }),
    });

    const mockItemsInsert = vi.fn().mockResolvedValue({ error: null });

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "billing_invoices") {
          return {
            insert: mockInvoiceInsert,
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                like: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "billing_items") {
          return { insert: mockItemsInsert };
        }
        return {};
      }),
    };

    const invoice = await createInvoice(mockDb as never, {
      organizationId: orgId,
      contactId,
      exchangeRateBcv: 65.5,
      taxRate: 0.16,
      items: [
        { description: "Matrícula de Curso", quantity: 1, unitPriceCents: 6000 },
        { description: "Material Didáctico", quantity: 2, unitPriceCents: 2000 },
      ],
      notes: "Inscripción Curso Desarrollo Web",
    });

    expect(invoice.id).toBe(invoiceId);
    expect(invoice.status).toBe("issued");
    expect(invoice.subtotalCents).toBe(10000);
    expect(invoice.taxCents).toBe(1600);
    expect(invoice.totalCents).toBe(11600);
    expect(invoice.totalVes).toBe(7598.0); // 116 * 65.50 = 7598.00 Bs
    expect(mockItemsInsert).toHaveBeenCalledTimes(1);
  });

  it("registra pago en Bolívares (Pago Móvil), actualiza balance y transiciona estado a partially_paid", async () => {
    const initialInvoice = {
      id: invoiceId,
      organization_id: orgId,
      contact_id: contactId,
      invoice_number: "INV-2026-0001",
      status: "issued",
      exchange_rate_bcv: 65.5,
      total_cents: 10000, // $100.00
      paid_cents: 0,
      balance_cents: 10000,
    };

    const mockPaymentInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "44444444-4444-4444-8444-444444444444",
            organization_id: orgId,
            invoice_id: invoiceId,
            payment_method: "pago_movil",
            currency: "VES",
            amount_cents: 5000, // Equivalente a $50.00
            amount_ves: 3275.0, // 3,275.00 Bs
            exchange_rate_applied: 65.5,
            reference_number: "PM-98765432",
            status: "confirmed",
          },
          error: null,
        }),
      }),
    });

    const mockInvoiceUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                ...initialInvoice,
                paid_cents: 5000,
                balance_cents: 5000,
                status: "partially_paid",
              },
              error: null,
            }),
          }),
        }),
      }),
    });

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "billing_invoices") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: initialInvoice, error: null }),
                }),
              }),
            }),
            update: mockInvoiceUpdate,
          };
        }
        if (table === "billing_payments") {
          return { insert: mockPaymentInsert };
        }
        return {};
      }),
    };

    const result = await registerPayment(mockDb as never, {
      organizationId: orgId,
      invoiceId,
      paymentMethod: "pago_movil",
      currency: "VES",
      amountVes: 3275.0, // Equivalente a $50.00 a tasa 65.5
      exchangeRateApplied: 65.5,
      referenceNumber: "PM-98765432",
    });

    expect(result.payment.paymentMethod).toBe("pago_movil");
    expect(result.payment.amountVes).toBe(3275.0);
    expect(result.payment.amountCents).toBe(5000);
    expect(result.updatedInvoice.status).toBe("partially_paid");
    expect(result.updatedInvoice.paidCents).toBe(5000);
    expect(result.updatedInvoice.balanceCents).toBe(5000);
  });

  it("rechaza pagos sobre facturas ya pagadas en su totalidad", async () => {
    const paidInvoice = {
      id: invoiceId,
      organization_id: orgId,
      status: "paid",
      total_cents: 10000,
      paid_cents: 10000,
      balance_cents: 0,
    };

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: paidInvoice, error: null }),
            }),
          }),
        }),
      }),
    };

    await expect(
      registerPayment(mockDb as never, {
        organizationId: orgId,
        invoiceId,
        paymentMethod: "zelle",
        amountCents: 5000,
      }),
    ).rejects.toThrow(/invoice_already_paid/);
  });

  it("rechaza la anulación de facturas que ya tienen pagos registrados", async () => {
    const invoiceWithPayments = {
      id: invoiceId,
      paid_cents: 2500,
      status: "partially_paid",
    };

    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: invoiceWithPayments }),
            }),
          }),
        }),
      }),
    };

    await expect(voidInvoice(mockDb as never, orgId, invoiceId, "Error en cliente")).rejects.toThrow(
      /cannot_void_invoice_with_payments/,
    );
  });
});
