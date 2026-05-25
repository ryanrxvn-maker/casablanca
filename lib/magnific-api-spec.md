# Magnific API Spec (descoberto via engenharia reversa live, 2026-05-24)

Capturado por Claude in Chrome MCP rodando geração real na conta do user (Premium+, user_id 188211386).

## Auth

- **Same-origin cookie auth** (sessão Laravel `session` cookie + `XSRF-TOKEN`)
- Headers obrigatórios em POSTs:
  - `content-type: application/json`
  - `accept: application/json`
  - `X-Requested-With: XMLHttpRequest`
  - `X-XSRF-TOKEN: <decoded XSRF-TOKEN cookie>` ← decode URI primeiro!

User_id e wallet_id vêm via `GET /app/api/auth/verify`.

## Base URL

`https://www.magnific.com/app/api/`

Todos endpoints aceitam `?lang=en_US&user_id={uid}` na query.

## Image Generation Pipeline (VALIDADO)

### 1) Reserve tokens
```
POST /app/api/start-tti-v2?lang=en_US&user_id={uid}

Body:
{
  "mode": "imagen-nano-banana-2-flash",  // ou imagen-nano-banana-2, imagen-nano-banana
  "prompt": "a tiny red cube on white background",
  "references": [],
  "num_images": 1,
  "aspect_ratio": "auto",  // ou "9:16", "16:9", "1:1"
  "color_palette": null,
  "color_palette_id": null,
  "variations": true,
  "force_credits": false
}

Response: 200
{
  "sexual": false,
  "minors": false,
  "family": "a1dbd324-f376-4447-92bf-1c6f904b6703",  // UUID família
  "available_slots": 24,
  "limit": 24,
  "request_tokens": ["HjK7Wull", "pGk3BP5", ... 24 tokens],
  "force_credits": false
}
```

### 2) Render (cria a creation REAL)
```
POST /app/api/render/v4?lang=en_US&user_id={uid}

Body:
{
  "tool": "text-to-image",
  "mode": "imagen-nano-banana-2-flash",
  "family": "a1dbd2b0-...",  // da step 1
  "prompt": "a tiny red cube on white background",
  "negative_prompt": null,
  "width": 0,
  "height": 0,  // 0 = auto pra aspect_ratio
  "seed": 792506,  // random
  "aspect_ratio": "auto",
  "resolution": "1k",
  "thinking_level": "minimal",  // "minimal" | "high"
  "use_google_search_tool": false,
  "request_token": "I0wFGmTjXBZd",  // 1 token da step 1
  "force_credits": false,
  "metadata": {
    "inputPrompt": "a tiny red cube on white background",
    "aspectRatio": "auto",
    "mode": "imagen-nano-banana-2-flash",
    "unlimited": true,
    "smartPrompt": true
  },
  "smart_prompt": true,
  "image_index": 0,
  "num_images": 1
}

Response: 200
{
  "creation": {
    "id": 3037732261,
    "identifier": "Xt4LQHJBfo",      // ← polling key
    "family": "a1dbd2b0-...",
    "tool": "text-to-image",
    "metadata": {
      "prompt": "A minuscule crimson cube...",  // smart-prompt expanded
      "seed": "1084139",
      "expectTime": 17,
      "transactionId": "8a0e...",
      "creditLedger": [{"credits": 0, "creditsEstimated": 75}],
      "creditLedgerTotals": {"credits": 0, "unlimitedCredits": 75},  // ZERO custo Unlimited
      "resolution": "1k",
      "queue_priority": 3
    }
  }
}
```

### 3) Polling
```
GET /app/api/creation/{identifier}?lang=en_US&user_id={uid}

Response 200:
{
  "id": 3037732261,
  "identifier": "Xt4LQHJBfo",
  "status": "completed",  // ou "pending", "failed"
  "url": "https://pikaso.cdnpk.net/private/production/4397196532/render.png?token=exp=1779926400~hmac=...",
  "preview": "...",
  "large_preview": "...",
  "metadata": {...}
}
```

URL é **signed** (token expira em ~3 dias).

## Video Generation Pipeline (VALIDADO LIVE 2026-05-24)

**DIFERENTE do image** — endpoint próprio `/app/api/generate?return_creations=true`, payload aninhado em `video.clips[]`, **sem reserve step**, criação + polling direto.

### POST /app/api/video/generate?return_creations=true

**ATUALIZADO 2026-05-24:** Endpoint mudou de `/app/api/generate` → `/app/api/video/generate`.
A rota antiga retorna 405 (Magnific reorganizou). Resposta agora vem com
`{success:true, message:"Video generation started successfully", data:{creations:[...]}}`.

