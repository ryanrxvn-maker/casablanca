# DARKO LAB

Plataforma SaaS de ferramentas para editores de vídeo e criadores de conteúdo, com portfolio compartilhável.

> **Branding**: o produto chamado anteriormente "CASABLANCA" foi rebatizado para **DARKO LAB** (logo: coelho sombrio com olhos lime brilhando, inspirado em Donnie Darko). O nome do repositório/diretório permanece `CASABLANCA` por inércia; toda a UI, metadata e favicon já refletem DARKO LAB.

Este repositório contém o **scaffold completo** da aplicação: Next.js 14 (App Router) + Supabase + Tailwind, com design system, autenticação, rotas, layouts e placeholders para todas as ferramentas.

---

## Stack

- **Framework**: Next.js 14.2 (App Router, Server Components)
- **Linguagem**: TypeScript
- **Auth + DB + Storage**: Supabase (via `@supabase/ssr`)
- **Estilo**: Tailwind CSS com tema dark/lime customizado
- **Áudio**: Web Audio API (a implementar)
- **Vídeo**: FFmpeg WASM (a implementar)
- **Deploy**: Vercel

---

## Rodando localmente

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No painel, vá em **SQL Editor** e rode os scripts na ordem:
   - `supabase/migrations/001_init.sql` — cria tabelas, RLS e trigger de profile automático.
   - `supabase/migrations/002_storage.sql` — cria os buckets e policies de storage.
   - `supabase/migrations/003_privacy_hardening.sql` — fecha leak de `email` em perfis públicos (RPC `get_public_profile_by_slug` + helper `is_public_profile`).
   - `supabase/migrations/004_portfolio_extras.sql` — adiciona `whatsapp`, `portfolio_show_avatar`, `portfolio_cover` em `profiles`.
   - `supabase/migrations/005_agenda.sql` — tabelas `agenda_tasks` e `agenda_occurrences` com RLS.
   - `supabase/migrations/006_profile_upgrade.sql` — portfolio sempre público, bucket `avatars` pra foto de perfil, trigger `handle_new_user` atualizado.
3. Copie **Project URL** e **anon key** (em *Project Settings → API*) para `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

4. **(Opcional)** Ative o Google OAuth em *Authentication → Providers → Google*:
   - Crie credenciais no [Google Cloud Console](https://console.cloud.google.com).
   - Adicione `https://seu-projeto.supabase.co/auth/v1/callback` como Authorized redirect URI.
   - Cole client ID e client secret no Supabase.

### 3. Iniciar o servidor de dev

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

---

## Estrutura do projeto

```
casablanca/
├── app/
│   ├── layout.tsx              Layout raiz (pt-BR, globals.css)
│   ├── page.tsx                Redireciona para /tools ou /login
│   ├── login/                  Login (email/senha + Google)
│   ├── register/               Registro
│   ├── forgot-password/        Recuperar senha
│   ├── auth/callback/          Troca código OAuth por sessão
│   ├── tools/                  Área logada de ferramentas
│   │   ├── layout.tsx          Header + TabNav
│   │   ├── audio-split/        (UI pronta, motor pendente)
│   │   ├── decupagem/          (UI pronta, motor pendente)
│   │   ├── camuflagem/         (UI pronta, motor pendente)
│   │   ├── acelerador/         (UI pronta, motor pendente)
│   │   ├── compressor/         (UI pronta com estimativa em tempo real)
│   │   └── calculadora/        ✅ Implementada
│   ├── portfolio/              Editor (gerencia slug, público/privado)
│   │   └── provas-sociais/
│   └── p/[slug]/               Portfolio público (server-rendered)
├── components/
│   ├── Brand.tsx               Wordmark DARKO LAB + DarkoLogo
│   ├── DarkoLogo.tsx           SVG do coelho sombrio (olhos lime)
│   ├── ToolsStateProvider.tsx  Context que persiste estado das ferramentas
│   ├── Header.tsx              Header com badge ONLINE + logout
│   ├── TabNav.tsx              Tabs com underline lime
│   ├── AudioPlayer.tsx         Player com seek
│   ├── VideoPlayer.tsx         Player de vídeo com seek
│   ├── FileUpload.tsx          Upload com drag & drop
│   ├── AuthShell.tsx           Shell das páginas de auth
│   ├── ToolShell.tsx           Shell das páginas de ferramentas
│   └── ComingSoon.tsx          Placeholder visual
├── lib/
│   ├── supabase/
│   │   ├── client.ts           Cliente para Client Components
│   │   ├── server.ts           Cliente para Server Components
│   │   └── middleware.ts       Refresh de sessão + redirects
│   └── utils.ts                Helpers (formatTime, formatBRL, slugify...)
├── middleware.ts               Protege rotas
├── supabase/migrations/        Scripts SQL
├── tailwind.config.ts          Tema dark + paleta lime
└── next.config.js              Headers COOP/COEP para FFmpeg WASM
```

