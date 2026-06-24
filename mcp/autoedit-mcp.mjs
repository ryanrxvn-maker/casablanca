#!/usr/bin/env node
/**
 * autoedit-mcp — servidor MCP do AutoEdit (stdio / JSON-RPC 2.0).
 *
 * Expõe as ferramentas do app como TOOLS NATIVAS pro Claude (Code/Desktop):
 * whoami, lipsync, separar_audio, upload e `call` genérico (alcança QUALQUER
 * rota /api). Reusa 100% o núcleo do CLI (../cli/core.mjs) — mesma config
 * (~/.autoedit/config.json), mesma chave de máquina x-autoedit-key.
 *
 * Zero-dependência: implementa o protocolo MCP em stdio puro (Node 18+).
 * NDJSON: cada mensagem é uma linha JSON. stdout é SÓ protocolo; logs vão pro
 * stderr (o núcleo não escreve em stdout).
 *
 * Registrar no Claude Code:
 *   claude mcp add autoedit -- node "<repo>/mcp/autoedit-mcp.mjs"
 * Ou no claude_desktop_config.json:
 *   { "mcpServers": { "autoedit": { "command": "node", "args": ["<repo>/mcp/autoedit-mcp.mjs"] } } }
 */

import {
  api, saveConfig, uploadViaTool, download,
  runLipsync, runSepararAudio, UPLOAD_TOOLS,
} from '../cli/core.mjs';

const NAME = 'autoedit';
const VERSION = '1.1.0';
const DEFAULT_PROTOCOL = '2024-11-05';

// ─── Definição das tools (JSON Schema) ───────────────────────────────────────
const TOOLS = [
  {
    name: 'autoedit_whoami',
    description: 'Testa a conexão com o AutoEdit e retorna a identidade de máquina (userId, email, tier). Use pra confirmar que a chave está válida.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'autoedit_lipsync',
    description: 'Gera lipsync (DreamFace): sobe o vídeo (rosto) e o áudio, dispara e aguarda o render. Retorna a URL do MP4 pronto; se "out" for dado, baixa pra esse caminho. Pode levar minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        video: { type: 'string', description: 'Caminho local OU URL do vídeo com o rosto.' },
        audio: { type: 'string', description: 'Caminho local OU URL do áudio (voz).' },
        out: { type: 'string', description: 'Opcional. Caminho local pra salvar o MP4 resultante.' },
        audio_ms: { type: 'number', description: 'Opcional. Duração do áudio em ms (se omitido, mede com ffprobe). Obrigatório só se "audio" for URL e ffprobe não puder medir.' },
      },
      required: ['video', 'audio'],
      additionalProperties: false,
    },
  },
  {
    name: 'autoedit_separar_audio',
    description: 'Separa um áudio nas 4 trilhas (vocals/drums/bass/other) via Demucs. Retorna as URLs; se "out_dir" for dado, baixa as trilhas nessa pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Caminho local OU URL do áudio.' },
        out_dir: { type: 'string', description: 'Opcional. Pasta local pra salvar as trilhas.' },
      },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'autoedit_upload',
    description: 'Sobe um arquivo local pro Storage do app (via signed upload URL) e retorna a URL pública — útil pra alimentar uma rota depois.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Caminho local do arquivo.' },
        tool: { type: 'string', enum: Object.keys(UPLOAD_TOOLS), description: 'Bucket/ferramenta de destino (default: lipsync).' },
        kind: { type: 'string', enum: ['video', 'audio'], description: 'Opcional. Tipo do arquivo (alguns uploads pedem).' },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
  {
    name: 'autoedit_call',
    description: 'Escape hatch: chama QUALQUER rota /api do AutoEdit autenticada como admin. Use pra rotas sem tool dedicada (heygen, admin, decupagem, etc). Retorna o JSON da resposta.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'GET, POST, etc. Default GET.' },
        path: { type: 'string', description: 'Caminho da rota, ex: /api/heygen/avatars' },
        json: { type: 'object', description: 'Opcional. Corpo JSON pra POST/PUT.' },
        query: { type: 'object', description: 'Opcional. Parâmetros de query string.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

// ─── Implementação das tools ─────────────────────────────────────────────────
async function runTool(name, args = {}) {
  switch (name) {
    case 'autoedit_whoami': {
      const r = await api('GET', '/api/cli/whoami');
      if (r.supabaseUrl && r.supabaseAnonKey) saveConfig({ supabaseUrl: r.supabaseUrl, supabaseAnonKey: r.supabaseAnonKey });
      return r;
    }
    case 'autoedit_lipsync': {
      const r = await runLipsync({ video: args.video, audio: args.audio, audioMs: args.audio_ms });
      if (args.out) {
        const bytes = await download(r.output_video_url, args.out);
        return { ...r, savedTo: { path: args.out, bytes } };
      }
      return r;
    }
    case 'autoedit_separar_audio': {
      const res = await runSepararAudio({ input: args.input });
      if (args.out_dir) {
        const savedTo = {};
        for (const [stem, meta] of Object.entries(res.stems)) {
          if (!meta || !meta.url) continue;
          const p = `${args.out_dir}/${stem}.mp3`;
          savedTo[stem] = { path: p, bytes: await download(meta.url, p) };
        }
        return { stems: res.stems, savedTo };
      }
      return res;
    }
    case 'autoedit_upload': {
      const path = UPLOAD_TOOLS[args.tool || 'lipsync'];
      if (!path) throw new Error(`tool inválida: ${args.tool}. Conhecidas: ${Object.keys(UPLOAD_TOOLS).join(', ')}`);
      const url = await uploadViaTool(path, args.file, { kind: args.kind });
      return { url };
    }
    case 'autoedit_call': {
      const method = (args.method || 'GET').toUpperCase();
      if (!args.path) throw new Error('path é obrigatório.');
      return api(method, args.path, { json: args.json, query: args.query });
    }
    default:
      throw new Error(`tool desconhecida: ${name}`);
  }
}

// ─── Transporte JSON-RPC (stdio / NDJSON) ────────────────────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

let negotiatedProtocol = DEFAULT_PROTOCOL;

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      negotiatedProtocol = typeof requested === 'string' ? requested : DEFAULT_PROTOCOL;
      return reply(id, {
        protocolVersion: negotiatedProtocol,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NAME, version: VERSION },
      });
    }
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const toolName = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const result = await runTool(toolName, args);
        return reply(id, {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        // Erro da tool volta como conteúdo isError (o modelo vê), não erro JSON-RPC.
        return reply(id, {
          content: [{ type: 'text', text: `Erro: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        });
      }
    }
    case 'ping':
      return reply(id, {});
    default:
      if (method && method.startsWith('notifications/')) return; // notificações: sem resposta
      if (!isNotification) return replyError(id, -32601, `método não suportado: ${method}`);
  }
}

// ─── Loop de leitura (NDJSON) ────────────────────────────────────────────────
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      replyError(null, -32700, 'parse error');
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => {
      console.error('[autoedit-mcp] handler error:', e && e.message);
    });
  }
});
// Sem process.exit() no 'end': deixa requisições em andamento concluírem; o
// Node encerra sozinho quando o event loop drena (cliente fechou o stdio).
process.stdin.on('end', () => {});
console.error(`[autoedit-mcp] pronto (${NAME} v${VERSION}) — aguardando JSON-RPC em stdio`);
