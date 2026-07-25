import { describe, expect, it } from "vitest";
import { RealtimeKitGateway, DEFAULT_PRESETS } from "../../src/worker/media-gateway";

/**
 * Teste de contrato contra o provedor REAL. Sem fetch mockado.
 *
 * Existe porque os testes unitários do gateway afirmam o contrato que nós
 * emitimos. Este arquivo não entra na suíte local padrão; `npm run test:media`
 * exige credenciais e falha quando elas não existem.
 */

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const appId = process.env.REALTIMEKIT_APP_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const temCredenciais = Boolean(accountId && appId && apiToken);
const presetOrDefault = (value: string | undefined, fallback: string) => value?.trim() || fallback;

const presets = {
  groupCallHost: presetOrDefault(process.env.RTK_PRESET_HOST, DEFAULT_PRESETS.groupCallHost),
  groupCallParticipant: presetOrDefault(
    process.env.RTK_PRESET_PARTICIPANT,
    DEFAULT_PRESETS.groupCallParticipant,
  ),
  livestreamHost: presetOrDefault(
    process.env.RTK_PRESET_LIVESTREAM_HOST,
    DEFAULT_PRESETS.livestreamHost,
  ),
  livestreamViewer: presetOrDefault(
    process.env.RTK_PRESET_VIEWER,
    DEFAULT_PRESETS.livestreamViewer,
  ),
};

describe("contrato com o provedor de mídia", () => {
  it("tem as três credenciais obrigatórias", () => {
    expect(temCredenciais).toBe(true);
  });

  const gateway = new RealtimeKitGateway(accountId!, appId!, apiToken!, presets);

  it("cria uma reunião de verdade", async () => {
    const roomId = await gateway.createRoom(`ci-contract-${Date.now()}`);
    expect(roomId).toBeTruthy();
  }, 30_000);

  // Cada modo é testado separadamente para cobrir chamada e transmissão.
  it.each([
    ["host de chamada", "groupCallHost", presets.groupCallHost],
    ["participante de chamada", "groupCallParticipant", presets.groupCallParticipant],
    ["host de transmissão", "livestreamHost", presets.livestreamHost],
    ["audiência", "livestreamViewer", presets.livestreamViewer],
  ] as const)("emite token para o preset de %s (%s)", async (papel, preset, nomePreset) => {
    const roomId = await gateway.createRoom(`ci-contract-${papel}-${Date.now()}`);
    const token = await gateway.createParticipantToken(roomId, {
      participantId: crypto.randomUUID(),
      username: `ci-${papel}`,
      preset,
    });
    expect(token, `preset "${nomePreset}" não emitiu token`).toBeTruthy();
  }, 30_000);
});
