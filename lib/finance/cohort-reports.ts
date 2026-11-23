/**
 * COBRAFLOW — REPORTES FINANCIEROS Y METRICAS DE COHORTES Y CURSOS
 *
 * Provee análisis de ingresos proyectados, recaudados y cuentas por cobrar
 * para academias e instituciones educativas, con desglose bimonetario (USD y VES a tasa BCV).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestBcvRate, convertUsdCentsToVes } from "./bcv-service";

export interface CohortFinancialReport {
  cohortId: string;
  cohortName: string;
  courseId: string;
  courseName: string;
  status: string;
  totalStudents: number;
  confirmedEnrollments: number;
  pendingEnrollments: number;
  projectedRevenueCents: number;
  collectedRevenueCents: number;
  pendingBalanceCents: number;
  collectionRatePercent: number;
  projectedRevenueUsd: string;
  collectedRevenueUsd: string;
  pendingBalanceUsd: string;
  collectedRevenueVes: number;
  pendingBalanceVes: number;
  exchangeRateUsed: number;
}

export interface CourseFinancialReport {
  courseId: string;
  courseName: string;
  code: string | null;
  totalCohorts: number;
  totalStudents: number;
  projectedRevenueCents: number;
  collectedRevenueCents: number;
  pendingBalanceCents: number;
  collectionRatePercent: number;
  collectedRevenueVes: number;
  pendingBalanceVes: number;
  cohorts: CohortFinancialReport[];
}

/**
 * Genera el reporte financiero detallado de una cohorte específica.
 */
export async function getCohortFinancialReport(
  db: SupabaseClient,
  organizationId: string,
  cohortId: string,
  customBcvRate?: number,
): Promise<CohortFinancialReport> {
  // 1. Obtener datos de la cohorte y curso
  const { data: cohort, error: cohortErr } = await db
    .from("education_cohorts")
    .select(`
      id,
      name,
      status,
      course_id,
      education_courses (
        id,
        name
      )
    `)
    .eq("id", cohortId)
    .eq("organization_id", organizationId)
    .single();

  if (cohortErr || !cohort) {
    throw new Error(`cohort_not_found: cohorte ${cohortId} no encontrada.`);
  }

  const course = (cohort.education_courses as unknown as { id: string; name: string }) || {
    id: cohort.course_id,
    name: "Curso",
  };

  // 2. Obtener inscripciones de la cohorte con sus facturas vinculadas
  const { data: enrollments, error: enrollErr } = await db
    .from("education_enrollments")
    .select(`
      id,
      status,
      invoice_id,
      billing_invoices (
        id,
        status,
        total_cents,
        paid_cents,
        balance_cents,
        exchange_rate_bcv
      )
    `)
    .eq("cohort_id", cohortId)
    .eq("organization_id", organizationId);

  if (enrollErr) {
    throw new Error(`enrollments_fetch_failed: ${enrollErr.message}`);
  }

  // 3. Resolver tasa BCV para la conversión a VES
  let bcvRate = customBcvRate;
  if (!bcvRate || bcvRate <= 0) {
    const latestRate = await getLatestBcvRate(db);
    bcvRate = latestRate?.usdToVes || 65.0;
  }

  // 4. Calcular métricas financieras
  let projectedRevenueCents = 0;
  let collectedRevenueCents = 0;
  let pendingBalanceCents = 0;
  let confirmedEnrollments = 0;
  let pendingEnrollments = 0;

  for (const enr of enrollments || []) {
    if (enr.status === "confirmed" || enr.status === "active" || enr.status === "completed") {
      confirmedEnrollments++;
    } else {
      pendingEnrollments++;
    }

    const inv = enr.billing_invoices as unknown as {
      total_cents?: number;
      paid_cents?: number;
      balance_cents?: number;
      status?: string;
    } | null;

    if (inv && inv.status !== "voided" && inv.status !== "cancelled") {
      projectedRevenueCents += Number(inv.total_cents || 0);
      collectedRevenueCents += Number(inv.paid_cents || 0);
      pendingBalanceCents += Number(inv.balance_cents || 0);
    }
  }

  const collectionRatePercent = projectedRevenueCents > 0
    ? Math.round((collectedRevenueCents / projectedRevenueCents) * 10000) / 100
    : 0;

  const { amountVes: collectedRevenueVes } = convertUsdCentsToVes(collectedRevenueCents, bcvRate);
  const { amountVes: pendingBalanceVes } = convertUsdCentsToVes(pendingBalanceCents, bcvRate);

  return {
    cohortId: cohort.id,
    cohortName: cohort.name,
    courseId: course.id,
    courseName: course.name,
    status: cohort.status,
    totalStudents: (enrollments || []).length,
    confirmedEnrollments,
    pendingEnrollments,
    projectedRevenueCents,
    collectedRevenueCents,
    pendingBalanceCents,
    collectionRatePercent,
    projectedRevenueUsd: `$${(projectedRevenueCents / 100).toFixed(2)}`,
    collectedRevenueUsd: `$${(collectedRevenueCents / 100).toFixed(2)}`,
    pendingBalanceUsd: `$${(pendingBalanceCents / 100).toFixed(2)}`,
    collectedRevenueVes,
    pendingBalanceVes,
    exchangeRateUsed: bcvRate,
  };
}

/**
 * Genera el reporte consolidado de un curso, agregando todas sus cohortes.
 */
export async function getCourseFinancialReport(
  db: SupabaseClient,
  organizationId: string,
  courseId: string,
  customBcvRate?: number,
): Promise<CourseFinancialReport> {
  const { data: course, error: courseErr } = await db
    .from("education_courses")
    .select("id, name, code")
    .eq("id", courseId)
    .eq("organization_id", organizationId)
    .single();

  if (courseErr || !course) {
    throw new Error(`course_not_found: curso ${courseId} no encontrado.`);
  }

  const { data: cohorts, error: cohortsErr } = await db
    .from("education_cohorts")
    .select("id")
    .eq("course_id", courseId)
    .eq("organization_id", organizationId);

  if (cohortsErr) {
    throw new Error(`cohorts_fetch_failed: ${cohortsErr.message}`);
  }

  const cohortReports: CohortFinancialReport[] = [];
  let totalStudents = 0;
  let projectedRevenueCents = 0;
  let collectedRevenueCents = 0;
  let pendingBalanceCents = 0;

  for (const c of cohorts || []) {
    const report = await getCohortFinancialReport(db, organizationId, c.id, customBcvRate);
    cohortReports.push(report);
    totalStudents += report.totalStudents;
    projectedRevenueCents += report.projectedRevenueCents;
    collectedRevenueCents += report.collectedRevenueCents;
    pendingBalanceCents += report.pendingBalanceCents;
  }

  const rate = customBcvRate || (cohortReports[0]?.exchangeRateUsed || 65.0);
  const collectionRatePercent = projectedRevenueCents > 0
    ? Math.round((collectedRevenueCents / projectedRevenueCents) * 10000) / 100
    : 0;

  const { amountVes: collectedRevenueVes } = convertUsdCentsToVes(collectedRevenueCents, rate);
  const { amountVes: pendingBalanceVes } = convertUsdCentsToVes(pendingBalanceCents, rate);

  return {
    courseId: course.id,
    courseName: course.name,
    code: course.code,
    totalCohorts: cohortReports.length,
    totalStudents,
    projectedRevenueCents,
    collectedRevenueCents,
    pendingBalanceCents,
    collectionRatePercent,
    collectedRevenueVes,
    pendingBalanceVes,
    cohorts: cohortReports,
  };
}
