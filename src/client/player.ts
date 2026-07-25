import type { TvPlayback } from "../shared/tv-source";
import type { PlaybackEvent } from "../shared/events";
import { reduce, type PlayerState } from "./state";
import { wireLogout } from "./chrome";

wireLogout();

/**
 * Player da homepage pública. Regras desta etapa:
 *  - inicia sempre silenciado, som só com gesto do usuário;
 *  - nunca solicita câmera ou microfone;
 *  - se a mídia não iniciar dentro de timeoutMs, mostra o fallback.
 */

function readConfig(): TvPlayback {
  const el = document.getElementById("tv-config");
  if (!el?.textContent) return { mode: "unavailable", reason: "unconfigured" };
  try {
    return JSON.parse(el.textContent) as TvPlayback;
  } catch {
    return { mode: "unavailable", reason: "unconfigured" };
  }
}

function sendEvent(type: PlaybackEvent["type"], mode: PlaybackEvent["mode"], detail?: string): void {
  const body = JSON.stringify({ type, mode, at: new Date().toISOString(), detail });
  try {
    if (navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // sendBeacon indisponível ou recusado — cai para fetch abaixo.
  }
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

class TvPlayer {
  private state: PlayerState = "loading";
  private timeoutHandle: number | undefined;
  private teardown: (() => void) | undefined;

  constructor(
    private readonly config: TvPlayback,
    private readonly root: HTMLElement,
    private readonly media: HTMLElement,
    private readonly unmuteButton: HTMLButtonElement,
  ) {}

  start(): void {
    if (this.config.mode === "unavailable") {
      this.transition("MEDIA_ERROR");
      sendEvent("tv_unavailable", "unavailable", this.config.reason);
      return;
    }
    this.setState("loading");
    sendEvent("tv_loading", this.config.mode);
    this.timeoutHandle = window.setTimeout(() => this.transition("TIMEOUT"), this.config.timeoutMs);
    if (this.config.mode === "iframe") this.startIframe(this.config.src);
    else void this.startHls(this.config.src);
  }

  private transition(event: "MEDIA_PLAYING" | "MEDIA_ERROR" | "TIMEOUT" | "RETRY"): void {
    const next = reduce(this.state, event);
    if (next === this.state) return;
    this.setState(next);
    const mode = this.config.mode;
    if (next === "playing") {
      window.clearTimeout(this.timeoutHandle);
      sendEvent("tv_playing", mode);
    } else if (next === "unavailable") {
      window.clearTimeout(this.timeoutHandle);
      this.teardown?.();
      this.teardown = undefined;
      this.media.replaceChildren();
      sendEvent("tv_unavailable", mode, event === "TIMEOUT" ? "timeout" : "media_error");
    }
  }

  private setState(state: PlayerState): void {
    this.state = state;
    this.root.dataset.state = state;
  }

  private startIframe(src: string): void {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.id = "tv-iframe";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "no-referrer";
    // Limitação documentada: sem contrato postMessage com o parceiro, o evento
    // `load` do iframe é o melhor sinal disponível de que o player subiu.
    iframe.addEventListener("load", () => this.transition("MEDIA_PLAYING"));
    iframe.addEventListener("error", () => this.transition("MEDIA_ERROR"));
    this.media.replaceChildren(iframe);
    // O controle de som fica dentro do player do parceiro.
    this.unmuteButton.hidden = true;
  }

  private async startHls(src: string): Promise<void> {
    const video = document.createElement("video");
    video.id = "tv-video";
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.addEventListener("playing", () => this.transition("MEDIA_PLAYING"));
    video.addEventListener("error", () => this.transition("MEDIA_ERROR"));
    this.media.replaceChildren(video);

    this.unmuteButton.hidden = false;
    this.unmuteButton.addEventListener("click", () => {
      video.muted = false;
      this.unmuteButton.hidden = true;
      sendEvent("tv_unmuted", "hls");
    });

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    const { default: Hls } = await import("hls.js");
    if (!Hls.isSupported()) {
      this.transition("MEDIA_ERROR");
      return;
    }
    const hls = new Hls();
    this.teardown = () => hls.destroy();
    hls.on(Hls.Events.ERROR, (_name, data) => {
      if (data.fatal) this.transition("MEDIA_ERROR");
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  }

  retry(): void {
    this.transition("RETRY");
    sendEvent("tv_retry", this.config.mode === "unavailable" ? "unavailable" : this.config.mode);
    this.start();
  }
}

function main(): void {
  const root = document.getElementById("tv");
  const media = document.getElementById("tv-media");
  const unmuteButton = document.getElementById("tv-unmute");
  const retryButton = document.getElementById("tv-retry");
  if (!root || !media || !(unmuteButton instanceof HTMLButtonElement)) return;

  const player = new TvPlayer(readConfig(), root, media, unmuteButton);
  retryButton?.addEventListener("click", () => player.retry());
  player.start();
}

main();
