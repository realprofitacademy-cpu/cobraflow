import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  crmListCourses,
  crmGetStudentEnrollments,
  crmGetBcvRate,
  crmEnrollStudent,
} from "@/lib/mcp/tools/educacao";
import type { McpContext } from "@/lib/mcp/types";

describe("CobraFlow — Herramientas MCP de Educación y Finanzas (Fase 4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const orgId = "11111111-1111-4111-8111-111111111111";
  const contactId = "22222222-2222-4222-8222-222222222222";
  const courseId = "33333333-3333-4333-8333-333333333333";
  const cohortId = "44444444-4444-4444-8444-444444444444";

  function createMockCtx(overrides?: Partial<McpContext>): McpContext {
    return {
      organizationId: orgId,
      role: "agent",
      actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
      apiTokenId: "token-1",
      requestId: "req-1",
      supabase: {} as any,
      ...overrides,
    };
  }

  describe("crm_list_courses", () => {
    it("lista cursos y calcula precios bimonetarios con tasa BCV", async () => {
      const mockCourses = [
        {
          id: courseId,
          name: "Diplomado en Inteligencia Artificial",
          code: "DIA-01",
          description: "Curso profesional intensivo",
          default_price_cents: 25000, // $250.00
          currency: "USD",
          is_active: true,
          education_cohorts: [
            {
              id: cohortId,
              name: "Cohorte 2026-I",
              start_date: "2026-03-01",
              end_date: "2026-06-30",
              max_students: 30,
              status: "enrolling",
            },
          ],
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
                      data: { usd_to_ves: 65.0, rate_date: "2026-11-23", source: "BCV", is_official: true },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "education_courses") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockCourses, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const ctx = createMockCtx({ supabase: mockDb as any });
      const result = await crmListCourses.handler({ is_active: true }, ctx) as any;

      expect(result.totalCourses).toBe(1);
      expect(result.bcvRateUsed).toBe(65.0);
      expect(result.courses[0].name).toBe("Diplomado en Inteligencia Artificial");
      expect(result.courses[0].priceUsd).toBe("$250.00");
      // 250 * 65.0 = 16,250.00 Bs
      expect(result.courses[0].priceVes).toContain("16.250,00");
      expect(result.courses[0].cohorts.length).toBe(1);
      expect(result.courses[0].cohorts[0].status).toBe("enrolling");
    });
  });

  describe("crm_get_student_enrollments", () => {
    it("respeta el aislamiento del turno y rechaza consultar a otro contacto", async () => {
      const ctx = createMockCtx({ contatoDoTurno: contactId });
      const otherContact = "55555555-5555-4555-8555-555555555555";

      const res = await crmGetStudentEnrollments.handler({ contact_id: otherContact }, ctx) as any;
      expect(res.refused).toBe(true);
      expect(res.reason).toContain("contato_fora_do_turno");
    });

    it("devuelve inscripciones y saldo pendiente para el contacto del turno", async () => {
      const mockStudent = {
        id: "student-1",
        student_code: "ALU-100200",
        national_id: "V-20123456",
        status: "active",
      };

      const mockEnrollments = [
        {
          id: "enr-1",
          status: "confirmed",
          enrolled_at: "2026-02-01T10:00:00Z",
          education_cohorts: {
            id: cohortId,
            name: "Cohorte 2026-I",
            status: "in_progress",
            start_date: "2026-03-01",
            education_courses: { id: courseId, name: "Diplomado en IA", code: "DIA" },
          },
          billing_invoices: {
            id: "inv-1",
            invoice_number: "INV-2026-0001",
            status: "partially_paid",
            total_cents: 20000,
            paid_cents: 10000,
            balance_cents: 10000, // $100.00 pendiente
            currency: "USD",
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
                      data: { usd_to_ves: 65.0, rate_date: "2026-11-23" },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "education_students") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockStudent, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "education_enrollments") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: mockEnrollments, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const ctx = createMockCtx({ contatoDoTurno: contactId, supabase: mockDb as any });
      const res = await crmGetStudentEnrollments.handler({ contact_id: contactId }, ctx) as any;

      expect(res.enrolled).toBe(true);
      expect(res.studentCode).toBe("ALU-100200");
      expect(res.enrollments.length).toBe(1);
      expect(res.enrollments[0].courseName).toBe("Diplomado en IA");
      expect(res.enrollments[0].invoice.hasPendingBalance).toBe(true);
      expect(res.enrollments[0].invoice.balanceUsd).toBe("$100.00");
      // 100 * 65.0 = 6,500.00 Bs
      expect(res.enrollments[0].invoice.balanceVes).toContain("6.500,00");
    });
  });

  describe("crm_get_bcv_rate", () => {
    it("obtiene la tasa del BCV y convierte montos en dólares a bolívares", async () => {
      const mockDb = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { usd_to_ves: 66.5, rate_date: "2026-11-23", source: "BCV Oficial", is_official: true },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      const ctx = createMockCtx({ supabase: mockDb as any });
      const res = await crmGetBcvRate.handler({ amount_usd: 50.0 }, ctx) as any;

      expect(res.usdToVes).toBe(66.5);
      expect(res.rateDate).toBe("2026-11-23");
      expect(res.conversion.amountUsd).toBe(50.0);
      expect(res.conversion.formattedUsd).toBe("$50.00");
      // $50 * 66.50 = 3,325.00 Bs
      expect(res.conversion.amountVes).toBe(3325.0);
      expect(res.conversion.formattedVes).toContain("3.325,00");
    });
  });

  describe("crm_enroll_student", () => {
    it("respeta el aislamiento del turno al inscribir", async () => {
      const ctx = createMockCtx({ contatoDoTurno: contactId });
      const otherContact = "55555555-5555-4555-8555-555555555555";

      const res = await crmEnrollStudent.handler({
        contact_id: otherContact,
        cohort_id: cohortId,
      }, ctx) as any;

      expect(res.refused).toBe(true);
      expect(res.reason).toContain("contato_fora_do_turno");
    });
  });
});
