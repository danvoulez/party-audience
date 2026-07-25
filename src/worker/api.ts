import { blockSchema, createCallSchema, kickSchema, loginSchema, signupSchema } from "../shared/api";
import type { MeResponse, MediaAccess, RoomServerEvent } from "../shared/api";
import { CALL_RING_TIMEOUT_MS, ROLE_PRESETS } from "../shared/domain";
import type { Permissions } from "../shared/domain";
import {
  clearSessionCookie,
  hashPassword,
  newId,
  newSessionToken,
  readSessionToken,
  sessionCookie,
  sha256Hex,
  verifyPassword,
} from "./auth";
import { Db, membershipPerms } from "./db";
import type { UserRow } from "./db";
import { mediaAccessFor } from "./media-gateway";
import type { MediaGateway } from "./media-gateway";

export interface Ctx {
  db: Db;
  gateway: MediaGateway;
  rooms: DurableObjectNamespace;
}

export const MAIN_PARTY_ID = "party-main";
const MAX_JSON_BODY = 4_096;

function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...extra }, { status });
}

async function readJson(request: Request): Promise<unknown | Response> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BODY) return jsonError(413, "payload_too_large");
  try {
    return JSON.parse(raw);
  } catch {
    return jsonError(400, "invalid_json");
  }
}

export async function currentUser(request: Request, db: Db): Promise<UserRow | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  return db.getUserByAuthToken(await sha256Hex(token));
}

function notifyRoom(ctx: Ctx, sessionId: string, event: RoomServerEvent, targetUserId?: string): Promise<Response> {
  const stub = ctx.rooms.get(ctx.rooms.idFromName(sessionId));
  return stub.fetch("https://room/notify", {
    method: "POST",
    body: JSON.stringify({ event, targetUserId }),
    headers: { "content-type": "application/json" },
  });
}

