/**
 * COBRAFLOW — CONTRATO DE TRANSPORTE REALTIME (PROVIDER-AGNOSTIC)
 *
 * Desacopla la capa de presentación (Inbox, Kanban, notificaciones) del
 * proveedor de WebSockets subyacente (Supabase Realtime, Centrifugo, Socket.io).
 *
 * Reglas de diseño:
 * 1. Prioriza Broadcast sobre Postgres Changes (cero carga de WAL en Postgres).
 * 2. Presence gestiona estados efímeros en memoria (agente online, escribiendo,
 *    colisión de agentes) sin persistir en base de datos.
 * 3. PostgreSQL sigue siendo la única fuente de verdad persistente.
 */

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

export type RealtimeEventHandler<T = unknown> = (payload: T) => void;

export interface RealtimeEnvelope<T = unknown> {
  topic: string;
  event: string;
  payload: T;
  timestamp: string;
  organizationId: string;
}

export interface ICobraRealtimeProvider {
  /** Conecta al broker con el token de sesión autenticado */
  connect(token?: string): Promise<void>;

  /** Cierra la conexión activa */
  disconnect(): Promise<void>;

  /** Suscribe un handler a un evento de Broadcast en un tópico aislado */
  subscribe<T = unknown>(
    topic: string,
    event: string,
    handler: RealtimeEventHandler<T>
  ): () => void;

  /** Emite un evento Broadcast a un tópico específico */
  broadcast<T = unknown>(
    topic: string,
    event: string,
    payload: T,
    organizationId: string
  ): Promise<void>;

  /** Rastrear presencia efímera del usuario/agente en un tópico */
  trackPresence(topic: string, state: Record<string, unknown>): Promise<void>;

  /** Escuchar sincronización de presencia en el tópico */
  subscribePresence(
    topic: string,
    onSync: (presences: Record<string, unknown>[]) => void
  ): () => void;

  /** Suscribirse a cambios de estado de la conexión */
  onStatusChange(handler: (status: RealtimeStatus) => void): () => void;
}
