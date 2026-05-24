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

## Video Generation Pipeline (PARCIALMENTE VALIDADO)

Mesmo padrão. Confirmado que `/app/api/render/v4` aceita tool de video — retornou 422 com erros específicos:
- `tool: "image-to-video"` → invalid (precisa achar o nome correto via captura real)
- `width: required` (NÃO aceita 0, precisa valor exato)
- `height: required`
- `resolution: "720p"` → invalid (precisa achar enum certo)

**TODO captura final** (precisa user disparar via UI):
- `tool` exato pra video (provavelmente `text-to-video` ou `image-to-video`)
- `mode` = `kling-25` confirmado
- `width`/`height` exatos pra 9:16 720p
- `resolution` enum válido (talvez `"hd"` ou `"720p_9_16"`)
- `duration` aceita
- Como passa `start_image` (URL ou file?)
- Talvez tenha `start-ttv-v2` ou similar pra reserve tokens primeiro

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
