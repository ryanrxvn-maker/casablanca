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
