import { describe, expect, it } from "vitest";
import { RealtimeKitGateway, DEFAULT_PRESETS } from "../../src/worker/media-gateway";
import type { Permissions } from "../../src/shared/domain";

/**
 * Teste de contrato contra o provedor REAL. Sem fetch mockado.
 *
 * Existe porque os testes unitários do gateway afirmam o contrato que nós
 * emitimos, e passariam verdes contra uma API desligada — foi exatamente o que
 * aconteceu quando a API legada do Dyte foi descontinuada. Só uma chamada de
 * verdade detecta o provedor mudando sem que ninguém toque no nosso código.
 *
 * Roda apenas com credenciais no ambiente. Sem elas o bloco é PULADO, nunca
 * aprovado por omissão: um teste pulado não conta como verificação em
 * scripts/check-promises.mjs.
 */

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const appId = process.env.REALTIMEKIT_APP_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const temCredenciais = Boolean(accountId && appId && apiToken);

const presets = {
  host: process.env.RTK_PRESET_HOST ?? DEFAULT_PRESETS.host,
  participant: process.env.RTK_PRESET_PARTICIPANT ?? DEFAULT_PRESETS.participant,
  viewer: process.env.RTK_PRESET_VIEWER ?? DEFAULT_PRESETS.viewer,
};

const BASE: Permissions = {
  canPublishAudio: true,
  canPublishVideo: true,
  canSubscribeMedia: true,
  canSendText: true,
  canModerate: false,
};

describe.skipIf(!temCredenciais)("contrato com o provedor de mídia", () => {
  const gateway = new RealtimeKitGateway(accountId!, appId!, apiToken!, presets);

  it("cria uma reunião de verdade", async () => {
    const roomId = await gateway.createRoom(`ci-contract-${Date.now()}`);
    expect(roomId).toBeTruthy();
  }, 30_000);

  // Cada preset é testado separadamente: é comum group_call_* existirem por
  // padrão e o preset de audiência não, e o sintoma seria só a transmissão
  // pessoal falhando em produção.
  it.each([
    ["host", { ...BASE, canModerate: true }, presets.host],
    ["participante", BASE, presets.participant],
    ["audiência", { ...BASE, canPublishAudio: false, canPublishVideo: false }, presets.viewer],
  ])("emite token para o preset de %s (%s)", async (papel, perms, nomePreset) => {
    const roomId = await gateway.createRoom(`ci-contract-${papel}-${Date.now()}`);
    const token = await gateway.createParticipantToken(roomId, {
      userId: `ci-${papel}`,
      username: `ci-${papel}`,
      perms: perms as Permissions,
    });
    expect(token, `preset "${nomePreset}" não emitiu token`).toBeTruthy();
  }, 30_000);
});

describe.skipIf(temCredenciais)("contrato com o provedor de mídia", () => {
  it("está sem credenciais — o provedor NÃO foi contatado", () => {
    // Registrado como teste que passa apenas para deixar a lacuna legível no
    // relatório. A promessa mg.provedor-aceita-o-contrato segue 'pending' no
    // docs/acceptance.json, e é lá que o CI cobra.
    expect(temCredenciais).toBe(false);
  });
});