function updateRoomPerms(ctx: Ctx, sessionId: string, userId: string, perms: Permissions): Promise<Response> {
  const stub = ctx.rooms.get(ctx.rooms.idFromName(sessionId));
  return stub.fetch("https://room/perms", {
    method: "POST",
    body: JSON.stringify({ userId, perms }),
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------- identidade

export async function handleSignup(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input", { detail: parsed.error.issues[0]?.message });

  const existing = await ctx.db.getUserByUsername(parsed.data.username);
  if (existing) return jsonError(409, "username_taken");

  const pw = await hashPassword(parsed.data.password);
  const userId = newId();
  try {
    await ctx.db.createUserWithChannel({
      id: userId,
      username: parsed.data.username,
      passwordHash: pw.hash,
      passwordSalt: pw.salt,
      passwordIterations: pw.iterations,
      channelId: newId(),
    });
  } catch {
    return jsonError(409, "username_taken");
  }
  return issueSession(request, ctx, userId);
}

export async function handleLogin(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input");

  const user = await ctx.db.getUserByUsername(parsed.data.username);
  if (!user) return jsonError(401, "invalid_credentials");
  if (user.locked_until && user.locked_until > Date.now()) return jsonError(429, "account_locked");

  const ok = await verifyPassword(parsed.data.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  await ctx.db.recordLoginResult(user.id, ok);
  if (!ok) return jsonError(401, "invalid_credentials");
  return issueSession(request, ctx, user.id);
}

async function issueSession(request: Request, ctx: Ctx, userId: string): Promise<Response> {
  const { token, expiresAt } = newSessionToken();
  await ctx.db.createAuthSession(await sha256Hex(token), userId, expiresAt);
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie(token, request, Math.floor((expiresAt - Date.now()) / 1000)) } },
  );
}

export async function handleLogout(request: Request, ctx: Ctx): Promise<Response> {
  const token = readSessionToken(request);
  if (token) {
    const hash = await sha256Hex(token);
    const user = await ctx.db.getUserByAuthToken(hash);
    await ctx.db.deleteAuthSession(hash);
    if (user) await ctx.db.setUserStatus(user.id, "offline");
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
}

export async function handleMe(user: UserRow, ctx: Ctx): Promise<Response> {
  const channel = await ctx.db.getChannelByOwner(user.id);
  const party = await ctx.db.getActivePartyMembership(user.id);
  const me: MeResponse = {
    user: { id: user.id, username: user.username, status: user.status },
    channel: { slug: channel?.slug ?? user.username, status: channel?.status ?? "offline" },
    ...(party
      ? { partyMembership: { sessionId: party.session_id, role: party.role, ...membershipPerms(party) } }
      : {}),
  };
  return Response.json(me);
}

// -------------------------------------------------------------------- festa

async function ensureMainParty(ctx: Ctx, firstJoiner: string): Promise<{ id: string; ownerUserId: string | null }> {
  let session = await ctx.db.getSession(MAIN_PARTY_ID);
  if (!session || session.status === "ended") {
    if (session?.status === "ended") {
      // Festa anterior encerrada: nesta etapa há uma única festa principal
      // permanente; reativação recria a linha só se necessário.
      await ctx.db.endSession(MAIN_PARTY_ID);
    }
    if (!session) {
      try {
        await ctx.db.createSession({ id: MAIN_PARTY_ID, type: "party", ownerUserId: firstJoiner });
      } catch {
        // corrida: outra requisição criou primeiro
      }
      session = await ctx.db.getSession(MAIN_PARTY_ID);
    }
  }
  return { id: MAIN_PARTY_ID, ownerUserId: session?.owner_user_id ?? null };
}

export async function handlePartyJoin(request: Request, user: UserRow, ctx: Ctx): Promise<Response> {
  const party = await ensureMainParty(ctx, user.id);
  const isAdmin = party.ownerUserId === user.id;
  const existing = await ctx.db.getMembership(party.id, user.id);
  const role = existing?.role ?? (isAdmin ? "party_admin" : "party_participant");
  const perms = existing ? membershipPerms(existing) : ROLE_PRESETS[role as keyof typeof ROLE_PRESETS];
  if (!existing) await ctx.db.upsertMembership(party.id, user.id, role, perms);

  const media = await partyMedia(ctx, user, perms);
  return Response.json({
    sessionId: party.id,
    role,
    perms,
    wsPath: `/api/sessions/${party.id}/ws`,
    media,
  });
}

async function partyMedia(ctx: Ctx, user: UserRow, perms: Permissions): Promise<MediaAccess> {
  return mediaAccessFor(
    ctx.gateway,
    async () => {
      const session = await ctx.db.getSession(MAIN_PARTY_ID);
      if (!session) return null;
      if (session.media_room_id) return session.media_room_id;
      const roomId = await ctx.gateway.createRoom("Festa principal");
      await ctx.db.setSessionMediaRoom(MAIN_PARTY_ID, roomId);
      return roomId;
    },
    { userId: user.id, username: user.username, perms },
  );
}

export async function handlePartyLeave(user: UserRow, ctx: Ctx): Promise<Response> {
  await ctx.db.leaveMembership(MAIN_PARTY_ID, user.id);
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "presence_leave", username: user.username });
  return Response.json({ ok: true });
}

export async function handlePartyKick(request: Request, user: UserRow, ctx: Ctx): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = kickSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input");

  const my = await ctx.db.getMembership(MAIN_PARTY_ID, user.id);
  if (!my || !my.can_moderate) return jsonError(403, "not_a_moderator");

  const target = await ctx.db.getUserByUsername(parsed.data.username);
  if (!target) return jsonError(404, "user_not_found");
  if (target.id === user.id) return jsonError(400, "cannot_kick_self");
  const targetMembership = await ctx.db.getMembership(MAIN_PARTY_ID, target.id);
  if (!targetMembership) return jsonError(404, "not_a_member");

  await ctx.db.leaveMembership(MAIN_PARTY_ID, target.id);
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "kicked" }, target.id);
  console.log(JSON.stringify({ moderation: { action: "kick", by: user.username, target: target.username } }));
  return Response.json({ ok: true });
}

/** Religa as permissões de publicação do próprio usuário na festa (pós-chamada). */
export async function handlePartyMediaResume(user: UserRow, ctx: Ctx): Promise<Response> {
  const membership = await ctx.db.getMembership(MAIN_PARTY_ID, user.id);
  if (!membership) return jsonError(404, "not_a_member");
  if (await ctx.db.userIsInActiveCall(user.id)) return jsonError(409, "in_call");

  const preset = ROLE_PRESETS[membership.role as keyof typeof ROLE_PRESETS];
  if (!preset) return jsonError(500, "unknown_role");
  await ctx.db.updateMembershipPerms(MAIN_PARTY_ID, user.id, {
    canPublishAudio: preset.canPublishAudio,
    canPublishVideo: preset.canPublishVideo,
  });
  const updated = await ctx.db.getMembership(MAIN_PARTY_ID, user.id);
  const perms = updated ? membershipPerms(updated) : preset;
  await updateRoomPerms(ctx, MAIN_PARTY_ID, user.id, perms);
  return Response.json({ ok: true, perms });
}

