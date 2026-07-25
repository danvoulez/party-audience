# Cloudflare RealtimeKit

Festa, chamada privada e transmissão usam a plataforma RealtimeKit da
Cloudflare.

## API usada pelo Worker

Base:

```text
https://api.cloudflare.com/client/v4/accounts/{account_id}/realtime/kit/{app_id}
```

Operações:

```text
POST  /meetings
POST  /meetings/{meeting_id}/participants
PATCH /meetings/{meeting_id}
```

O Worker lê o ID da reunião em `data.id` e o token do participante em
`data.token`. A autenticação é `Authorization: Bearer <CLOUDFLARE_API_TOKEN>`.
O token precisa de `Realtime` ou `Realtime Admin`.

## Configuração

Desenvolvimento (`.dev.vars`):

```text
CLOUDFLARE_ACCOUNT_ID=...
REALTIMEKIT_APP_ID=...
CLOUDFLARE_API_TOKEN=...
```

Produção:

```bash
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put REALTIMEKIT_APP_ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

O App ID vem de um App RealtimeKit dentro da conta Cloudflare. Account ID,
App ID e API token são três identificadores diferentes.

## Presets

O tipo da sessão escolhe o preset; ele não é inferido apenas de permissões
genéricas:

| Uso | Preset padrão |
|---|---|
| administrador da festa | `group-call-host` |
| participante da festa ou chamada 1:1 | `group-call-participant` |
| dono da transmissão | `livestream-host` |
| audiência da transmissão | `livestream-viewer` |

Se o App usa nomes diferentes:

```text
RTK_PRESET_HOST=...
RTK_PRESET_PARTICIPANT=...
RTK_PRESET_LIVESTREAM_HOST=...
RTK_PRESET_VIEWER=...
```

## Navegador

`src/client/realtime.ts` inicializa `@cloudflare/realtimekit` com o token
emitido pelo Worker e monta `<rtk-meeting>` do pacote
`@cloudflare/realtimekit-ui`.

O host de festa e chamada entra com câmera/microfone conforme a escolha e as
permissões do backend. A audiência 1:n entra sem publicar áudio ou vídeo.

## Contrato real

```bash
npm run test:media
```

Esse comando exige as três credenciais, cria uma reunião real e emite um token
para cada um dos quatro presets. Credencial ausente ou preset inexistente faz o
comando falhar.
