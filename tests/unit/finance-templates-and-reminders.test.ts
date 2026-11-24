import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  FINANCE_WHATSAPP_TEMPLATES,
  renderFinanceTemplate,
} from "@/lib/finance/templates";
import { processPaymentReminders } from "@/lib/finance/payment-reminders";

describe("CobraFlow — Plantillas de WhatsApp y Recordatorios de Cobranza (Fase 5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const orgId = "11111111-1111-4111-8111-111111111111";

  describe("Renderizado de Plantillas de WhatsApp", () => {
    it("renderiza plantilla de convocatoria de admisiones con precios bimonetarios", () => {
      const rendered = renderFinanceTemplate(FINANCE_WHATSAPP_TEMPLATES.ADMISSIONS_LAUNCH, {
        contactName: "Valeria Gómez",
        courseName: "Diplomado en Marketing Digital",
        cohortName: "Cohorte 2026-II",
        startDate: "15 de Abril 2026",
        amountUsd: "$150.00",
        amountVes: "9.750,00 Bs",
        bcvRate: "65.00",
      });

      expect(rendered).toContain("Valeria Gómez");
      expect(rendered).toContain("Diplomado en Marketing Digital");
      expect(rendered).toContain("Cohorte 2026-II");
      expect(rendered).toContain("$150.00");
      expect(rendered).toContain("9.750,00 Bs");
      expect(rendered).toContain("65.00 Bs/$");
    });

    it("renderiza plantilla preventiva de cobranza con desglose y métodos de pago", () => {
      const rendered = renderFinanceTemplate(FINANCE_WHATSAPP_TEMPLATES.PAYMENT_REMINDER_PRE_DUE, {
        contactName: "Carlos Méndez",
        courseName: "Desarrollo Web Full Stack",
        invoiceNumber: "INV-2026-0042",
        balanceUsd: "$75.00",
        balanceVes: "4.950,00 Bs",
        bcvRate: "66.00",
        dueDate: "2026-03-30",
      });

      expect(rendered).toContain("Carlos Méndez");
      expect(rendered).toContain("INV-2026-0042");
      expect(rendered).toContain("$75.00");
      expect(rendered).toContain("4.950,00 Bs");
      expect(rendered).toContain("Pago Móvil");
      expect(rendered).toContain("Zelle");
    });

    it("renderiza confirmación y recibo de pago con estatus de alumno", () => {
      const rendered = renderFinanceTemplate(FINANCE_WHATSAPP_TEMPLATES.PAYMENT_CONFIRMATION, {
        contactName: "María Rodríguez",
        amountUsd: "$100.00",
        amountVes: "6.550,00 Bs",
        invoiceNumber: "INV-2026-0010",
        receiptNumber: "PAGOMOVIL-994821",
        balanceUsd: "$0.00",
        balanceVes: "0,00 Bs",
        studentCode: "ALU-5012",
        cohortName: "Cohorte IA-2026",
      });

      expect(rendered).toContain("María Rodríguez");
      expect(rendered).toContain("PAGOMOVIL-994821");
      expect(rendered).toContain("ALU-5012");
      expect(rendered).toContain("Cohorte IA-2026");
      expect(rendered).toContain("Pago confirmado con éxito");
    });
  });

  describe("Servicio de Recordatorios de Cobranza (processPaymentReminders)", () => {
    it("procesa facturas pendientes, convierte a tasa BCV y respeta el dryRun", async () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const mockInvoices = [
        {
          id: "inv-1",
          organization_id: orgId,
          invoice_number: "INV-2026-0001",
          due_date: todayStr,
          balance_cents: 10000, // $100.00
          status: "issued",
          notes: null,
          contact_id: "c-1",
          contacts: {
            id: "c-1",
            name: "Andrés Silva",
            phone: "+584121234567",
            is_blocked: false,
          },
        },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "exchange_rates_bcv") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { usd_to_ves: 65.0, rate_date: todayStr },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "billing_invoices") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    not: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          eq: vi.fn().mockResolvedValue({ data: mockInvoices, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const result = await processPaymentReminders(mockDb as any, {
        organizationId: orgId,
        dryRun: true,
      });

      expect(result.scannedInvoices).toBe(1);
      expect(result.remindersQueued).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.details[0].invoiceNumber).toBe("INV-2026-0001");
      expect(result.details[0].balanceUsd).toBe("$100.00");
      // 100 * 65.0 = 6,500.00 Bs
      expect(result.details[0].balanceVes).toContain("6.500,00");
      expect(result.details[0].status).toBe("dry_run");
    });

    it("salta contactos bloqueados o sin número telefónico", async () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const mockInvoices = [
        {
          id: "inv-2",
          organization_id: orgId,
          invoice_number: "INV-2026-0002",
          due_date: todayStr,
          balance_cents: 5000,
          status: "issued",
          notes: null,
          contact_id: "c-2",
          contacts: {
            id: "c-2",
            name: "Contacto Bloqueado",
            phone: "+584149999999",
            is_blocked: true,
          },
        },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "exchange_rates_bcv") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { usd_to_ves: 65.0 } }),
                  }),
                }),
              }),
            };
          }
          if (table === "billing_invoices") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    not: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          eq: vi.fn().mockResolvedValue({ data: mockInvoices, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const result = await processPaymentReminders(mockDb as any, {
        organizationId: orgId,
      });

      expect(result.scannedInvoices).toBe(1);
      expect(result.remindersQueued).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.details[0].reason).toBe("contact_missing_phone_or_blocked");
    });

    it("evita enviar más de un recordatorio el mismo día al mismo contacto", async () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const mockInvoices = [
        {
          id: "inv-3",
          organization_id: orgId,
          invoice_number: "INV-2026-0003",
          due_date: todayStr,
          balance_cents: 8000,
          status: "issued",
          notes: `Observaciones previas\n[reminder_sent:${todayStr}]`,
          contact_id: "c-3",
          contacts: {
            id: "c-3",
            name: "Contacto Ya Avisado",
            phone: "+584241234567",
            is_blocked: false,
          },
        },
      ];

      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "exchange_rates_bcv") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { usd_to_ves: 65.0 } }),
                  }),
                }),
              }),
            };
          }
          if (table === "billing_invoices") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    not: vi.fn().mockReturnValue({
                      lte: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          eq: vi.fn().mockResolvedValue({ data: mockInvoices, error: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const result = await processPaymentReminders(mockDb as any, {
        organizationId: orgId,
      });

      expect(result.scannedInvoices).toBe(1);
      expect(result.remindersQueued).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.details[0].reason).toBe("already_reminded_today");
    });
  });
});
