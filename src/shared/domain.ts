import { z } from "zod";

export type SessionType = "party" | "direct_call" | "personal_broadcast" | "random_call";
export type SessionStatus = "waiting" | "active" | "ended";
export type UserStatus = "online" | "busy" | "offline";

export interface Permissions {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canSubscribeMedia: boolean;
  canSendText: boolean;
  canModerate: boolean;
}

export type Role =
  | "party_admin"
  | "party_participant"
  | "call_participant"
  | "broadcast_host"
  | "broadcast_audience";

/** Permissões padrão por papel. O backend é a única fonte de verdade. */
export const ROLE_PRESETS: Record<Role, Permissions> = {
  party_admin: {
    canPublishAudio: true,
    canPublishVideo: true,
    canSubscribeMedia: true,
    canSendText: true,
    canModerate: true,
  },
  party_participant: {
    canPublishAudio: true,
    canPublishVideo: true,
    canSubscribeMedia: true,
    canSendText: true,
    canModerate: false,
  },
  call_participant: {
    canPublishAudio: true,
    canPublishVideo: true,
    canSubscribeMedia: true,
    canSendText: true,
    canModerate: false,
  },
  broadcast_host: {
    canPublishAudio: true,
    canPublishVideo: true,
    canSubscribeMedia: true,
    canSendText: true,
    canModerate: true,
  },
  broadcast_audience: {
    canPublishAudio: false,
    canPublishVideo: false,
    canSubscribeMedia: true,
    canSendText: true,
    canModerate: false,
  },
};

/**
 * Slugs que nunca podem virar username, porque os perfis vivem na raiz
 * (dominio.com/usuario) e colidiriam com rotas do sistema.
 */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "cadastro",
  "call",
  "chamada",
  "configuracoes",
  "entrar",
  "festa",
  "healthz",
  "lobby",
  "login",
  "logout",
  "privacidade",
  "signup",
  "suporte",
  "termos",
]);

export const usernameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{2,19}$/,
    "username deve ter 3–20 caracteres: letras minúsculas, números, _ ou -",
  )
  .refine((u) => !RESERVED_SLUGS.has(u), "este nome é reservado pelo sistema");

export const passwordSchema = z.string().min(8, "senha deve ter no mínimo 8 caracteres").max(128);

export type CallInviteState = "ringing" | "accepted" | "declined" | "cancelled" | "expired" | "ended";

const INVITE_TRANSITIONS: Record<CallInviteState, CallInviteState[]> = {
  ringing: ["accepted", "declined", "cancelled", "expired"],
  accepted: ["ended"],
  declined: [],
  cancelled: [],
  expired: [],
  ended: [],
};

export function canTransitionInvite(from: CallInviteState, to: CallInviteState): boolean {
  return INVITE_TRANSITIONS[from].includes(to);
}

export const CALL_RING_TIMEOUT_MS = 30_000;
export const CHAT_MAX_LENGTH = 500;
