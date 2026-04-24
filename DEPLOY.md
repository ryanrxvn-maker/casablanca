# DARKO LAB — Guia de deploy

Passo a passo para colocar o DARKO LAB em produção na Vercel com Supabase +
chaves das APIs de IA (Anthropic, AssemblyAI, ElevenLabs).

Leva cerca de 25-40 minutos se você já tem conta nos serviços.

---

## 1. Supabase — criar projeto e rodar migrations

1. Acesse [supabase.com](https://supabase.com) e crie um novo projeto.
   - Escolha a região `South America (São Paulo)` se a maioria dos usuários
     for BR.
   - Anote a senha do banco em local seguro (ela não é mostrada depois).
   - Aguarde ~2 minutos para o projeto provisionar.

2. No painel do projeto, vá em **SQL Editor → New query** e rode os scripts
   em `supabase/migrations/` **em ordem numérica** (001 → 008). Cola um por
   um e clica em **Run**.

   Resumo do que cada migração faz (o que importa pro DARKO LAB atual está
   concentrado em 001, 006 e 008):

   - `001_init.sql` — cria a tabela `profiles` (espelho do `auth.users`),
     policies de RLS e o trigger `handle_new_user` que insere um profile
     automaticamente no signup.
   - `002_storage.sql` → `005_agenda.sql` — migrações legadas que criavam
     buckets de portfolio, agenda, etc. Rodá-las em projetos **novos** não é
     obrigatório; a migration 008 remove tudo que elas criavam. Se o projeto
     for do zero, pode pular direto pra 006.
   - `006_profile_upgrade.sql` — cria o bucket de Storage `avatars` com RLS
     (upload de foto de perfil em `/configuracoes`).
   - `007_darko_visibility.sql` — ajustes de schema legados. Pode rodar ou
     pular em projetos novos.
   - `008_remove_portfolio_agenda.sql` — **obrigatória no DARKO LAB atual.**
     Limpa todas as tabelas, buckets e RPCs de portfolio/agenda que foram
     removidos do produto. Em projetos novos que nunca rodaram 002-005 ela é
     idempotente (todos os `drop ... if exists` viram no-op).

   **Projeto novo, caminho rápido**: rode apenas `001` → `006` → `008`.
   **Projeto existente com deploys antigos**: rode tudo 001 → 008 em ordem.

3. Em **Authentication → Email Templates → Confirm signup**, troque o corpo
   padrão para usar `{{ .Token }}` em vez de `{{ .ConfirmationURL }}`. O
   fluxo de cadastro (`/register` → `/verify`) espera um código numérico de
   6 dígitos. Exemplo:

   ```
   Seu código de confirmação: {{ .Token }}
   ```

4. Em **Project Settings → API**, copie:
   - **Project URL** (formato `https://xxxxx.supabase.co`)
   - **anon public** key (formato `ey...`)

   Guarde — vão no `.env.local` e na Vercel.

---

## 2. (Opcional) Google OAuth

Se quiser login com Google:

1. No [Google Cloud Console](https://console.cloud.google.com), crie um
   projeto.
2. Em **APIs & Services → Credentials**, crie **OAuth 2.0 Client ID** do
   tipo *Web application*.
3. Em **Authorized redirect URIs**, adicione:
   ```
   https://<seu-projeto>.supabase.co/auth/v1/callback
   ```
4. Copie **Client ID** e **Client secret**.
5. No Supabase, **Authentication → Providers → Google**: habilita e cola as
   strings.
6. Em **Authentication → URL Configuration**:
   - **Site URL**: `https://seu-dominio.vercel.app`
   - **Redirect URLs**: `https://seu-dominio.vercel.app/auth/callback`

---

## 3. Chaves das APIs de IA

A AI Suite precisa de três chaves. Sem elas, as rotas `/tools/auto-broll` e
`/tools/troca-produto` respondem com erro mas o resto do app continua
funcionando.

### 3.1 Anthropic (Claude) — Auto B-Roll

1. Acesse [console.anthropic.com](https://console.anthropic.com).
2. **Settings → API Keys → Create Key**.
3. Copie a chave no formato `sk-ant-...`.
4. Abasteça a conta com créditos (pay-as-you-go). Um run de Auto B-Roll
   típico consome menos de $0,05.

### 3.2 AssemblyAI — Troca de Produto (transcrição)

1. Acesse [assemblyai.com](https://www.assemblyai.com) e faça signup.
2. No dashboard, copie a **API Key** da sidebar.
3. O free tier dá algumas horas de transcrição grátis. Depois é
   pay-as-you-go (~$0,65/hora no plano padrão no momento da escrita — cheque
   o pricing atual).

### 3.3 ElevenLabs — Troca de Produto (voice clone + TTS)

1. Acesse [elevenlabs.io](https://elevenlabs.io) e faça signup.
2. **Profile → API Keys → Create**.
3. Plano Starter ou superior é recomendado — o free tier **não permite
   Instant Voice Clone**, que é obrigatório pra Troca de Produto.

### 3.4 (Opcional) Replicate — separação voz/música

Se no futuro a Troca de Produto for estendida pra isolar a voz antes da
clonagem (via Demucs), precisa de uma chave do Replicate. Não é usada hoje,
mas a variável fica no `.env.local.example` pra caso.

---

## 4. Testar localmente antes do deploy

1. Crie `.env.local`:
   ```bash
   cp .env.local.example .env.local
   ```

2. Edite com todos os valores:
   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000

   # AI Suite
   ANTHROPIC_API_KEY=sk-ant-...
   ASSEMBLYAI_API_KEY=...
   ELEVENLABS_API_KEY=...

   # Opcional
   REPLICATE_API_TOKEN=
   ```

3. Rode o build:
   ```bash
   npm install
   npm run build
   ```
   Deve mostrar `✓ Compiled successfully`.

4. Sobe o dev server:
   ```bash
   npm run dev
   ```
   - Abra <http://localhost:3000>.
   - Cria conta em `/register`, loga.
   - `/tools/audio-split` com um MP3 pequeno → confirma que FFmpeg WASM
     roda.
   - `/tools/auto-broll` com copy curta → confirma Claude respondendo.
   - `/tools/troca-produto` com um áudio curto → confirma AssemblyAI +
     ElevenLabs end-to-end.

---

## 5. Deploy na Vercel

### Opção A: via CLI

```bash
npm install -g vercel
vercel login
vercel deploy              # preview
vercel deploy --prod       # produção
```

Na primeira vez:
- Link com projeto existente? **No**
- Nome: `darko-lab` (ou outro)
- Diretório: `./`
- Override settings? **No**

### Opção B: via dashboard

1. <https://vercel.com/new>
2. Importa repositório Git.
3. Framework: **Next.js** (auto-detect).

### Env vars na Vercel

**Project Settings → Environment Variables**, marcando Production +
Preview + Development:

| Nome                              | Exemplo                                   |
| --------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | `https://seu-projeto.supabase.co`         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | `ey...`                                   |
| `NEXT_PUBLIC_SITE_URL`            | `https://seu-dominio.vercel.app`          |
| `ANTHROPIC_API_KEY`               | `sk-ant-...`                              |
| `ASSEMBLYAI_API_KEY`              | `...`                                     |
| `ELEVENLABS_API_KEY`              | `...`                                     |
| `REPLICATE_API_TOKEN`             | (opcional, deixe vazio se não usar)       |

Depois força rebuild:
```bash
vercel deploy --prod --force
```

---

## 6. Pós-deploy — checklist de validação

Abra a URL de produção e valide:

1. **Home redireciona.** `/` → `/login` deslogado, `/tools` logado.

2. **Signup + email.** Cria conta, recebe o código de 6 dígitos, confirma
   em `/verify`, cai em `/tools`.

3. **OAuth (se configurou).** Login com Google volta logado em `/tools`.

4. **Configurações.** `/configuracoes` abre, permite editar nome, trocar
   senha, fazer upload de avatar.

5. **Base Suite.**
   - `/tools/audio-split`: processa MP3 pequeno, baixa ZIP com
     `parte1.wav`, `parte2.wav`, ...
   - `/tools/compressor`: comprime MP4 pequeno.
   - `/tools/decupagem`, `/tools/camuflagem`, `/tools/acelerador`,
     `/tools/calculadora`: sanity check visual de cada uma.

6. **crossOriginIsolated.** DevTools console:
   ```js
   window.crossOriginIsolated
   ```
   Deve retornar `true`. Se `false`, os headers COOP/COEP do `vercel.json`
   não estão chegando — force rebuild.

7. **FFmpeg MT.** Em `/tools/compressor`, processa um MP4 de ~30s. No
   Network tab deve aparecer o download de `@ffmpeg/core-mt` (com `core-mt`
   no path), indicando que a variante multi-thread foi carregada.

8. **AI Suite — Auto B-Roll.** Em `/tools/auto-broll`, preenche público +
   persona + copy curta (3-4 frases), clica em gerar. Em < 20s deve
   aparecer a tabela de cenas + video prompts + JSON do Nano Banana. Se der
   erro 401, `ANTHROPIC_API_KEY` não chegou na Vercel.

9. **AI Suite — Troca de Produto.** Sobe um áudio de ~1 min com menção a
   um produto. Confirma:
   - AssemblyAI retornou transcript com matches do `word_boost`.
   - Ao confirmar, o ElevenLabs clona a voz (leva ~5s).
   - O TTS gera o nome novo na voz clonada.
   - FFmpeg WASM emenda o MP3 final. A voz clonada é deletada ao final
     (ver aba Voices no ElevenLabs — não deve acumular voice temp).

10. **Banco limpo.** No SQL Editor do Supabase:
    ```sql
    select table_name from information_schema.tables
     where table_schema='public' and table_name in
       ('portfolio_items','portfolio_categories','agenda_tasks',
        'agenda_occurrences');
    ```
    Deve retornar 0 linhas. Se retornar algum, a migration 008 não rodou.

---

## 7. Troubleshooting comum

**"SharedArrayBuffer is not defined" no compressor/acelerador.**
COOP/COEP não estão chegando. Verifica `vercel.json` e força rebuild com
`vercel deploy --prod --force`.

**Login com Google redireciona pra localhost.**
Em **Supabase → Authentication → URL Configuration**, atualiza **Site URL**
pra URL de produção. No Google Cloud Console, atualiza também o redirect
URI se o domínio mudou.

**Auto B-Roll retorna 500.**
Checa logs da função `/api/auto-broll` na Vercel. 99% das vezes é
`ANTHROPIC_API_KEY` ausente ou sem créditos na conta Anthropic.

**Troca de Produto falha na transcrição.**
AssemblyAI demora até ~4 min em áudios longos. A rota tem timeout de 4min.
Se passar disso, divide o áudio antes (`/tools/audio-split`) e roda em
blocos.

**ElevenLabs "voice_clone_not_allowed_on_free_plan".**
Exatamente isso: free tier não clona. Precisa de Starter ou superior.

**Voice clone não foi deletada após o uso.**
A rota `elevenlabs-delete` roda no `finally` do frontend. Se o usuário
fechou a aba no meio, a voice pode ficar órfã. Limpa manualmente no
dashboard da ElevenLabs (Voices → temp).

**FFmpeg demora muito na primeira vez.**
Normal: o core WASM tem ~30MB. A partir da segunda sessão carrega do Cache
API (ver `cachedBlobURL` em `lib/ffmpeg-worker.ts`). Se quiser forçar
re-download, chama `clearFFmpegCache()` no console.

---

## 8. Custos estimados (referência)

Para dimensionar quanto custa rodar o DARKO LAB em produção com uso real:

- **Supabase**: free tier cobre até 500MB de banco + 1GB de storage.
  Suficiente pra centenas de usuários dado que o app quase não escreve no
  banco (só profiles + avatars).
- **Vercel**: Hobby tier cobre deploys pessoais. Pro ($20/mo) recomendado
  se passar de uns 100k requests/mês.
- **Anthropic (Claude Sonnet 4.5)**: ~$0,02-0,05 por run do Auto B-Roll.
- **AssemblyAI**: ~$0,65/hora de áudio transcrito.
- **ElevenLabs Starter** ($5/mo): inclui 30k chars de TTS, voice clone
  habilitado. Um run típico de Troca de Produto usa ~300 chars.

Projeção: um usuário rodando 10 Auto B-Rolls + 10 Trocas de Produto de
20min por mês custa aprox. $0,50 (Claude) + $2,20 (AssemblyAI) + plano
Starter da ElevenLabs.
