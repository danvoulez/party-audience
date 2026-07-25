import type { TvPlayback } from "../shared/tv-source";

/** Evita que `</script>` dentro do JSON encerre o bloco de configuração. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
${body}
</body>
</html>`;
}

export function renderHomePage(playback: TvPlayback): string {
  const unavailableMessage =
    playback.mode === "unavailable" && playback.reason === "unconfigured"
      ? "A TV ainda não foi configurada. Volte em breve."
      : "A TV está fora do ar no momento. Tente novamente em instantes.";

  const body = `
<header class="site-header">
  <span class="brand">Party Audience</span>
  <nav class="auth-actions">
    <a class="button button-ghost" href="/login">Entrar</a>
    <a class="button button-primary" href="/signup">Criar conta</a>
  </nav>
</header>
<main>
  <section id="tv" data-state="${playback.mode === "unavailable" ? "unavailable" : "loading"}" aria-label="TV 24 horas">
    <div id="tv-media"></div>
    <div id="tv-overlay-loading" class="tv-overlay" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <p>Sintonizando a TV…</p>
    </div>
    <div id="tv-overlay-unavailable" class="tv-overlay">
      <p class="tv-unavailable-title">TV indisponível</p>
      <p>${unavailableMessage}</p>
      <button id="tv-retry" class="button button-ghost" type="button">Tentar novamente</button>
    </div>
    <button id="tv-unmute" class="button button-primary tv-unmute" type="button" hidden>Ativar som</button>
  </section>
  <section class="pitch">
    <h1>TV ao vivo, 24 horas por dia.</h1>
    <p>Assista sem cadastro. Crie uma conta para entrar nas festas, chamadas e transmissões — em breve.</p>
  </section>
</main>
<script id="tv-config" type="application/json">${safeJson(playback)}</script>
<script type="module" src="/player.js"></script>`;
  return layout("Party Audience — TV 24h ao vivo", body);
}

export function renderAuthPlaceholder(kind: "login" | "signup"): string {
  const title = kind === "login" ? "Entrar" : "Criar conta";
  const body = `
<header class="site-header">
  <a class="brand" href="/">Party Audience</a>
</header>
<main class="placeholder">
  <h1>${title}</h1>
  <p>Identidade e login serão entregues na próxima etapa. Esta tela ainda não é funcional.</p>
  <a class="button button-primary" href="/">Voltar para a TV</a>
</main>`;
  return layout(`Party Audience — ${title}`, body);
}

export function renderNotFound(): string {
  const body = `
<main class="placeholder">
  <h1>Página não encontrada</h1>
  <a class="button button-primary" href="/">Voltar para a TV</a>
</main>`;
  return layout("Party Audience — 404", body);
}
