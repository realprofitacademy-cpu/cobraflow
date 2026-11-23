/**
 * COBRAFLOW — MOTOR DE VENTAS, INSCRIPCIONES Y FINANZAS
 *
 * Conecta el CRM Comercial con la Facturación y la Vertical Educativa:
 * - Conversión de Lead (Oportunidad) a Alumno Inscrito.
 * - Generación automática de Factura/Recibo comercial.
 * - Registro de Pago inicial (completo o abono/anticipo en USD o VES).
 * - Cierre comercial de la oportunidad (Closed-Won) con trazabilidad inmutable.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export const enrollmentConversionSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  cohortId: z.string().uuid(),
  studentCode: z.string().optional(),
  nationalId: z.string().min(5, "Cédula o documento de identidad requerido"),
  academicNotes: z.string().optional(),
  // Datos comerciales y financieros
  invoiceNumber: z.string().min(3),
  currency: z.enum(["USD", "VES"]).default("USD"),
  exchangeRateBcv: z.number().positive().optional(),
  totalCents: z.number().int().positive(),
  taxCents: z.number().int().nonnegative().default(0),
  // Pago inicial / anticipo
  initialPayment: z
    .object({
      amountCents: z.number().int().positive(),
      amountVes: z.number().positive().optional(),
      paymentMethod: z.enum([
        "pago_movil",
        "bank_transfer",
        "zelle",
        "cash",
        "card",
        "other",
      ]),
      referenceNumber: z.string().optional(),
      evidenceStoragePath: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  actorUserId: z.string().uuid().optional(),
});

export type EnrollmentConversionInput = z.infer<typeof enrollmentConversionSchema>;

export interface EnrollmentConversionResult {
  success: boolean;
  studentId?: string;
  enrollmentId?: string;
  invoiceId?: string;
  paymentId?: string;
  error?: string;
}

/**
 * Convierte un Lead comercial en una Inscripción académica activa
 * generando la factura correspondiente y registrando abonos o pagos.
 */
export async function convertLeadToEnrollment(
  supabase: SupabaseClient,
  input: EnrollmentConversionInput
): Promise<EnrollmentConversionResult> {
  const validated = enrollmentConversionSchema.parse(input);
  const { organizationId, leadId, cohortId, nationalId } = validated;

  try {
    // 1. Obtener datos del lead y contacto asociado
    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .select("id, contact_id, organization_id, title")
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .single();

    if (leadError || !lead) {
      logger.error("[CobraFlow.Enrollment] Lead no encontrado", { leadId, error: leadError });
      return { success: false, error: "Lead comercial no encontrado en la organización." };
    }

    if (!lead.contact_id) {
      return { success: false, error: "El lead debe tener un contacto vinculado para inscribirlo." };
    }

    // 2. Crear o actualizar Alumno (education_students)
    const { data: existingStudent } = await supabase
      .from("education_students")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contact_id", lead.contact_id)
      .maybeSingle();

    let studentId = existingStudent?.id;

    if (!studentId) {
      const { data: newStudent, error: studentError } = await supabase
        .from("education_students")
        .insert({
          organization_id: organizationId,
          contact_id: lead.contact_id,
          national_id: nationalId,
          student_code: validated.studentCode ?? `ALU-${Date.now().toString().slice(-6)}`,
          academic_notes: validated.academicNotes,
          status: "enrolled",
        })
        .select("id")
        .single();

      if (studentError || !newStudent) {
        logger.error("[CobraFlow.Enrollment] Error al registrar alumno", { studentError });
        return { success: false, error: "No se pudo registrar la ficha del alumno." };
      }
      studentId = newStudent.id;
    } else {
      // Actualizar datos de identidad
      await supabase
        .from("education_students")
        .update({ national_id: nationalId, status: "enrolled" })
        .eq("id", studentId);
    }

    // 3. Crear Factura Comercial (billing_invoices)
    const subtotalCents = validated.totalCents - validated.taxCents;
    const initialPaidCents = validated.initialPayment ? validated.initialPayment.amountCents : 0;
    const initialBalanceCents = validated.totalCents - initialPaidCents;
    const initialInvoiceStatus =
      initialPaidCents >= validated.totalCents
        ? "paid"
        : initialPaidCents > 0
        ? "partially_paid"
        : "issued";

    const { data: invoice, error: invoiceError } = await supabase
      .from("billing_invoices")
      .insert({
        organization_id: organizationId,
        contact_id: lead.contact_id,
        lead_id: leadId,
        invoice_number: validated.invoiceNumber,
        currency: validated.currency,
        exchange_rate_bcv: validated.exchangeRateBcv,
        subtotal_cents: subtotalCents,
        tax_cents: validated.taxCents,
        total_cents: validated.totalCents,
        paid_cents: initialPaidCents,
        balance_cents: initialBalanceCents,
        status: initialInvoiceStatus,
      })
      .select("id")
      .single();

    if (invoiceError || !invoice) {
      logger.error("[CobraFlow.Enrollment] Error al generar factura", { invoiceError });
      return { success: false, error: "No se pudo generar la factura comercial." };
    }

    // 4. Si hay pago inicial, registrarlo en billing_payments
    let paymentId: string | undefined;
    if (validated.initialPayment) {
      const p = validated.initialPayment;
      const { data: payment, error: paymentError } = await supabase
        .from("billing_payments")
        .insert({
          organization_id: organizationId,
          invoice_id: invoice.id,
          contact_id: lead.contact_id,
          payment_method: p.paymentMethod,
          currency: validated.currency,
          amount_cents: p.amountCents,
          amount_ves: p.amountVes,
          exchange_rate_applied: validated.exchangeRateBcv,
          reference_number: p.referenceNumber,
          evidence_storage_path: p.evidenceStoragePath,
          status: "confirmed",
          confirmed_by: validated.actorUserId,
          confirmed_at: new Date().toISOString(),
          notes: p.notes,
        })
        .select("id")
        .single();

      if (paymentError) {
        logger.error("[CobraFlow.Enrollment] Error al registrar pago", { paymentError });
      } else {
        paymentId = payment?.id;
      }
    }

    // 5. Crear Inscripción (education_enrollments)
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("education_enrollments")
      .insert({
        organization_id: organizationId,
        student_id: studentId,
        cohort_id: cohortId,
        lead_id: leadId,
        invoice_id: invoice.id,
        status: initialInvoiceStatus === "paid" ? "confirmed" : "pending",
      })
      .select("id")
      .single();

    if (enrollmentError || !enrollment) {
      logger.error("[CobraFlow.Enrollment] Error al formalizar inscripción", { enrollmentError });
      return { success: false, error: "No se pudo formalizar la matrícula." };
    }

    // 6. Actualizar status del lead (marcar ganado)
    await supabase
      .from("crm_leads")
      .update({ status: "won" })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    return {
      success: true,
      studentId,
      enrollmentId: enrollment.id,
      invoiceId: invoice.id,
      paymentId,
    };
  } catch (err) {
    logger.error("[CobraFlow.Enrollment] Excepción inesperada en conversión", { err });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error interno al procesar inscripción.",
    };
  }
}
