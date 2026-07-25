# Party Audience

Aplicação social de vídeo sobre Cloudflare:

- festa em grupo (`/festa`);
- chamada privada 1:1 (`/chamada/:id`);
- transmissão pessoal 1:n (`/<username>`);
- identidade e estado em D1;
- presença e chat em Durable Objects;
- áudio e vídeo com Cloudflare RealtimeKit.

## Infraestrutura

O Worker cria reuniões e participantes pela API da Cloudflare. O navegador usa
`@cloudflare/realtimekit` e `@cloudflare/realtimekit-ui` para entrar na reunião.

Variáveis obrigatórias para mídia:

```text
CLOUDFLARE_ACCOUNT_ID
REALTIMEKIT_APP_ID
CLOUDFLARE_API_TOKEN
```

O token da API precisa da permissão `Realtime` ou `Realtime Admin`. Os presets
usados por padrão são:

```text
group-call-host
group-call-participant
livestream-host
livestream-viewer
```

Veja [docs/media-gateway.md](docs/media-gateway.md) para os endpoints e
sobrescritas de preset.

## Desenvolvimento

```bash
npm install
npm run dev
```

Para testar vídeo localmente, crie `.dev.vars` com as três variáveis acima.
Sem elas, as rotas de festa, chamada e transmissão devolvem
`media_unavailable`; não existe sucesso simulado.

`TV_SOURCE` é opcional e controla apenas o player público da homepage. Não é a
infraestrutura de festa/chamada/transmissão.

## Verificação

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:media   # contrato real; exige credenciais Cloudflare
```

Os testes locais cobrem lógica e contrato HTTP. `test:media` cria uma reunião
real e participantes reais para os quatro presets; ele falha se as credenciais
não existirem.

## Deploy

```bash
# Provisiona o App/presets na API real (idempotente).
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."
export REALTIMEKIT_APP_ID="..." # opcional; cria/reusa party-audience-production quando ausente
npm run provision:media

# Instala as mesmas credenciais no Worker.
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put REALTIMEKIT_APP_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npm run deploy
```

O deploy:

1. verifica tipos, lint e testes;
2. cria ou vincula o D1 e aplica as migrations;
3. recusa publicar se os três secrets do RealtimeKit não existirem;
4. publica o Worker;
5. exige `/healthz` com `db: true` e `media: true`.

## Estrutura

```text
src/worker/   API, autenticação, D1, Durable Objects e RealtimeKit
src/client/   UI, chat, chamadas e montagem do RealtimeKit UI Kit
src/shared/   contratos compartilhados
migrations/   schema D1
test/         unidade, integração e contrato real
e2e/          testes no navegador
```
