# `autoedit` — CLI do AutoEdit

Controle o AutoEdit (darkoautoedit.com) pela linha de comando: dispara
ferramentas, sobe arquivos e fala com **qualquer** rota `/api`. Feito pra ser
dirigido por humano, pelo Claude (via Bash), por cron ou CI.

- **Zero-dependência** — Node 18+ puro (`fetch`/`FormData` nativos). Sem build, sem `npm install`.
- **1 arquivo** — [`cli/autoedit.mjs`](./autoedit.mjs).

## Como funciona a autenticação

Toda rota `/api/*` do app autentica por **cookie de sessão do browser**. O CLI
não tem cookie — então existe uma **chave de máquina** (`AUTOEDIT_CLI_KEY`)
enviada no header `x-autoedit-key`. O servidor a valida em `lib/cli-auth.ts` e
concede **tier admin** (controle total).

> ⚠️ **Trate `AUTOEDIT_CLI_KEY` como senha-mestra.** Quem tiver a chave controla
> o app inteiro pela API. Fica **desligada por padrão**: sem a env na Vercel (ou
> com chave < 24 chars), o caminho de máquina é inerte e nada muda no app.

### Setup (uma vez)

1. **Gerar a chave** e setá-la no ambiente da **Vercel** (Production) como `AUTOEDIT_CLI_KEY`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   (Opcional: `AUTOEDIT_CLI_USER_ID` = seu user id no Supabase, pra atribuir
   uploads/jobs a uma conta real.) Faça redeploy pra a env valer.

2. **Configurar o CLI** na sua máquina:
   ```bash
   node cli/autoedit.mjs config --key <a-chave-gerada>
   # opcional p/ dev: --url http://localhost:3000
   node cli/autoedit.mjs whoami        # deve mostrar tier admin
   ```
   A config fica em `~/.autoedit/config.json`. Variáveis de ambiente
   (`AUTOEDIT_CLI_KEY`, `AUTOEDIT_URL`) sempre vencem o arquivo.

3. (Opcional) **Instalar global** pra chamar só `autoedit`:
   ```bash
   npm link        # na raiz do repo → cria o comando `autoedit`
   ```

## Comandos

```
autoedit whoami                                  testa a conexão (identidade + tier)
autoedit config --url <url> --key <chave>        salva config | config show | config path
autoedit tools                                   lista as rotas conhecidas

autoedit lipsync --video <f|url> --audio <f|url> [--out a.mp4] [--audio-ms N]
autoedit separar-audio <f|url> [--out-dir pasta]
autoedit upload <arquivo> [--tool lipsync|separador] [--kind video|audio]

autoedit call <MÉTODO> <caminho> [--json '<body>'] [--data k=v] [--query k=v]
```

### Exemplos

```bash
# Lipsync ponta-a-ponta: sobe rosto + voz, dispara, faz poll e baixa o MP4
autoedit lipsync --video rosto.mp4 --audio voz.mp3 --out resultado.mp4

# Separar uma música nas 4 trilhas
autoedit separar-audio musica.mp3 --out-dir ./stems

# Escape hatch — QUALQUER rota /api autenticada:
autoedit call GET  /api/heygen/avatars --query motor=V --query q=ana
autoedit call POST /api/admin/set-tier --json '{"userId":"…","tier":"pro"}'
```

`call` é a garantia de **controle total**: as ~70 rotas do app são alcançáveis
mesmo antes de ganharem um comando dedicado. Os comandos tipados (lipsync,
separar-audio) são só açúcar que encadeia upload → disparo → poll → download.

## Arquitetura

```
cli/core.mjs               ← núcleo: client HTTP + auth + upload + poll (SEM stdout)
cli/autoedit.mjs           ← casca CLI (UI + comandos) sobre o core
mcp/autoedit-mcp.mjs       ← casca MCP (tools nativas) sobre o MESMO core
lib/cli-auth.ts            ← valida x-autoedit-key → identidade de máquina (admin)
app/api/cli/whoami         ← health-check + bootstrap (config pública do Supabase)
```

Um núcleo, duas cascas — zero duplicação. A auth de máquina está plugada nos 3
gates do app (`requireTier`, `requirePro`, `requireAdmin`), então **toda** rota
que usa um desses gates já obedece o CLI/MCP.

## MCP (tools nativas pro Claude)

Já pronto: [`mcp/autoedit-mcp.mjs`](../mcp/README.md). Registre com
`claude mcp add autoedit -s user -- node "<repo>/mcp/autoedit-mcp.mjs"` e o
Claude passa a chamar `autoedit_lipsync`, `autoedit_separar_audio`,
`autoedit_call` etc. direto, sem você digitar comando.
