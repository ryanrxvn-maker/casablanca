# CASABLANCA — Guia de deploy

Passo a passo para colocar o CASABLANCA em produção na Vercel com Supabase.
Leva cerca de 20-30 minutos se você já tem conta nos dois serviços.

---

## 1. Supabase — criar projeto e rodar migrations

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
   - Escolha a região `South America (São Paulo)` se a maioria dos usuários for BR.
   - Anote a senha do banco em local seguro (ela não é mostrada depois).
   - Aguarde ~2 minutos para o projeto provisionar.

2. No painel do projeto, vá em **SQL Editor → New query** e rode os scripts na ordem:
   - Cole o conteúdo de `supabase/migrations/001_init.sql` e clique em **Run**.
     Isso cria as tabelas `profiles`, `portfolio_items`, `portfolio_categories`,
     `social_proofs`, as policies de RLS e o trigger que cria um profile
     automaticamente no signup.
   - Cole o conteúdo de `supabase/migrations/002_storage.sql` e rode.
     Isso cria os buckets `portfolio-videos`, `portfolio-thumbnails` e
     `social-proofs`, junto das policies de storage (cada usuário só mexe
     nos próprios arquivos; portfolio-videos e portfolio-thumbnails são
     públicos para leitura; social-proofs também).
   - Cole o conteúdo de `supabase/migrations/003_privacy_hardening.sql` e rode.
     Isso troca a policy ampla `public profile read` (que vazava `email`)
     por duas funções SECURITY DEFINER: `get_public_profile_by_slug(slug)`
     e `is_public_profile(uid)`. As policies de items/cats/proofs passam a
     chamar `is_public_profile(user_id)` em vez de fazer EXISTS em profiles.

3. Em **Project Settings → API**, copie:
   - **Project URL** (formato `https://xxxxx.supabase.co`)
   - **anon public** key (formato `ey...`)

   Guarde esses dois valores — vão ser usados no `.env.local` e na Vercel.

---

## 2. (Opcional, mas recomendado) Google OAuth

Se quiser login com Google:

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto.
2. Em **APIs & Services → Credentials**, crie **OAuth 2.0 Client ID** do tipo
   *Web application*.
3. Em **Authorized redirect URIs**, adicione:
   ```
   https://<seu-projeto>.supabase.co/auth/v1/callback
   ```
4. Copie **Client ID** e **Client secret**.
5. No Supabase, vá em **Authentication → Providers → Google**, habilite, cole
   as duas strings e salve.
6. Ainda no Supabase, em **Authentication → URL Configuration**, adicione:
   - **Site URL**: `https://seu-dominio.vercel.app` (ajusta depois do deploy)
   - **Redirect URLs**: `https://seu-dominio.vercel.app/auth/callback`

---

## 3. Testar localmente antes do deploy

1. Crie `.env.local` a partir do template:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edite `.env.local` com os valores que você pegou no passo 1:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. Rode o build para ter certeza que compila:
   ```bash
   npm install
   npm run build
   ```
   Deve mostrar `✓ Compiled successfully` e listar as 17 rotas.

4. Rode o dev server e teste:
   ```bash
   npm run dev
   ```
   Abra <http://localhost:3000>. Crie uma conta em `/register`, entre em
   `/tools/audio-split` com um MP3 pequeno, e confirme que o processamento
   funciona.

---

## 4. Deploy na Vercel

### Opção A: via CLI (mais rápido)

```bash
npm install -g vercel          # se ainda não tiver
vercel login
vercel deploy                  # preview deploy primeiro
vercel deploy --prod           # quando estiver confiante
```

Na primeira vez o CLI vai perguntar:
- Link com projeto existente? **No** (vai criar novo)
- Nome do projeto: `casablanca` (ou o que preferir)
- Diretório: `./` (enter)
- Override settings? **No**

### Opção B: via dashboard

1. Acesse <https://vercel.com/new>.
2. Importe o repositório Git (se você já subiu pro GitHub/GitLab/Bitbucket)
   ou suba a pasta via CLI.
