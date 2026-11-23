import { describe, expect, it, vi } from "vitest";
import { normalizePhoneNumber, formatPhoneForDisplay } from "@/lib/channels/phone-normalization";
import { canonicalPhone, phoneLookupVariants, samePhone } from "@/lib/channels/phone-variants";
import { emitRealtimeInboxEvent } from "@/lib/realtime/broadcast";

describe("CobraFlow — WhatsApp Coexistencia & Normalización Venezuela (+58)", () => {
  it("normaliza formatos venezolanos móviles (0412, 0414, 0424, 0416, 0426) a E.164", () => {
    expect(normalizePhoneNumber("04121234567")).toBe("+584121234567");
    expect(normalizePhoneNumber("04149876543")).toBe("+584149876543");
    expect(normalizePhoneNumber("04245556677")).toBe("+584245556677");
    expect(normalizePhoneNumber("4121234567")).toBe("+584121234567");
    expect(normalizePhoneNumber("584121234567")).toBe("+584121234567");
    expect(normalizePhoneNumber("+584121234567")).toBe("+584121234567");
  });

  it("normaliza formatos venezolanos fijos (0212 Caracas, etc.) a E.164", () => {
    expect(normalizePhoneNumber("02129876543")).toBe("+582129876543");
    expect(normalizePhoneNumber("2129876543")).toBe("+582129876543");
  });

  it("canonicalPhone devuelve E.164 canónico para números venezolanos", () => {
    expect(canonicalPhone("04121234567")).toBe("+584121234567");
    expect(canonicalPhone("4121234567")).toBe("+584121234567");
    expect(canonicalPhone("+584121234567")).toBe("+584121234567");
  });

  it("phoneLookupVariants genera variantes compatibles para búsqueda en CRM", () => {
    const variantsFrom0412 = phoneLookupVariants("04121234567");
    expect(variantsFrom0412).toContain("+584121234567");
    expect(variantsFrom0412[0]).toBe("+04121234567");

    const variantsFrom58 = phoneLookupVariants("584121234567");
    expect(variantsFrom58).toContain("+584121234567");
    expect(variantsFrom58).toContain("+04121234567");
  });

  it("samePhone reconoce que el número local y el E.164 venezolano son la misma persona", () => {
    expect(samePhone("04121234567", "+584121234567")).toBe(true);
    expect(samePhone("4121234567", "+584121234567")).toBe(true);
    expect(samePhone("584121234567", "04121234567")).toBe(true);
  });

  it("formatPhoneForDisplay formatea correctamente para la interfaz del Inbox", () => {
    expect(formatPhoneForDisplay("+584121234567")).toBe("+58 (412) 123-4567");
    expect(formatPhoneForDisplay("+582121234567")).toBe("+58 (212) 123-4567");
  });

  it("emitRealtimeInboxEvent despacha eventos Broadcast en el canal privado de la organización", async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const mockChannel = {
      subscribe: vi.fn((cb: (status: string) => void) => {
        cb("SUBSCRIBED");
        return mockChannel;
      }),
      send: mockSend,
    };
    const mockRemoveChannel = vi.fn().mockResolvedValue({});
    const mockAdmin = {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: mockRemoveChannel,
    };

    await emitRealtimeInboxEvent(mockAdmin as never, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      event: "message.created",
      payload: {
        direction: "outbound",
        sent_via: "external_device",
        from_business_app: true,
        text: "Respuesta desde el celular oficial de la empresa",
        ai_paused: true,
      },
    });

    expect(mockAdmin.channel).toHaveBeenCalledWith(
      "private:org:11111111-1111-4111-8111-111111111111:inbox",
      expect.objectContaining({ config: { broadcast: { self: false } } }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "broadcast",
        event: "message.created",
        payload: expect.objectContaining({
          direction: "outbound",
          sent_via: "external_device",
          from_business_app: true,
          ai_paused: true,
          organization_id: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });
});
