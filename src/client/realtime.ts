import RealtimeKitClient from "@cloudflare/realtimekit";
import { defineCustomElements } from "@cloudflare/realtimekit-ui/loader";
import type { MediaAccess } from "../shared/api";

defineCustomElements(window);

interface RtkMeetingElement extends HTMLElement {
  meeting?: Awaited<ReturnType<typeof RealtimeKitClient.init>>;
  showSetupScreen?: boolean;
}

export interface MediaDefaults {
  audio: boolean;
  video: boolean;
}

/**
 * Inicializa o SDK oficial da Cloudflare e entrega a reunião ao UI Kit.
 * O authToken é emitido pelo Worker para este usuário e esta reunião.
 */
export async function mountRealtimeKit(
  media: MediaAccess,
  defaults: MediaDefaults,
): Promise<void> {
  const area = document.getElementById("media-area");
  const blocked = document.getElementById("media-blocked");
  if (!area) return;

  if (media.status === "blocked") {
    if (blocked) {
      blocked.hidden = false;
      blocked.textContent =
        media.reason === "realtimekit_error"
          ? `Vídeo indisponível: ${media.message}`
          : "Vídeo indisponível: RealtimeKit ainda não foi configurado no Worker.";
    }
    area.replaceChildren();
    return;
  }

  if (blocked) blocked.hidden = true;
  const meeting = await RealtimeKitClient.init({
    authToken: media.token,
    defaults,
  });

  const element = document.createElement("rtk-meeting") as RtkMeetingElement;
  element.id = "realtimekit-meeting";
  element.showSetupScreen = defaults.audio || defaults.video;
  element.meeting = meeting;
  area.replaceChildren(element);
}
