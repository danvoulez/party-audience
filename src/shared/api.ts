import { z } from "zod";
import { CHAT_MAX_LENGTH, passwordSchema, usernameSchema } from "./domain";
import type { Permissions, UserStatus } from "./domain";

export const signupSchema = z.object({ username: usernameSchema, password: passwordSchema });
export const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });
export const createCallSchema = z.object({ username: usernameSchema });
export const kickSchema = z.object({ username: usernameSchema });
export const blockSchema = z.object({ username: usernameSchema });

export const chatMessageSchema = z.object({
  type: z.literal("chat"),
  text: z.string().min(1).max(CHAT_MAX_LENGTH),
});

/** O que o cliente recebe ao entrar numa sessão, sobre a mídia interativa. */
export type MediaAccess =
  | { status: "ready"; provider: "realtimekit"; roomId: string; token: string }
  | { status: "blocked"; reason: "realtimekit_unconfigured" | "realtimekit_error"; message: string };

export interface MeResponse {
  user: { id: string; username: string; status: UserStatus };
  channel: { slug: string; status: string };
  partyMembership?: { sessionId: string; role: string } & Permissions;
}

/** Eventos que o servidor envia pelos WebSockets das sessões. */
export type RoomServerEvent =
  | { type: "roster"; users: { username: string; role: string }[] }
  | { type: "presence_join"; username: string; role: string }
  | { type: "presence_leave"; username: string }
  | { type: "chat"; from: string; text: string; at: string }
  | { type: "chat_rejected"; reason: "rate_limited" | "not_allowed" | "invalid" }
  | { type: "call_invite"; inviteId: string; from: string }
  | { type: "call_state"; inviteId: string; state: string; sessionId?: string }
  | { type: "perms_updated"; perms: Permissions }
  | { type: "kicked" }
  | { type: "session_ended" };
