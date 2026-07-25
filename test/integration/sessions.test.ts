import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { makeEnv } from "../helpers/env";

/**
 * Critérios de aceite das Etapas 2 a 5 exercitados contra SQLite real, com o
 * schema real de migrations/0001_init.sql. São as garantias que o plano define
 * em texto — aqui viram asserções.
 */

let env: ReturnType<typeof makeEnv>;
let mediaFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  env = makeEnv();
  mediaFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/participants")) {
      return Response.json({ success: true, data: { token: crypto.randomUUID() } });
    }
    if (init?.method === "PATCH") return Response.json({ success: true, data: {} });
    return Response.json({ success: true, data: { id: crypto.randomUUID() } });
  });
  vi.stubGlobal("fetch", mediaFetch);
});

afterEach(() => vi.unstubAllGlobals());

type Session = { cookie: string; id: string; username: string };

function req(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return worker.fetch(new Request(`https://tv.example${path}`, { ...init, headers }), env);
}

function post(path: string, body?: unknown, cookie?: string): Promise<Response> {
  return req(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), cookie });
}

async function signup(username: string): Promise<Session> {
  const res = await post("/api/signup", { username, password: "senha-forte-123" });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const me = await (await req("/api/me", { cookie })).json();
  return { cookie, id: me.user.id, username };
}

describe("Etapa 2 — identidade e slug", () => {
  it("cadastro cria usuário e reserva o canal /<username>", async () => {
    const alice = await signup("alice");
    const me = await (await req("/api/me", { cookie: alice.cookie })).json();
    expect(me.user).toMatchObject({ username: "alice", status: "online" });
    expect(me.channel).toMatchObject({ slug: "alice", status: "offline" });
  });

  it("username duplicado é recusado", async () => {
    await signup("alice");
    const res = await post("/api/signup", { username: "alice", password: "senha-forte-123" });
    expect(res.status).toBe(409);
  });

  it("slugs reservados do sistema não viram username", async () => {
    for (const reserved of ["login", "signup", "festa", "api"]) {
      const res = await post("/api/signup", { username: reserved, password: "senha-forte-123" });
      expect(res.status, `slug reservado aceito: ${reserved}`).not.toBe(200);
    }
  });

  it("senha errada não autentica e não vaza se o usuário existe", async () => {
    await signup("alice");
    const errada = await post("/api/login", { username: "alice", password: "senha-errada-1" });
    const inexistente = await post("/api/login", { username: "zzztop", password: "senha-errada-1" });
    expect(errada.status).toBe(401);
    expect(await errada.json()).toEqual(await inexistente.json());
  });

  it("requisição sem sessão não acessa a API autenticada", async () => {
    expect((await req("/api/me")).status).toBe(401);
    expect((await post("/api/party/join", {})).status).toBe(401);
  });
});

describe("Etapa 3 — festa", () => {
  it("sem RealtimeKit não cria uma participação fantasma", async () => {
    const alice = await signup("alice");
    Object.assign(env, {
      CLOUDFLARE_ACCOUNT_ID: undefined,
      REALTIMEKIT_APP_ID: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
    });

    const response = await post("/api/party/join", {}, alice.cookie);
    expect(response.status).toBe(503);
    expect(env.DB.query("SELECT * FROM memberships WHERE left_at IS NULL")).toHaveLength(0);
  });

  it("o primeiro a entrar é admin; os seguintes são participantes", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const a = await (await post("/api/party/join", {}, alice.cookie)).json();
    const b = await (await post("/api/party/join", {}, bob.cookie)).json();
    expect(a.role).toBe("party_admin");
    expect(a.perms.canModerate).toBe(true);
    expect(b.role).toBe("party_participant");
    expect(b.perms.canModerate).toBe(false);
  });

  it("participante sem moderação não consegue expulsar ninguém", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    await post("/api/party/join", {}, alice.cookie);
    await post("/api/party/join", {}, bob.cookie);
    const res = await post("/api/party/kick", { username: "alice" }, bob.cookie);
    expect(res.status).toBe(403);
  });

  it("participantes têm as mesmas permissões de fala do admin", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const a = await (await post("/api/party/join", {}, alice.cookie)).json();
    const b = await (await post("/api/party/join", {}, bob.cookie)).json();
    // O admin modera; não fala mais alto que os outros.
    for (const key of ["canPublishAudio", "canPublishVideo", "canSendText", "canSubscribeMedia"]) {
      expect(b.perms[key], key).toBe(a.perms[key]);
    }
  });
});

