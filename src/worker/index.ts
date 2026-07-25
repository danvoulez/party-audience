import { parseTvSource, resolvePlayback } from "../shared/tv-source";
import { MAX_EVENT_BODY_BYTES, playbackEventSchema } from "../shared/events";
import { RESERVED_SLUGS } from "../shared/domain";
import {
  renderAuthPage,
  renderCallPage,
  renderChannelPage,
  renderForbidden,
  renderHomePage,
  renderLobbyPage,
  renderNotFound,
  renderPartyPage,
} from "./html";
import { Db } from "./db";
import { gatewayFromEnv } from "./media-gateway";
import type { UserRow } from "./db";
import {
  currentUser,
  handleBlockAdd,
  handleBlockRemove,
  handleBroadcastStart,
  handleBroadcastStop,
  handleCallAccept,
  handleCallCancel,
  handleCallCreate,
  handleCallDecline,
  handleCallEnd,
  handleCallGet,
  handleCallsIncoming,
  handleChannelGet,
  handleLogin,
  handleLogout,
  handleMe,
  handlePartyJoin,
  handlePartyKick,
  handlePartyLeave,
  handlePartyMediaResume,
  handleSessionWs,
  handleSignup,
} from "./api";
import type { Ctx } from "./api";

export { SessionRoom } from "./session-room";

export interface Env {
  /** JSON validado por tvSourceSchema; ver docs/tv-partner-contract.md. */
  TV_SOURCE?: string;
  DB?: D1Database;
  SESSION_ROOMS?: DurableObjectNamespace;
  REALTIMEKIT_ORG_ID?: string;
  REALTIMEKIT_API_KEY?: string;
  REALTIMEKIT_BASE_URL?: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

function html(markup: string, status = 200): Response {
  return new Response(markup, { status, headers: HTML_HEADERS });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

async function handleEvents(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_EVENT_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = playbackEventSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }
  console.log(JSON.stringify({ analytics: parsed.data }));
  return new Response(null, { status: 204 });
}

/** Rotas /api/* autenticadas e de sessão. */
async function handleApi(request: Request, ctx: Ctx, pathname: string): Promise<Response> {
  const { method } = request;
  const seg = pathname.split("/").filter(Boolean); // ["api", ...]

  if (method === "POST" && pathname === "/api/signup") return handleSignup(request, ctx);
  if (method === "POST" && pathname === "/api/login") return handleLogin(request, ctx);
  if (method === "POST" && pathname === "/api/logout") return handleLogout(request, ctx);

  // WebSocket de sessão: autenticação própria (permite anônimo em broadcast).
  if (seg[1] === "sessions" && seg[3] === "ws" && seg.length === 4) {
    return handleSessionWs(seg[2]!, request, ctx);
  }

  if (method === "GET" && seg[1] === "channels" && seg.length === 3) {
    return handleChannelGet(seg[2]!, request, ctx);
  }

  const user = await currentUser(request, ctx.db);
  if (!user) return Response.json({ error: "auth_required" }, { status: 401 });

  if (method === "GET" && pathname === "/api/me") return handleMe(user, ctx);
  if (method === "POST" && pathname === "/api/party/join") return handlePartyJoin(request, user, ctx);
  if (method === "POST" && pathname === "/api/party/leave") return handlePartyLeave(user, ctx);
  if (method === "POST" && pathname === "/api/party/kick") return handlePartyKick(request, user, ctx);
  if (method === "POST" && pathname === "/api/party/media/resume") return handlePartyMediaResume(user, ctx);

  if (method === "POST" && pathname === "/api/calls") return handleCallCreate(request, user, ctx);
  if (method === "GET" && pathname === "/api/calls/incoming") return handleCallsIncoming(user, ctx);
  if (seg[1] === "calls" && seg.length >= 3 && seg[2] !== "incoming") {
    const inviteId = seg[2]!;
    if (method === "GET" && seg.length === 3) return handleCallGet(inviteId, user, ctx);
    if (method === "POST" && seg[3] === "accept") return handleCallAccept(inviteId, user, ctx);
    if (method === "POST" && seg[3] === "decline") return handleCallDecline(inviteId, user, ctx);
    if (method === "POST" && seg[3] === "cancel") return handleCallCancel(inviteId, user, ctx);
    if (method === "POST" && seg[3] === "end") return handleCallEnd(inviteId, user, ctx);
  }

  if (method === "POST" && pathname === "/api/broadcast/start") return handleBroadcastStart(user, ctx);
  if (method === "POST" && pathname === "/api/broadcast/stop") return handleBroadcastStop(user, ctx);

  if (method === "POST" && pathname === "/api/blocks") return handleBlockAdd(request, user, ctx);
  if (method === "DELETE" && seg[1] === "blocks" && seg.length === 3) {
    return handleBlockRemove(seg[2]!, user, ctx);
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "POST" && pathname === "/api/events") {
      return handleEvents(request);
    }

    if (pathname.startsWith("/api/") || pathname === "/lobby" || pathname === "/festa" || isChannelPath(pathname) || pathname.startsWith("/chamada/")) {
      if (!env.DB || !env.SESSION_ROOMS) {
        return Response.json({ error: "backend_unconfigured", detail: "D1/Durable Objects não vinculados" }, { status: 503 });
      }
    }

    if (pathname.startsWith("/api/")) {
      const ctx: Ctx = { db: new Db(env.DB!), gateway: gatewayFromEnv(env), rooms: env.SESSION_ROOMS! };
      return handleApi(request, ctx, pathname);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    const db = env.DB ? new Db(env.DB) : null;
    const user: UserRow | null = db ? await currentUser(request, db) : null;

    switch (pathname) {
      case "/": {
        const playback = resolvePlayback(parseTvSource(env.TV_SOURCE));
        return html(renderHomePage(playback, user !== null));
      }
      case "/login":
      case "/signup": {
        if (user) return redirect("/lobby");
        return html(renderAuthPage(pathname === "/login" ? "login" : "signup"));
      }
      case "/lobby": {
        if (!user) return redirect("/login");
        return html(renderLobbyPage(user.username));
      }
      case "/festa": {
        if (!user) return redirect("/login");
        return html(renderPartyPage(user.username));
      }
      case "/healthz": {
        const source = parseTvSource(env.TV_SOURCE);
        return Response.json({ ok: true, tv: resolvePlayback(source).mode, db: !!env.DB });
      }
    }

    if (pathname.startsWith("/chamada/")) {
      if (!user || !db) return redirect("/login");
      const inviteId = pathname.slice("/chamada/".length);
      const invite = await db.getInvite(inviteId);
      if (!invite || (invite.caller_user_id !== user.id && invite.callee_user_id !== user.id)) {
        // Não participante não descobre nem que a chamada existe.
        return html(renderNotFound(), 404);
      }
      return html(renderCallPage(inviteId));
    }

    // Canal público: /<username> (um único segmento, não reservado).
    if (isChannelPath(pathname) && db) {
      const slug = pathname.slice(1);
      const channel = await db.getChannelBySlug(slug);
      if (channel) {
        return html(
          renderChannelPage({
            slug: channel.slug,
            status: channel.status,
            isOwner: user?.id === channel.owner_user_id,
            authed: user !== null,
          }),
        );
      }
    }

    return html(renderNotFound(), 404);
  },
};

function isChannelPath(pathname: string): boolean {
  const slug = pathname.slice(1);
  return (
    /^[a-z0-9][a-z0-9_-]{2,19}$/.test(slug) && !RESERVED_SLUGS.has(slug) && !pathname.slice(1).includes("/")
  );
}

export default worker;
