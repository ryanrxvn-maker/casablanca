# DARKO LAB

Suite de ferramentas para editores de vídeo e criadores de conteúdo. Duas
trilhas bem separadas:

- **Base Suite** — pós-produção local, 100% client-side via FFmpeg WASM +
  Web Audio API. Nenhum arquivo sobe pra servidor.
- **AI Suite** — ferramentas com IA (Claude, AssemblyAI, ElevenLabs) pra
  automatizar trabalho criativo sob demanda.

Stack: Next.js 14 (App Router) + TypeScript + Tailwind + Supabase (auth).

> **Branding**: o produto antes chamado "CASABLANCA" foi rebatizado pra
> **DARKO LAB**. O diretório do repositório segue como `CASABLANCA` por
> inércia; toda a UI, metadata e favicon já são DARKO LAB.

---

## Pré-requisitos

- Node 20+
- Conta no [Supabase](https://supabase.com)
- Conta na [Anthropic](https://console.anthropic.com) (Claude Messages API)
- Conta na [AssemblyAI](https://www.assemblyai.com) (transcrição com
  timestamps por palavra)
- Conta na [ElevenLabs](https://elevenlabs.io) (voice clone + TTS)

## Setup local

```bash
npm install
cp .env.local.example .env.local
# preenche as chaves (ver seção abaixo)
npm run dev
```

A app sobe em `http://localhost:3000`.

## Variáveis de ambiente

```
# Supabase (auth)
NEXT_PUBLIC_SUPABASE_URL=https://<projeto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Anthropic Claude — usado pelo Auto B-Roll
ANTHROPIC_API_KEY=sk-ant-...

# AssemblyAI — transcript com word-level timestamps (Troca de Produto)
ASSEMBLYAI_API_KEY=...

# ElevenLabs — voice clone + TTS (Troca de Produto)
ELEVENLABS_API_KEY=...

# (Opcional) Replicate — Demucs pra separar voz/música antes da clonagem
REPLICATE_API_TOKEN=
```

## Banco de dados

Em `supabase/migrations/` ficam as migrações SQL numeradas. Rode em ordem
no SQL Editor do Supabase (ou via `supabase db push`). Ver `DEPLOY.md`
pra o passo a passo completo. A app atual usa só:

- `profiles` (id, name, avatar_url, whatsapp) — espelho do `auth.users`
- Bucket `avatars` — foto de perfil (upload via `/configuracoes`)

As migrações 001–007 criaram tabelas legadas (portfolio, agenda); a 008
limpa tudo pós-restructure. Projetos novos podem rodar direto 001 +
006 + 008, ou começar do zero com o schema mínimo do `profiles`.

---

## Estrutura

```
app/
├── (auth)/                    Login, register, verify, reset, callback
├── configuracoes/             Config de conta (email, senha, logout, deletar)
├── tools/
│   ├── layout.tsx             Shell + Header + ToolsNav (rail + switcher)
│   ├── page.tsx               Redirect -> /tools/decupagem
│   ├── decupagem/             Base Suite — corta cortes ruins do vídeo
│   ├── camuflagem/            Base Suite — mistura 2 áudios "preto+branco"
│   ├── compressor/            Base Suite — comprime MP4/MOV/WEBM
│   ├── audio-split/           Base Suite — divide áudio em partes de N min
│   ├── acelerador/            Base Suite — acelera 1×–4×
│   ├── normalizador/          Base Suite — equilibra volume (dynaudnorm)
│   ├── take-splitter/         Base Suite — separa cenas/takes (scdet)
│   ├── calculadora/           Base Suite — orçamento R$/min × minutagem
│   ├── auto-broll/            AI Suite — copy → cenas + prompts + JSON
│   ├── troca-produto/         AI Suite — troca nome de produto no áudio
│   ├── remover-elementos/     AI Suite — remove legendas/watermarks (vision + delogo)
│   └── decupagem-copy/        AI Suite — alinha video bruto com copy/script
├── api/
│   ├── auto-broll/            Claude Messages API
│   ├── troca-produto/
│   │   ├── assemblyai/        Upload + transcript + word-level timestamps
│   │   ├── elevenlabs-clone/  Instant Voice Clone
│   │   ├── elevenlabs-tts/    TTS com voice clonada
│   │   └── elevenlabs-delete/ Cleanup pós-uso
│   ├── remover-elementos/
│   │   └── detect/            Claude Haiku Vision → bounding boxes
│   └── decupagem-copy/
│       └── match/             AssemblyAI transcript + matcher copy↔video
components/
├── Header.tsx, Brand.tsx, SuiteSwitcher.tsx, ToolRail.tsx, ToolsNav.tsx
├── ToolIcons.tsx, ToolShell.tsx, ToolsStateProvider.tsx
├── FileUpload.tsx, AudioPlayer.tsx, MouseGlow.tsx, RippleRoot.tsx
lib/
├── audio-engine.ts    Web Audio API
├── camuflagem.ts      Mix "preto+branco"
├── ffmpeg-worker.ts   Singleton FFmpeg WASM + helpers
├── zip-builder.ts     ZIP nativo (Audio Split)
├── supabase/          Client + server helpers (SSR)
supabase/
└── migrations/        SQL numerado, aplicado em ordem
```

### State persistente entre tabs

`ToolsStateProvider` vive em `app/tools/layout.tsx` — cada ferramenta usa
`useToolState(key, initial)` como drop-in replacement pro `useState`
normal. O store é um `Record` em `useRef`, então mudar de aba não
desmonta nem reseta o processamento. É possível disparar o Compressor em
uma aba e voltar minutos depois pra baixar o resultado.

---

## Base Suite

Todas as ferramentas rodam 100% no browser — nenhum arquivo sobe pra
servidor.

| Ferramenta | O que faz |
|---|---|
| **Decupagem** | Detecta silêncios e cortes ruins, gera vídeo decupado. Modo áudio (MP3/WAV) ou vídeo. Usa FFmpeg WASM + Web Audio API. |
| **Camuflagem** | Mistura um áudio "preto" com um "branco" pra criar uma versão única não rastreável por sistemas de copyright (formato configurável). |
| **Compressor** | Reduz o tamanho de vídeos até ±10% do alvo, batch até 10. |
| **Audio Split** | Divide um áudio em partes de N minutos e zipa como `parte1.wav`, `parte2.wav`, … |
| **Acelerador** | Acelera áudio/vídeo 1×–4×, preserva pitch. |
| **Normalizador** | Equilibra volume com cadeia `acompressor` 2-stage + `loudnorm` (3 intensidades). Saída MP4/MP3/WAV. Voz alta e baixa saem no mesmo nível, sem drift. Batch até 10. |
| **Separar Takes** | Detecta cortes de cena via FFmpeg `select=gt(scene,T)` e divide o vídeo em takes nomeados (`take_001_NICHO.mp4`, …). Lossless `-c copy`. Até 2GB. |
| **Calculadora** | Calcula orçamento de projeto: valor/min × minutagem − desconto. Presets de R$/min comuns + state persistente. |

---

## AI Suite

### Auto B-Roll (`/tools/auto-broll`)

Recebe: copy da VSL + público + persona do narrador + (opcional)
referência visual em texto.

Retorna, em uma única chamada ao Claude Sonnet 4.5:

1. **Tabela de cenas** (pt-BR) — cada linha mapeia copy → categoria →
   emoção → duração → descrição visual.
2. **Video prompts** (inglês) — 3–5 segundos cada, com shot type,
   movimento de câmera, paleta, lente, emoção.
3. **Bloco de consistência** — persona fixa do narrador + paleta por
   categoria + padrão de câmera por categoria.
4. **Nano Banana 2 JSON** — array estruturado pronto pra alimentar a API
   de geração de imagem/vídeo.

Backend: `app/api/auto-broll/route.ts` (fetch direto em
`https://api.anthropic.com/v1/messages`, sem SDK adicional).

### Troca de Produto (`/tools/troca-produto`)

Substitui o nome de um produto em um áudio preservando a voz original.
Pipeline:

1. **AssemblyAI** transcreve o áudio com timestamps por palavra e
   `word_boost` no nome antigo → matches em ms.
2. Usuário confirma via checkbox quais ocorrências substituir.
3. **ElevenLabs Instant Voice Clone** clona a voz do narrador a partir
   do próprio áudio.
4. **ElevenLabs TTS** gera o nome novo na voz clonada, com
   `previous_text`/`next_text` pra manter a entonação.
5. **FFmpeg WASM** (local) faz time-stretch (`atempo`) de cada TTS pra
   caber no slot original e concatena os segmentos num MP3 final.
6. Cleanup: a voice clonada é deletada no final.

Backend: quatro rotas em `app/api/troca-produto/*`.

**Custo estimado por VSL**: depende da duração e do nº de ocorrências.
Para um áudio de 20 min com ~10 trocas: ~$0,50 em AssemblyAI +
~$0,10 em ElevenLabs TTS + clone gratuito dentro do plano.

### Remover Legenda & Marca d'Água (`/tools/remover-elementos`)

Remove legendas hardcoded ou watermarks de vídeos. Arquitetura totalmente
client-side com IA só na detecção:

1. **Browser FFmpeg WASM** extrai 3 frames JPG do vídeo (~200KB cada).
2. **Claude 3.5 Haiku Vision** retorna bounding boxes das regiões
   (legendas + watermarks) em coordenadas %.
3. Agregador funde regiões consistentes entre frames + filtra por
   confidence.
4. **Browser FFmpeg WASM** aplica filtro `delogo` nas regiões → MP4 limpo.

Modos: Smart AI / Só Legenda / Só Watermark / Bottom 18% (sem IA) /
Manual (X/Y/W/H em %). Batch até 5 vídeos × 500MB × 40min.

Backend: `app/api/remover-elementos/detect/route.ts`.

**Custo estimado**: ~$0,015 por vídeo (3 frames Haiku Vision). Para
batch de 5: ~$0,075.

### Decupagem por Copy (`/tools/decupagem-copy`)

Recebe vídeo bruto de expert + copy/script. Retorna vídeo reeditado na
ordem da copy, com a melhor take de cada frase escolhida automaticamente:

1. **Browser FFmpeg WASM** extrai áudio em OPUS 12kbps mono 16kHz
   (~3,6MB pra 40min, cabe no body limit do Vercel).
2. **AssemblyAI** transcreve com timestamps por palavra (pt).
3. **Server matcher**: pra cada frase da copy, sliding-window encontra o
   melhor span no transcript. Score = completude (0.55) + fluência (0.15)
   + sem fillers (0.15) + boundary limpo (0.15). Pega o melhor com
   score ≥ 0.5.
4. Retorna lista de cuts em ordem da copy.
5. **Browser FFmpeg WASM** corta + concatena via `cutVideoSegments` →
   MP4 final.

Limite: 1 vídeo por vez, ≤800MB / ≤40min. Backend:
`app/api/decupagem-copy/match/route.ts`.

**Custo estimado**: ~$0,27 por vídeo de 40min (AssemblyAI).

---

## Scripts

```bash
npm run dev           # Dev server
npm run build         # Production build
npm run start         # Serve o build
npm run lint          # ESLint (next lint)
npm run type-check    # tsc --noEmit
```

---

## Deploy

Ver `DEPLOY.md` pra o passo a passo completo (Supabase + Vercel + todas as
chaves de IA).
