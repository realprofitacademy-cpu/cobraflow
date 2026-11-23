import { describe, it, expect, vi } from "vitest";
import { convertLeadToEnrollment } from "@/lib/business/education-sales";

describe("CobraFlow — Motor de Ventas e Inscripciones (Fase 2A)", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const otherOrgId = "22222222-2222-4222-8222-222222222222";
  const leadId = "33333333-3333-4333-8333-333333333333";
  const contactId = "44444444-4444-4444-8444-444444444444";
  const cohortId = "55555555-5555-4555-8555-555555555555";

  it("convierte exitosamente un lead comercial en alumno inscrito con factura y abono", async () => {
    // Mock Supabase Client
    const mockSupabase: any = {
      from: vi.fn((table: string) => {
        if (table === "crm_leads") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: leadId, contact_id: contactId, organization_id: orgId, title: "Interesado en Diplomado" },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          };
        }
        if (table === "education_students") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "student-uuid-1" },
              error: null,
            }),
          };
        }
        if (table === "billing_invoices") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "invoice-uuid-100" },
              error: null,
            }),
          };
        }
        if (table === "billing_payments") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "payment-uuid-500" },
              error: null,
            }),
          };
        }
        if (table === "education_enrollments") {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: "enrollment-uuid-999" },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
        };
      }),
    };

    const result = await convertLeadToEnrollment(mockSupabase, {
      organizationId: orgId,
      leadId,
      cohortId,
      nationalId: "V-19876543",
      studentCode: "ALU-2026-001",
      invoiceNumber: "INV-2026-0001",
      currency: "USD",
      exchangeRateBcv: 49.5,
      totalCents: 15000, // $150 USD
      taxCents: 0,
      initialPayment: {
        amountCents: 5000, // Abono de $50 USD
        amountVes: 2475.0, // 50 * 49.5
        paymentMethod: "pago_movil",
        referenceNumber: "PM-987654",
        notes: "Abono inicial 1ra cuota",
      },
    });

    expect(result.success).toBe(true);
    expect(result.studentId).toBe("student-uuid-1");
    expect(result.invoiceId).toBe("invoice-uuid-100");
    expect(result.paymentId).toBe("payment-uuid-500");
    expect(result.enrollmentId).toBe("enrollment-uuid-999");
  });

  it("rechaza la conversión si el lead no pertenece a la organización activa", async () => {
    const mockSupabaseCrossOrg: any = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Row not found" },
        }),
      })),
    };

    const result = await convertLeadToEnrollment(mockSupabaseCrossOrg, {
      organizationId: otherOrgId,
      leadId,
      cohortId,
      nationalId: "V-20111222",
      invoiceNumber: "INV-2026-0002",
      totalCents: 10000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Lead comercial no encontrado");
  });
});
