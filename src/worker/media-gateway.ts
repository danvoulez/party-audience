import type { MediaAccess } from "../shared/api";

/**
 * Fronteira com o provedor de mídia interativa (WebRTC/SFU).
 *
 * A lógica do produto usa esta interface para criar reuniões e participantes.
 */
export interface MediaGateway {
  readonly configured: boolean;
  /** Cria a reunião no RealtimeKit. */
  createRoom(title: string): Promise<string>;
  /** Emite um token usando um preset escolhido pelo tipo real da experiência. */
  createParticipantToken(roomId: string, participant: {
    participantId: string;
    username: string;
    preset: MediaPreset;
  }): Promise<string>;
  endRoom(roomId: string): Promise<void>;
}

export const REALTIMEKIT_SETUP_INSTRUCTIONS =
  "Defina CLOUDFLARE_ACCOUNT_ID, REALTIMEKIT_APP_ID e CLOUDFLARE_API_TOKEN " +
  "(dev: .dev.vars; produção: wrangler secret put). O token precisa da permissão Realtime. " +
  "Os presets configurados em RTK_PRESET_* devem existir no app. Ver docs/media-gateway.md.";

export interface PresetNames {
  groupCallHost: string;
  groupCallParticipant: string;
  livestreamHost: string;
  livestreamViewer: string;
}

export const DEFAULT_PRESETS: PresetNames = {
  groupCallHost: "group-call-host",
  groupCallParticipant: "group-call-participant",
  livestreamHost: "livestream-host",
  livestreamViewer: "livestream-viewer",
};

export type MediaPreset = keyof PresetNames;

const presetOrDefault = (value: string | undefined, fallback: string) => value?.trim() || fallback;

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

/** Cliente mínimo da API REST atual da Cloudflare RealtimeKit. */
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
    const body = await this.call<{ success: boolean; data?: { id?: string } }>("/meetings", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    const id = body.data?.id;
    if (!id) throw new Error("realtimekit_error: resposta sem id da reunião");
    return id;
  }

  async createParticipantToken(
    roomId: string,
    participant: { participantId: string; username: string; preset: MediaPreset },
  ): Promise<string> {
    const body = await this.call<{ success: boolean; data?: { token?: string } }>(
      `/meetings/${roomId}/participants`,
      {
      method: "POST",
      body: JSON.stringify({
        name: participant.username,
        custom_participant_id: participant.participantId,
        preset_name: this.presets[participant.preset],
      }),
      },
    );
    const token = body.data?.token;
    if (!token) throw new Error("realtimekit_error: resposta sem token do participante");
    return token;
  }

  async endRoom(roomId: string): Promise<void> {
    await this.call(`/meetings/${roomId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "INACTIVE" }),
    });
  }
}

export interface MediaEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  REALTIMEKIT_APP_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_API_BASE?: string;
  RTK_PRESET_HOST?: string;
  RTK_PRESET_PARTICIPANT?: string;
  RTK_PRESET_LIVESTREAM_HOST?: string;
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
      groupCallHost: presetOrDefault(env.RTK_PRESET_HOST, DEFAULT_PRESETS.groupCallHost),
      groupCallParticipant: presetOrDefault(
        env.RTK_PRESET_PARTICIPANT,
        DEFAULT_PRESETS.groupCallParticipant,
      ),
      livestreamHost: presetOrDefault(
        env.RTK_PRESET_LIVESTREAM_HOST,
        DEFAULT_PRESETS.livestreamHost,
      ),
      livestreamViewer: presetOrDefault(env.RTK_PRESET_VIEWER, DEFAULT_PRESETS.livestreamViewer),
    },
    env.CLOUDFLARE_API_BASE,
  );
}

/** Resolve o acesso à mídia para um participante. */
export async function mediaAccessFor(
  gateway: MediaGateway,
  ensureRoomId: () => Promise<string | null>,
  participant: { participantId: string; username: string; preset: MediaPreset },
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
