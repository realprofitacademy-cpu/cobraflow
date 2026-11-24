/**
 * COBRAFLOW — CAPACIDADES MCP DE EDUCAÇÃO E FINANÇAS (ACADEMIAS E INSTITUTOS)
 *
 * Implementa as 4 ferramentas do agente de IA para a vertical educativa venezuelana:
 *  - crm_list_courses: Consulta catálogo de cursos, turmas abertas e valores bimonetários (USD e VES a BCV).
 *  - crm_get_student_enrollments: Consulta inscrições, status acadêmico e saldo devedor do aluno.
 *  - crm_get_bcv_rate: Consulta taxa oficial do Banco Central de Venezuela e converte valores.
 *  - crm_enroll_student: Registra inscrição em turma e emite a fatura comercial vinculada.
 */
import { z } from "zod";
import type { McpToolDefinition } from "../types";
import { getLatestBcvRate, convertUsdCentsToVes } from "@/lib/finance/bcv-service";
import { createInvoice } from "@/lib/finance/billing-service";

// ---------------------------------------------------------------------------
// 1. crm_list_courses
// ---------------------------------------------------------------------------
const listCoursesInputShape = {
  is_active: z.boolean().optional().default(true).describe("Filtrar apenas cursos ativos (padrão true)"),
};

