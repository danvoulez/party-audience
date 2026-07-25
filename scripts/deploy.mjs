#!/usr/bin/env node
/**
 * Deploy para a Cloudflare, do zero ao ar, sem passo manual.
 *
 * Faz na ordem: confere credencial, roda a verificação, resolve o D1 real
 * (cria se não existir), aplica a migration remota, publica e só então declara
 * sucesso — confirmando /healthz na URL publicada. Se o smoke test falhar, o
 * deploy é reportado como falho mesmo tendo subido.
 *
 * É idempotente: rodar de novo com o banco já criado e a migration já aplicada
 * não duplica nada.
 *
 *   node scripts/deploy.mjs [--dry-run] [--skip-verify]
 *
 *   --dry-run      só o preflight, não cria nem publica nada
 *   --skip-verify  pula tipos/lint/testes (use quando acabou de rodar)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const skipVerify = flags.has("--skip-verify");

const PLACEHOLDER_DB_ID = "00000000-0000-0000-0000-000000000000";
const DB_NAME = "party-audience";

let passo = 0;
const titulo = (t) => console.log(`\n\x1b[1m${++passo}. ${t}\x1b[0m`);
const ok = (m) => console.log(`   \x1b[32m✓\x1b[0m ${m}`);
const aviso = (m) => console.log(`   \x1b[33m!\x1b[0m ${m}`);

function morrer(mensagem, detalhe) {
  console.error(`\n\x1b[31m✖ ${mensagem}\x1b[0m`);
  if (detalhe) console.error(`\n${detalhe}`);
  process.exit(1);
}

function run(cmd, args, { silencioso = false, tolerante = false } = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf-8",
      stdio: silencioso ? "pipe" : ["inherit", "pipe", "inherit"],
    });
  } catch (erro) {
    if (tolerante) return null;
    morrer(`falhou: ${cmd} ${args.join(" ")}`, erro.stdout || erro.message);
  }
}

const wrangler = (args, opts) => run("npx", ["wrangler", ...args], opts);

// ------------------------------------------------------------- 1. credencial

titulo("Credencial");
const quem = wrangler(["whoami"], { silencioso: true, tolerante: true });
if (!quem || /not authenticated/i.test(quem)) {
  morrer(
    "wrangler não está autenticado.",
    [
      "Duas formas, qualquer uma serve:",
      "",
      "  a) Máquina com navegador:",
      "       npx wrangler login",
      "",
      "  b) Sem navegador (container, CI):",
      "       export CLOUDFLARE_API_TOKEN=...   # precisa de Workers Scripts:Edit e D1:Edit",
      "       export CLOUDFLARE_ACCOUNT_ID=...",
      "",
      "Token se cria em: My Profile > API Tokens no dashboard da Cloudflare.",
    ].join("\n"),
  );
}
const conta = quem.match(/associated with the email ([^\s.]+)/i)?.[1];
ok(conta ? `autenticado como ${conta}` : "autenticado");

// ------------------------------------------------------------ 2. verificação

titulo("Verificação");
if (skipVerify) {
  aviso("pulada por --skip-verify");
} else {
  run("npm", ["run", "verify"], { silencioso: true });
  ok("tipos, lint, integridade, testes e promessas — verde");
}

// -------------------------------------------------------------------- 3. D1

titulo("Banco D1");
const config = readFileSync("wrangler.jsonc", "utf-8");
let databaseId = config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];

if (databaseId && databaseId !== PLACEHOLDER_DB_ID) {
  ok(`já configurado (${databaseId})`);
} else if (dryRun) {
  aviso(`database_id ainda é placeholder; o deploy real criaria/vincularia "${DB_NAME}"`);
} else {
  // Reaproveita o banco se ele já existir na conta; só cria quando falta.
  const lista = wrangler(["d1", "list", "--json"], { silencioso: true, tolerante: true });
  let existente = null;
  try {
    existente = (JSON.parse(lista ?? "[]") ?? []).find((d) => d.name === DB_NAME) ?? null;
  } catch {
    existente = null;
  }

  if (existente) {
    databaseId = existente.uuid ?? existente.database_id ?? existente.id;
    ok(`banco "${DB_NAME}" já existe na conta`);
  } else {
    const criado = wrangler(["d1", "create", DB_NAME], { silencioso: true });
    databaseId = criado.match(/([0-9a-f-]{36})/i)?.[1];
    if (!databaseId) morrer("D1 criado mas não consegui extrair o database_id da saída.", criado);
    ok(`banco "${DB_NAME}" criado`);
  }

  writeFileSync("wrangler.jsonc", config.replace(PLACEHOLDER_DB_ID, databaseId));
  ok(`database_id gravado no wrangler.jsonc (${databaseId})`);
  aviso("commite essa mudança: o placeholder era uma lacuna declarada em docs/acceptance.json");
}

// -------------------------------------------------------------- 4. migration

titulo("Migration remota");
if (dryRun) {
  aviso("não aplicada (--dry-run)");
} else {
  const pendentes = wrangler(["d1", "migrations", "list", DB_NAME, "--remote"], {
    silencioso: true,
    tolerante: true,
  });
  if (pendentes && /no migrations to apply/i.test(pendentes)) {
    ok("já aplicada, nada a fazer");
  } else {
    wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"], { silencioso: true });
    ok("aplicada");
  }
}

// ---------------------------------------------------- 5. o que sobe degradado

titulo("O que sobe funcionando");
const segredos = wrangler(["secret", "list"], { silencioso: true, tolerante: true }) ?? "";
const tem = (nome) => segredos.includes(nome);

const midiaPronta = tem("CLOUDFLARE_ACCOUNT_ID") && tem("REALTIMEKIT_APP_ID") && tem("CLOUDFLARE_API_TOKEN");

// A TV é um encaixe: quando houver fonte, é uma variável e pronto, sem deploy
// de código. Até lá a homepage mostra o estado "não configurada".
if (tem("TV_SOURCE")) {
  ok("TV 24h: fonte configurada");
} else {
  ok("TV 24h: encaixe pronto e vazio — quando houver sinal, wrangler secret put TV_SOURCE");
}

if (midiaPronta) {
  ok("mídia interativa: credenciais presentes");
} else {
  aviso("mídia interativa: sem credenciais, áudio e vídeo sobem bloqueados (docs/media-gateway.md)");
}
ok("identidade, sessões, festa, chamadas, transmissão e chat: funcionam sem depender do acima");

// ------------------------------------------------------------------ 6. deploy

titulo("Publicação");
if (dryRun) {
  const saida = wrangler(["deploy", "--dry-run"], { silencioso: true });
  ok("build de deploy válido");
  console.log(saida.split("\n").filter((l) => l.includes("env.") || l.includes("Total Upload")).join("\n"));
  console.log("\n\x1b[1m--dry-run: nada foi criado nem publicado.\x1b[0m");
  process.exit(0);
}

run("npm", ["run", "build:client"], { silencioso: true });
const saidaDeploy = wrangler(["deploy"], { silencioso: true });
const url = saidaDeploy.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
ok(url ? `publicado em ${url}` : "publicado");

// -------------------------------------------------------------- 7. smoke test

titulo("Confirmação no ar");
if (!url) {
  aviso("não achei a URL na saída do wrangler; confirme /healthz manualmente");
  process.exit(0);
}

// Um deploy que subiu mas não responde não é um deploy bem-sucedido.
let saude = null;
for (let tentativa = 1; tentativa <= 5; tentativa++) {
  const corpo = run("curl", ["-sS", "--max-time", "15", `${url}/healthz`], {
    silencioso: true,
    tolerante: true,
  });
  try {
    saude = JSON.parse(corpo ?? "");
    break;
  } catch {
    if (tentativa < 5) execFileSync("sleep", ["3"]);
  }
}

if (!saude) morrer(`publicado em ${url}, mas /healthz não respondeu JSON válido.`);
if (saude.db !== true) {
  morrer(
    `publicado em ${url}, mas /healthz diz db:false — o binding do D1 não chegou.`,
    JSON.stringify(saude, null, 2),
  );
}

ok(`/healthz responde: ${JSON.stringify(saude)}`);
console.log(`\n\x1b[1m\x1b[32mNo ar:\x1b[0m ${url}`);
console.log(`   TV em "não configurada" (não temos fonte ainda) e mídia ${midiaPronta ? "ativa" : "bloqueada"}.`);
