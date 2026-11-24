import { describe, expect, it, vi, beforeEach } from "vitest";
import { crmGetCohortReport } from "@/lib/mcp/tools/educacao";
import { dispatchCohortAdmissionCampaign } from "@/lib/campanhas/educacao-campanhas";
import type { McpContext } from "@/lib/mcp/types";

describe("CobraFlow — Fase 7: Extensões de IA e Campanhas Educativas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const orgId = "11111111-1111-4111-8111-111111111111";
  const cohortId = "44444444-4444-4444-8444-444444444444";
  const courseId = "33333333-3333-4333-8333-333333333333";

  describe("MCP: crm_get_cohort_report", () => {
    it("devolve relatório financeiro e acadêmico da cohorte", async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "exchange_rates_bcv") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { usd_to_ves: 65.5, rate_date: "2026-11-23" },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "education_cohorts") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: cohortId,
                        name: "Cohorte 2026-I",
                        status: "active",
                        course_id: courseId,
                        education_courses: {
                          id: courseId,
                          name: "Diplomado en Finanzas",
                        },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "education_enrollments") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "enr-1",
                        status: "confirmed",
                        invoice_id: "inv-1",
                        billing_invoices: {
                          id: "inv-1",
                          total_cents: 20000,
                          paid_cents: 20000,
                          balance_cents: 0,
                          status: "paid",
                        },
                      },
                      {
                        id: "enr-2",
                        status: "pending",
                        invoice_id: "inv-2",
                        billing_invoices: {
                          id: "inv-2",
                          total_cents: 20000,
                          paid_cents: 10000,
                          balance_cents: 10000,
                          status: "partially_paid",
                        },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const ctx: McpContext = {
        organizationId: orgId,
        role: "agent",
        actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
        apiTokenId: "token-1",
        requestId: "req-1",
        supabase: mockDb as any,
      };

      const result = await crmGetCohortReport.handler({ cohort_id: cohortId }, ctx);
      expect(result.success).toBe(true);
      expect(result.report.cohortName).toBe("Cohorte 2026-I");
      expect(result.report.confirmedEnrollments).toBe(1);
      expect(result.report.pendingEnrollments).toBe(1);
      expect(result.report.totalStudents).toBe(2);
      expect(result.summary).toContain("Cohorte 2026-I");
    });
  });

  describe("Campanhas: dispatchCohortAdmissionCampaign", () => {
    it("gera pré-visualização ou envia campanha de admissões com taxa BCV", async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "education_cohorts") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: cohortId,
                        name: "Cohorte 2026-I",
                        start_date: "2026-03-15",
                        end_date: "2026-07-15",
                        status: "enrolling",
                        education_courses: {
                          id: courseId,
                          name: "Diplomado en Gerencia",
                          default_price_cents: 15000,
                        },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "exchange_rates_bcv") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { usd_to_ves: 65.0, rate_date: "2026-11-23" },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "contacts") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [
                        { id: "cont-1", name: "Carlos Pérez", phone: "+584121112233" },
                        { id: "cont-2", name: "Ana Torres", phone: "+584149998877" },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const result = await dispatchCohortAdmissionCampaign(mockDb as any, {
        cohortId,
        organizationId: orgId,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.courseName).toBe("Diplomado en Gerencia");
      expect(result.cohortName).toBe("Cohorte 2026-I");
      expect(result.totalRecipients).toBe(2);
      expect(result.messagesSent).toBe(0); // dryRun
      expect(result.sampleMessage).toContain("Diplomado en Gerencia");
      expect(result.sampleMessage).toContain("65.00 Bs/$");
      expect(result.recipients[0]?.renderedMessage).toContain("Carlos Pérez");
      expect(result.recipients[1]?.renderedMessage).toContain("Ana Torres");
    });
  });
});
