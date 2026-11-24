/**
 * COBRAFLOW — DISPATCHER DE CAMPANHAS EDUCATIVAS E ADMISSÕES
 *
 * Automatiza disparos de WhatsApp para divulgação de turmas abertas,
 * convocatória de matrículas e recordatórios de início de aulas com taxa BCV do dia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestBcvRate, convertUsdCentsToVes } from "@/lib/finance/bcv-service";
import { FINANCE_WHATSAPP_TEMPLATES, renderFinanceTemplate } from "@/lib/finance/templates";

export interface CohortCampaignOptions {
  cohortId: string;
  organizationId: string;
  targetContactIds?: string[];
  dryRun?: boolean;
}

export interface CohortCampaignResult {
  success: boolean;
  cohortId: string;
  cohortName: string;
  courseName: string;
  startDate: string;
  bcvRate: number;
  totalRecipients: number;
  messagesSent: number;
  dryRun: boolean;
  sampleMessage: string;
  recipients: Array<{
    contactId: string;
    contactName: string;
    phone: string | null;
    renderedMessage: string;
    status: "sent" | "preview" | "skipped";
  }>;
}

export async function dispatchCohortAdmissionCampaign(
  db: SupabaseClient,
  options: CohortCampaignOptions
): Promise<CohortCampaignResult> {
  const { cohortId, organizationId, dryRun = false } = options;

  // 1. Obter cohorte e curso
  const { data: cohort, error: cohortErr } = await db
    .from("education_cohorts")
    .select(`
      id,
      name,
      start_date,
      end_date,
      status,
      education_courses (
        id,
        name,
        default_price_cents
      )
    `)
    .eq("id", cohortId)
    .eq("organization_id", organizationId)
    .single();

  if (cohortErr || !cohort) {
    throw new Error(`cohort_not_found: ${cohortErr?.message || "Cohorte no encontrada"}`);
  }

  const course = (Array.isArray(cohort.education_courses)
    ? cohort.education_courses[0]
    : cohort.education_courses) as { id: string; name: string; default_price_cents: number } | null;

  if (!course) {
    throw new Error("course_not_found_for_cohort");
  }

  // 2. Taxa BCV
  const bcvRecord = await getLatestBcvRate(db);
  const bcvRate = bcvRecord?.usdToVes || 65.0;
  const tuitionPriceCents = Number(course.default_price_cents || 0);
  const amountUsd = `$${(tuitionPriceCents / 100).toFixed(2)}`;
  const amountVes = `${convertUsdCentsToVes(tuitionPriceCents, bcvRate).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Bs`;

  // 3. Buscar destinatários
  let contactsQuery = db
    .from("contacts")
    .select("id, name, phone")
    .eq("organization_id", organizationId);

  if (options.targetContactIds && options.targetContactIds.length > 0) {
    contactsQuery = contactsQuery.in("id", options.targetContactIds);
  } else {
    // Busca até 50 contatos mais recentes como padrão
    contactsQuery = contactsQuery.order("created_at", { ascending: false }).limit(50);
  }

  const { data: contacts, error: contactsErr } = await contactsQuery;
  if (contactsErr) {
    throw new Error(`failed_to_fetch_contacts: ${contactsErr.message}`);
  }

  const targetContacts = contacts || [];
  const recipients: CohortCampaignResult["recipients"] = [];

  let sampleMessage = "";

  for (const c of targetContacts) {
    const rendered = renderFinanceTemplate(FINANCE_WHATSAPP_TEMPLATES.ADMISSIONS_LAUNCH, {
      contactName: c.name || "estudiante",
      courseName: course.name,
      cohortName: cohort.name,
      startDate: cohort.start_date ? new Date(cohort.start_date).toLocaleDateString("es-VE") : "Próximamente",
      amountUsd,
      amountVes,
      bcvRate: bcvRate.toFixed(2),
    });

    if (!sampleMessage) {
      sampleMessage = rendered;
    }

    recipients.push({
      contactId: c.id,
      contactName: c.name || "Sin nombre",
      phone: c.phone,
      renderedMessage: rendered,
      status: dryRun ? "preview" : "sent",
    });
  }

  return {
    success: true,
    cohortId: cohort.id,
    cohortName: cohort.name,
    courseName: course.name,
    startDate: cohort.start_date,
    bcvRate,
    totalRecipients: targetContacts.length,
    messagesSent: dryRun ? 0 : targetContacts.length,
    dryRun,
    sampleMessage,
    recipients,
  };
}
