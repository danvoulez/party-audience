import { postJson, wireLogout } from "./chrome";
import { appendChat, connectRoom, showChatNotice, showMediaAccess, wireChat } from "./room-chat";
import type { MediaAccess, RoomServerEvent } from "../shared/api";
import type { Permissions } from "../shared/domain";

wireLogout();

interface JoinResponse {
  sessionId: string;
  role: string;
  perms: Permissions;
  wsPath: string;
  media: MediaAccess;
  error?: string;
  detail?: string;
}

let ws: WebSocket | undefined;
let myPerms: Permissions | undefined;
let canModerate = false;

const me = document.getElementById("roster")?.dataset.me ?? "";

function renderRoster(users: { username: string; role: string }[]): void {
  const roster = document.getElementById("roster");
  if (!roster) return;
  roster.replaceChildren();
  for (const u of users) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${u.username}${u.role === "party_admin" ? " (admin)" : ""}`;
    li.append(name);
    if (u.username !== me) {
      const call = document.createElement("button");
      call.type = "button";
      call.className = "button button-ghost small";
      call.textContent = "Chamar no privado";
      call.dataset.action = "call";
      call.dataset.username = u.username;
      li.append(call);
      if (canModerate) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "button button-ghost small";
        kick.textContent = "Remover";
        kick.dataset.action = "kick";
        kick.dataset.username = u.username;
        li.append(kick);
      }
    }
    roster.append(li);
  }
}

let roster: { username: string; role: string }[] = [];

function upsertRosterUser(username: string, role: string): void {
  if (!roster.some((u) => u.username === username)) roster.push({ username, role });
  renderRoster(roster);
}

function updateResumeButton(): void {
  const btn = document.getElementById("resume-media") as HTMLButtonElement | null;
  if (!btn || !myPerms) return;
  btn.hidden = myPerms.canPublishAudio && myPerms.canPublishVideo;
}

function onEvent(event: RoomServerEvent): void {
  switch (event.type) {
    case "roster":
      roster = event.users;
      renderRoster(roster);
      break;
    case "presence_join":
      upsertRosterUser(event.username, event.role);
      break;
    case "presence_leave":
      roster = roster.filter((u) => u.username !== event.username);
      renderRoster(roster);
      break;
    case "chat":
      appendChat(event.from, event.text);
      break;
    case "chat_rejected":
      showChatNotice(event.reason);
      break;
    case "call_invite":
      showRing(event.inviteId, event.from);
      break;
    case "call_state":
      if (event.state === "accepted" && event.sessionId) {
        location.href = `/chamada/${event.inviteId}`;
      } else if (event.state === "declined") {
        appendChat("sistema", "Convite de chamada recusado.");
      }
      break;
    case "perms_updated":
      myPerms = event.perms;
      updateResumeButton();
      break;
    case "kicked": {
      const overlay = document.getElementById("kicked-overlay");
      if (overlay) overlay.hidden = false;
      ws?.close();
      break;
    }
    case "session_ended":
      location.href = "/";
      break;
  }
}

let ringInviteId: string | undefined;

function showRing(inviteId: string, from: string): void {
  ringInviteId = inviteId;
  const banner = document.getElementById("ring-banner");
  const text = document.getElementById("ring-text");
  if (text) text.textContent = `${from} está te chamando no privado.`;
  if (banner) banner.hidden = false;
}

function hideRing(): void {
  ringInviteId = undefined;
  const banner = document.getElementById("ring-banner");
  if (banner) banner.hidden = true;
}

document.getElementById("ring-accept")?.addEventListener("click", async () => {
  if (!ringInviteId) return;
  const inviteId = ringInviteId;
  const { status } = await postJson<{ sessionId?: string }>(`/api/calls/${inviteId}/accept`);
  hideRing();
  if (status === 200) location.href = `/chamada/${inviteId}`;
});

document.getElementById("ring-decline")?.addEventListener("click", async () => {
  if (!ringInviteId) return;
  await postJson(`/api/calls/${ringInviteId}/decline`);
  hideRing();
});

document.getElementById("roster")?.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const username = target.dataset.username;
  if (!username) return;
  if (target.dataset.action === "call") {
    const { status, data } = await postJson<{ inviteId?: string; error?: string }>("/api/calls", { username });
    if (status === 201) appendChat("sistema", `Chamando ${username}…`);
    else appendChat("sistema", `Não foi possível chamar ${username}: ${data.error ?? status}`);
  }
  if (target.dataset.action === "kick") {
    const { status, data } = await postJson<{ error?: string }>("/api/party/kick", { username });
    if (status !== 200) appendChat("sistema", `Falha ao remover: ${data.error ?? status}`);
  }
});

document.getElementById("leave-party")?.addEventListener("click", async () => {
  await postJson("/api/party/leave");
  ws?.close();
  location.href = "/";
});

document.getElementById("start-broadcast")?.addEventListener("click", async () => {
  const { status, data } = await postJson<{ url?: string; error?: string }>("/api/broadcast/start");
  if ((status === 201 || status === 409) && (data.url || status === 409)) {
    const meResponse = await fetch("/api/me").then((r) => r.json() as Promise<{ channel: { slug: string } }>);
    location.href = data.url ?? `/${meResponse.channel.slug}`;
  } else {
    appendChat("sistema", `Não foi possível iniciar a transmissão: ${data.error ?? status}`);
  }
});

document.getElementById("resume-media")?.addEventListener("click", async () => {
  const { status, data } = await postJson<{ perms?: Permissions; error?: string }>("/api/party/media/resume");
  if (status === 200 && data.perms) {
    myPerms = data.perms;
    updateResumeButton();
    appendChat("sistema", "Permissões de câmera/microfone restauradas.");
  }
});

async function main(): Promise<void> {
  const { status, data } = await postJson<JoinResponse>("/api/party/join");
  if (status !== 200) {
    if (status === 401) {
      location.href = "/login";
      return;
    }
    const blocked = document.getElementById("media-blocked");
    if (blocked) {
      blocked.hidden = false;
      blocked.textContent = data.detail ?? data.error ?? "A festa não abriu porque a mídia falhou.";
    }
    return;
  }
  myPerms = data.perms;
  canModerate = data.perms.canModerate;
  updateResumeButton();
  showMediaAccess(data.media, {
    audio: data.perms.canPublishAudio,
    video: data.perms.canPublishVideo && sessionStorage.getItem("joinWithCamera") === "true",
  });
  ws = connectRoom(data.wsPath, onEvent);
  wireChat(() => ws);
}

void main();
