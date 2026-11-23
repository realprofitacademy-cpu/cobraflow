-- =============================================================================
-- COBRAFLOW FOUNDATIONS — FASE 1
-- Módulo Financiero, Multimoneda BCV y Vertical Educativa con RLS Estricto
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TASA DE CAMBIO OFICIAL BCV (Histórica e Inmutable)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchange_rates_bcv (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_date DATE NOT NULL UNIQUE,
    usd_to_ves NUMERIC(14, 4) NOT NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'BCV',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_official BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lectura pública para cualquier usuario autenticado
ALTER TABLE public.exchange_rates_bcv ENABLE ROW LEVEL SECURITY;

CREATE POLICY exchange_rates_bcv_read_all ON public.exchange_rates_bcv
    FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- 2. FACTURACIÓN Y VENTAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
    invoice_number VARCHAR(50) NOT NULL,
    issue_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_date TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    exchange_rate_bcv NUMERIC(14, 4),
    subtotal_cents BIGINT NOT NULL DEFAULT 0,
    tax_cents BIGINT NOT NULL DEFAULT 0,
    total_cents BIGINT NOT NULL DEFAULT 0,
    paid_cents BIGINT NOT NULL DEFAULT 0,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT billing_invoices_status_check CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'voided', 'cancelled')),
    CONSTRAINT billing_invoices_currency_check CHECK (currency IN ('USD', 'VES')),
    CONSTRAINT billing_invoices_org_number_unique UNIQUE (organization_id, invoice_number)
);

ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_invoices ON public.billing_invoices
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- Items de factura
CREATE TABLE IF NOT EXISTS public.billing_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price_cents BIGINT NOT NULL DEFAULT 0,
    total_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_items ON public.billing_items
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- -----------------------------------------------------------------------------
-- 3. PAGOS Y CUENTAS POR COBRAR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    payment_method VARCHAR(40) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    amount_cents BIGINT NOT NULL,
    amount_ves NUMERIC(16, 2),
    exchange_rate_applied NUMERIC(14, 4),
    reference_number VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    evidence_storage_path TEXT,
    confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT billing_payments_method_check CHECK (payment_method IN ('pago_movil', 'bank_transfer', 'zelle', 'cash', 'card', 'other')),
    CONSTRAINT billing_payments_status_check CHECK (status IN ('pending', 'confirmed', 'rejected', 'refunded'))
);

ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_payments ON public.billing_payments
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- -----------------------------------------------------------------------------
-- 4. VERTICAL EDUCATIVA (Academias e Institutos)
-- -----------------------------------------------------------------------------
-- Cursos y programas
CREATE TABLE IF NOT EXISTS public.education_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    description TEXT,
    default_price_cents BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.education_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_education_courses ON public.education_courses
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- Cohortes o grupos
CREATE TABLE IF NOT EXISTS public.education_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.education_courses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    start_date DATE,
    end_date DATE,
    max_students INTEGER,
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT education_cohorts_status_check CHECK (status IN ('planned', 'enrolling', 'in_progress', 'completed', 'cancelled'))
);

ALTER TABLE public.education_cohorts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_education_cohorts ON public.education_cohorts
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- Alumnos (vinculados al contacto del CRM 360)
CREATE TABLE IF NOT EXISTS public.education_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    student_code VARCHAR(50),
    national_id VARCHAR(50), -- Cédula de Identidad (V- / E-)
    academic_notes TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT education_students_status_check CHECK (status IN ('prospect', 'enrolled', 'active', 'graduated', 'suspended', 'withdrawn')),
    CONSTRAINT education_students_contact_unique UNIQUE (organization_id, contact_id)
);

ALTER TABLE public.education_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_education_students ON public.education_students
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- Inscripciones (une alumno, cohorte, oportunidad CRM y factura comercial)
CREATE TABLE IF NOT EXISTS public.education_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.education_students(id) ON DELETE CASCADE,
    cohort_id UUID NOT NULL REFERENCES public.education_cohorts(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT education_enrollments_status_check CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'dropped')),
    CONSTRAINT education_enrollments_student_cohort_unique UNIQUE (student_id, cohort_id)
);

ALTER TABLE public.education_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_education_enrollments ON public.education_enrollments
    FOR ALL USING (organization_id IN (SELECT public.fn_user_org_ids()));

-- -----------------------------------------------------------------------------
-- 5. BLINDAJE DE RLS EN TABLAS ANTERIORES NO AUDITADAS
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    tbl text;
    target_tables text[] := ARRAY[
        'channel_knobs',
        'account_plans',
        'agent_inbox_items',
        'ai_router_decisions',
        'ai_router_members',
        'ai_routers',
        'before_send_traces',
        'calendar_resources',
        'calendar_service_blocks',
        'calendar_service_calendar_sources',
        'calendar_service_occurrence_resources',
        'calendar_service_occurrences',
        'calendar_service_professionals',
        'calendar_service_resources',
        'calendar_service_schedule'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        END IF;
    END LOOP;
END $$;
