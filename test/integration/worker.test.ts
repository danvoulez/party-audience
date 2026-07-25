import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../../src/worker/index";

function get(path: string, env: Env = {}): Promise<Response> {
  return worker.fetch(new Request(`https://tv.example${path}`), env);
}

const HLS_ENV: Env = { TV_SOURCE: '{"kind":"hls","url":"https://cdn.parceiro.tv/live.m3u8"}' };

describe("GET /", () => {
  it("serve a homepage sem autenticação, com player e fonte HLS resolvida", async () => {
    const res = await get("/", HLS_ENV);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="tv"');
    expect(body).toContain('data-state="loading"');
    expect(body).toContain('"mode":"hls"');
    expect(body).toContain("https://cdn.parceiro.tv/live.m3u8");
    expect(body).toContain('src="/player.js"');
    expect(body).toContain("/login");
    expect(body).toContain("/signup");
  });

  it("sem TV_SOURCE renderiza estado indisponível sem quebrar a página", async () => {
    const res = await get("/", {});
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('data-state="unavailable"');
    expect(body).toContain("A TV ainda não foi configurada");
  });

  it("TV_SOURCE inválida degrada para indisponível em vez de erro 500", async () => {
    const res = await get("/", { TV_SOURCE: "{{{broken" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-state="unavailable"');
  });

  it("não expõe a configuração bruta nem pede câmera/microfone", async () => {
    const body = await (await get("/", HLS_ENV)).text();
    expect(body).not.toContain("TV_SOURCE");
    expect(body).not.toMatch(/getUserMedia|mediaDevices|camera|microphone/i);
  });

  it("overlays de loading e indisponibilidade têm conteúdo real, não elementos vazios", async () => {
    const body = await (await get("/", HLS_ENV)).text();
    expect(body).toMatch(/id="tv-overlay-loading"[^>]*>[\s\S]*?Sintonizando/);
    expect(body).toMatch(/id="tv-overlay-unavailable"[^>]*>[\s\S]*?TV indisponível/);
    expect(body).toMatch(/id="tv-retry"[^>]*>[\s\S]*?Tentar novamente/);
  });
});

describe("bundle do player", () => {
  it("existe e não é um arquivo vazio de fachada", () => {
    expect(statSync("public/player.js").size).toBeGreaterThan(2_000);
    const bundle = readFileSync("public/player.js", "utf-8");
    expect(bundle).toContain("tv-config");
  });
});

describe("páginas auxiliares", () => {
  it("/login e /signup servem formulários reais de autenticação", async () => {
    for (const path of ["/login", "/signup"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('id="auth-form"');
      expect(body).toContain(`data-kind="${path.slice(1) === "login" ? "login" : "signup"}"`);
      expect(body).toContain('name="username"');
      expect(body).toContain('name="password"');
      expect(body).toContain('src="/auth.js"');
    }
  });

  it("rota desconhecida devolve 404 com página própria", async () => {
    const res = await get("/nao-existe");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Página não encontrada");
  });

  // Regressão: um slug válido sem D1 vinculado chegava a responder 503 JSON,
  // quebrando a página 404 para praticamente qualquer URL do site.
  it("slug com formato de canal, sem backend vinculado, ainda devolve 404 HTML", async () => {
    const res = await get("/algum-canal");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Página não encontrada");
  });

  it("a API responde 503 quando o backend não está vinculado", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "backend_unconfigured" });
  });

  it("/healthz informa o modo de TV ativo e se o banco está vinculado", async () => {
    const res = await get("/healthz", HLS_ENV);
    expect(await res.json()).toEqual({ ok: true, tv: "hls", db: false, media: false });
  });
});

describe("POST /api/events", () => {
  function post(body: string): Promise<Response> {
    return worker.fetch(
      new Request("https://tv.example/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      {},
    );
  }

  it("aceita evento de reprodução válido", async () => {
    const res = await post(
      JSON.stringify({ type: "tv_playing", mode: "hls", at: new Date().toISOString() }),
    );
    expect(res.status).toBe(204);
  });

  it("rejeita evento com tipo desconhecido", async () => {
    const res = await post(
      JSON.stringify({ type: "hack", mode: "hls", at: new Date().toISOString() }),
    );
    expect(res.status).toBe(400);
  });

  it("rejeita JSON inválido e payload gigante", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(10_000))).status).toBe(413);
  });
});
