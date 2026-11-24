import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";

import { EducacaoDashboard } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Educação — gestión de cursos, cohortes y matrículas.
 * Viewer: puede ver cursos y cohortes.
 * Manager/Agent: puede inscribir estudiantes (crea factura automáticamente).
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
        <h1 className="text-xl font-semibold">{t("Educación")}</h1>
        <p className="text-sm text-text-muted">
          {t("Gestión de cursos, cohortes y matrículas para academias.")}
        </p>
      </div>
      <EducacaoDashboard
        podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager}
        moedaDaOrg={moedaDaOrg}
      />
    </div>
  );
}
