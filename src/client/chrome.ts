/** Comportos comuns do chrome da página (header). */

export function wireLogout(): void {
  document.getElementById("logout")?.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    location.href = "/";
  });
}

export async function postJson<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}
