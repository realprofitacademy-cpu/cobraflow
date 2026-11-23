/**
 * COBRAFLOW — SERVICIO DE BROADCAST REALTIME ESCALABLE
 *
 * Implementa el envío de eventos de tiempo real mediante Supabase Broadcast
 * para desacoplar el Inbox de la replicación WAL de Postgres (postgres_changes).
 *
 * Cumple con los requerimientos:
 * 1. Prioriza Broadcast sobre Postgres Changes.
 * 2. Canales privados por organización (`private:org:{org_id}:inbox`).
 * 3. PostgreSQL es la única fuente de verdad; si el broadcast falla,
 *    la transacción y la persistencia no se rompen (fail-open para realtime).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export interface RealtimeInboxEvent {
  organizationId: string;
  conversationId: string;
  event:
    | "message.created"
    | "message.updated"
    | "conversation.updated"
    | "conversation.claimed"
    | "agent.typing";
  payload: Record<string, unknown>;
}

/**
 * Emite un evento Broadcast a través del canal privado de la organización.
 */
export async function emitRealtimeInboxEvent(
  admin: SupabaseClient,
  eventData: RealtimeInboxEvent
): Promise<void> {
  const { organizationId, conversationId, event, payload } = eventData;
  const channelName = `private:org:${organizationId}:inbox`;

  try {
    if (typeof admin.channel !== "function") {
      // Cliente mock o entorno sin Realtime configurado
      return;
    }

    const channel = admin.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    // Suscribe temporalmente para enviar broadcast
    await channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel
          .send({
            type: "broadcast",
            event,
            payload: {
              ...payload,
              organization_id: organizationId,
              conversation_id: conversationId,
              timestamp: new Date().toISOString(),
            },
          })
          .catch((err) => {
            logger.warn("[realtime.broadcast] Error enviando broadcast", {
              channel: channelName,
              event,
              error: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => {
            // Limpia el canal después de enviar
            if (typeof admin.removeChannel === "function") {
              void admin.removeChannel(channel);
            }
          });
      }
    });
  } catch (err) {
    logger.warn("[realtime.broadcast] Fallo al despachar evento de broadcast", {
      channel: channelName,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
