# CobraFlow — Vertical de Gestión Educativa y Facturación Multimoneda (Venezuela)

CobraFlow es una extensión vertical especializada sobre la plataforma CRM, diseñada para optimizar los procesos de academias, institutos formativos y empresas comerciales que operan bajo el esquema bimonetario (USD y Bolívares a tasa oficial BCV) en Venezuela.

---

## 1. Arquitectura y Componentes Desarrollados

### 1.1 Base de Datos y Modelado (`supabase/migrations/`)
- `exchange_rates_bcv`: Almacén histórico y en tiempo real de cotizaciones USD/VES oficiales.
- `billing_invoices`: Facturas comerciales con soporte bimonetario (subtotal, IVA 16%, total en USD cents y VES).
- `billing_items`: Líneas de detalle de factura (cursos, matrículas, servicios).
- `billing_payments`: Registro de pagos en Bolívares (Pago Móvil, Transferencia bancaria) o Dólares (Zelle, Efectivo).
- `education_courses`: Catálogo de cursos, diplomados y programas académicos.
- `education_cohorts`: Turmas/cohortes con fechas de inicio/fin, cupos máximos y estados.
- `education_students`: Perfiles de alumnos con código estudiantil único.
- `education_enrollments`: Matrículas activas vinculadas a facturas y estados académicos.
- **Seguridad RLS:** Políticas estrictas de aislamiento multi-inquilino basadas en `fn_user_org_ids()`.

### 1.2 Biblioteca de Finanzas y Lógica de Negocio (`lib/finance/`)
- `bcv-service.ts`: Obtención de tasa en vivo desde BCV / DolarAPI, sincronización y conversión precisa de céntimos USD a VES.
- `billing-service.ts`: Emisión automática de facturas correlativas, liquidación de pagos y conciliación de saldos.
- `cohort-reports.ts`: Reportes de recaudación, ingresos proyectados y cuentas por cobrar por cohorte y curso.
- `templates.ts`: Plantillas de WhatsApp optimizadas para admisiones, cobros preventivos y confirmaciones.
- `payment-reminders.ts`: Motor de escaneo y recordatorios automáticos de vencimiento.

### 1.3 Herramientas de Agente de IA MCP (`lib/mcp/tools/`)
Capacidades integradas en el catálogo del agente (paquete `escalar`):
- `crm_list_courses`: Consulta de cursos, fechas de cohortes y precios convertidos a BCV.
- `crm_get_student_enrollments`: Consulta de matrículas y saldo pendiente del estudiante.
- `crm_get_bcv_rate`: Cotización oficial del BCV al día y calculadora cambiaria.
- `crm_enroll_student`: Inscripción de contacto en cohorte con facturación comercial automática.
- `crm_get_cohort_report`: Métricas de recaudación, tasa de ocupación y balance financiero de cohorte.

### 1.4 Campañas y Recordatorios Automatizados (`lib/campanhas/`, `docker/scheduler/`)
- `educacao-campanhas.ts`: Despacho de convocatorias de admisión a cohortes con mensajes bimonetarios personalizados.
- **Tareas Programadas (Cron):**
  - `/api/v1/cron/bcv-sync`: Sincronización diaria de la tasa oficial a las 18:30.
  - `/api/v1/cron/finance-payment-reminders`: Disparo matutino de recordatorios de cobro a las 09:30.
  - Registrados en `docker/scheduler/entrypoint.sh` cumpliendo la cerca estricta de tareas programadas.

### 1.5 Vistas e Interfaces de Usuario (`app/app/`)
- `app/app/financeiro/`: Panel de facturas, control de saldos, creación de facturas (`_invoice-modal.tsx`) y conciliación de pagos (`_payment-modal.tsx`).
- `app/app/educacao/`: Gestión de cursos, cohortes activas y matriculación rápida (`_enrollment-modal.tsx`).
- **Navegación:** Registrados en `NAV_CATALOG` bajo el grupo `analise` (sección `Dinheiro`), manteniendo intacta la regla de densidad de navegación.

---

## 2. API Endpoints

| Método | Endpoint | Descripción | Rol Mínimo |
|---|---|---|---|
| `GET` / `POST` | `/api/v1/finance/bcv-rate` | Consulta o fuerza sincronización de tasa BCV | `viewer` / `admin` |
| `GET` / `POST` | `/api/v1/finance/invoices` | Listado y creación de facturas multimoneda | `viewer` / `agent` |
| `GET` / `PATCH` | `/api/v1/finance/invoices/[id]` | Detalle o anulación de factura | `viewer` / `manager` |
| `POST` | `/api/v1/finance/invoices/[id]/payments` | Registro de pago (Pago Móvil, Zelle, etc.) | `agent` |
| `GET` | `/api/v1/finance/reports/cohorts/[cohortId]` | Reporte financiero de cohorte | `manager` |
| `GET` | `/api/v1/finance/reports/courses/[courseId]` | Reporte financiero global del curso | `manager` |
| `POST` | `/api/v1/education/cohorts/[id]/campaign` | Disparo/simulación de campaña de admisiones | `manager` |
| `GET` / `POST` | `/api/v1/cron/bcv-sync` | Endpoint para el programador del BCV | Cron Auth |
| `GET` / `POST` | `/api/v1/cron/finance-payment-reminders` | Endpoint para recordatorios de cobro | Cron Auth |

---

## 3. Verificación y Calidad

Para ejecutar todas las pruebas y validaciones del módulo CobraFlow:

```bash
# Validación de aislamiento de canales
pnpm lint:channels

# Ejecución de suites de prueba unitarias y cercas arquitectónicas
npx vitest run \
  tests/unit/finance-bcv.test.ts \
  tests/unit/billing-invoicing.test.ts \
  tests/unit/cohort-reports.test.ts \
  tests/unit/finance-templates-and-reminders.test.ts \
  tests/unit/mcp-education-tools.test.ts \
  tests/unit/education-campaigns-and-mcp.test.ts \
  tests/unit/cobraflow-ui.test.tsx \
  tests/unit/navegacao-completude.test.ts \
  tests/unit/navegacao-registry.test.ts \
  tests/unit/cron-routes-scheduled.test.ts \
  tests/unit/catalogo-tools-leigo-friendly.test.ts \
  tests/unit/pacote-reserva-vaga-da-critica.test.ts
```
