# `autoedit-mcp` — servidor MCP do AutoEdit

Expõe as ferramentas do AutoEdit como **tools nativas** pro Claude (Code e
Desktop). Em vez de digitar comandos, você pede em linguagem natural — "gera um
lipsync com esse rosto e essa voz", "separa as trilhas desse áudio", "lista os
avatares motor V no HeyGen" — e o Claude chama a tool certa.

- **Zero-dependência** — protocolo MCP em stdio puro (Node 18+). Sem build, sem `npm install`.
- **Mesmo núcleo do CLI** ([`../cli/core.mjs`](../cli/core.mjs)) — mesma config (`~/.autoedit/config.json`), mesma chave `AUTOEDIT_CLI_KEY`. Se o `autoedit whoami` funciona, o MCP funciona.

## Tools expostas

| Tool | O quê |
|------|-------|
| `autoedit_whoami` | testa a conexão (identidade + tier) |
| `autoedit_lipsync` | gera lipsync: sobe rosto+voz, dispara, aguarda, devolve o MP4 |
| `autoedit_separar_audio` | separa o áudio em 4 trilhas (Demucs) |
| `autoedit_upload` | sobe um arquivo pro Storage e devolve a URL |
| `autoedit_call` | **escape hatch**: chama QUALQUER rota `/api` como admin |

## Registrar

Pré-requisito: a chave já configurada (`autoedit config --key …`) — o MCP lê o
mesmo `~/.autoedit/config.json`.

**Claude Code (CLI):**
```bash
claude mcp add autoedit -s user -- node "D:/Área de Trabalho/CASABLANCA/mcp/autoedit-mcp.mjs"
```
Depois reinicie o Claude Code. Confira com `claude mcp list` (deve aparecer
`autoedit: connected`).

**Claude Desktop** — em `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "autoedit": {
      "command": "node",
      "args": ["D:/Área de Trabalho/CASABLANCA/mcp/autoedit-mcp.mjs"]
    }
  }
}
```

## Testar à mão (sem cliente MCP)

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"autoedit_whoami","arguments":{}}}' \
 | node mcp/autoedit-mcp.mjs
```

## Debug

`AE_DEBUG=1` faz o núcleo logar (no stderr) status HTTP + `x-vercel-id` de cada
request — útil se uma tool retornar erro.

---

## instagram-mcp — Instagram do Auto Edit (@darkoautoedit)

Publica foto, carrossel, story e reel; lê posts, comentários e insights; responde comentário.
Usa a **Instagram Graph API** oficial ("Instagram API with Instagram Login" — não precisa de Página do Facebook).

### 1. Pegar o token (uma vez, ~10 min — só o dono da conta faz)

1. No Instagram, em **@darkoautoedit**: Configurações → *Tipo de conta e ferramentas* → mudar pra **Profissional** (Empresa ou Criador). Sem isso a API não enxerga a conta.
2. Entra em <https://developers.facebook.com/apps> → **Criar app** → caso de uso *Outro* → tipo **Empresa** → nome `Auto Edit Instagram`.
3. No painel do app: **Adicionar produto → Instagram** → *Configuração da API com login do Instagram*.
4. Em **Gerar tokens de acesso** → *Adicionar conta* → loga com @darkoautoedit. Se pedir, aceita o convite de testador no app do Instagram (Configurações → *Site e apps* → *Convites de testador*).
5. Clica **Gerar token** → autoriza as permissões (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`) → copia o token (longa duração, 60 dias).
6. No terminal, na pasta do repo:
   ```bash
   node mcp/instagram-mcp.mjs set-token COLE_O_TOKEN_AQUI
   ```
   Valida no `/me` e salva em `~/.autoedit/instagram.json` (fora do repo). Resposta esperada: `✔ conectado como @darkoautoedit (BUSINESS, N posts)`.

O app pode ficar em **modo desenvolvimento** pra sempre — só a conta de testador (a nossa) precisa funcionar, não tem revisão da Meta.

### 2. Registrar no Claude Code

```bash
claude mcp add instagram -- node "D:/Área de Trabalho/CASABLANCA/mcp/instagram-mcp.mjs"
```

### 3. Usar

Depois de registrado, o Claude ganha as tools `ig_*`. Exemplos do dia a dia:

- *"posta o carrossel da decupagem com a legenda do arquivo"* → `ig_publish_carousel` com os 8 `slide-0N.png` + a legenda
- *"sobe esse story"* → `ig_publish_story`
- *"o que comentaram no último post?"* → `ig_media_list` + `ig_comments`
- *"como foi o alcance do carrossel?"* → `ig_insights`
- a cada ~50 dias: `ig_refresh_token` (o token vale 60)

### Limites da API (da Meta, não nossos)

- 100 publicações por 24 h via API (`ig_quota` mostra o uso)
- Imagem: **JPEG** só (PNG é convertido sozinho), até 8 MB, proporção entre 4:5 e 1.91:1 — os carrosséis 1080×1350 e stories 1080×1920 passam
- Reel: MP4 9:16, H.264/AAC
- **Story via API não tem sticker nem link** — o story "Segue o insta", que precisa do sticker de menção, sobe melhor pelo app
- Arquivo local vira URL pública pelo Storage do AutoEdit (bucket do lipsync; limpo sozinho em 2 h)