export const crmListCourses: McpToolDefinition<typeof listCoursesInputShape> = {
  name: "crm_list_courses",
  description:
    "Lista cursos e programas da academia com suas turmas ativas/abertas para matrícula. " +
    "Retorna descrição, carga, datas de início e preços em dólares e bolívares (à taxa oficial BCV).",
  inputSchema: listCoursesInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const rateRecord = await getLatestBcvRate(ctx.supabase);
    const bcvRate = rateRecord?.usdToVes || 65.0;

    const { data: courses, error } = await ctx.supabase
      .from("education_courses")
      .select(`
        id,
        name,
        code,
        description,
        default_price_cents,
        currency,
        is_active,
        education_cohorts (
          id,
          name,
          start_date,
          end_date,
          max_students,
          status
        )
      `)
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", input.is_active)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`failed_to_list_courses: ${error.message}`);
    }

    const formattedCourses = (courses || []).map((c) => {
      const priceCents = Number(c.default_price_cents || 0);
      const { amountVes, formattedVes, formattedUsd } = convertUsdCentsToVes(priceCents, bcvRate);

      const activeCohorts = (c.education_cohorts || []).filter(
        (cohort: any) => cohort.status === "enrolling" || cohort.status === "planned" || cohort.status === "in_progress",
      );

      return {
        id: c.id,
        name: c.name,
        code: c.code,
        description: c.description,
        priceUsd: formattedUsd,
        priceVes: formattedVes,
        priceCents,
        priceVesRaw: amountVes,
        cohorts: activeCohorts.map((co: any) => ({
          id: co.id,
          name: co.name,
          startDate: co.start_date,
          endDate: co.end_date,
          status: co.status,
          maxStudents: co.max_students,
        })),
      };
    });

    return {
      totalCourses: formattedCourses.length,
      bcvRateUsed: bcvRate,
      rateDate: rateRecord?.rateDate || new Date().toISOString().split("T")[0],
      courses: formattedCourses,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. crm_get_student_enrollments
// ---------------------------------------------------------------------------
const studentEnrollmentsInputShape = {
  contact_id: z.string().uuid().describe("O contato cujas inscrições acadêmicas se quer consultar."),
};

export const crmGetStudentEnrollments: McpToolDefinition<typeof studentEnrollmentsInputShape> = {
  name: "crm_get_student_enrollments",
  description:
    "Consulta as matrículas acadêmicas de um contato, turmas em andamento e situação financeira " +
    "(faturas pagas e saldos pendentes em USD e VES). Em conversa de atendimento, devolve apenas do contato do turno.",
  inputSchema: studentEnrollmentsInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    if (ctx.contatoDoTurno && input.contact_id !== ctx.contatoDoTurno) {
      return {
        refused: true,
        reason: "contato_fora_do_turno: você só pode consultar dados do contato atendido nesta conversa.",
      };
    }

    const rateRecord = await getLatestBcvRate(ctx.supabase);
    const bcvRate = rateRecord?.usdToVes || 65.0;

    // 1. Obter ficha do aluno
    const { data: student, error: studentErr } = await ctx.supabase
      .from("education_students")
      .select("id, student_code, national_id, status")
      .eq("contact_id", input.contact_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (studentErr) {
      throw new Error(`failed_to_get_student: ${studentErr.message}`);
    }

    if (!student) {
      return {
        enrolled: false,
        message: "O contato ainda não possui cadastro de aluno nem matrículas registradas.",
        enrollments: [],
      };
    }

    // 2. Obter matrículas e faturas
    const { data: enrollments, error: enrollErr } = await ctx.supabase
      .from("education_enrollments")
      .select(`
        id,
        status,
        enrolled_at,
        education_cohorts (
          id,
          name,
          status,
          start_date,
          education_courses ( id, name, code )
        ),
        billing_invoices (
          id,
          invoice_number,
          status,
          total_cents,
          paid_cents,
          balance_cents,
          currency
        )
      `)
      .eq("student_id", student.id)
      .eq("organization_id", ctx.organizationId);

    if (enrollErr) {
      throw new Error(`failed_to_get_enrollments: ${enrollErr.message}`);
    }

    const items = (enrollments || []).map((e: any) => {
      const cohort = e.education_cohorts || {};
      const course = cohort.education_courses || {};
      const invoice = e.billing_invoices || null;

      let balanceUsd = "$0.00";
      let balanceVes = "0,00 Bs";
      let isPending = false;

      if (invoice && invoice.balance_cents > 0) {
        isPending = true;
        const conv = convertUsdCentsToVes(Number(invoice.balance_cents), bcvRate);
        balanceUsd = conv.formattedUsd;
        balanceVes = conv.formattedVes;
      }

      return {
        enrollmentId: e.id,
        enrollmentStatus: e.status,
        enrolledAt: e.enrolled_at,
        courseName: course.name || "Curso",
        cohortName: cohort.name || "Turma",
        cohortStatus: cohort.status,
        startDate: cohort.start_date,
        invoice: invoice ? {
          invoiceNumber: invoice.invoice_number,
          status: invoice.status,
          hasPendingBalance: isPending,
          balanceUsd,
          balanceVes,
        } : null,
      };
    });

    return {
      enrolled: true,
      studentCode: student.student_code,
      nationalId: student.national_id,
      studentStatus: student.status,
      bcvRateUsed: bcvRate,
      enrollments: items,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. crm_get_bcv_rate
// ---------------------------------------------------------------------------
const bcvRateInputShape = {
  amount_usd: z.number().min(0).optional().describe("Monto opcional en dólares americanos para convertir a Bolívares"),
};

export const crmGetBcvRate: McpToolDefinition<typeof bcvRateInputShape> = {
  name: "crm_get_bcv_rate",
  description:
    "Obtiene la tasa oficial de cambio del Banco Central de Venezuela (BCV) del día y, opcionalmente, " +
    "convierte un monto en dólares (USD) a bolívares digitales (VES). Útil para cotizar matrículas y pagos en moneda local.",
  inputSchema: bcvRateInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const rateRecord = await getLatestBcvRate(ctx.supabase);
    const usdToVes = rateRecord?.usdToVes || 65.0;
    const rateDate = rateRecord?.rateDate || new Date().toISOString().split("T")[0];

    const res: Record<string, unknown> = {
      usdToVes,
      rateDate,
      source: rateRecord?.source || "BCV Oficial",
      isOfficial: rateRecord?.isOfficial ?? true,
    };

    if (input.amount_usd !== undefined && input.amount_usd !== null) {
      const cents = Math.round(input.amount_usd * 100);
      const converted = convertUsdCentsToVes(cents, usdToVes);
      res.conversion = {
        amountUsd: input.amount_usd,
        formattedUsd: converted.formattedUsd,
        amountVes: converted.amountVes,
        formattedVes: converted.formattedVes,
      };
    }

    return res;
  },
};

// ---------------------------------------------------------------------------
// 4. crm_enroll_student
// ---------------------------------------------------------------------------
const enrollStudentInputShape = {
  contact_id: z.string().uuid().describe("ID do contato para efetuar a matrícula"),
  cohort_id: z.string().uuid().describe("ID da turma onde será matriculado"),
  national_id: z.string().optional().describe("Documento de identidade ou cédula do aluno (ex: V-12345678)"),
  lead_id: z.string().uuid().optional().describe("ID da oportunidade comercial se houver"),
  notes: z.string().optional().describe("Observações ou detalhes da matrícula"),
};

export const crmEnrollStudent: McpToolDefinition<typeof enrollStudentInputShape> = {
  name: "crm_enroll_student",
  description:
    "Registra a matrícula de um aluno em uma turma e gera automaticamente a fatura comercial em dólares " +
    "e bolívares à taxa oficial do BCV. Em atendimento, só matricula o contato do turno.",
  inputSchema: enrollStudentInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    if (ctx.contatoDoTurno && input.contact_id !== ctx.contatoDoTurno) {
      return {
        refused: true,
        reason: "contato_fora_do_turno: você só pode matricular o contato atendido nesta conversa.",
      };
    }

    // 1. Validar turma e curso
    const { data: cohort, error: cohortErr } = await ctx.supabase
      .from("education_cohorts")
      .select(`
        id,
        name,
        status,
        start_date,
        education_courses (
          id,
          name,
          default_price_cents
        )
      `)
      .eq("id", input.cohort_id)
      .eq("organization_id", ctx.organizationId)
      .single();

    if (cohortErr || !cohort) {
      throw new Error(`cohort_not_found: turma ${input.cohort_id} não encontrada.`);
    }

    const course = (cohort.education_courses as unknown as { id: string; name: string; default_price_cents: number }) || {
      id: "unknown",
      name: "Curso",
      default_price_cents: 10000,
    };

    // 2. Garantir que o registro do aluno exista
    let { data: student } = await ctx.supabase
      .from("education_students")
      .select("id, student_code")
      .eq("contact_id", input.contact_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (!student) {
      const studentCode = `ALU-${Date.now().toString().slice(-6)}`;
      const { data: newStudent, error: createStudentErr } = await ctx.supabase
        .from("education_students")
        .insert({
          organization_id: ctx.organizationId,
          contact_id: input.contact_id,
          student_code: studentCode,
          national_id: input.national_id || null,
          status: "enrolled",
        })
        .select("id, student_code")
        .single();

      if (createStudentErr) {
        throw new Error(`student_creation_failed: ${createStudentErr.message}`);
      }
      student = newStudent;
    }

    // 3. Emitir fatura comercial automática para a matrícula
    const tuitionPriceCents = Number(course.default_price_cents || 0);
    const invoice = await createInvoice(ctx.supabase, {
      organizationId: ctx.organizationId,
      contactId: input.contact_id,
      leadId: input.lead_id || null,
      notes: `Matrícula: ${course.name} — Turma ${cohort.name}`,
      items: [
        {
          description: `Inscrição e Matrícula: ${course.name} (${cohort.name})`,
          quantity: 1,
          unitPriceCents: tuitionPriceCents > 0 ? tuitionPriceCents : 10000,
        },
      ],
    });

    // 4. Criar registro de inscrição
    const { data: enrollment, error: enrollErr } = await ctx.supabase
      .from("education_enrollments")
      .insert({
        organization_id: ctx.organizationId,
        student_id: student.id,
        cohort_id: cohort.id,
        lead_id: input.lead_id || null,
        invoice_id: invoice.id,
        status: "pending",
      })
      .select("id, status, enrolled_at")
      .single();

    if (enrollErr) {
      throw new Error(`enrollment_creation_failed: ${enrollErr.message}`);
    }

    return {
      success: true,
      enrollmentId: enrollment.id,
      studentCode: student.student_code,
      courseName: course.name,
      cohortName: cohort.name,
      startDate: cohort.start_date,
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        totalUsd: `$${(invoice.totalCents / 100).toFixed(2)}`,
        totalVes: `${invoice.totalVes.toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs`,
        exchangeRateBcv: invoice.exchangeRateBcv,
      },
      message: `Matrícula registrada com sucesso! A fatura ${invoice.invoiceNumber} foi gerada no valor de $${(invoice.totalCents / 100).toFixed(2)} (${invoice.totalVes.toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs).`,
    };
  },
};
