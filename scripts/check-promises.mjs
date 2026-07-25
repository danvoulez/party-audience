#!/usr/bin/env node
/**
 * Confere docs/acceptance.json contra o resultado REAL dos testes.
 *
 * O objetivo é impedir que o repositório afirme cumprir uma promessa do plano
 * sem ter um teste que passe provando isso. Falha quando:
 *
 *   - uma promessa 'verified' não lista nenhum teste;
 *   - um teste listado não existe (renomeado ou apagado) — cobertura não some
 *     em silêncio;
 *   - um teste listado existe mas não passou;
 *   - uma promessa 'pending' lista testes (deveria ter sido promovida);
 *   - o status é desconhecido ou o id se repete.
 *
 * Promessas 'pending' NÃO derrubam o build: são a distância honesta entre o
 * plano e o código, e aparecem no resumo de toda execução. Para travar uma
 * etapa como concluída, use --strict-etapa=N.
 *
 * Uso:
 *   node scripts/check-promises.mjs --vitest=<json> --playwright=<json> [--strict-etapa=N]
 */

import { readFileSync, appendFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const inventory = JSON.parse(readFileSync("docs/acceptance.json", "utf-8"));

/** @returns {Map<string, "passed"|"failed">} nome do teste -> resultado */
function loadVitest(path) {
  const out = new Map();
  if (!path) return out;
  const report = JSON.parse(readFileSync(path, "utf-8"));
  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      out.set(`vitest::${t.fullName}`, t.status === "passed" ? "passed" : "failed");
    }
  }
  return out;
}

function loadPlaywright(path) {
  const out = new Map();
  if (!path) return out;
  const report = JSON.parse(readFileSync(path, "utf-8"));
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      out.set(`e2e::${spec.title}`, spec.ok ? "passed" : "failed");
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

const results = new Map([
  ...loadVitest(args.vitest),
  ...loadPlaywright(args.playwright),
]);

const errors = [];
const pending = [];
const verified = [];
const seen = new Set();

for (const p of inventory.promises) {
  if (seen.has(p.id)) errors.push(`${p.id}: id repetido no inventário`);
  seen.add(p.id);

  const refs = p.verified_by ?? [];

  if (p.status === "verified") {
    if (refs.length === 0) {
      errors.push(`${p.id}: marcada como 'verified' sem nenhum teste em verified_by`);
      continue;
    }
    for (const ref of refs) {
      const result = results.get(ref);
      if (result === undefined) {
        errors.push(`${p.id}: o teste "${ref}" não existe — foi renomeado ou apagado?`);
      } else if (result !== "passed") {
        errors.push(`${p.id}: o teste "${ref}" existe mas NÃO passou`);
      }
    }
    verified.push(p);
  } else if (p.status === "pending") {
    if (refs.length > 0) {
      errors.push(`${p.id}: marcada como 'pending' mas lista testes — promova para 'verified'`);
    }
    pending.push(p);
  } else {
    errors.push(`${p.id}: status desconhecido "${p.status}"`);
  }
}

// Trava opcional: exige que uma etapa inteira esteja verificada.
const strict = args["strict-etapa"];
if (strict) {
  const abertas = pending.filter((p) => String(p.etapa) === String(strict));
  for (const p of abertas) {
    errors.push(`--strict-etapa=${strict}: "${p.id}" ainda está pendente`);
  }
}

// ------------------------------------------------------------------ relatório

const porEtapa = new Map();
for (const p of inventory.promises) {
  const k = String(p.etapa);
  if (!porEtapa.has(k)) porEtapa.set(k, { verified: 0, pending: 0 });
  porEtapa.get(k)[p.status === "verified" ? "verified" : "pending"] += 1;
}

const linhas = [];
linhas.push("## Promessas do plano vs. código\n");
linhas.push(`**${verified.length} verificadas · ${pending.length} pendentes** de ${inventory.promises.length}\n`);
linhas.push("| Etapa | Verificadas | Pendentes |");
linhas.push("| --- | --- | --- |");
for (const [etapa, c] of porEtapa) {
  linhas.push(`| ${etapa} | ${c.verified} | ${c.pending || ""} |`);
}

if (pending.length) {
  linhas.push("\n### Ainda não cumpridas\n");
  linhas.push("O plano promete, o código ainda não entrega:\n");
  for (const p of pending) {
    linhas.push(`- **${p.id}** (etapa ${p.etapa}) — ${p.criterio}`);
    if (p.nota) linhas.push(`  <br><sub>${p.nota}</sub>`);
  }
}

if (errors.length) {
  linhas.push("\n### Inventário inconsistente\n");
  for (const e of errors) linhas.push(`- ${e}`);
}

const relatorio = linhas.join("\n");
console.log(relatorio);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, relatorio + "\n");
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} inconsistência(s): o inventário não corresponde aos testes.`);
  process.exit(1);
}
console.log(`\n✓ Inventário confere. ${pending.length} promessa(s) ainda pendente(s) — visível, não escondido.`);