describe("Etapa 4 — chamada privada", () => {
  async function callInProgress() {
    const alice = await signup("alice");
    const bob = await signup("bob");
    const carol = await signup("carol");
    for (const s of [alice, bob, carol]) await post("/api/party/join", {}, s.cookie);
    const created = await (await post("/api/calls", { username: "bob" }, alice.cookie)).json();
    return { alice, bob, carol, inviteId: created.inviteId as string };
  }

  it("nenhum terceiro lê, aceita ou encerra a chamada — nem antes nem depois do aceite", async () => {
    const { bob, carol, inviteId } = await callInProgress();

    for (const fase of ["antes do aceite", "depois do aceite"]) {
      const leitura = await req(`/api/calls/${inviteId}`, { cookie: carol.cookie });
      const aceite = await post(`/api/calls/${inviteId}/accept`, undefined, carol.cookie);
      const fim = await post(`/api/calls/${inviteId}/end`, undefined, carol.cookie);
      const pagina = await req(`/chamada/${inviteId}`, { cookie: carol.cookie });

      // 404 e não 403: o terceiro não descobre nem que a chamada existe.
      expect(leitura.status, `leitura ${fase}`).toBe(404);
      expect(aceite.status, `aceite ${fase}`).toBe(404);
      expect(fim.status, `encerramento ${fase}`).toBe(404);
      expect(pagina.status, `página ${fase}`).toBe(404);

      if (fase === "antes do aceite") {
        expect((await post(`/api/calls/${inviteId}/accept`, undefined, bob.cookie)).status).toBe(200);
      }
    }
  });

  it("a sala da chamada só tem os dois participantes", async () => {
    const { alice, bob, carol, inviteId } = await callInProgress();
    await post(`/api/calls/${inviteId}/accept`, undefined, bob.cookie);

    const membros = env.DB.query<{ user_id: string }>(
      "SELECT m.user_id FROM memberships m JOIN sessions s ON s.id = m.session_id WHERE s.type = 'direct_call'",
    ).map((r) => r.user_id);

    expect(membros.sort()).toEqual([alice.id, bob.id].sort());
    expect(membros).not.toContain(carol.id);
  });

  it("o polling da chamada não cria participantes RealtimeKit repetidamente", async () => {
    const { alice, bob, inviteId } = await callInProgress();
    await post(`/api/calls/${inviteId}/accept`, undefined, bob.cookie);
    mediaFetch.mockClear();

    await req(`/api/calls/${inviteId}`, { cookie: alice.cookie });
    await req(`/api/calls/${inviteId}`, { cookie: alice.cookie });
    expect(mediaFetch.mock.calls.filter(([input]) => String(input).endsWith("/participants"))).toHaveLength(0);

    await req(`/api/calls/${inviteId}?media=1`, { cookie: alice.cookie });
    expect(mediaFetch.mock.calls.filter(([input]) => String(input).endsWith("/participants"))).toHaveLength(1);
  });

  it("aceitar a chamada suspende a mídia na festa só de quem está na chamada", async () => {
    const { alice, bob, carol, inviteId } = await callInProgress();
    await post(`/api/calls/${inviteId}/accept`, undefined, bob.cookie);

    const perms = (userId: string) =>
      env.DB.query<{ can_publish_audio: number; can_publish_video: number }>(
        "SELECT can_publish_audio, can_publish_video FROM memberships WHERE session_id = 'party-main' AND user_id = ?",
        userId,
      )[0];

    expect(perms(alice.id)).toMatchObject({ can_publish_audio: 0, can_publish_video: 0 });
    expect(perms(bob.id)).toMatchObject({ can_publish_audio: 0, can_publish_video: 0 });
    // Quem ficou na festa não é afetado.
    expect(perms(carol.id)).toMatchObject({ can_publish_audio: 1, can_publish_video: 1 });
  });

  it("a mídia da festa não religa sozinha ao encerrar: exige retomada explícita", async () => {
    const { alice, bob, inviteId } = await callInProgress();
    await post(`/api/calls/${inviteId}/accept`, undefined, bob.cookie);
    await post(`/api/calls/${inviteId}/end`, undefined, alice.cookie);

    const depoisDoFim = env.DB.query<{ can_publish_audio: number }>(
      "SELECT can_publish_audio FROM memberships WHERE session_id = 'party-main' AND user_id = ?",
      alice.id,
    )[0];
    expect(depoisDoFim!.can_publish_audio).toBe(0);

    expect((await post("/api/party/media/resume", undefined, alice.cookie)).status).toBe(200);
    const depoisDaRetomada = env.DB.query<{ can_publish_audio: number }>(
      "SELECT can_publish_audio FROM memberships WHERE session_id = 'party-main' AND user_id = ?",
      alice.id,
    )[0];
    expect(depoisDaRetomada!.can_publish_audio).toBe(1);
  });

  it("bloqueio impede a criação da chamada nos dois sentidos", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    await post("/api/party/join", {}, alice.cookie);
    await post("/api/party/join", {}, bob.cookie);
    expect((await post("/api/blocks", { username: "bob" }, alice.cookie)).status).toBe(200);

    expect((await post("/api/calls", { username: "bob" }, alice.cookie)).status).toBe(403);
    expect((await post("/api/calls", { username: "alice" }, bob.cookie)).status).toBe(403);
  });

  it("não é possível ligar para si mesmo", async () => {
    const alice = await signup("alice");
    await post("/api/party/join", {}, alice.cookie);
    expect((await post("/api/calls", { username: "alice" }, alice.cookie)).status).toBe(400);
  });
});

