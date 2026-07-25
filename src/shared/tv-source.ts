import { z } from "zod";

/**
 * Contrato de configuração da TV 24h externa.
 *
 * A fonte é definida server-side (variável de ambiente TV_SOURCE, JSON).
 * O cliente recebe apenas o resultado já resolvido (`TvPlayback`), nunca a
 * configuração bruta nem credenciais.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/** URLs http:// são aceitas apenas para loopback (dev/testes). */
const streamUrl = z
  .string()
  .url()
  .refine((raw) => {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  }, "URL deve ser https:// (http:// permitido apenas para localhost)");

const timeoutMs = z.number().int().min(1_000).max(60_000).default(DEFAULT_TIMEOUT_MS);

export const tvSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("iframe"), embedUrl: streamUrl, timeoutMs }),
  z.object({ kind: z.literal("hls"), url: streamUrl, timeoutMs }),
  z.object({ kind: z.literal("dash"), url: streamUrl, timeoutMs }),
  z.object({
    kind: z.literal("cloudflare_stream"),
    customerSubdomain: z.string().regex(/^[a-z0-9-]+$/),
    videoId: z.string().regex(/^[a-z0-9]+$/),
    timeoutMs,
  }),
]);

export type TvSource = z.infer<typeof tvSourceSchema>;

/**
 * O que o cliente recebe. Discriminado por `mode`:
 *  - "iframe": player embutido do parceiro (inclui cloudflare_stream);
 *  - "hls": reprodução HLS via <video> + hls.js;
 *  - "unavailable": nada reproduzível — o motivo distingue "não configurado"
 *    de "formato aceito no contrato mas ainda sem player implementado" (dash).
 */
export type TvPlayback =
  | { mode: "iframe"; src: string; timeoutMs: number }
  | { mode: "hls"; src: string; timeoutMs: number }
  | { mode: "unavailable"; reason: "unconfigured" | "unsupported_format" };

/**
 * Interpreta a variável de ambiente TV_SOURCE. Ausente, inválida ou mal
 * formada nunca derruba a página: vira estado "unconfigured".
 */
export function parseTvSource(raw: string | undefined): TvSource | undefined {
  if (!raw || raw.trim() === "") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = tvSourceSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

export function resolvePlayback(source: TvSource | undefined): TvPlayback {
  if (!source) return { mode: "unavailable", reason: "unconfigured" };
  switch (source.kind) {
    case "iframe":
      return { mode: "iframe", src: source.embedUrl, timeoutMs: source.timeoutMs };
    case "hls":
      return { mode: "hls", src: source.url, timeoutMs: source.timeoutMs };
    case "cloudflare_stream":
      return {
        mode: "iframe",
        src: `https://${source.customerSubdomain}.cloudflarestream.com/${source.videoId}/iframe?muted=true&autoplay=true`,
        timeoutMs: source.timeoutMs,
      };
    case "dash":
      // Aceito no contrato de configuração, mas sem player nesta etapa.
      return { mode: "unavailable", reason: "unsupported_format" };
  }
}