```
POST /app/api/video/generate?return_creations=true&lang=en_US&user_id={uid}

Body:
{
  "video": {
    "family": "c512f5b6-c20c-43b3-962d-645902ce14f3",  // UUID gerado client-side
    "clips": [
      {
        "position": 0,
        "prompt": "slow zoom in",
        "negativePrompt": "",
        "name": "slow zoom in",  // até 80 chars
        "family": "c512f5b6-...",  // mesmo UUID do video
        "aspectRatio": "9:16",  // ou "16:9", "1:1"
        "cameraMotion": null,
        "duration": 10,  // 5 ou 10
        "api": "kling",  // família do modelo
        "model": "kling",
        "mode": "25",  // versão (25, 26, 21)
        "slug": "kling-25",
        "extraParameters": {},
        "withSoundEffects": false,
        "promptType": "basic",
        "resolution": "720p",  // ou "1080p"
        "keyframes": {
          "start": {
            "type": "image",
            "url": "https://pikaso.cdnpk.net/private/production/.../render.png?token=..."
          }
        },
        "audioUrl": "",
        "voices": [],
        "boardUuid": null,
        "videoPreset": "custom"
      }
    ]
  }
}

Response: 200
{
  "success": true,
  "data": {
    "creations": [
      {
        "id": 3037745891,
        "identifier": "abc123XYZ",  // ← polling key
        "family": "c512f5b6-..."
      }
    ]
  }
}
```

### Polling
Mesma rota do image: `GET /app/api/creation/{identifier}` → `status: "completed"` + `url` final.

### Map modelo → api/mode
- `kling-25` → `{api: "kling", mode: "25"}`
- `kling-26` → `{api: "kling", mode: "26"}`
- `kling-21` → `{api: "kling", mode: "21"}`
- `wan-2-5`, `google-veo3`, etc seguem mesma estrutura (api = família, mode = versão).

## Modelos confirmados disponíveis (user Premium+)

### text-to-image
- `imagen-nano-banana-2-flash` (default UI Google Nano Banana 2)
- `imagen-nano-banana-2`
- `imagen-nano-banana`
- `gpt-2`, `flux-2`, `seedream-5-lite`, etc

### video-generator
- `kling-25` (Kling 2.5)
- `kling-26`, `kling-21`, `kling-omni1`
- `wan-2-5`, `wan-2-2`
- `google-veo3`, etc

## Catálogo completo
```
GET /app/api/v2/ai-models?lang=en_US

Response: array de 127 modelos. Cada um tem:
- slug, tool, status, defaults, inputs, outputs, metadata
```

## Batch Polling — `GET /creations?ids[]=...`

**ÓTIMO** — 1 request retorna status de TODOS os identifiers ativos.
Reduz polling de N requests/ciclo pra 1.

```
GET /app/api/creations?ids[]=A&ids[]=B&limit=N&lang=en_US&user_id={uid}

Response: 200
{
  "data": [
    {
      "id": 3037776397,
      "identifier": "hEZ77FuvqL",
      "family": "bd55ee92-...",
      "tool": "video-generator",
      "status": "completed",      // ou "pending", "failed"
      "url": "https://pikaso.cdnpk.net/.../render.mp4?token=...",
      "metadata": {
        "api": "kling", "mode": "25", "slug": "kling-25",
        "resolution": "720p", "duration": 10, "fps": 24,
        "width": 1300, "height": 708,
        "status": "completed", "expectTime": 17,
        "prompt": "...", "keyframes": {...}
      },
      "preview": "...", "large_preview": "...",
      "created_at": "...", "is_watermarked": false
    }
  ]
}
```

IDs não encontrados são SILENCIOSAMENTE omitidos (não dão 404).
Implementado em `lib/magnific-api-server.ts:createBatchPoller()`.

## Anti-Credit Guards

**Antes de disparar** (route auto-broll-v2/generate chama `assertZeroCreditCost()`):

### GET /unlimited-status
```
Response:
{
  "is_banned": false,
  "is_relaxed_mode": false,
  "is_unlimited_mode_enabled": true,    // ← se false: ABORTA
  "unlimited_cycle_reset_date": "2026-06-13",
  "usage": {"metric": "cost", "percent": 87}   // ← >= 100: throttle ativo
}
```

### POST /v2/ai/simulate-generation
```
Body: {"items":[{"model":"kling-25","quantity":1,"config":{"resolution":"720p","tier":"mid","duration":10}}], "forceCredits":false}

Response:
{
  "items": [{"isUnlimited": true, "costPerImage": 28, ...}],
  "total": {"credits": 0, "hasUnlimited": true, "remaining": 413, "realCost": 28}
}
```

`total.credits > 0` OU `total.hasUnlimited: false` → ABORTA disparo (rota retorna 402).

## Wallet / Limits
```
GET /app/api/wallet?wallet_id={uid}&lang=en_US&user_id={uid}
→ {credits, totalCredits, productName: "Premium+", etc}

GET /app/api/limits?lang=en_US&user_id={uid}
→ {limits: {key, title, remaining, max, isPremium}}
```

## Cost preview (opcional)
```
POST /app/api/v2/ai/simulate-generation?lang=en_US&user_id={uid}

Body: {"items":[{"model":"...","quantity":1,"config":{"resolution":"1k","variant":"standard","tier":"mid"}}], "forceCredits": false}

Response: {items: [{costPerImage, isUnlimited, ...}], total: {credits, hasUnlimited, remaining}}
```
