import type { CallInviteState, Permissions, SessionType, UserStatus } from "../shared/domain";

/** Camada fina e tipada sobre o D1. Todas as escritas passam por aqui. */

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  status: UserStatus;
  failed_logins: number;
  locked_until: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  type: SessionType;
  owner_user_id: string | null;
  parent_session_id: string | null;
  status: "waiting" | "active" | "ended";
  media_room_id: string | null;
  created_at: number;
  ended_at: number | null;
}

export interface MembershipRow {
  session_id: string;
  user_id: string;
  role: string;
  can_publish_audio: number;
  can_publish_video: number;
  can_subscribe_media: number;
  can_send_text: number;
  can_moderate: number;
  joined_at: number;
  left_at: number | null;
}

export interface ChannelRow {
  id: string;
  owner_user_id: string;
  slug: string;
  status: "offline" | "live" | "suspended";
  current_session_id: string | null;
}

export interface CallInviteRow {
  id: string;
  session_id: string | null;
  caller_user_id: string;
  callee_user_id: string;
  state: CallInviteState;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export function membershipPerms(m: MembershipRow): Permissions {
  return {
    canPublishAudio: !!m.can_publish_audio,
    canPublishVideo: !!m.can_publish_video,
    canSubscribeMedia: !!m.can_subscribe_media,
    canSendText: !!m.can_send_text,
    canModerate: !!m.can_moderate,
  };
}

export class Db {
  constructor(private readonly d1: D1Database) {}

  // --- usuários e autenticação ---

  getUserByUsername(username: string): Promise<UserRow | null> {
    return this.d1.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
  }

  getUserById(id: string): Promise<UserRow | null> {
    return this.d1.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  }

  async createUserWithChannel(user: {
    id: string;
    username: string;
    passwordHash: string;
    passwordSalt: string;
    passwordIterations: number;
    channelId: string;
  }): Promise<void> {
    const now = Date.now();
    await this.d1.batch([
      this.d1
        .prepare(
          "INSERT INTO users (id, username, password_hash, password_salt, password_iterations, status, created_at) VALUES (?, ?, ?, ?, ?, 'online', ?)",
        )
        .bind(user.id, user.username, user.passwordHash, user.passwordSalt, user.passwordIterations, now),
      this.d1
        .prepare("INSERT INTO channels (id, owner_user_id, slug, status) VALUES (?, ?, ?, 'offline')")
        .bind(user.channelId, user.id, user.username),
    ]);
  }

  async recordLoginResult(userId: string, ok: boolean): Promise<void> {
    if (ok) {
      await this.d1
        .prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, status = 'online' WHERE id = ?")
        .bind(userId)
        .run();
    } else {
      // 5 falhas seguidas bloqueiam por 10 minutos.
      await this.d1
        .prepare(
          `UPDATE users SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= 5 THEN ? ELSE locked_until END
           WHERE id = ?`,
        )
        .bind(Date.now() + 10 * 60 * 1000, userId)
        .run();
    }
  }

