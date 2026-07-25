import { defineConfig } from "@playwright/test";

/**
 * Três instâncias locais do Worker, cada uma com uma configuração de TV:
 *  - 8791: TV_SOURCE ausente  → estado "não configurada";
 *  - 8792: iframe apontando para o próprio servidor → fluxo de sucesso real;
 *  - 8793: HLS com URL morta e timeout curto → fluxo de falha real.
 */
export const PORTS = { unconfigured: 8791, iframe: 8792, hlsDead: 8793 } as const;

function wranglerDev(port: number, tvSource?: string): string {
  const varFlag = tvSource ? ` --var 'TV_SOURCE:${tvSource}'` : "";
  return `npx wrangler dev --port ${port}${varFlag}`;
}

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  webServer: [
    {
      command: wranglerDev(PORTS.unconfigured),
      url: `http://127.0.0.1:${PORTS.unconfigured}/healthz`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: wranglerDev(
        PORTS.iframe,
        `{"kind":"iframe","embedUrl":"http://127.0.0.1:${PORTS.iframe}/healthz"}`,
      ),
      url: `http://127.0.0.1:${PORTS.iframe}/healthz`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: wranglerDev(
        PORTS.hlsDead,
        '{"kind":"hls","url":"http://127.0.0.1:9990/dead/live.m3u8","timeoutMs":4000}',
      ),
      url: `http://127.0.0.1:${PORTS.hlsDead}/healthz`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
