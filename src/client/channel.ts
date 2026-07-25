import { postJson, wireLogout } from "./chrome";
import { appendChat, connectRoom, showChatNotice, showMediaAccess, wireChat } from "./room-chat";
import type { RoomServerEvent } from "../shared/api";

wireLogout();

/** Página do canal público /<username>: transmissão ao vivo ou estado offline. */

const config = JSON.parse(document.getElementById("channel-config")?.textContent ?? "{}") as {
  slug?: string;
  isOwner?: boolean;
};

let ws: WebSocket | undefined;

function onEvent(event: RoomServerEvent): void {
  switch (event.type) {
    case "chat":
      appendChat(event.from, event.text);
      break;
    case "chat_rejected":
      showChatNotice(event.reason);
      break;
    case "session_ended":
      location.reload();
      break;
    default:
      break;
  }
}

async function connectIfLive(): Promise<void> {
  if (!config.slug) return;
  const res = await fetch(`/api/channels/${config.slug}`);
  if (res.status !== 200) return;
  const info = (await res.json()) as {
    status: string;
    sessionId: string | null;
    media?: { status: string; reason?: string; message?: string };
  };
  if (info.status === "live" && info.sessionId) {
    showMediaAccess(info.media);
    ws = connectRoom(`/api/sessions/${info.sessionId}/ws`, onEvent);
    wireChat(() => ws);
  }
}

document.getElementById("start-broadcast")?.addEventListener("click", async () => {
  const { status } = await postJson<{ url?: string }>("/api/broadcast/start");
  if (status === 201 || status === 409) location.reload();
});

document.getElementById("stop-broadcast")?.addEventListener("click", async () => {
  await postJson("/api/broadcast/stop");
  location.reload();
});

void connectIfLive();
