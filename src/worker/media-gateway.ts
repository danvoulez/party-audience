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
  "Defina REALTIMEKIT_ORG_ID e REALTIMEKIT_API_KEY (dev: .dev.vars; produção: wrangler secret put). " +
  "Os presets 'group_call_host', 'group_call_participant' e 'livestream_viewer' devem existir na organização RealtimeKit. " +
  "Ver docs/media-gateway.md.";

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
 * Cloudflare RealtimeKit (API compatível com Dyte v2).
 * NÃO VERIFICADO com credenciais reais neste ambiente — ver README.
 */
export class RealtimeKitGateway implements MediaGateway {
  readonly configured = true;

  constructor(
    private readonly orgId: string,
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.realtime.cloudflare.com/v2",
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${btoa(`${this.orgId}:${this.apiKey}`)}`,
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
    const body = await this.call<{ data: { id: string } }>("/meetings", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    return body.data.id;
  }

  async createParticipantToken(
    roomId: string,
    participant: { userId: string; username: string; perms: Permissions },
  ): Promise<string> {
    // O preset (definido na organização RealtimeKit) é quem efetivamente
    // aplica as permissões no plano de mídia; escolhemos pelo shape das
    // permissões vindas do backend — nunca do cliente.
    const preset = !participant.perms.canPublishAudio && !participant.perms.canPublishVideo
      ? "livestream_viewer"
      : participant.perms.canModerate
        ? "group_call_host"
        : "group_call_participant";
    const body = await this.call<{ data: { token: string } }>(`/meetings/${roomId}/participants`, {
      method: "POST",
      body: JSON.stringify({
        name: participant.username,
        custom_participant_id: participant.userId,
        preset_name: preset,
      }),
    });
    return body.data.token;
  }

  async endRoom(): Promise<void> {
    // A API do RealtimeKit encerra reuniões por inatividade; kick explícito de
    // todos os participantes fica para quando houver credenciais para validar.
  }
}

export function gatewayFromEnv(env: { REALTIMEKIT_ORG_ID?: string; REALTIMEKIT_API_KEY?: string; REALTIMEKIT_BASE_URL?: string }): MediaGateway {
  if (env.REALTIMEKIT_ORG_ID && env.REALTIMEKIT_API_KEY) {
    return new RealtimeKitGateway(env.REALTIMEKIT_ORG_ID, env.REALTIMEKIT_API_KEY, env.REALTIMEKIT_BASE_URL);
  }
  return new UnconfiguredGateway();
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
