import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESETS, RealtimeKitGateway, gatewayFromEnv } from "../../src/worker/media-gateway";

/**
 * O gateway fala com a API atual do RealtimeKit sob a REST API da Cloudflare
 * (/accounts/{id}/realtime/kit/{appId}, Bearer token). Estes testes travam o
 * contrato de saída: URL, autenticação, envelope `data` e nomes dos presets.
 */

const CREDS = {
  CLOUDFLARE_ACCOUNT_ID: "acc-123",
  REALTIMEKIT_APP_ID: "app-456",
  CLOUDFLARE_API_TOKEN: "tok-789",
};

function mockFetch(payload: unknown, status = 200) {
  const spy = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("gatewayFromEnv", () => {
  it("sem as três credenciais, o gateway fica desconfigurado", () => {
    expect(gatewayFromEnv({}).configured).toBe(false);
    expect(gatewayFromEnv({ CLOUDFLARE_ACCOUNT_ID: "a" }).configured).toBe(false);
    expect(gatewayFromEnv({ ...CREDS, CLOUDFLARE_API_TOKEN: undefined }).configured).toBe(false);
  });

  it("com as três credenciais, sobe o gateway real", () => {
    expect(gatewayFromEnv(CREDS).configured).toBe(true);
  });

  it("variável de preset vazia não apaga o padrão", async () => {
    const fetchSpy = mockFetch({ success: true, data: { token: "t" } });
    const gateway = gatewayFromEnv({ ...CREDS, RTK_PRESET_VIEWER: "   " });

    await gateway.createParticipantToken("m1", {
      participantId: "u",
      username: "u",
      preset: "livestreamViewer",
    });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).preset_name).toBe(DEFAULT_PRESETS.livestreamViewer);
  });
});

describe("RealtimeKitGateway", () => {
  it("cria a reunião na rota da conta, com Bearer token", async () => {
    const fetchSpy = mockFetch({ success: true, data: { id: "meet-1" } });
    const gateway = new RealtimeKitGateway("acc-123", "app-456", "tok-789");

    expect(await gateway.createRoom("Festa principal")).toBe("meet-1");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc-123/realtime/kit/app-456/meetings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-789");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Festa principal" });
  });

  it("lê data.token do participante", async () => {
    const gateway = new RealtimeKitGateway("a", "b", "t");

    mockFetch({ success: true, data: { token: "rtk-token" } });
    expect(
      await gateway.createParticipantToken("m1", {
        participantId: "u",
        username: "u",
        preset: "groupCallHost",
      }),
    ).toBe("rtk-token");
  });

  it.each([
    ["host de chamada", "groupCallHost", DEFAULT_PRESETS.groupCallHost],
    ["participante de chamada", "groupCallParticipant", DEFAULT_PRESETS.groupCallParticipant],
    ["host de transmissão", "livestreamHost", DEFAULT_PRESETS.livestreamHost],
    ["audiência da transmissão", "livestreamViewer", DEFAULT_PRESETS.livestreamViewer],
  ] as const)("%s usa o preset atual", async (_nome, preset, esperado) => {
    const fetchSpy = mockFetch({ success: true, data: { token: "t" } });
    const gateway = new RealtimeKitGateway("a", "b", "t");

    await gateway.createParticipantToken("m1", {
      participantId: "u1",
      username: "alice",
      preset,
    });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      preset_name: esperado,
      custom_participant_id: "u1",
      name: "alice",
    });
  });

  it("nomes de preset são configuráveis, para orgs que não usam os padrões", async () => {
    const fetchSpy = mockFetch({ success: true, data: { token: "t" } });
    const gateway = new RealtimeKitGateway("a", "b", "t", {
      groupCallHost: "meu-host",
      groupCallParticipant: "meu-participante",
      livestreamHost: "meu-live-host",
      livestreamViewer: "minha-audiencia",
    });

    await gateway.createParticipantToken("m1", {
      participantId: "u",
      username: "u",
      preset: "livestreamViewer",
    });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).preset_name).toBe("minha-audiencia");
  });

  it("erro do provedor vira exceção legível, sem vazar o corpo inteiro", async () => {
    mockFetch({ errors: [{ message: "preset not found" }] }, 404);
    const gateway = new RealtimeKitGateway("a", "b", "t");
    await expect(gateway.createRoom("x")).rejects.toThrow(/realtimekit_error: 404/);
  });

  it("resposta 200 sem id não passa por válida", async () => {
    mockFetch({ success: true, data: {} });
    const gateway = new RealtimeKitGateway("a", "b", "t");
    await expect(gateway.createRoom("x")).rejects.toThrow(/sem id da reunião/);
  });
});
