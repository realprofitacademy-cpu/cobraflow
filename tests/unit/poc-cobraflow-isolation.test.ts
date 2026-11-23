import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signInviteToken, verifyInviteToken, type InvitePayload } from "@/lib/auth/invite-token";
import type { ICobraRealtimeProvider, RealtimeEnvelope } from "@/lib/realtime/contract";

describe("CobraFlow PoC — Aislamiento Multi-Tenant y Seguridad Base (Fase 0B)", () => {
  const orgA = "11111111-1111-4111-8111-111111111111"; // Academia Alpha
  const orgB = "22222222-2222-4222-8222-222222222222"; // Instituto Beta

  const secretOrg = "secret-key-cobraflow-enterprise-poc-2026-99";

  beforeEach(() => {
    process.env.INTERNAL_SECRET = secretOrg;
  });

  afterEach(() => {
    delete process.env.INTERNAL_SECRET;
    delete process.env.INVITE_TOKEN_SECRET;
  });

  describe("1. Seguridad de Tokens de Invitación (Defensa T4)", () => {
    it("debe firmar y validar un token legítimo de la Organización A", () => {
      const payload: InvitePayload = {
        invite_id: "33333333-3333-4333-8333-333333333333",
        email: "profesor@academia-alpha.com",
        organization_id: orgA,
        role: "agent",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const token = signInviteToken(payload);
      expect(token).toBeDefined();

      const verified = verifyInviteToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.organization_id).toBe(orgA);
      expect(verified?.email).toBe("profesor@academia-alpha.com");
    });

    it("un token firmado para Org A no debe ser aceptado si alguien adultera la organización a Org B", () => {
      const payload: InvitePayload = {
        invite_id: "44444444-4444-4444-8444-444444444444",
        email: "atacante@instituto-beta.com",
        organization_id: orgA,
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const token = signInviteToken(payload);
      const [body, sig] = token.split(".");

      // Atacante modifica el payload base64url para cambiar orgA por orgB
      const decodedJson = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
      decodedJson.organization_id = orgB;
      const forgedBody = Buffer.from(JSON.stringify(decodedJson)).toString("base64url");

      const forgedToken = `${forgedBody}.${sig}`;
      const result = verifyInviteToken(forgedToken);

      // Debe fallar inmediatamente por firma inválida (HMAC)
      expect(result).toBeNull();
    });

    it("debe rechazar tokens firmados con el dev-fallback público heredado", () => {
      // Simula token generado con el fallback estático antiguo "dev-fallback"
      process.env.INTERNAL_SECRET = "dev-fallback";
      const payload: InvitePayload = {
        invite_id: "55555555-5555-4555-8555-555555555555",
        email: "vendedor@empresa.com",
        organization_id: orgA,
        role: "manager",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const tokenWithOldFallback = signInviteToken(payload);

      // Ahora el sistema en ejecución con clave real verifica
      process.env.INTERNAL_SECRET = "real-production-secret-cobraflow-987654321";
      const verification = verifyInviteToken(tokenWithOldFallback);
      expect(verification).toBeNull();
    });
  });

  describe("2. Aislamiento Lógico Multi-Tenant en Estructura de Datos de Mensajería", () => {
    interface MockMessage {
      id: string;
      organizationId: string;
      conversationId: string;
      content: string;
    }

    const messagesStore: MockMessage[] = [
      { id: "m1", organizationId: orgA, conversationId: "c1", content: "Información confidencial de Academia Alpha" },
      { id: "m2", organizationId: orgA, conversationId: "c1", content: "Precio de matrícula: $150 USD" },
      { id: "m3", organizationId: orgB, conversationId: "c2", content: "Datos privados de Instituto Beta" },
    ];

    function queryMessagesAsTenant(userOrgId: string, conversationId: string): MockMessage[] {
      // Simula la capa RLS / DAO: SELECT * FROM messages WHERE organization_id = userOrgId AND conversation_id = conversationId
      return messagesStore.filter(
        (m) => m.organizationId === userOrgId && m.conversationId === conversationId
      );
    }

    it("un usuario de Org A solo puede leer mensajes de Org A", () => {
      const resultsAlpha = queryMessagesAsTenant(orgA, "c1");
      expect(resultsAlpha.length).toBe(2);
      expect(resultsAlpha.every((m) => m.organizationId === orgA)).toBe(true);
    });

    it("un usuario de Org B no puede leer mensajes de una conversación de Org A", () => {
      const resultsBetaTryingAlpha = queryMessagesAsTenant(orgB, "c1");
      // Cero registros retornados
      expect(resultsBetaTryingAlpha.length).toBe(0);
    });
  });

  describe("3. Contrato de Broker Realtime (Provider Agnostic)", () => {
    class MockCobraRealtimeProvider implements ICobraRealtimeProvider {
      public emittedEvents: RealtimeEnvelope[] = [];

      async connect(_token?: string): Promise<void> {}
      async disconnect(): Promise<void> {}

      subscribe<T>(_topic: string, _event: string, _handler: (payload: T) => void): () => void {
        return () => {};
      }

      async broadcast<T>(topic: string, event: string, payload: T, organizationId: string): Promise<void> {
        this.emittedEvents.push({
          topic,
          event,
          payload,
          timestamp: new Date().toISOString(),
          organizationId,
        });
      }

      async trackPresence(_topic: string, _state: Record<string, unknown>): Promise<void> {}
      subscribePresence(_topic: string, _onSync: (presences: Record<string, unknown>[]) => void): () => void {
        return () => {};
      }

      onStatusChange(_handler: (status: any) => void): () => void {
        return () => {};
      }
    }

    it("emite eventos de Broadcast respetando el topic aislado por organización", async () => {
      const provider = new MockCobraRealtimeProvider();

      await provider.broadcast(
        `private:org:${orgA}:inbox`,
        "conversation.assigned",
        { conversationId: "conv-101", agentId: "agent-55" },
        orgA
      );

      expect(provider.emittedEvents.length).toBe(1);
      const event = provider.emittedEvents[0]!;
      expect(event.topic).toBe(`private:org:${orgA}:inbox`);
      expect(event.organizationId).toBe(orgA);
      expect(event.event).toBe("conversation.assigned");
    });
  });
});
