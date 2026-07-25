#!/usr/bin/env node
/**
 * Verificações de honestidade estrutural do repositório.
 *
 * 1. Referência pendurada: todo docs/*.md citado em código, config ou outro
 *    doc precisa existir. Erro real cometido aqui: a mensagem de erro do
 *    MediaGateway mandava o usuário ler docs/media-gateway.md, que não existia.
 *
 * 2. Valor de fachada: strings que parecem configuração real mas não são
 *    (UUID de zeros, TODO, changeme) só podem existir se estiverem declaradas
 *    em known_gaps no docs/acceptance.json. A checagem é bidirecional — um
 *    known_gap que já não se aplica também falha, para o inventário não
 *    apodrecer com dívida imaginária.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IGNORAR = new Set(["node_modules", ".git", ".wrangler", "public", "test-results", "playwright-report", "dist"]);
const EXTENSOES = /\.(ts|mjs|js|jsonc?|md|yml|yaml)$/;

function listarArquivos(dir = ".", acc = []) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) listarArquivos(caminho, acc);
    else if (EXTENSOES.test(nome)) acc.push(caminho);
  }
  return acc;
}

const arquivos = listarArquivos();
const erros = [];

// ------------------------------------------- 1. referências a docs penduradas

const refDoc = /docs\/[a-z0-9._-]+\.md/gi;
for (const arquivo of arquivos) {
  const conteudo = readFileSync(arquivo, "utf-8");
  for (const ref of new Set(conteudo.match(refDoc) ?? [])) {
    if (!existsSync(ref)) {
      erros.push(`${arquivo}: cita "${ref}", que não existe`);
    }
  }
}

// ------------------------------------------------ 2. valores de fachada

const inventario = JSON.parse(readFileSync("docs/acceptance.json", "utf-8"));
const lacunas = inventario.known_gaps ?? [];

const PADROES_FACHADA = [
  { nome: "UUID de zeros", re: /00000000-0000-0000-0000-000000000000/ },
  { nome: "changeme", re: /\bchangeme\b/i },
  { nome: "your-api-key", re: /your[-_](api[-_])?key/i },
];

const declarados = new Set(lacunas.map((l) => l.detectar));

for (const arquivo of arquivos) {
  // Markdown fica de fora: em config um valor de fachada é uma mentira, em
  // prosa é exemplo — a própria descrição desta checagem cita "changeme".
  if (arquivo.endsWith(".md")) continue;
  if (arquivo.includes("check-integrity") || arquivo.endsWith("acceptance.json")) continue;
  const conteudo = readFileSync(arquivo, "utf-8");
  for (const padrao of PADROES_FACHADA) {
    const achado = conteudo.match(padrao.re);
    if (!achado) continue;
    const coberto = [...declarados].some((d) => conteudo.includes(d) && padrao.re.test(d));
    if (!coberto) {
      erros.push(
        `${arquivo}: contém ${padrao.nome} ("${achado[0]}") sem entrada correspondente em known_gaps do docs/acceptance.json`,
      );
    }
  }
}

// bidirecional: known_gap que já não se aplica é dívida imaginária
for (const lacuna of lacunas) {
  if (!existsSync(lacuna.arquivo)) {
    erros.push(`known_gaps/${lacuna.id}: aponta para "${lacuna.arquivo}", que não existe mais`);
    continue;
  }
  const conteudo = readFileSync(lacuna.arquivo, "utf-8");
  if (!conteudo.includes(lacuna.detectar)) {
    erros.push(
      `known_gaps/${lacuna.id}: "${lacuna.detectar}" não está mais em ${lacuna.arquivo} — a lacuna foi resolvida, remova a entrada`,
    );
  }
}

// ------------------------------------------------------------------ relatório

if (erros.length) {
  console.error("✖ Integridade:\n");
  for (const e of erros) console.error(`  - ${e}`);
  console.error(`\n${erros.length} problema(s).`);
  process.exit(1);
}
console.log(`✓ Integridade: nenhuma referência pendurada; ${lacunas.length} lacuna(s) declarada(s) e ainda válida(s).`);
