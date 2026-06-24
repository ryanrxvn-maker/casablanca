# DARKO LAB

Suite de ferramentas para editores de vídeo e criadores de conteúdo. Três
trilhas:

- **Base Suite** (8 ferramentas) — pós-produção local 100% client-side
  via FFmpeg WASM + Web Audio API. Nenhum arquivo sobe pra servidor.
- **AI Suite** (6 ferramentas) — ferramentas com IA pra automatizar
  trabalho criativo sob demanda.
- **Mind Ads Suite** (admin only) — megazord. Pipeline completo de geração
  de anúncios: avatar HeyGen + b-rolls IA + montagem + SRT.

Stack: Next.js 14 (App Router) + TypeScript + Tailwind + Supabase (auth) +
Chrome Extension v1.2.0 (automação HeyGen).

---

## Ferramentas

### Base Suite (offline, FFmpeg WASM)

1. **Decupagem** — corta silêncios automaticamente
2. **Camuflagem** — modifica metadados pra evitar detecção de duplicata
3. **Compressor** — reduz tamanho mantendo qualidade
4. **Audio Split** — separa áudio de vídeo
5. **Acelerador** — speed up vídeo + áudio
6. **Normalizador** — equaliza volume com compressor estático
7. **Separar Takes** — divide vídeo nos cortes de cena (com modo IA opcional)
8. **Calculadora** — preços e descontos

### AI Suite

1. **Auto B-Roll** — gera prompts de B-roll com Claude pra cada take
2. **Remover Legenda** — apaga regiões com FFmpeg delogo
3. **Decupagem por Copy v2** — alinha vídeo bruto com copy assertivamente
   (Groq Whisper + algoritmo DP)
5. **Copy → SRT** — gera legendas .srt alinhadas com texto da copy
6. **HeyGen Auto Avatar** — automação HeyGen via extensão Chrome (sem API)

### Mind Ads Suite (admin)

Pipeline 6 etapas: Claude segmenta copy → HeyGen gera avatar → Replicate
gera B-rolls (imagem + animação) → FFmpeg corta silêncios + monta →
AssemblyAI/Groq legenda. Saída: MP4 final + avatar isolado + ZIP de
B-rolls + .SRT.

3 tiers de qualidade/custo:
- **Eco** ~$0.90/ad — Flux schnell + Kling 1.6 + Groq
- **Padrão** ~$1.50/ad — Flux dev + Luma Ray 2 + Groq
- **Premium** ~$3.90/ad — Nano Banana Pro + Wan 2.1 + AssemblyAI

Avatar HeyGen via extensão DARKO LAB (zero custo de API, usa mensalidade
do user).

---

## Setup local

```bash
npm install
cp .env.local.example .env.local
# preenche as keys obrigatorias
npm run dev
```

A app sobe em `http://localhost:3000`.

## Variáveis de ambiente obrigatórias

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=  # admin, NUNCA expor no client
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# BYOK encryption (gere com: openssl rand -hex 32)
SECRETS_ENCRYPTION_KEY=
```

Todas as chaves de IA (Anthropic, AssemblyAI, ElevenLabs, HeyGen, Replicate,
Groq) são fornecidas POR USUÁRIO via `/configuracoes/api`. Cifradas com
AES-256-GCM. Nem o admin vê.

## Migrations Supabase

Em `supabase/migrations/` ficam os SQLs numerados. Rode em ordem:

- `001-008` — schema inicial (profiles, RLS, triggers)
- `009` — admin role + closed beta lockdown
- `010` — user_api_keys (BYOK)
- `011` — senha provisória + tracking online (last_seen, last_ip, last_tool)
- `012` — colunas heygen_key + replicate_key
- `013` — coluna groq_key

## Chrome Extension (HeyGen Auto)

Pra ferramentas que usam HeyGen:

1. User loga em `/configuracoes/api` e configura HeyGen API key (pra previews)
2. User baixa extensão em `/api/extension/download`
3. Descompacta + carrega em `chrome://extensions` (modo dev)
4. Loga no HeyGen normalmente
5. Volta no DARKO LAB — extensão é detectada automaticamente

