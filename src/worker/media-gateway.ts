import type { Permissions } from "../shared/domain";
import type { MediaAccess } from "../shared/api";

/**
 * Fronteira com o provedor de mídia interativa (WebRTC/SFU).
 *
 * A lógica do produto nunca fala com o RealtimeKit diretamente — só com esta
 * interface. Sem credenciais configuradas, o gateway devolve um MediaAccess
 * "blocked" com instruções exatas; nada finge funcionar.
 */
export interface MediaGateway {
  readonly configured: boolean;
  /** Cria (ou reutiliza) a sala de mídia da sessão. Retorna o roomId do provedor. */
  createRoom(title: string): Promise<string>;
  /** Emite token de participante amarrado à sala, ao usuário e às permissões. */
  createParticipantToken(roomId: string, participant: {
    userId: string;
    username: string;
    perms: Permissions;
  }): Promise<string>;
  endRoom(roomId: string): Promise<void>;
}

export const REALTIMEKIT_SETUP_INSTRUCTIONS =
  "Defina CLOUDFLARE_ACCOUNT_ID, REALTIMEKIT_APP_ID e CLOUDFLARE_API_TOKEN " +
  "(dev: .dev.vars; produção: wrangler secret put). O token precisa da permissão Realtime. " +
  "Os presets configurados em RTK_PRESET_* devem existir no app. Ver docs/media-gateway.md.";

/**
 * Presets do RealtimeKit: é o preset, definido no app, que efetivamente aplica
 * as permissões no plano de mídia. Os nomes são configuráveis porque só
 * group_call_host e group_call_participant vêm prontos em apps criados pelo
 * dashboard — o preset de audiência normalmente precisa ser criado.
 */
export interface PresetNames {
  host: string;
  participant: string;
  viewer: string;
}

export const DEFAULT_PRESETS: PresetNames = {
  host: "group_call_host",
  participant: "group_call_participant",
  viewer: "livestream_viewer",
};

export class UnconfiguredGateway implements MediaGateway {
  readonly configured = false;
  createRoom(): Promise<string> {
    return Promise.reject(new Error("realtimekit_unconfigured"));
  }
  createParticipantToken(): Promise<string> {
    return Promise.reject(new Error("realtimekit_unconfigured"));
  }
  endRoom(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Cloudflare RealtimeKit, API atual sob a REST API da Cloudflare.
 *
 * A API legada do Dyte (api.dyte.io/v2, Basic auth com orgId:apiKey) foi
 * descontinuada na migração para a Cloudflare: agora as rotas ficam sob
 * /accounts/{accountId}/realtime/kit/{appId} e a autenticação é por token
 * Cloudflare com permissão Realtime.
 *
 * NÃO VERIFICADO com credenciais reais neste ambiente — ver docs/media-gateway.md.
 */
export class RealtimeKitGateway implements MediaGateway {
  readonly configured = true;
  private readonly base: string;

  constructor(
    accountId: string,
    appId: string,
    private readonly apiToken: string,
    private readonly presets: PresetNames = DEFAULT_PRESETS,
    apiBase = "https://api.cloudflare.com/client/v4",
  ) {
    this.base = `${apiBase}/accounts/${accountId}/realtime/kit/${appId}`;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`realtimekit_error: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    }
    return (await res.json()) as T;
  }

  async createRoom(title: string): Promise<string> {
    const body = await this.call<{ result?: { id: string }; data?: { id: string } }>("/meetings", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    // A REST API da Cloudflare embrulha em `result`; a herança Dyte usa `data`.
    const id = body.result?.id ?? body.data?.id;
    if (!id) throw new Error("realtimekit_error: resposta sem id da reunião");
    return id;
  }

  async createParticipantToken(
    roomId: string,
    participant: { userId: string; username: string; perms: Permissions },
  ): Promise<string> {
    // O preset é quem aplica as permissões no plano de mídia; escolhemos pelo
    // shape das permissões vindas do backend — nunca do cliente.
    const preset = !participant.perms.canPublishAudio && !participant.perms.canPublishVideo
      ? this.presets.viewer
      : participant.perms.canModerate
        ? this.presets.host
        : this.presets.participant;
    const body = await this.call<{
      result?: { authToken?: string; token?: string };
      data?: { authToken?: string; token?: string };
    }>(`/meetings/${roomId}/participants`, {
      method: "POST",
      body: JSON.stringify({
        name: participant.username,
        custom_participant_id: participant.userId,
        preset_name: preset,
      }),
    });
    const payload = body.result ?? body.data;
    const token = payload?.authToken ?? payload?.token;
    if (!token) throw new Error("realtimekit_error: resposta sem authToken do participante");
    return token;
  }

  async endRoom(): Promise<void> {
    // O RealtimeKit encerra reuniões por inatividade; kick explícito de todos
    // os participantes fica para quando houver credenciais para validar.
  }
}

export interface MediaEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  REALTIMEKIT_APP_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_API_BASE?: string;
  RTK_PRESET_HOST?: string;
  RTK_PRESET_PARTICIPANT?: string;
  RTK_PRESET_VIEWER?: string;
}

export function gatewayFromEnv(env: MediaEnv): MediaGateway {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.REALTIMEKIT_APP_ID || !env.CLOUDFLARE_API_TOKEN) {
    return new UnconfiguredGateway();
  }
  return new RealtimeKitGateway(
    env.CLOUDFLARE_ACCOUNT_ID,
    env.REALTIMEKIT_APP_ID,
    env.CLOUDFLARE_API_TOKEN,
    {
      host: env.RTK_PRESET_HOST ?? DEFAULT_PRESETS.host,
      participant: env.RTK_PRESET_PARTICIPANT ?? DEFAULT_PRESETS.participant,
      viewer: env.RTK_PRESET_VIEWER ?? DEFAULT_PRESETS.viewer,
    },
    env.CLOUDFLARE_API_BASE,
  );
}

/** Resolve o acesso à mídia para um participante, sem nunca lançar para a rota. */
export async function mediaAccessFor(
  gateway: MediaGateway,
  ensureRoomId: () => Promise<string | null>,
  participant: { userId: string; username: string; perms: Permissions },
): Promise<MediaAccess> {
  if (!gateway.configured) {
    return { status: "blocked", reason: "realtimekit_unconfigured", message: REALTIMEKIT_SETUP_INSTRUCTIONS };
  }
  try {
    const roomId = await ensureRoomId();
    if (!roomId) throw new Error("realtimekit_error: sala não criada");
    const token = await gateway.createParticipantToken(roomId, participant);
    return { status: "ready", provider: "realtimekit", roomId, token };
  } catch (err) {
    return {
      status: "blocked",
      reason: "realtimekit_error",
      message: err instanceof Error ? err.message : "erro desconhecido no provedor de mídia",
    };
  }
}
