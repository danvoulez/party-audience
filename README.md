# Party Audience

Plataforma de vídeo social — MVP em construção por fatias verticais.

**Etapa atual: 0 + 1 — homepage pública com TV 24h externa.**
Festa em grupo, chamadas privadas, transmissão pessoal e matchmaking ainda
**não** foram iniciados. As telas `/login` e `/signup` são placeholders que
declaram isso explicitamente.

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
npm run deploy
npx wrangler secret put TV_SOURCE   # fonte real do parceiro
```

Não verificado neste ambiente (sem credenciais Cloudflare).

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
