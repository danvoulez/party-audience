# Party Audience

Plataforma de vídeo social — MVP em construção por fatias verticais.

**Etapa atual: 0 a 5 parcialmente implementadas.** A homepage, identidade,
sessões, controles de festa, chamadas privadas e transmissão pessoal já têm
fluxos de backend. Os critérios concluídos e as lacunas restantes ficam no
inventário executável [`docs/acceptance.json`](docs/acceptance.json). Mídia em
tempo real depende de credenciais do RealtimeKit; matchmaking (etapa 6) ainda
não foi iniciado.

## Stack

- TypeScript
- Cloudflare Workers (+ Workers Assets para estáticos)
- Player: `iframe` do parceiro ou HLS (`<video>` nativo / hls.js), escolhido por
  configuração server-side validada com zod
- Testes: Vitest (unidade/integração) + Playwright (end-to-end contra
  `wrangler dev`)

## Como executar

```bash
npm install
cp .dev.vars.example .dev.vars   # opcional: configurar a fonte da TV
npm run dev                      # http://localhost:8787
```

Sem `TV_SOURCE` configurada, a homepage funciona e mostra o estado
"TV ainda não foi configurada" — este é o comportamento esperado enquanto não
houver fonte real do parceiro. O formato da configuração e o contrato técnico
esperado do parceiro estão em [`docs/tv-partner-contract.md`](docs/tv-partner-contract.md).

Para validar o player HLS com um stream público de demonstração (não é a TV do
parceiro):

```bash
npx wrangler dev --var 'TV_SOURCE:{"kind":"hls","url":"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"}'
```

## Verificação

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest: unidade + integração (builda o cliente antes)
npm run test:e2e    # playwright: sobe 3 wrangler dev com fontes distintas
npm run verify      # tudo acima em sequência
```

O e2e cobre: TV não configurada (fallback), fluxo de sucesso via iframe,
fluxo de falha via HLS morto (timeout → indisponível → tentar novamente),
responsividade mobile/desktop e a garantia de que a homepage nunca pede
câmera/microfone.

## Deploy

```bash
npx wrangler login
npx wrangler secret put TV_SOURCE   # fonte real do parceiro
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put REALTIMEKIT_APP_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npm run deploy
```

`npm run deploy` reúne o processo inteiro: verifica o projeto, cria ou vincula
o D1, aplica migrations, inspeciona os secrets, publica e confirma `/healthz`.
Para validar apenas o bundle e obter uma lista única do que ainda depende de
acesso externo, sem autenticar nem alterar a conta, use:

```bash
npm run deploy:check
```

O deploy pode subir de forma degradada sem TV ou mídia; o script deixa isso
explícito e reúne ao final os comandos das pendências externas. Para considerar
a experiência completa pronta, também execute manualmente o workflow
`media-contract.yml` com os secrets configurados, validando o provedor real.

## Estrutura

```
src/worker/    Worker: rotas, render da homepage, POST /api/events
src/client/    Player da TV (máquina de estados pura + wiring de DOM)
src/shared/    Schemas zod compartilhados (fonte da TV, eventos de analytics)
public/        Estáticos (CSS; player.js é gerado pelo build, não versionado)
docs/          Contrato técnico do parceiro de TV
test/          Vitest (unidade + integração)
e2e/           Playwright
```

## CI: o que o código faz vs. o que prometemos

`npm run verify` roda exatamente o que o CI roda. Além de tipos, lint e testes,
duas verificações existem para o repositório não mentir sobre si mesmo:

**`docs/acceptance.json`** é o inventário das promessas do plano (Etapas 0 a 6),
legível por máquina. Cada critério de aceite está marcado `verified` — e então
aponta para testes nomeados que precisam existir e passar — ou `pending`, e
aparece no resumo de toda execução do CI.

`scripts/check-promises.mjs` cruza o inventário com o resultado real dos testes
e falha quando ele mente em qualquer direção: promessa `verified` sem teste,
teste renomeado ou apagado, teste que existe mas falha, promessa `pending` que
já tem verificação. Um teste **pulado** também não conta como prova.

```bash
npm run verify                       # tudo, como no CI
node scripts/check-promises.mjs \
  --vitest=reports/vitest.json \
  --playwright=reports/playwright.json \
  --strict-etapa=4                   # trava: exige a etapa 4 inteira verificada
```

`scripts/check-integrity.mjs` pega referência pendurada (todo `docs/*.md` citado
em código precisa existir) e valor de fachada (UUID de zeros, `changeme`), que
só pode existir se declarado em `known_gaps`. A checagem é bidirecional: lacuna
já resolvida também falha, para o inventário não acumular dívida imaginária.

O workflow `media-contract.yml` chama o provedor de mídia **de verdade**, em
agenda diária. É o único mecanismo que detecta o provedor mudando sem ninguém
tocar no nosso código — os testes unitários do gateway usam `fetch` mockado e
passariam verdes contra uma API desligada, que foi como a API legada do Dyte
morreu sem o CI perceber. Sem os secrets configurados ele não contata ninguém e
diz isso em alto e bom som, em vez de passar por omissão.

## Limitações conhecidas desta etapa

- Não há fonte real da TV do parceiro: a produção mostrará o estado
  "não configurada" até `TV_SOURCE` ser definida com um sinal real.
- `dash` é aceito na configuração, mas não tem player implementado.
- `cloudflare_stream` está implementado via embed iframe, mas não foi
  verificado com uma conta Stream real.
- Em modo `iframe`, "playing" significa "iframe carregou" — sem contrato de
  `postMessage` com o parceiro não há sinal real de reprodução.
- Eventos de analytics vão para os logs do Worker; não há persistência em banco.
- Sem rate limiting em `/api/events` nesta etapa (payload é validado e limitado
  a 2 KB); entra junto com identidade/sessões na próxima etapa.
