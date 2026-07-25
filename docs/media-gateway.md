# MediaGateway — Cloudflare RealtimeKit

Áudio e vídeo interativos (festa, chamada privada, transmissão pessoal) não são
servidos pelo Worker: ele só decide **quem pode publicar o quê** e pede ao
provedor um token que carrega essa decisão. A fronteira é a interface
`MediaGateway` em `src/worker/media-gateway.ts`; nenhuma regra de produto fala
com o provedor diretamente.

Sem credenciais, `gatewayFromEnv()` devolve o `UnconfiguredGateway` e toda rota
que precisaria de mídia responde `media: { status: "blocked" }` com instruções.
O app continua funcionando — presença, chat, papéis e permissões são
independentes do plano de mídia. Nada finge funcionar.

## A API mudou: Dyte → Cloudflare

O RealtimeKit nasceu como Dyte e foi migrado para a infraestrutura da
Cloudflare. A API legada **foi descontinuada**:

| | Legado (Dyte) | Atual (Cloudflare) |
|---|---|---|
| Base | `api.dyte.io/v2` | `api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}` |
| Auth | Basic `base64(orgId:apiKey)` | Bearer `<API token>` |
| Credenciais | Organization ID + API Key | Account ID + App ID + API token |
| Token do participante | `data.token` | `result.authToken` |

Se você tem uma organização Dyte antiga, ela precisa ser migrada primeiro (vira
um *App* do RealtimeKit); presets, analytics e histórico são preservados.

## As três variáveis

```
CLOUDFLARE_ACCOUNT_ID   # ID da conta Cloudflare
REALTIMEKIT_APP_ID      # ID do app RealtimeKit dentro da conta
CLOUDFLARE_API_TOKEN    # token com permissão Realtime
```

O token se cria em **My Profile → API Tokens** no dashboard da Cloudflare, com
a permissão **Realtime** (ou **Realtime Admin**) marcada. Account ID e App ID
aparecem na seção Realtime do dashboard da conta.

```bash
# dev — .dev.vars, que está no .gitignore
CLOUDFLARE_ACCOUNT_ID=...
REALTIMEKIT_APP_ID=...
CLOUDFLARE_API_TOKEN=...

# produção
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put REALTIMEKIT_APP_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Com as três presentes o gateway real sobe sozinho; não há mudança de código.
Falta qualquer uma e o gateway permanece desconfigurado — nunca meio ligado.

## Presets: onde a permissão vira realidade

O backend decide as permissões, mas quem as **aplica** no plano de mídia é o
*preset* do RealtimeKit. `createParticipantToken()` escolhe pelo shape das
permissões vindas do banco — nunca por algo enviado pelo cliente:

| Permissão | Preset | Onde aparece |
|---|---|---|
| publica e modera | `group_call_host` | admin da festa, host da transmissão |
| publica sem moderar | `group_call_participant` | participante da festa, os dois lados da chamada |
| não publica áudio nem vídeo | `livestream_viewer` | audiência da transmissão pessoal |

**Atenção:** apps criados pelo dashboard já vêm com `group_call_host` e
`group_call_participant`. O preset de audiência normalmente **não existe por
padrão** e precisa ser criado (dashboard ou API de Presets) — sem ele, festa e
chamada funcionam e só a audiência da transmissão falha.

Se o seu app usa outros nomes, não mexa no código: sobrescreva por env.

```
RTK_PRESET_HOST=...
RTK_PRESET_PARTICIPANT=...
RTK_PRESET_VIEWER=...
```

`CLOUDFLARE_API_BASE` também é sobrescrevível, útil para apontar a um mock em
teste.

## Estado de verificação

O `RealtimeKitGateway` **nunca rodou contra credenciais reais** neste
repositório. O que está coberto por teste (`test/unit/media-gateway.test.ts`)
é o contrato de saída: URL montada, header de autenticação, escolha de preset
por permissão, leitura do `authToken` e tratamento de erro. O que só a primeira
execução com credencial real confirma é se o provedor aceita esse contrato —
em especial se os três presets existem com os nomes configurados.

Ao ligar pela primeira vez, o sinal de sucesso é `media.status` sair de
`blocked` para `ready` em `POST /api/party/join`. Se vier
`blocked` com `reason: "realtimekit_error"`, a `message` traz o status HTTP e o
corpo do erro do provedor.
