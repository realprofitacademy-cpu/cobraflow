import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { instagramAdapter } from "@/lib/channels/adapters/meta-instagram";
import { capabilitiesOf } from "@/lib/channels/capabilities";
import { getAdapter } from "@/lib/channels";

describe("CobraFlow — Adaptador Nativo Meta Instagram (Graph API v21.0)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registra meta_instagram en el seam de canales con capabilities correctas", () => {
    const adapter = getAdapter("meta_instagram");
    expect(adapter).toBeDefined();
    expect(adapter.provider).toBe("meta_instagram");

    const caps = capabilitiesOf("meta_instagram");
    expect(caps.requiresTemplates).toBe(false);
    expect(caps.freeformOutsideWindow).toBe(false);
    expect(caps.voiceNote).toBe("wav-only");
    expect(caps.podeReagir).toBe(true);
    expect(caps.marcaLidasPorMensagem).toBe(true);
  });

  it("resuelve destinatarios por IGSID o providerConversationId", () => {
    // Para Instagram DM, el destinatario es el ID de conversación/usuario en IG
    expect(
      instagramAdapter.resolveRecipient({
        isGroup: false,
        providerConversationId: "ig_user_123456789",
        phone: null,
      }),
    ).toBe("ig_user_123456789");

    // Rechaza grupos en v1
    expect(
      instagramAdapter.resolveRecipient({
        isGroup: true,
        providerConversationId: "ig_group_thread",
        phone: null,
      }),
    ).toBeNull();
  });

  it("envía mensajes de texto a Meta Graph API v21.0 correctamente", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "m_mid.1234567890" }),
    });
    global.fetch = fetchMock;

    process.env.META_INSTAGRAM_TOKEN = "test-token-ig";
    process.env.META_INSTAGRAM_PAGE_ID = "17841400000000000";

    const result = await instagramAdapter.send({
      organizationId: "11111111-1111-4111-8111-111111111111",
      sessionRef: "17841400000000000",
      to: "ig_user_recipient",
      kind: "text",
      body: "Hola desde CobraFlow CRM!",
    });

    expect(result.externalId).toBe("m_mid.1234567890");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://graph.facebook.com/");
    expect(url).toContain("/17841400000000000/messages");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-token-ig");

    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.recipient.id).toBe("ig_user_recipient");
    expect(parsedBody.message.text).toBe("Hola desde CobraFlow CRM!");
  });

  it("envía adjuntos de medios a Meta Graph API correctamente", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "m_mid.media_987654" }),
    });
    global.fetch = fetchMock;

    process.env.META_INSTAGRAM_TOKEN = "test-token-ig";

    const result = await instagramAdapter.send({
      organizationId: "11111111-1111-4111-8111-111111111111",
      sessionRef: "17841400000000000",
      to: "ig_user_recipient",
      kind: "image",
      media: {
        url: "https://cobraflow.test/media/factura.png",
      },
    });

    expect(result.externalId).toBe("m_mid.media_987654");
    const parsedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(parsedBody.message.attachment.type).toBe("image");
    expect(parsedBody.message.attachment.payload.url).toBe("https://cobraflow.test/media/factura.png");
  });

  it("soporta markRead emitiendo sender_action mark_seen", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;

    process.env.META_INSTAGRAM_TOKEN = "test-token-ig";

    await instagramAdapter.markRead?.(
      { organizationId: "11111111-1111-4111-8111-111111111111", sessionRef: "ig_user_recipient" },
      "m_mid.12345",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(parsedBody.sender_action).toBe("mark_seen");
    expect(parsedBody.recipient.id).toBe("ig_user_recipient");
  });
});
