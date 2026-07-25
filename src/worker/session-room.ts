import { chatMessageSchema } from "../shared/api";
import type { RoomServerEvent } from "../shared/api";
import type { Permissions } from "../shared/domain";

/**
 * Durable Object por sessão (festa, chamada, transmissão): presença em tempo
 * real, chat com rate limit e entrega de eventos (convites, moderação).
 *
 * O DO só é alcançável através do Worker, que autentica o usuário e injeta a
 * identidade/permissões no header interno x-room-auth. O chat é efêmero
 * (últimas 100 mensagens em memória) nesta etapa.
 */

interface Conn {
  userId: string; // "" para espectador anônimo (somente broadcast)
  username: string;
  role: string;
  perms: Permissions;
  chatTimestamps: number[];
}

const CHAT_RATE_LIMIT = { max: 5, windowMs: 10_000 };
const HISTORY_LIMIT = 100;

export class SessionRoom {
  private conns = new Map<CfWebSocket, Conn>();
  private history: Extract<RoomServerEvent, { type: "chat" }>[] = [];

  constructor(_state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      const auth = request.headers.get("x-room-auth");
      if (!auth || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("bad request", { status: 400 });
      }
      const conn = JSON.parse(auth) as Omit<Conn, "chatTimestamps">;
      const pair = new WebSocketPair();
      this.accept(pair[1], { ...conn, chatTimestamps: [] });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/notify" && request.method === "POST") {
      const { event, targetUserId } = (await request.json()) as {
        event: RoomServerEvent;
        targetUserId?: string;
      };
      this.deliver(event, targetUserId);
      if (event.type === "kicked" && targetUserId) this.disconnectUser(targetUserId);
      if (event.type === "session_ended") this.disconnectAll();
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/perms" && request.method === "POST") {
      const { userId, perms } = (await request.json()) as { userId: string; perms: Permissions };
      for (const [ws, conn] of this.conns) {
        if (conn.userId === userId) {
          conn.perms = perms;
          this.send(ws, { type: "perms_updated", perms });
        }
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/roster") {
      return Response.json({ users: this.rosterUsers() });
    }

    return new Response("not found", { status: 404 });
  }

  private accept(ws: CfWebSocket, conn: Conn): void {
    ws.accept();
    this.conns.set(ws, conn);
    ws.addEventListener("message", (event) => this.onMessage(ws, conn, event));
    const close = () => {
      if (!this.conns.delete(ws)) return;
      if (conn.userId && !this.userStillConnected(conn.userId)) {
        this.broadcast({ type: "presence_leave", username: conn.username });
      }
    };
    ws.addEventListener("close", close);
    ws.addEventListener("error", close);

    this.send(ws, { type: "roster", users: this.rosterUsers() });
    for (const msg of this.history) this.send(ws, msg);
    if (conn.userId) this.broadcast({ type: "presence_join", username: conn.username, role: conn.role });
  }

  private onMessage(ws: CfWebSocket, conn: Conn, event: MessageEvent): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      this.send(ws, { type: "chat_rejected", reason: "invalid" });
      return;
    }
    const msg = chatMessageSchema.safeParse(parsed);
    if (!msg.success) {
      this.send(ws, { type: "chat_rejected", reason: "invalid" });
      return;
    }
    if (!conn.userId || !conn.perms.canSendText) {
      this.send(ws, { type: "chat_rejected", reason: "not_allowed" });
      return;
    }
    const now = Date.now();
    conn.chatTimestamps = conn.chatTimestamps.filter((t) => now - t < CHAT_RATE_LIMIT.windowMs);
    if (conn.chatTimestamps.length >= CHAT_RATE_LIMIT.max) {
      this.send(ws, { type: "chat_rejected", reason: "rate_limited" });
      return;
    }
    conn.chatTimestamps.push(now);
    const chat: Extract<RoomServerEvent, { type: "chat" }> = {
      type: "chat",
      from: conn.username,
      text: msg.data.text,
      at: new Date(now).toISOString(),
    };
    this.history.push(chat);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.broadcast(chat);
  }

  private rosterUsers(): { username: string; role: string }[] {
    const seen = new Map<string, { username: string; role: string }>();
    for (const conn of this.conns.values()) {
      if (conn.userId) seen.set(conn.userId, { username: conn.username, role: conn.role });
    }
    return [...seen.values()];
  }

  private userStillConnected(userId: string): boolean {
    for (const conn of this.conns.values()) if (conn.userId === userId) return true;
    return false;
  }

  private send(ws: CfWebSocket, event: RoomServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      this.conns.delete(ws);
    }
  }

  private broadcast(event: RoomServerEvent): void {
    for (const ws of this.conns.keys()) this.send(ws, event);
  }

  private deliver(event: RoomServerEvent, targetUserId?: string): void {
    for (const [ws, conn] of this.conns) {
      if (!targetUserId || conn.userId === targetUserId) this.send(ws, event);
    }
  }

  private disconnectUser(userId: string): void {
    for (const [ws, conn] of this.conns) {
      if (conn.userId === userId) {
        this.conns.delete(ws);
        try {
          ws.close(1000, "kicked");
        } catch {
          // já fechado
        }
      }
    }
    // presença: avisa os demais
    const remaining = this.rosterUsers();
    this.broadcast({ type: "roster", users: remaining });
  }

  private disconnectAll(): void {
    for (const ws of this.conns.keys()) {
      try {
        ws.close(1000, "session_ended");
      } catch {
        // já fechado
      }
    }
    this.conns.clear();
  }
}