A extensão automatiza geração HeyGen via cookies de sessão (sem consumir
API publica). Código em `/extension/`.

---

## Estrutura

```
app/
├── (auth)/                    Login, register, verify, reset, callback
├── admin/                     Painel admin (cria/desativa users, online status)
├── api/                       Server routes
│   ├── admin/                 create-user, list-users
│   ├── decupagem-copy/match/  Algoritmo DP global v2
│   ├── extension/download/    ZIP da extensao
│   ├── heygen/                avatars, voices, clone-voice (preview-only API)
│   ├── mind-ads/              generate-prompts, replicate/{start-image,start-video,status}, transcribe-srt, heygen, proxy
│   ├── take-splitter/verify-cuts/  Haiku Vision
│   └── user/                  secrets (BYOK CRUD), heartbeat, clear-password-flag
├── configuracoes/             Conta + BYOK
├── tools/                     8 base + 6 ai + heygen-auto
│   ├── auto-broll/
│   ├── camuflagem/
│   ├── ...
│   ├── heygen-auto/           Automacao HeyGen via extensao
│   └── mind-ads/              Megazord (admin only)
├── trocar-senha/              Senha provisoria (forced first login)
└── layout.tsx                 ToolsNav + ToolRail + Header

components/
├── HeyGenAvatarPicker.tsx     Compartilhado entre Mind Ads + HeyGen Auto
├── HeyGenVoicePicker.tsx      Compartilhado (incl. voice clone)
├── ToolsNav.tsx, ToolRail, SuiteSwitcher
├── MindAdsButton.tsx          Olho 3D flutuante (admin)
├── Heartbeat.tsx              Pings 25s pra rastrear online
├── MissingKeyBanner.tsx       Avisa se BYOK nao configurado
└── ...

lib/
├── ffmpeg-worker.ts           Singleton FFmpeg + helpers (incl. mindAdsMontage, removeAvatarSilences, splitVideoByScenes com aiVerify)
├── heygen-extension-bridge.ts postMessage protocol + audioFileToBase64 + splitCopyIntoParts
├── mind-ads-models.ts         Tier eco/padrao/premium + estimateAdCost
├── mind-ads-pipeline.ts       Orquestracao client-side
├── srt-builder.ts             Algoritmo SRT compartilhado
├── secrets.ts                 AES-256-GCM
├── user-keys.ts               Resolve BYOK
├── zip-builder.ts             ZIP nativo (sem libs)
└── ...

extension/                     Chrome Extension v1.2.0
├── manifest.json              MV3
├── background.js              Service worker
├── bridge.js                  Content script no DARKO LAB
├── heygen-content.js          Automacao no app.heygen.com
└── README.md
```

---

## Custos por ferramenta (com BYOK)

| Ferramenta | Provider | Custo |
|---|---|---|
| Auto B-Roll | Anthropic | $0.05/run |
| Remover Legenda | Anthropic Vision | $0.02/run |
| Decupagem por Copy v2 | Groq Whisper | $0.04/h vídeo |
| Decupagem v2 (fallback) | AssemblyAI | $0.45/h |
| Copy → SRT | AssemblyAI | $0.45/h |
| Take Splitter (sem IA) | — | $0 |
| Take Splitter (com IA) | Anthropic Haiku Vision | $0.05/5min |
| HeyGen Auto Avatar | extensão | $0 (mensalidade) |
| Voice clone | HeyGen API | $0.30 one-shot |
| Mind Ads tier eco | combo | ~$0.88/ad |
| Mind Ads tier padrão | combo | ~$1.50/ad |
| Mind Ads tier premium | combo | ~$3.90/ad |

---

## Deploy

Vercel auto-deploy via `git push`. Configurar env vars no dashboard:
`SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_ENCRYPTION_KEY`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Ver `DEPLOY.md` pra checklist completo.

---

## Branding

Produto antes chamado "CASABLANCA" foi rebatizado pra **DARKO LAB**. O
diretório do repositório segue como `CASABLANCA` por inércia; toda a UI,
metadata e favicon já são DARKO LAB.
