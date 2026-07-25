import { wireLogout } from "./chrome";

wireLogout();

/**
 * Teste de dispositivos do lobby. getUserMedia SÓ roda após clique explícito;
 * o stream é sempre parado ao sair ou ao clicar em "Parar teste".
 */

const preview = document.getElementById("device-preview") as HTMLVideoElement | null;
const status = document.getElementById("device-status");
const testButton = document.getElementById("test-devices") as HTMLButtonElement | null;
const stopButton = document.getElementById("stop-devices") as HTMLButtonElement | null;

let stream: MediaStream | undefined;

function stopStream(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  if (preview) {
    preview.srcObject = null;
    preview.hidden = true;
  }
  if (testButton) testButton.hidden = false;
  if (stopButton) stopButton.hidden = true;
}

testButton?.addEventListener("click", async () => {
  if (!status) return;
  status.textContent = "Solicitando acesso à câmera e ao microfone…";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (preview) {
      preview.srcObject = stream;
      preview.hidden = false;
    }
    const cams = stream.getVideoTracks().length;
    const mics = stream.getAudioTracks().length;
    status.textContent = `Funcionando: ${cams} câmera(s), ${mics} microfone(s).`;
    if (testButton) testButton.hidden = true;
    if (stopButton) stopButton.hidden = false;
  } catch (err) {
    status.textContent = `Não foi possível acessar os dispositivos: ${err instanceof Error ? err.message : "erro"}. Você ainda pode entrar na festa sem câmera.`;
  }
});

stopButton?.addEventListener("click", stopStream);
window.addEventListener("pagehide", stopStream);

document.getElementById("enter-party")?.addEventListener("click", () => {
  const withCamera = (document.getElementById("join-with-camera") as HTMLInputElement | null)?.checked ?? false;
  stopStream();
  sessionStorage.setItem("joinWithCamera", String(withCamera));
  location.href = "/festa";
});