3. Framework: **Next.js** (detecta sozinho).

### Configurar as env vars na Vercel

Em **Project Settings → Environment Variables**, adicione as três:

| Nome                              | Valor                                         |
| --------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | `https://seu-projeto.supabase.co`             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | `ey...`                                       |
| `NEXT_PUBLIC_SITE_URL`            | `https://seu-dominio.vercel.app`              |

Marque todas as três para **Production**, **Preview** e **Development**.

Depois rode:
```bash
vercel deploy --prod --force
```

para forçar um rebuild com as novas env vars.

---

## 5. Pós-deploy — checklist de validação

Abra a URL de produção e confirme cada item abaixo:

1. **Home redireciona corretamente.** `/` manda pra `/login` se deslogado e
   pra `/tools` se logado.

2. **Signup + email confirmation.** Cria conta, recebe email (ver em
   Supabase → Authentication → Users), confirma, loga.

3. **OAuth (se configurou).** `/login` → Continue com Google → redireciona
   pro Supabase OAuth → volta logado em `/tools`.

4. **Tools funcionam.** Entra em `/tools/audio-split` com um MP3, clica
   Processar, aguarda — deve gerar as partes.

5. **crossOriginIsolated está ativo.** Abre DevTools → Console e roda:
   ```js
   window.crossOriginIsolated
   ```
   Deve retornar `true`. Se retornar `false`, os headers COOP/COEP não estão
   chegando — revise `vercel.json` e force rebuild.

6. **FFmpeg MT está ativo.** Em `/tools/compressor`, processa um MP4 pequeno
   (30s). No console:
   ```js
   import('/_next/static/chunks/...ffmpeg-worker...').then(m => console.log(m.getFFmpegVariant()))
   ```
   (mais fácil: rodar a compressão uma vez e ver no log network que ele baixou
   `@ffmpeg/core-mt` — o path tem `core-mt` no nome.)

7. **Portfolio público funciona.** Em `/portfolio`, define um slug, marca
   como público, abre `https://seu-dominio.vercel.app/p/<slug>` em aba
   anônima — deve listar os vídeos.

8. **Thumbnails carregam.** Suba um MP4 em `/portfolio`. A thumbnail deve
   aparecer na lista. Se não aparecer e o console mostrar erro de CORP, os
   headers COEP ainda estão em `require-corp` — volta em `vercel.json` e
   confirma que está `credentialless`.

9. **Drag & drop.** Em `/portfolio` com 2+ vídeos na mesma categoria, arrasta
   um para outra posição. A ordem deve persistir após F5.

---

## 6. Troubleshooting comum

**"SharedArrayBuffer is not defined" no compressor/acelerador.**
COOP/COEP não estão chegando. Verifica `vercel.json` e força rebuild com
`vercel deploy --prod --force`.

**Login com Google redireciona pra localhost.**
Em **Supabase → Authentication → URL Configuration**, atualiza **Site URL**
pra URL de produção. No Google Cloud Console, atualiza também o redirect URI
se o domínio mudou.

**Upload de vídeo falha com "row violates row-level security".**
A policy de storage não tá batendo. Confirma que `002_storage.sql` rodou
completo — os buckets precisam existir E as policies precisam ter o path
prefix `{user_id}/` no condicional.

**Thumbnail não gera, só vídeo faz upload.**
`generateThumbnail` usa `<video>` + canvas. Alguns codecs (HEVC, VP9 10-bit)
não rodam no `<video>` do browser. A função captura o erro e segue com
`thumbnail_url = null`, então o item sobe sem thumbnail. Comportamento
esperado — use MP4 H.264 pra ter thumbnail garantida.

**FFmpeg demora muito pra carregar na primeira vez.**
Normal: o core WASM tem ~30MB. A partir da segunda sessão, carrega do Cache
API (ver `cachedBlobURL` em `lib/ffmpeg-worker.ts`). Se quiser forçar
re-download, chama `clearFFmpegCache()`.
