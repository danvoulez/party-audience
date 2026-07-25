import type { RoomServerEvent } from "../shared/api";
import type { MediaAccess } from "../shared/api";
import { mountRealtimeKit } from "./realtime";

/** Conexão WebSocket + chat compartilhados entre festa, chamada e canal. */

export function connectRoom(
  wsPath: string,
  onEvent: (event: RoomServerEvent) => void,
): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}${wsPath}`);
  ws.addEventListener("message", (e) => {
    try {
      onEvent(JSON.parse(String(e.data)) as RoomServerEvent);
    } catch {
      // mensagem malformada: ignora
    }
  });
  return ws;
}

export function wireChat(ws: () => WebSocket | undefined): void {
  const form = document.getElementById("chat-form") as HTMLFormElement | null;
  const input = document.getElementById("chat-input") as HTMLInputElement | null;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input?.value.trim();
    const socket = ws();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "chat", text }));
    if (input) input.value = "";
  });
}

export function appendChat(from: string, text: string): void {
  const log = document.getElementById("chat-log");
  if (!log) return;
  const li = document.createElement("li");
  const strong = document.createElement("strong");
  strong.textContent = `${from}: `;
  li.append(strong, document.createTextNode(text));
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

export function showChatNotice(reason: string): void {
  const notice = document.getElementById("chat-notice");
  if (!notice) return;
  notice.textContent =
    reason === "rate_limited"
      ? "Calma! Você está enviando mensagens rápido demais."
      : reason === "not_allowed"
        ? "Você não tem permissão para escrever neste chat."
        : "Mensagem inválida.";
  notice.hidden = false;
  setTimeout(() => {
    notice.hidden = true;
  }, 4000);
}

export function showMediaAccess(
  media: MediaAccess | undefined,
  defaults = { audio: true, video: true },
): void {
  const blocked = document.getElementById("media-blocked");
  if (!blocked) return;
  if (!media) {
    blocked.hidden = false;
    blocked.textContent = "Vídeo indisponível: o servidor não entregou acesso à sala.";
    return;
  }
  void mountRealtimeKit(media, defaults).catch((error: unknown) => {
    blocked.hidden = false;
    blocked.textContent = `Não foi possível abrir o vídeo: ${error instanceof Error ? error.message : "erro desconhecido"}`;
  });
}