// ---------------------------------------------------------- chamada privada

export async function handleCallCreate(request: Request, user: UserRow, ctx: Ctx): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = createCallSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input");

  const callee = await ctx.db.getUserByUsername(parsed.data.username);
  if (!callee) return jsonError(404, "user_not_found");
  if (callee.id === user.id) return jsonError(400, "cannot_call_self");
  if (await ctx.db.isBlockedEitherWay(user.id, callee.id)) return jsonError(403, "blocked");
  if (await ctx.db.userIsInActiveCall(user.id)) return jsonError(409, "caller_busy");
  if (await ctx.db.userIsInActiveCall(callee.id)) return jsonError(409, "callee_busy");

  const inviteId = newId();
  await ctx.db.createInvite({
    id: inviteId,
    callerUserId: user.id,
    calleeUserId: callee.id,
    expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
  });
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "call_invite", inviteId, from: user.username }, callee.id);
  return Response.json({ inviteId, state: "ringing" }, { status: 201 });
}

export async function handleCallsIncoming(user: UserRow, ctx: Ctx): Promise<Response> {
  const invites = await ctx.db.listIncomingRinging(user.id);
  const withNames = await Promise.all(
    invites.map(async (i) => ({
      inviteId: i.id,
      from: (await ctx.db.getUserById(i.caller_user_id))?.username ?? "?",
      expiresAt: i.expires_at,
    })),
  );
  return Response.json({ invites: withNames });
}

async function loadInviteFor(inviteId: string, user: UserRow, ctx: Ctx) {
  const invite = await ctx.db.getInvite(inviteId);
  if (!invite) return { error: jsonError(404, "invite_not_found") };
  if (invite.caller_user_id !== user.id && invite.callee_user_id !== user.id) {
    // Não participante não descobre nem que o convite existe.
    return { error: jsonError(404, "invite_not_found") };
  }
  if (invite.state === "ringing" && invite.expires_at <= Date.now()) {
    await ctx.db.transitionInvite(invite.id, "ringing", "expired");
    invite.state = "expired";
  }
  return { invite };
}

export async function handleCallGet(inviteId: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const { invite, error } = await loadInviteFor(inviteId, user, ctx);
  if (error) return error;
  const caller = await ctx.db.getUserById(invite.caller_user_id);
  const callee = await ctx.db.getUserById(invite.callee_user_id);

  let media: MediaAccess | undefined;
  if (invite.state === "accepted" && invite.session_id) {
    const sessionId = invite.session_id;
    media = await mediaAccessFor(
      ctx.gateway,
      async () => {
        const session = await ctx.db.getSession(sessionId);
        if (!session) return null;
        if (session.media_room_id) return session.media_room_id;
        const roomId = await ctx.gateway.createRoom(`Chamada privada ${sessionId}`);
        await ctx.db.setSessionMediaRoom(sessionId, roomId);
        return roomId;
      },
      { userId: user.id, username: user.username, perms: ROLE_PRESETS.call_participant },
    );
  }
  return Response.json({
    inviteId: invite.id,
    state: invite.state,
    sessionId: invite.session_id,
    caller: caller?.username,
    callee: callee?.username,
    ...(media ? { media } : {}),
  });
}

