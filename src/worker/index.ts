import { parseTvSource, resolvePlayback } from "../shared/tv-source";
import { MAX_EVENT_BODY_BYTES, playbackEventSchema } from "../shared/events";
import { renderAuthPlaceholder, renderHomePage, renderNotFound } from "./html";

export interface Env {
  /** JSON validado por tvSourceSchema; ver docs/tv-partner-contract.md. */
  TV_SOURCE?: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

function html(markup: string, status = 200): Response {
  return new Response(markup, { status, headers: HTML_HEADERS });
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
  // Persistência de analytics fica fora do escopo desta etapa: os eventos são
  // registrados de forma estruturada nos logs do Worker.
  console.log(JSON.stringify({ analytics: parsed.data }));
  return new Response(null, { status: 204 });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "POST" && pathname === "/api/events") {
      return handleEvents(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }

    switch (pathname) {
      case "/": {
        const playback = resolvePlayback(parseTvSource(env.TV_SOURCE));
        return html(renderHomePage(playback));
      }
      case "/login":
        return html(renderAuthPlaceholder("login"));
      case "/signup":
        return html(renderAuthPlaceholder("signup"));
      case "/healthz": {
        const source = parseTvSource(env.TV_SOURCE);
        return Response.json({ ok: true, tv: resolvePlayback(source).mode });
      }
      default:
        return html(renderNotFound(), 404);
    }
  },
};

export default worker;
