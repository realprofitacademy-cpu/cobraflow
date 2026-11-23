/**
 * COBRAFLOW — ADAPTADOR OFICIAL META INSTAGRAM DIRECT
 *
 * Implementa ChannelAdapter nativo para Instagram Messaging a través de
 * Meta Graph API v21.0, eliminando la dependencia obligatoria de intermediarios.
 *
 * Endpoints:
 * - Mensajes: POST https://graph.facebook.com/v21.0/{ig_page_id}/messages
 * - Lectura: POST https://graph.facebook.com/v21.0/{ig_page_id}/messages (sender_action: mark_seen)
 * - Reacciones: POST https://graph.facebook.com/v21.0/{ig_page_id}/messages (sender_action: react)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { FalhaDeEnvioDoCanal } from "../falha-de-envio";
import { graphVersion } from "@/lib/graph-version";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

export interface InstagramCreds {
  pageId: string;
  token: string;
  graphVersion: string;
}

/**
 * Resuelve las credenciales de Instagram para la organización y sesión dada.
 */
export async function resolveInstagramCreds(
  admin: ReturnType<typeof createAdminClient>,
  scope: ChannelTenantScope,
): Promise<InstagramCreds | null> {
  if (admin && typeof admin.from === "function") {
    const { data: session } = await admin
      .from("channel_sessions")
      .select("id, encrypted_token, metadata")
      .eq("organization_id", scope.organizationId)
      .eq("provider", "meta_instagram")
      .is("archived_at", null)
      .maybeSingle();

    if (session?.encrypted_token) {
      const token = await decryptWebhookSecret(admin, session.encrypted_token);
      const meta = (session.metadata as Record<string, unknown>) ?? {};
      const pageId = (meta.instagram_page_id as string) || (meta.page_id as string) || "me";
      if (token) {
        return {
          pageId,
          token,
          graphVersion: (meta.graph_version as string) || graphVersion(),
        };
      }
    }
  }

  // Fallback a variables de entorno para desarrollo o instancia dedicada
  const envToken = process.env.META_INSTAGRAM_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  const envPageId = process.env.META_INSTAGRAM_PAGE_ID || "me";
  if (envToken) {
    return {
      pageId: envPageId,
      token: envToken,
      graphVersion: graphVersion(),
    };
  }

  return null;
}

export const instagramAdapter: ChannelAdapter = {
  provider: "meta_instagram",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup) return null; // Instagram DMs grupales no soportados en v1
    // Destinatario es el IGSID (Instagram Scoped ID)
    return input.providerConversationId ?? (input.phone ? input.phone.replace(/\D/g, "") : null);
  },

  isConfigured(): boolean {
    return true;
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const admin = createAdminClient();
    const creds = await resolveInstagramCreds(admin, {
      organizationId: envelope.organizationId,
      sessionRef: envelope.sessionRef,
    });

    if (!creds) {
      throw new FalhaDeEnvioDoCanal({
        mensagem: "Credenciales de Instagram no configuradas para esta organización.",
        categoria: "credencial_invalida",
      });
    }

    const recipientId = envelope.providerConversationId || envelope.to;
    if (!recipientId) {
      throw new FalhaDeEnvioDoCanal({
        mensagem: "Destinatario no válido para Instagram Direct (falta IGSID).",
        categoria: "destinatario_invalido",
      });
    }

    const url = `https://graph.facebook.com/${creds.graphVersion}/${creds.pageId}/messages`;

    let payloadMessage: Record<string, unknown>;

    if (envelope.kind === "text") {
      if (!envelope.body?.trim()) {
        throw new FalhaDeEnvioDoCanal({
          mensagem: "Mensaje de Instagram sin cuerpo de texto.",
          categoria: "corpo_invalido",
        });
      }
      payloadMessage = { text: envelope.body };
    } else if (envelope.media) {
      const type = envelope.kind === "audio" ? "audio" : envelope.kind === "video" ? "video" : "image";
      payloadMessage = {
        attachment: {
          type,
          payload: {
            url: envelope.media.url,
            is_reusable: true,
          },
        },
      };
    } else {
      payloadMessage = { text: envelope.body || "" };
    }

    const body = {
      recipient: { id: recipientId },
      message: payloadMessage,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      id?: string;
      error?: { message: string; code: number; error_subcode?: number };
    };

    if (!res.ok || json.error) {
      const err = json.error;
      throw new FalhaDeEnvioDoCanal({
        mensagem: err?.message || `Error en Graph API HTTP ${res.status}`,
        codigo: err?.code ? String(err.code) : String(res.status),
        categoria: err?.code === 190 ? "credencial_invalida" : "rejeicao_da_plataforma",
      });
    }

    const externalId = json.message_id || json.id || null;
    return { externalId };
  },

  async markRead(scope: ChannelTenantScope, messageExternalId: string): Promise<void> {
    const admin = createAdminClient();
    const creds = await resolveInstagramCreds(admin, scope);
    if (!creds) return;

    const url = `https://graph.facebook.com/${creds.graphVersion}/${creds.pageId}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: scope.sessionRef },
        sender_action: "mark_seen",
      }),
    }).catch(() => {
      // Marcado de lectura es fail-safe
    });
  },

  async checkHealth(input: { organizationId: string; sessionRef: string }): Promise<ChannelHealth> {
    const admin = createAdminClient();
    const creds = await resolveInstagramCreds(admin, input);

    if (!creds) {
      return { reachable: true, status: "FAILED", detail: "credencial_indisponivel" };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/${creds.graphVersion}/me?fields=id,name`,
        {
          headers: { Authorization: `Bearer ${creds.token}` },
        },
      );

      if (!res.ok) {
        return { reachable: true, status: "FAILED", detail: `meta_error_${res.status}` };
      }

      return { reachable: true, status: "WORKING", detail: null };
    } catch {
      return { reachable: false, status: null, detail: "meta_graph_unreachable" };
    }
  },
};