export async function handleCallAccept(inviteId: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const { invite, error } = await loadInviteFor(inviteId, user, ctx);
  if (error) return error;
  if (invite.callee_user_id !== user.id) return jsonError(403, "only_callee_can_accept");
  if (invite.state !== "ringing") return jsonError(409, "invalid_state", { state: invite.state });

  const sessionId = newId();
  const moved = await ctx.db.transitionInvite(invite.id, "ringing", "accepted", sessionId);
  if (!moved) return jsonError(409, "invalid_state");

  await ctx.db.createSession({
    id: sessionId,
    type: "direct_call",
    ownerUserId: invite.caller_user_id,
    parentSessionId: MAIN_PARTY_ID,
  });
  const perms = ROLE_PRESETS.call_participant;
  await ctx.db.upsertMembership(sessionId, invite.caller_user_id, "call_participant", perms);
  await ctx.db.upsertMembership(sessionId, invite.callee_user_id, "call_participant", perms);

  // Suspende a publicação de mídia dos dois na festa enquanto durar a chamada.
  for (const uid of [invite.caller_user_id, invite.callee_user_id]) {
    await ctx.db.updateMembershipPerms(MAIN_PARTY_ID, uid, { canPublishAudio: false, canPublishVideo: false });
    const m = await ctx.db.getMembership(MAIN_PARTY_ID, uid);
    if (m) await updateRoomPerms(ctx, MAIN_PARTY_ID, uid, membershipPerms(m));
    await ctx.db.setUserStatus(uid, "busy");
  }

  await notifyRoom(
    ctx,
    MAIN_PARTY_ID,
    { type: "call_state", inviteId: invite.id, state: "accepted", sessionId },
    invite.caller_user_id,
  );
  return Response.json({ ok: true, sessionId });
}

export async function handleCallDecline(inviteId: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const { invite, error } = await loadInviteFor(inviteId, user, ctx);
  if (error) return error;
  if (invite.callee_user_id !== user.id) return jsonError(403, "only_callee_can_decline");
  if (!(await ctx.db.transitionInvite(invite.id, "ringing", "declined"))) {
    return jsonError(409, "invalid_state", { state: invite.state });
  }
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "call_state", inviteId: invite.id, state: "declined" }, invite.caller_user_id);
  return Response.json({ ok: true });
}

export async function handleCallCancel(inviteId: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const { invite, error } = await loadInviteFor(inviteId, user, ctx);
  if (error) return error;
  if (invite.caller_user_id !== user.id) return jsonError(403, "only_caller_can_cancel");
  if (!(await ctx.db.transitionInvite(invite.id, "ringing", "cancelled"))) {
    return jsonError(409, "invalid_state", { state: invite.state });
  }
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "call_state", inviteId: invite.id, state: "cancelled" }, invite.callee_user_id);
  return Response.json({ ok: true });
}

export async function handleCallEnd(inviteId: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const { invite, error } = await loadInviteFor(inviteId, user, ctx);
  if (error) return error;
  if (invite.state !== "accepted" || !invite.session_id) return jsonError(409, "invalid_state", { state: invite.state });
  if (!(await ctx.db.transitionInvite(invite.id, "accepted", "ended"))) return jsonError(409, "invalid_state");

  await ctx.db.endSession(invite.session_id);
  for (const uid of [invite.caller_user_id, invite.callee_user_id]) {
    await ctx.db.leaveMembership(invite.session_id, uid);
    await ctx.db.setUserStatus(uid, "online");
    // As permissões de publicação na festa NÃO são religadas automaticamente:
    // o usuário confirma via POST /api/party/media/resume.
  }
  await notifyRoom(ctx, invite.session_id, { type: "session_ended" });
  const other = invite.caller_user_id === user.id ? invite.callee_user_id : invite.caller_user_id;
  await notifyRoom(ctx, MAIN_PARTY_ID, { type: "call_state", inviteId: invite.id, state: "ended" }, other);
  return Response.json({ ok: true });
}

// ------------------------------------------------------- transmissão pessoal

export async function handleBroadcastStart(user: UserRow, ctx: Ctx): Promise<Response> {
  const channel = await ctx.db.getChannelByOwner(user.id);
  if (!channel) return jsonError(404, "channel_not_found");
  if (channel.status === "suspended") return jsonError(403, "channel_suspended");
  if (channel.status === "live" && channel.current_session_id) {
    return jsonError(409, "already_live", { sessionId: channel.current_session_id });
  }

  const sessionId = newId();
  await ctx.db.createSession({ id: sessionId, type: "personal_broadcast", ownerUserId: user.id });
  const perms = ROLE_PRESETS.broadcast_host;
  await ctx.db.upsertMembership(sessionId, user.id, "broadcast_host", perms);
  await ctx.db.setChannelLive(channel.id, sessionId);

  const media = await mediaAccessFor(
    ctx.gateway,
    async () => {
      const roomId = await ctx.gateway.createRoom(`Transmissão de ${user.username}`);
      await ctx.db.setSessionMediaRoom(sessionId, roomId);
      return roomId;
    },
    { userId: user.id, username: user.username, perms },
  );
  return Response.json({ ok: true, sessionId, url: `/${channel.slug}`, media }, { status: 201 });
}

