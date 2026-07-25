import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESETS, RealtimeKitGateway, gatewayFromEnv } from "../../src/worker/media-gateway";
import type { Permissions } from "../../src/shared/domain";

/**
 * O gateway fala com a API atual do RealtimeKit sob a REST API da Cloudflare
 * (/accounts/{id}/realtime/kit/{appId}, Bearer token). Estes testes travam o
 * contrato de saída: URL, autenticação e — o mais importante — qual preset é
 * pedido para cada shape de permissão, já que é o preset que aplica a
 * permissão no plano de mídia.
 */

const CREDS = {
  CLOUDFLARE_ACCOUNT_ID: "acc-123",
  REALTIMEKIT_APP_ID: "app-456",
  CLOUDFLARE_API_TOKEN: "tok-789",
};

const HOST: Permissions = {
  canPublishAudio: true,
  canPublishVideo: true,
  canSubscribeMedia: true,
  canSendText: true,
  canModerate: true,
};
const PARTICIPANT: Permissions = { ...HOST, canModerate: false };
const AUDIENCE: Permissions = { ...PARTICIPANT, canPublishAudio: false, canPublishVideo: false };

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
});

describe("RealtimeKitGateway", () => {
  it("cria a reunião na rota da conta, com Bearer token", async () => {
    const fetchSpy = mockFetch({ result: { id: "meet-1" } });
    const gateway = new RealtimeKitGateway("acc-123", "app-456", "tok-789");

    expect(await gateway.createRoom("Festa principal")).toBe("meet-1");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc-123/realtime/kit/app-456/meetings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-789");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Festa principal" });
  });

  it("lê o authToken do participante (campo novo) e o token (herança Dyte)", async () => {
    const gateway = new RealtimeKitGateway("a", "b", "t");

    mockFetch({ result: { authToken: "novo" } });
    expect(await gateway.createParticipantToken("m1", { userId: "u", username: "u", perms: HOST })).toBe("novo");

    mockFetch({ data: { token: "legado" } });
    expect(await gateway.createParticipantToken("m1", { userId: "u", username: "u", perms: HOST })).toBe("legado");
  });

  it.each([
    ["quem modera vira host", HOST, DEFAULT_PRESETS.host],
    ["quem publica sem moderar vira participante", PARTICIPANT, DEFAULT_PRESETS.participant],
    ["quem não publica áudio nem vídeo vira audiência", AUDIENCE, DEFAULT_PRESETS.viewer],
  ])("%s", async (_nome, perms, esperado) => {
    const fetchSpy = mockFetch({ result: { authToken: "t" } });
    const gateway = new RealtimeKitGateway("a", "b", "t");

    await gateway.createParticipantToken("m1", { userId: "u1", username: "alice", perms });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      preset_name: esperado,
      custom_participant_id: "u1",
      name: "alice",
    });
  });

  it("nomes de preset são configuráveis, para orgs que não usam os padrões", async () => {
    const fetchSpy = mockFetch({ result: { authToken: "t" } });
    const gateway = new RealtimeKitGateway("a", "b", "t", {
      host: "meu_host",
      participant: "meu_participante",
      viewer: "minha_audiencia",
    });

    await gateway.createParticipantToken("m1", { userId: "u", username: "u", perms: AUDIENCE });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).preset_name).toBe("minha_audiencia");
  });

  it("erro do provedor vira exceção legível, sem vazar o corpo inteiro", async () => {
    mockFetch({ errors: [{ message: "preset not found" }] }, 404);
    const gateway = new RealtimeKitGateway("a", "b", "t");
    await expect(gateway.createRoom("x")).rejects.toThrow(/realtimekit_error: 404/);
  });

  it("resposta 200 sem id não passa por válida", async () => {
    mockFetch({ result: {} });
    const gateway = new RealtimeKitGateway("a", "b", "t");
    await expect(gateway.createRoom("x")).rejects.toThrow(/sem id da reunião/);
  });
});
