import type { TvPlayback } from "../shared/tv-source";

/** Evita que `</script>` dentro do JSON encerre o bloco de configuração. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(title: string, body: string, script?: string): string {
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
${script ? `<script type="module" src="${script}"></script>` : ""}
</body>
</html>`;
}

function header(authed: boolean): string {
  const actions = authed
    ? `<a class="button button-ghost" href="/lobby">Lobby</a>
       <button class="button button-ghost" id="logout" type="button">Sair</button>`
    : `<a class="button button-ghost" href="/login">Entrar</a>
       <a class="button button-primary" href="/signup">Criar conta</a>`;
  return `<header class="site-header">
  <a class="brand" href="/">Party Audience</a>
  <nav class="auth-actions">${actions}</nav>
</header>`;
}

export function renderHomePage(playback: TvPlayback, authed: boolean): string {
  const unavailableMessage =
    playback.mode === "unavailable" && playback.reason === "unconfigured"
      ? "A TV ainda não foi configurada. Volte em breve."
      : "A TV está fora do ar no momento. Tente novamente em instantes.";

  const body = `
${header(authed)}
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
    <p>Assista sem cadastro. Entre para participar das festas, chamadas e transmissões.</p>
    <p><a class="button button-primary" href="${authed ? "/lobby" : "/login"}" id="cta-party">Entrar na festa</a></p>
  </section>
</main>
<script id="tv-config" type="application/json">${safeJson(playback)}</script>`;
  return layout("Party Audience — TV 24h ao vivo", body, "/player.js");
}

export function renderAuthPage(kind: "login" | "signup"): string {
  const title = kind === "login" ? "Entrar" : "Criar conta";
  const alt =
    kind === "login"
      ? '<p>Não tem conta? <a href="/signup">Criar conta</a></p>'
      : '<p>Já tem conta? <a href="/login">Entrar</a></p>';
  const body = `
${header(false)}
<main class="narrow">
  <h1>${title}</h1>
  <form id="auth-form" data-kind="${kind}">
    <label>Nome de usuário
      <input name="username" autocomplete="username" required minlength="3" maxlength="20"
             pattern="[a-z0-9][a-z0-9_\\-]{2,19}" title="letras minúsculas, números, _ ou -">
    </label>
    <label>Senha
      <input name="password" type="password" required minlength="8" maxlength="128"
             autocomplete="${kind === "login" ? "current-password" : "new-password"}">
    </label>
    <p class="form-error" id="auth-error" role="alert" hidden></p>
    <button class="button button-primary" type="submit">${title}</button>
  </form>
  ${alt}
</main>`;
  return layout(`Party Audience — ${title}`, body, "/auth.js");
}

export function renderLobbyPage(username: string): string {
  const body = `
${header(true)}
<main class="narrow">
  <h1>Lobby</h1>
  <p>Olá, <strong>${escapeHtml(username)}</strong>. Antes de entrar na festa, teste seus dispositivos.
     A câmera e o microfone <em>só</em> são acessados quando você clica no botão abaixo.</p>
  <section class="device-test">
    <video id="device-preview" muted autoplay playsinline hidden></video>
    <p id="device-status" role="status">Dispositivos ainda não testados.</p>
    <button class="button button-ghost" id="test-devices" type="button">Testar câmera e microfone</button>
    <button class="button button-ghost" id="stop-devices" type="button" hidden>Parar teste</button>
  </section>
  <section class="lobby-actions">
    <label><input type="checkbox" id="join-with-camera"> Entrar com câmera ligada</label>
    <button class="button button-primary" id="enter-party" type="button">Entrar na festa</button>
    <p><a href="/">Voltar para a TV</a></p>
  </section>
</main>`;
  return layout("Party Audience — Lobby", body, "/lobby.js");
}

export function renderPartyPage(username: string): string {
  const body = `
${header(true)}
<main class="room">
  <section class="media-pane">
    <div id="media-blocked" class="notice" hidden></div>
    <div id="media-area" aria-label="Vídeo da festa"></div>
    <div class="media-controls">
      <button class="button button-ghost" id="resume-media" type="button" hidden>Religar minha câmera/microfone</button>
      <button class="button button-ghost" id="leave-party" type="button">Sair da festa</button>
      <button class="button button-ghost" id="start-broadcast" type="button">Iniciar minha transmissão</button>
    </div>
  </section>
  <aside class="side-pane">
    <section>
      <h2>Participantes</h2>
      <ul id="roster" data-me="${escapeHtml(username)}"></ul>
    </section>
    <section class="chat">
      <h2>Chat</h2>
      <ul id="chat-log" aria-live="polite"></ul>
      <form id="chat-form">
        <input id="chat-input" maxlength="500" placeholder="Mensagem…" autocomplete="off">
        <button class="button button-primary" type="submit">Enviar</button>
      </form>
      <p id="chat-notice" role="status" hidden></p>
    </section>
  </aside>
  <div id="ring-banner" class="ring-banner" hidden>
    <span id="ring-text"></span>
    <button class="button button-primary" id="ring-accept" type="button">Aceitar</button>
    <button class="button button-ghost" id="ring-decline" type="button">Recusar</button>
  </div>
  <div id="kicked-overlay" class="full-overlay" hidden>
    <p>Você foi removido da festa por um moderador.</p>
    <a class="button button-primary" href="/">Voltar para a TV</a>
  </div>
</main>`;
  return layout("Party Audience — Festa", body, "/party.js");
}

export function renderCallPage(inviteId: string): string {
  const body = `
${header(true)}
<main class="narrow">
  <h1>Chamada privada</h1>
  <p id="call-status" role="status">Carregando…</p>
  <div id="media-blocked" class="notice" hidden></div>
  <div id="media-area" aria-label="Vídeo da chamada"></div>
  <div class="media-controls">
    <button class="button button-primary" id="end-call" type="button" hidden>Encerrar chamada</button>
    <a class="button button-ghost" href="/festa" id="back-to-party" hidden>Voltar para a festa</a>
  </div>
</main>
<script id="call-config" type="application/json">${safeJson({ inviteId })}</script>`;
  return layout("Party Audience — Chamada privada", body, "/call.js");
}

export function renderChannelPage(input: {
  slug: string;
  status: string;
  isOwner: boolean;
  authed: boolean;
}): string {
  const { slug, status, isOwner, authed } = input;
  const live = status === "live";
  const body = `
${header(authed)}
<main class="room" data-live="${live}">
  <section class="media-pane">
    <h1>@${escapeHtml(slug)} ${live ? '<span class="live-badge">AO VIVO</span>' : ""}</h1>
    <div id="channel-offline" class="notice" ${live ? "hidden" : ""}>
      <p><strong>@${escapeHtml(slug)}</strong> está offline no momento.</p>
      <p><a href="/">Assistir à TV 24h enquanto isso</a></p>
    </div>
    <div id="media-blocked" class="notice" hidden></div>
    <div id="media-area" aria-label="Transmissão"></div>
    ${isOwner ? `<div class="media-controls">
      <button class="button button-primary" id="start-broadcast" type="button" ${live ? "hidden" : ""}>Iniciar transmissão</button>
      <button class="button button-ghost" id="stop-broadcast" type="button" ${live ? "" : "hidden"}>Encerrar transmissão</button>
    </div>` : ""}
  </section>
  <aside class="side-pane" ${live ? "" : "hidden"} id="chat-pane">
    <section class="chat">
      <h2>Chat</h2>
      <ul id="chat-log" aria-live="polite"></ul>
      ${authed
        ? `<form id="chat-form">
             <input id="chat-input" maxlength="500" placeholder="Mensagem…" autocomplete="off">
             <button class="button button-primary" type="submit">Enviar</button>
           </form>
           <p id="chat-notice" role="status" hidden></p>`
        : '<p><a href="/login">Entre</a> para participar do chat.</p>'}
    </section>
  </aside>
</main>
<script id="channel-config" type="application/json">${safeJson({ slug, isOwner })}</script>`;
  return layout(`Party Audience — @${slug}`, body, "/channel.js");
}

export function renderNotFound(): string {
  const body = `
<main class="placeholder">
  <h1>Página não encontrada</h1>
  <a class="button button-primary" href="/">Voltar para a TV</a>
</main>`;
  return layout("Party Audience — 404", body);
}