export async function handleBroadcastStop(user: UserRow, ctx: Ctx): Promise<Response> {
  const channel = await ctx.db.getChannelByOwner(user.id);
  if (!channel) return jsonError(404, "channel_not_found");
  if (channel.status !== "live" || !channel.current_session_id) return jsonError(409, "not_live");

  const session = await ctx.db.getSession(channel.current_session_id);
  await ctx.db.endSession(channel.current_session_id);
  await ctx.db.leaveMembership(channel.current_session_id, user.id);
  await ctx.db.setChannelLive(channel.id, null);
  if (session?.media_room_id) await ctx.gateway.endRoom(session.media_room_id);
  await notifyRoom(ctx, channel.current_session_id, { type: "session_ended" });
  return Response.json({ ok: true });
}

export async function handleChannelGet(slug: string, request: Request, ctx: Ctx): Promise<Response> {
  const channel = await ctx.db.getChannelBySlug(slug);
  if (!channel) return jsonError(404, "channel_not_found");
  const viewer = await currentUser(request, ctx.db);

  let media: MediaAccess | undefined;
  if (channel.status === "live" && channel.current_session_id && viewer) {
    const sessionId = channel.current_session_id;
    const session = await ctx.db.getSession(sessionId);
    const isHost = viewer.id === channel.owner_user_id;
    const perms = isHost ? ROLE_PRESETS.broadcast_host : ROLE_PRESETS.broadcast_audience;
    media = await mediaAccessFor(ctx.gateway, async () => session?.media_room_id ?? null, {
      userId: viewer.id,
      username: viewer.username,
      perms,
    });
  }
  return Response.json({
    slug: channel.slug,
    status: channel.status,
    sessionId: channel.status === "live" ? channel.current_session_id : null,
    ...(media ? { media } : {}),
  });
}

// ------------------------------------------------------------------ bloqueios

export async function handleBlockAdd(request: Request, user: UserRow, ctx: Ctx): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = blockSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "invalid_input");
  const target = await ctx.db.getUserByUsername(parsed.data.username);
  if (!target) return jsonError(404, "user_not_found");
  if (target.id === user.id) return jsonError(400, "cannot_block_self");
  await ctx.db.addBlock(user.id, target.id);
  return Response.json({ ok: true });
}

export async function handleBlockRemove(username: string, user: UserRow, ctx: Ctx): Promise<Response> {
  const target = await ctx.db.getUserByUsername(username);
  if (!target) return jsonError(404, "user_not_found");
  await ctx.db.removeBlock(user.id, target.id);
  return Response.json({ ok: true });
}

// ------------------------------------------------------------ WebSocket join

export async function handleSessionWs(sessionId: string, request: Request, ctx: Ctx): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(400, "websocket_required");
  }
  const session = await ctx.db.getSession(sessionId);
  if (!session || session.status !== "active") return jsonError(404, "session_not_found");

  const user = await currentUser(request, ctx.db);
  let auth: { userId: string; username: string; role: string; perms: Permissions };

  if (user) {
    let membership = await ctx.db.getMembership(sessionId, user.id);
    if (!membership && session.type === "personal_broadcast") {
      // Usuário autenticado entra na audiência da transmissão automaticamente.
      await ctx.db.upsertMembership(sessionId, user.id, "broadcast_audience", ROLE_PRESETS.broadcast_audience);
      membership = await ctx.db.getMembership(sessionId, user.id);
    }
    if (!membership) return jsonError(403, "not_a_member");
    auth = { userId: user.id, username: user.username, role: membership.role, perms: membershipPerms(membership) };
  } else if (session.type === "personal_broadcast") {
    // Espectador anônimo: assiste e lê o chat, nunca escreve.
    auth = {
      userId: "",
      username: "visitante",
      role: "anonymous_viewer",
      perms: { canPublishAudio: false, canPublishVideo: false, canSubscribeMedia: true, canSendText: false, canModerate: false },
    };
  } else {
    return jsonError(401, "auth_required");
  }

  const stub = ctx.rooms.get(ctx.rooms.idFromName(sessionId));
  const headers = new Headers(request.headers);
  headers.set("x-room-auth", JSON.stringify(auth));
  return stub.fetch(new Request("https://room/connect", { headers, method: "GET" }));
}
