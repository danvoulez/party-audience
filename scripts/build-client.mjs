import { build } from "esbuild";

// Gera public/player.js (+ chunk do hls.js carregado sob demanda).
// Artefatos de build não são versionados; ver .gitignore.
await build({
  entryPoints: [
    "src/client/player.ts",
    "src/client/auth.ts",
    "src/client/lobby.ts",
    "src/client/party.ts",
    "src/client/call.ts",
    "src/client/channel.ts",
  ],
  outdir: "public",
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
});
