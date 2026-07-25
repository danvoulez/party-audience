# Contrato técnico — TV 24h do parceiro

A TV 24h é **produzida e operada por um parceiro externo**. A plataforma apenas
incorpora o sinal na homepage pública, detecta indisponibilidade, apresenta
fallback e registra eventos básicos de reprodução. A homepage **nunca** solicita
câmera ou microfone.

## O que o parceiro precisa entregar

Um destes formatos, informado na configuração server-side `TV_SOURCE`:

| `kind` | Campos | Status nesta etapa |
| --- | --- | --- |
| `iframe` | `embedUrl` | **Implementado.** Player embutido do parceiro. |
| `hls` | `url` (manifesto `.m3u8`) | **Implementado.** `<video>` nativo (Safari) ou hls.js. |
| `cloudflare_stream` | `customerSubdomain`, `videoId` | **Implementado** via embed iframe do Cloudflare Stream. Não verificado com uma conta Stream real. |
| `dash` | `url` (manifesto `.mpd`) | **Aceito na configuração, sem player.** A homepage mostra o estado indisponível. |

Campo opcional em todos: `timeoutMs` (1000–60000, padrão 15000) — tempo máximo
para o sinal iniciar antes de exibir a tela de indisponibilidade.

### Requisitos por formato

**`hls`**
- URL pública `https://` do manifesto (live, atualizado continuamente);
- CORS liberado para o domínio da plataforma (`Access-Control-Allow-Origin`),
  necessário para hls.js em Chrome/Firefox;
- codecs compatíveis com navegadores (H.264 + AAC recomendado);
- sem token de sessão embutido na URL — se o parceiro exigir URLs assinadas,
  será necessário um endpoint de assinatura server-side (não implementado; abrir
  como requisito antes de contratar esse modelo).

**`iframe`**
- URL `https://` embutível (sem `X-Frame-Options`/`frame-ancestors` bloqueando o
  domínio da plataforma);
- o player do parceiro deve iniciar sozinho, **silenciado** (política de
  autoplay dos navegadores);
- controle de som fica dentro do player do parceiro;
- *limitação conhecida*: sem um contrato de `postMessage`, o único sinal de que
  o player subiu é o evento `load` do iframe — um iframe que carrega mas não
  reproduz não é detectável. Se o parceiro expuser eventos via `postMessage`
  (ex.: `playing`, `error`), isso melhora a detecção e deve ser especificado
  em conjunto.

**`cloudflare_stream`**
- live input configurado na conta Cloudflare Stream do parceiro (ou nossa);
- `customerSubdomain` (ex.: `customer-abc123`) e o `videoId`/live input id.

## Configuração (`TV_SOURCE`)

Variável de ambiente com JSON validado no servidor (schema em
`src/shared/tv-source.ts`). Exemplos:

```json
{"kind":"hls","url":"https://cdn.parceiro.tv/canal24h/live.m3u8"}
{"kind":"iframe","embedUrl":"https://player.parceiro.tv/embed/canal24h","timeoutMs":10000}
{"kind":"cloudflare_stream","customerSubdomain":"customer-abc123","videoId":"31c9291ab41fac05471db4e73aa11717"}
```

- Local: arquivo `.dev.vars` (ver `.dev.vars.example`).
- Produção: variável/secret no Cloudflare (`wrangler secret put TV_SOURCE` ou
  dashboard).
- Configuração ausente ou inválida **não quebra a página**: a homepage mostra
  "TV ainda não foi configurada".
- `http://` só é aceito para `localhost`/`127.0.0.1` (dev e testes).
- O cliente recebe apenas o resultado resolvido (modo + URL de reprodução);
  a URL de um stream público é, por natureza, visível ao navegador. Nenhuma
  chave, token de conta ou credencial de parceiro chega ao cliente.

## Comportamento da homepage

Estados do player (máquina em `src/client/state.ts`):

1. `loading` — spinner "Sintonizando a TV…" enquanto a mídia inicia;
2. `playing` — sinal no ar; em HLS o botão "Ativar som" fica disponível
   (o player inicia sempre silenciado);
3. `unavailable` — timeout ou erro de mídia: tela de indisponibilidade com
   botão "Tentar novamente".

## Eventos de reprodução (analytics)

O cliente envia `POST /api/events` (validação em `src/shared/events.ts`):
`tv_loading`, `tv_playing`, `tv_unavailable`, `tv_unmuted`, `tv_retry`.
Nesta etapa os eventos são registrados nos logs estruturados do Worker;
persistência em banco fica para uma etapa futura.
