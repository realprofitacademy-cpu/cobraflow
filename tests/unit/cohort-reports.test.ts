import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getCohortFinancialReport,
  getCourseFinancialReport,
} from "@/lib/finance/cohort-reports";

describe("CobraFlow — Reportes Financieros de Cohortes y Cursos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const orgId = "11111111-1111-4111-8111-111111111111";
  const courseId = "22222222-2222-4222-8222-222222222222";
  const cohortId = "33333333-3333-4333-8333-333333333333";

  it("calcula ingresos proyectados, recaudados y tasa de cobro para una cohorte", async () => {
    const mockCohort = {
      id: cohortId,
      name: "Cohorte 2026-A",
      status: "in_progress",
      course_id: courseId,
      education_courses: { id: courseId, name: "Inteligencia Artificial Aplicada" },
    };

    const mockEnrollments = [
      {
        id: "enr-1",
        status: "confirmed",
        invoice_id: "inv-1",
        billing_invoices: {
          id: "inv-1",
          status: "paid",
          total_cents: 20000, // $200.00
          paid_cents: 20000,  // $200.00
          balance_cents: 0,
        },
      },
      {
        id: "enr-2",
        status: "confirmed",
        invoice_id: "inv-2",
        billing_invoices: {
          id: "inv-2",
          status: "partially_paid",
          total_cents: 20000, // $200.00
          paid_cents: 10000,  // $100.00
          balance_cents: 10000, // $100.00 pendiente
        },
      },
      {
        id: "enr-3",
        status: "pending",
        invoice_id: "inv-3",
        billing_invoices: {
          id: "inv-3",
          status: "issued",
          total_cents: 20000, // $200.00
          paid_cents: 0,
          balance_cents: 20000, // $200.00 pendiente
        },
      },
    ];

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "education_cohorts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockCohort, error: null }),
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

    const report = await getCohortFinancialReport(mockDb as never, orgId, cohortId, 65.0);

    expect(report.cohortId).toBe(cohortId);
    expect(report.cohortName).toBe("Cohorte 2026-A");
    expect(report.courseName).toBe("Inteligencia Artificial Aplicada");
    expect(report.totalStudents).toBe(3);
    expect(report.confirmedEnrollments).toBe(2);
    expect(report.pendingEnrollments).toBe(1);

    // Totales: 3 x $200 = $600.00 (60000 céntimos)
    expect(report.projectedRevenueCents).toBe(60000);
    expect(report.projectedRevenueUsd).toBe("$600.00");

    // Recaudado: $200 + $100 = $300.00 (30000 céntimos)
    expect(report.collectedRevenueCents).toBe(30000);
    expect(report.collectedRevenueUsd).toBe("$300.00");

    // Pendiente: $0 + $100 + $200 = $300.00
    expect(report.pendingBalanceCents).toBe(30000);
    expect(report.pendingBalanceUsd).toBe("$300.00");

    // Tasa de cobro: 300 / 600 = 50.00%
    expect(report.collectionRatePercent).toBe(50.0);

    // Conversión en Bolívares a tasa 65.0 Bs/$: $300 * 65.0 = 19,500.00 Bs
    expect(report.collectedRevenueVes).toBe(19500.0);
    expect(report.pendingBalanceVes).toBe(19500.0);
  });

  it("consolida métricas de múltiples cohortes en el reporte del curso", async () => {
    const mockCourse = {
      id: courseId,
      name: "Diplomado Full Stack",
      code: "DFS-2026",
    };

    const mockCohorts = [{ id: "c-1" }, { id: "c-2" }];

    // Mock individual reports
    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "education_courses") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockCourse, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "education_cohorts") {
          return {
            select: vi.fn().mockImplementation((selectStr: string) => {
              // List query: .select("id").eq("course_id",...).eq("organization_id",...)
              if (selectStr.trim() === "id") {
                return {
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ data: mockCohorts, error: null }),
                  }),
                };
              }
              // Detail query: .select(`id, name, status, ...`).eq("id", cohortId).eq("organization_id",...).single()
              return {
                eq: vi.fn().mockImplementation((_field: string, val: string) => ({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: val,
                        name: `Cohorte ${val}`,
                        status: "in_progress",
                        course_id: courseId,
                        education_courses: { id: courseId, name: "Diplomado Full Stack" },
                      },
                      error: null,
                    }),
                  }),
                })),
              };
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
                        status: "paid",
                        total_cents: 10000,
                        paid_cents: 10000,
                        balance_cents: 0,
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

    const report = await getCourseFinancialReport(mockDb as never, orgId, courseId, 65.0);

    expect(report.courseId).toBe(courseId);
    expect(report.courseName).toBe("Diplomado Full Stack");
    expect(report.totalCohorts).toBe(2);
    expect(report.totalStudents).toBe(2); // 1 alumno por cada cohorte
    expect(report.projectedRevenueCents).toBe(20000); // $200.00
    expect(report.collectedRevenueCents).toBe(20000); // $200.00
    expect(report.collectionRatePercent).toBe(100.0);
  });
});
