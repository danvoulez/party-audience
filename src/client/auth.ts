import { postJson, wireLogout } from "./chrome";

wireLogout();

const form = document.getElementById("auth-form") as HTMLFormElement | null;
const errorEl = document.getElementById("auth-error") as HTMLParagraphElement | null;

const ERROR_MESSAGES: Record<string, string> = {
  username_taken: "Este nome de usuário já está em uso.",
  invalid_credentials: "Usuário ou senha incorretos.",
  account_locked: "Conta temporariamente bloqueada por tentativas demais. Tente em alguns minutos.",
  invalid_input: "Dados inválidos. Verifique usuário e senha.",
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = form.dataset.kind === "signup" ? "signup" : "login";
  const data = new FormData(form);
  const { status, data: body } = await postJson<{ error?: string; detail?: string }>(`/api/${kind}`, {
    username: String(data.get("username") ?? ""),
    password: String(data.get("password") ?? ""),
  });
  if (status === 200) {
    location.href = "/lobby";
    return;
  }
  if (errorEl) {
    errorEl.textContent = body.detail ?? ERROR_MESSAGES[body.error ?? ""] ?? "Erro inesperado. Tente novamente.";
    errorEl.hidden = false;
  }
});