---

## Design system

Todas as cores e tokens vivem em `tailwind.config.ts` + `app/globals.css`. Classes utilitárias prontas para usar:

| Classe            | Uso                                                     |
| ----------------- | ------------------------------------------------------- |
| `.container-app`  | Wrapper centralizado `max-w-[960px]` com padding.       |
| `.card`           | Card com borda #1a1a1a, fundo #111 e backdrop-blur.     |
| `.card-pad`       | Padding padrão para cards (`p-6 md:p-8`).               |
| `.btn-primary`    | Botão lime (#c8ff00) com texto preto.                   |
| `.btn-secondary`  | Botão com borda #222, texto muted, hover lime.          |
| `.btn-ghost`      | Botão sem fundo, só hover.                              |
| `.input-field`    | Input dark com focus lime.                              |
| `.badge-online`   | Badge "● Online" com pulse.                             |
| `.tab-link`       | Tab com underline no estado ativo.                      |
| `.brand`          | Classe da logo: weight 900, tracking 0.25em, cor lime.  |
| `.mono`           | Fonte JetBrains Mono.                                   |

---

## Status de implementação

| Módulo                    | Status           | Observação                                    |
| ------------------------- | ---------------- | --------------------------------------------- |
| Design system             | ✅ Completo       | Tema, componentes base, tipografia.           |
| Auth (login/register/...)  | ✅ Completo       | Supabase + Google OAuth + middleware + OTP code `/verify`. |
| Layout com tabs            | ✅ Completo       | Header + TabNav (Orbitron) + rotas.            |
| **Agenda**                 | ✅ Completo       | Day/Week/Month + recorrência + donut stats + notificações + CSV. |
| **Calculadora**            | ✅ Completo       | Funcional, em tempo real.                      |
| **Audio Split**            | ✅ Completo       | Motor Web Audio API + split por pausas + ZIP nativo. |
| **Decupagem**              | ✅ Completo       | Áudio (WAV/MP3) + vídeo (corte via ffmpeg filter_complex). |
| **Camuflagem**             | ✅ Completo       | Inversão de fase estéreo + batch + MP4/MP3/WAV + mux em vídeo. |
| **Acelerador**             | ✅ Completo       | FFmpeg WASM: atempo + setpts, batch-20, MP4/MP3/WAV. |
| **Compressor**             | ✅ Completo       | FFmpeg WASM H.264 CRF + scale + batch-20 + size prediction. |
| **Portfolio editor**       | ✅ Completo       | Upload + thumbnail + categorias + drag-and-drop + cover picker. |
| Portfolio público `/p/[slug]` | ✅ Completo    | RPC `get_public_profile_by_slug` (sem vazar email) + capas animadas + WhatsApp. |
| **Provas sociais**         | ✅ Completo       | Upload múltiplo + masonry + caption inline + delete + zoom modal. |
| Visual 3D + mouse FX       | ✅ Completo       | `card-3d`, cursor spotlight, ripple click, Orbitron tabs, grain overlay. |
| SQL migrations             | ✅ Completo       | `001` → `006_profile_upgrade.sql`. |

---

## Próximos passos (roadmap sugerido)

Já implementado:
- ✅ **Engine de áudio** (`lib/audio-engine.ts`): `decodeAudio`, `detectSilences` (RMS 20ms / threshold 0.008 / min 0.15s), `trimSilences`, `splitByParagraphs`, `encodeWAV` 16-bit PCM, `downloadBlob` via data URL.
- ✅ **ZIP builder nativo** (`lib/zip-builder.ts`): método STORE, CRC-32, Local file header + Central Directory + EOCD. Zero dependências.
- ✅ **Camuflagem** (`lib/camuflagem.ts`): L = black + gain·white / R = -black + gain·white, output WAV estéreo.
- ✅ **FFmpeg worker** (`lib/ffmpeg-worker.ts`): singleton `getFFmpeg()` (carrega core WASM via unpkg CDN na primeira vez), wrappers `speedUpVideo` / `speedUpAudio` / `compressVideo` / `extractAudio`. Callback de progresso compatível com a API 0.12+ do `@ffmpeg/ffmpeg`. Todas as 6 ferramentas estão funcionais.
- ✅ **Portfolio upload** (`lib/portfolio-upload.ts`): `uploadVideo`, `generateThumbnail` (canvas/video), `uploadThumbnail`, `uploadProof`, `deleteByPublicUrl` e o combo `uploadPortfolioItem` que faz upload de vídeo + thumbnail + insert no DB numa chamada só.
- ✅ **Portfolio editor** (`/portfolio`): lista por categoria vinda do banco, upload com stages (video → thumbnail → DB), reorder via setas (swap de `order`), exclusão com remoção dos arquivos nos buckets, CRUD de categorias customizadas.
- ✅ **Provas sociais** (`/portfolio/provas-sociais`): upload múltiplo por input file, masonry com `columns-2/3/4` do Tailwind, caption inline editável (`onBlur` → update), delete individual.

- ✅ **Cache do core FFmpeg** (`cachedBlobURL` em `lib/ffmpeg-worker.ts`): armazena `ffmpeg-core.js` + `.wasm` em `caches.open('casablanca-ffmpeg-core-v1')` no primeiro carregamento, reutiliza em sessões seguintes. Fallback silencioso pra `fetch` direto se a Cache API estiver indisponível. `clearFFmpegCache()` exportado para invalidação manual.
- ✅ **Fallback robusto de decodificação** (`decodeAudioRobust` em `lib/audio-engine.ts`): tenta `AudioContext.decodeAudioData` primeiro; se o browser não entender o codec, baixa o FFmpeg via lazy-import, extrai a trilha como WAV PCM e re-decodifica. Audio Split, Decupagem e Camuflagem foram migrados pra essa versão.
- ✅ **Seleção automática MT/ST do core** (`supportsFFmpegMT` em `lib/ffmpeg-worker.ts`): detecta `window.crossOriginIsolated` + `SharedArrayBuffer` e carrega `@ffmpeg/core-mt@0.12.6` (com `ffmpeg-core.worker.js` adicional) para rodar em pool de threads — 2-3x mais rápido. Fallback automático para `@ffmpeg/core` ST quando o ambiente não atende os requisitos (ex: dev sem COOP/COEP, Safari privado, etc.). `getFFmpegVariant()` exposto para debug/telemetria.
- ✅ **Drag & drop no portfolio** (`app/portfolio/page.tsx`): reordenação nativa HTML5 com feedback visual (linha fica com borda lime quando dragover, opacidade 40% no item que está sendo arrastado, cursor `grab`/`grabbing`). Handler `reorderItems(from, to)` faz update otimista na UI e depois persiste o novo `order` de TODOS os items da categoria em batch via `Promise.all`. Pequeno grip de 6 pontos (SVG inline) à esquerda de cada item indica o affordance de arraste.
- ✅ **Privacy hardening** (`supabase/migrations/003_privacy_hardening.sql` + `app/p/[slug]/page.tsx`): a policy original `public profile read` permitia que qualquer anon fizesse SELECT em todas as colunas de profiles públicos — incluindo `email`. A migration 003 substitui por duas funções SECURITY DEFINER: `get_public_profile_by_slug(slug)` (retorna só id/name/avatar_url/slug/public, sem email) e `is_public_profile(uid)` (usada pelas policies de items/cats/proofs). O route handler `/p/[slug]` passa a chamar `supabase.rpc('get_public_profile_by_slug')` em vez de ler a tabela direto.

Pendente (em ordem de prioridade):

1. **Deploy checklist**
   - Rodar as 3 migrations no Supabase (001 → 002 → 003)
   - Popular `.env.local` de produção na Vercel
   - Testar OAuth em produção com o callback correto
   - Validar `window.crossOriginIsolated === true` em produção para garantir que o core-mt está ativo
   - Confirmar que `/p/<slug>` não retorna `email` em `curl "$SUPABASE_URL/rest/v1/profiles?portfolio_public=eq.true&select=email" -H "apikey: $ANON"` (deve dar `[]`)

---

## Deploy na Vercel

Ver [DEPLOY.md](./DEPLOY.md) para o passo-a-passo completo (criar projeto Supabase, rodar migrations, configurar OAuth, deploy, checklist pós-deploy de 9 itens, troubleshooting).

TL;DR:

```bash
npm run build                   # verifica que compila
npx vercel deploy --prod        # deploy
```

No painel da Vercel, popule `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_SITE_URL` (essa com a URL de produção).

Importante: os headers `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: credentialless` já estão em `next.config.js` e `vercel.json` — são necessários para `SharedArrayBuffer`/FFmpeg core-mt. `credentialless` (ao invés de `require-corp`) permite que thumbnails e vídeos do Supabase Storage carreguem sem precisar de header CORP.

---

## Licença

Uso interno / proprietário.
