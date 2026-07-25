import { postJson, wireLogout } from "./chrome";
import { showMediaAccess } from "./room-chat";

wireLogout();

/**
 * Página da chamada privada. O estado vem do backend; ao encerrar, o usuário
 * volta à festa e a câmera/microfone NÃO religam sem confirmação explícita.
 */

interface CallInfo {
  inviteId: string;
  state: string;
  sessionId?: string;
  caller?: string;
  callee?: string;
  media?: { status: string; reason?: string; message?: string };
  error?: string;
}

const config = JSON.parse(document.getElementById("call-config")?.textContent ?? "{}") as { inviteId?: string };
const statusEl = document.getElementById("call-status");
const endButton = document.getElementById("end-call") as HTMLButtonElement | null;
const backLink = document.getElementById("back-to-party");

let pollTimer: number | undefined;

function describe(info: CallInfo): string {
  switch (info.state) {
    case "ringing":
      return `Chamando ${info.callee ?? ""}… aguardando resposta.`;
    case "accepted":
      return `Em chamada: ${info.caller ?? "?"} e ${info.callee ?? "?"}. Sua mídia na festa está suspensa enquanto durar a chamada.`;
    case "declined":
      return "Chamada recusada.";
    case "cancelled":
      return "Chamada cancelada.";
    case "expired":
      return "Chamada não atendida (tempo esgotado).";
    case "ended":
      return "Chamada encerrada. Ao voltar à festa, religue câmera e microfone quando quiser.";
    default:
      return `Estado: ${info.state}`;
  }
}

async function refresh(): Promise<void> {
  if (!config.inviteId) return;
  const res = await fetch(`/api/calls/${config.inviteId}`);
  if (res.status !== 200) {
    if (statusEl) statusEl.textContent = "Chamada não encontrada.";
    window.clearInterval(pollTimer);
    return;
  }
  const info = (await res.json()) as CallInfo;
  if (statusEl) statusEl.textContent = describe(info);
  const active = info.state === "accepted";
  if (endButton) endButton.hidden = !active && info.state !== "ringing";
  if (endButton) endButton.textContent = info.state === "ringing" ? "Cancelar chamada" : "Encerrar chamada";
  if (backLink) backLink.hidden = active || info.state === "ringing";
  if (active) showMediaAccess(info.media);
  if (["declined", "cancelled", "expired", "ended"].includes(info.state)) {
    window.clearInterval(pollTimer);
  }
}

endButton?.addEventListener("click", async () => {
  if (!config.inviteId) return;
  // Cancela se ainda tocando; encerra se aceita. O backend valida o papel.
  const cancel = await postJson<{ error?: string }>(`/api/calls/${config.inviteId}/cancel`);
  if (cancel.status !== 200) {
    await postJson(`/api/calls/${config.inviteId}/end`);
  }
  await refresh();
});

void refresh();
pollTimer = window.setInterval(() => void refresh(), 2000);
