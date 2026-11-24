import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";

import { FinanceiroDashboard } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Financeiro — tablero de facturación y gestión financiera para CobraFlow.
 *
 * Viewer: puede ver el dashboard.
 * Manager/Agent: puede crear facturas y registrar pagos.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);
  const moedaDaOrg = await moedaDaOrganizacao(await createClient(), org.orgId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Financeiro")}</h1>
        <p className="text-sm text-text-muted">
          {t("Panel de facturación, cobros y reportes financieros.")}
        </p>
      </div>
      <FinanceiroDashboard
        podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager}
        moedaDaOrg={moedaDaOrg}
      />
    </div>
  );
}