describe("Etapa 5 — transmissão pessoal", () => {
  it("falha de mídia não declara o canal ao vivo", async () => {
    const alice = await signup("alice");
    mediaFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/participants")) {
        return Response.json({ success: false, errors: [{ message: "preset inválido" }] }, { status: 400 });
      }
      return Response.json({ success: true, data: { id: crypto.randomUUID() } });
    });

    expect((await post("/api/broadcast/start", undefined, alice.cookie)).status).toBe(502);
    expect(await (await req("/api/channels/alice")).json()).toMatchObject({ status: "offline" });
  });

  it("o canal fica offline até o dono iniciar, e volta a offline ao encerrar", async () => {
    const alice = await signup("alice");
    expect(await (await req("/api/channels/alice")).json()).toMatchObject({ status: "offline" });

    await post("/api/broadcast/start", undefined, alice.cookie);
    expect(await (await req("/api/channels/alice")).json()).toMatchObject({ status: "live" });

    await post("/api/broadcast/stop", undefined, alice.cookie);
    expect(await (await req("/api/channels/alice")).json()).toMatchObject({ status: "offline" });
  });

  it("visitante anônimo assiste sem receber permissão de publicar", async () => {
    const alice = await signup("alice");
    await post("/api/broadcast/start", undefined, alice.cookie);

    const canal = await (await req("/api/channels/alice")).json();
    expect(canal.status).toBe("live");
    // O anônimo recebe o que precisa para assistir e nada além disso.
    expect(canal.sessionId).toBeTruthy();
    expect(JSON.stringify(canal)).not.toContain("canPublish");

    // E não existe membership de audiência: não há permissão a ser elevada.
    const audiencia = env.DB.query(
      "SELECT * FROM memberships m JOIN sessions s ON s.id = m.session_id WHERE s.type = 'personal_broadcast' AND m.role != 'broadcast_host'",
    );
    expect(audiencia).toHaveLength(0);
  });

  it("só o dono transmite no próprio canal", async () => {
    const alice = await signup("alice");
    const bob = await signup("bob");
    await post("/api/broadcast/start", undefined, alice.cookie);

    // Bob transmitindo cria o canal DELE, nunca o da alice.
    await post("/api/broadcast/start", undefined, bob.cookie);
    const canalAlice = await (await req("/api/channels/alice")).json();
    const canalBob = await (await req("/api/channels/bob")).json();
    expect(canalAlice.sessionId).not.toBe(canalBob.sessionId);

    const hosts = env.DB.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM sessions WHERE type = 'personal_broadcast'",
    ).map((r) => r.owner_user_id);
    expect(hosts.sort()).toEqual([alice.id, bob.id].sort());
  });

  it("canal inexistente devolve 404 sem revelar nada", async () => {
    expect((await req("/api/channels/naoexiste")).status).toBe(404);
  });
});