  async createAuthSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.d1
      .prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, userId, Date.now(), expiresAt)
      .run();
  }

  async getUserByAuthToken(tokenHash: string): Promise<UserRow | null> {
    return this.d1
      .prepare(
        `SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id = u.id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .bind(tokenHash, Date.now())
      .first<UserRow>();
  }

  async deleteAuthSession(tokenHash: string): Promise<void> {
    await this.d1.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  async setUserStatus(userId: string, status: UserStatus): Promise<void> {
    await this.d1.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, userId).run();
  }

  // --- sessões e participações ---

  getSession(id: string): Promise<SessionRow | null> {
    return this.d1.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  }

  getActiveMainParty(): Promise<SessionRow | null> {
    return this.d1
      .prepare("SELECT * FROM sessions WHERE type = 'party' AND status = 'active' ORDER BY created_at LIMIT 1")
      .first<SessionRow>();
  }

  async createSession(row: {
    id: string;
    type: SessionType;
    ownerUserId?: string;
    parentSessionId?: string;
    status?: "waiting" | "active";
  }): Promise<void> {
    await this.d1
      .prepare(
        "INSERT INTO sessions (id, type, owner_user_id, parent_session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(row.id, row.type, row.ownerUserId ?? null, row.parentSessionId ?? null, row.status ?? "active", Date.now())
      .run();
  }

  async setSessionMediaRoom(sessionId: string, roomId: string): Promise<void> {
    await this.d1.prepare("UPDATE sessions SET media_room_id = ? WHERE id = ?").bind(roomId, sessionId).run();
  }

  async endSession(sessionId: string): Promise<void> {
    await this.d1
      .prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?")
      .bind(Date.now(), sessionId)
      .run();
  }

  getMembership(sessionId: string, userId: string): Promise<MembershipRow | null> {
    return this.d1
      .prepare("SELECT * FROM memberships WHERE session_id = ? AND user_id = ? AND left_at IS NULL")
      .bind(sessionId, userId)
      .first<MembershipRow>();
  }

  async upsertMembership(sessionId: string, userId: string, role: string, perms: Permissions): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO memberships (session_id, user_id, role, can_publish_audio, can_publish_video,
           can_subscribe_media, can_send_text, can_moderate, joined_at, left_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(session_id, user_id) DO UPDATE SET role = excluded.role,
           can_publish_audio = excluded.can_publish_audio,
           can_publish_video = excluded.can_publish_video,
           can_subscribe_media = excluded.can_subscribe_media,
           can_send_text = excluded.can_send_text,
           can_moderate = excluded.can_moderate,
           joined_at = excluded.joined_at,
           left_at = NULL`,
      )
      .bind(
        sessionId,
        userId,
        role,
        perms.canPublishAudio ? 1 : 0,
        perms.canPublishVideo ? 1 : 0,
        perms.canSubscribeMedia ? 1 : 0,
        perms.canSendText ? 1 : 0,
        perms.canModerate ? 1 : 0,
        Date.now(),
      )
      .run();
  }

  async updateMembershipPerms(sessionId: string, userId: string, perms: Partial<Permissions>): Promise<void> {
    const current = await this.getMembership(sessionId, userId);
    if (!current) return;
    const merged = { ...membershipPerms(current), ...perms };
    await this.upsertMembership(sessionId, userId, current.role, merged);
  }

  async leaveMembership(sessionId: string, userId: string): Promise<void> {
    await this.d1
      .prepare("UPDATE memberships SET left_at = ? WHERE session_id = ? AND user_id = ? AND left_at IS NULL")
      .bind(Date.now(), sessionId, userId)
      .run();
  }

  countActiveMembers(sessionId: string): Promise<{ n: number } | null> {
    return this.d1
      .prepare("SELECT COUNT(*) AS n FROM memberships WHERE session_id = ? AND left_at IS NULL")
      .bind(sessionId)
      .first<{ n: number }>();
  }

  async getActivePartyMembership(userId: string): Promise<(MembershipRow & { type: SessionType }) | null> {
    return this.d1
      .prepare(
        `SELECT m.*, s.type FROM memberships m JOIN sessions s ON s.id = m.session_id
         WHERE m.user_id = ? AND m.left_at IS NULL AND s.status = 'active' AND s.type = 'party'`,
      )
      .bind(userId)
      .first<MembershipRow & { type: SessionType }>();
  }

  async userIsInActiveCall(userId: string): Promise<boolean> {
    const row = await this.d1
      .prepare(
        `SELECT 1 AS x FROM call_invites
         WHERE (caller_user_id = ? OR callee_user_id = ?)
           AND (state = 'accepted' OR (state = 'ringing' AND expires_at > ?))
         LIMIT 1`,
      )
      .bind(userId, userId, Date.now())
      .first();
    return row !== null;
  }

  // --- canais ---

  getChannelBySlug(slug: string): Promise<ChannelRow | null> {
    return this.d1.prepare("SELECT * FROM channels WHERE slug = ?").bind(slug).first<ChannelRow>();
  }

  getChannelByOwner(userId: string): Promise<ChannelRow | null> {
    return this.d1.prepare("SELECT * FROM channels WHERE owner_user_id = ?").bind(userId).first<ChannelRow>();
  }

  async setChannelLive(channelId: string, sessionId: string | null): Promise<void> {
    await this.d1
      .prepare("UPDATE channels SET status = ?, current_session_id = ? WHERE id = ?")
      .bind(sessionId ? "live" : "offline", sessionId, channelId)
      .run();
  }

  // --- convites de chamada ---

  getInvite(id: string): Promise<CallInviteRow | null> {
    return this.d1.prepare("SELECT * FROM call_invites WHERE id = ?").bind(id).first<CallInviteRow>();
  }

  async createInvite(row: { id: string; callerUserId: string; calleeUserId: string; expiresAt: number }): Promise<void> {
    const now = Date.now();
    await this.d1
      .prepare(
        "INSERT INTO call_invites (id, caller_user_id, callee_user_id, state, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'ringing', ?, ?, ?)",
      )
      .bind(row.id, row.callerUserId, row.calleeUserId, now, now, row.expiresAt)
      .run();
  }

  /** Transição atômica: só aplica se o estado atual for o esperado. */
  async transitionInvite(id: string, from: CallInviteState, to: CallInviteState, sessionId?: string): Promise<boolean> {
    const result = await this.d1
      .prepare(
        "UPDATE call_invites SET state = ?, updated_at = ?, session_id = COALESCE(?, session_id) WHERE id = ? AND state = ?",
      )
      .bind(to, Date.now(), sessionId ?? null, id, from)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listIncomingRinging(calleeUserId: string): Promise<CallInviteRow[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM call_invites WHERE callee_user_id = ? AND state = 'ringing' AND expires_at > ?")
      .bind(calleeUserId, Date.now())
      .all<CallInviteRow>();
    return results;
  }

  // --- bloqueios ---

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const row = await this.d1
      .prepare(
        "SELECT 1 AS x FROM blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1",
      )
      .bind(a, b, b, a)
      .first();
    return row !== null;
  }

  async addBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.d1
      .prepare("INSERT OR IGNORE INTO blocks (blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?)")
      .bind(blockerUserId, blockedUserId, Date.now())
      .run();
  }

  async removeBlock(blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?")
      .bind(blockerUserId, blockedUserId)
      .run();
  }
}
