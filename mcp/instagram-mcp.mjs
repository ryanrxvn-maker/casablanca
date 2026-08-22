#!/usr/bin/env node
/**
 * instagram-mcp — servidor MCP do Instagram do Auto Edit (@darkoautoedit).
 *
 * Fala com a Instagram Graph API ("Instagram API with Instagram Login" —
 * graph.instagram.com) e expõe pro Claude, como tools nativas:
 *   ig_whoami · ig_publish_image · ig_publish_carousel · ig_publish_story ·
 *   ig_publish_reel · ig_media_list · ig_comments · ig_reply_comment ·
 *   ig_insights · ig_quota · ig_refresh_token
 *
 * Arquivo LOCAL vira URL pública sozinho: a API da Meta só aceita URL, então
 * o servidor sobe o arquivo pro Storage do AutoEdit (mesma rota/bucket do
 * lipsync, via cli/core.mjs) e entrega a URL pra Meta buscar. PNG vira JPEG
 * antes (a Meta só aceita JPEG em imagem) — conversão pelo Python/PIL local.
 *
 * Credencial: ~/.autoedit/instagram.json  { access_token, user_id, username }
 *   Nunca vai pro repo. Pra gravar: `node mcp/instagram-mcp.mjs set-token <TOKEN>`
 *   (valida no /me antes de salvar). Ou a env IG_ACCESS_TOKEN.
 *
 * Registrar no Claude Code:
 *   claude mcp add instagram -- node "<repo>/mcp/instagram-mcp.mjs"
 *
 * Zero-dependência (Node 18+). stdout é SÓ protocolo (NDJSON); logs no stderr.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { uploadViaTool, UPLOAD_TOOLS, isUrl, sleep } from '../cli/core.mjs';

const NAME = 'instagram';
const VERSION = '1.0.0';
const DEFAULT_PROTOCOL = '2024-11-05';
const GRAPH = 'https://graph.instagram.com/v23.0';

// ─── Credencial ──────────────────────────────────────────────────────────────
function credPath() { return join(homedir(), '.autoedit', 'instagram.json'); }
function readCred() {
  if (process.env.IG_ACCESS_TOKEN) {
    return { access_token: process.env.IG_ACCESS_TOKEN, user_id: process.env.IG_USER_ID || null };
  }
  try { return JSON.parse(readFileSync(credPath(), 'utf8')); } catch { return null; }
}
function writeCred(c) {
  mkdirSync(join(homedir(), '.autoedit'), { recursive: true });
  writeFileSync(credPath(), JSON.stringify(c, null, 2));
}
function needCred() {
  const c = readCred();
  if (!c || !c.access_token) {
    throw new Error('Instagram não conectado. Gere o token na conta @darkoautoedit e rode: node mcp/instagram-mcp.mjs set-token <TOKEN>  (veja mcp/README.md).');
  }
  return c;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function graph(method, path, { query = {}, token } = {}) {
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  url.searchParams.set('access_token', token);
  const res = await fetch(url, { method });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Meta ${res.status}: ${e.message || text.slice(0, 300)}${e.error_user_msg ? ' — ' + e.error_user_msg : ''} (code ${e.code ?? '?'}${e.error_subcode ? '/' + e.error_subcode : ''})`);
  }
  return json;
}

async function me(token) {
  return graph('GET', '/me', { token, query: { fields: 'user_id,username,account_type,media_count,name' } });
}
async function resolveUserId(c) {
  if (c.user_id) return c.user_id;
  const m = await me(c.access_token);
  c.user_id = m.user_id || m.id; c.username = m.username;
  try { writeCred(c); } catch { /* env-only */ }
  return c.user_id;
}

// ─── Arquivo local → URL pública ─────────────────────────────────────────────
function pngToJpeg(src) {
  const out = join(tmpdir(), `ig-${Date.now()}-${basename(src, extname(src))}.jpg`);
  const py = [
    'from PIL import Image; import sys',
    'im = Image.open(sys.argv[1]).convert("RGBA")',
    'bg = Image.new("RGBA", im.size, (8,8,10,255)); bg.alpha_composite(im)',
    'bg.convert("RGB").save(sys.argv[2], "JPEG", quality=95, subsampling=0, optimize=True)',
  ].join('; ');
  for (const exe of ['python', 'python3', 'py']) {
    try { execFileSync(exe, ['-c', py, src, out], { stdio: ['ignore', 'ignore', 'pipe'] }); return out; } catch { /* tenta o próximo */ }
  }
  throw new Error('Não consegui converter PNG→JPEG (precisa de Python com Pillow). Converta antes e passe o .jpg.');
}

/** Aceita caminho local ou URL; devolve URL pública (JPEG para imagem). */
async function toPublicUrl(src, kind /* 'image' | 'video' */) {
  if (isUrl(src)) return src;
  if (!existsSync(src)) throw new Error(`arquivo não encontrado: ${src}`);
  let path = src; let tmp = null;
  const ext = extname(src).toLowerCase();
  if (kind === 'image' && ext !== '.jpg' && ext !== '.jpeg') { tmp = pngToJpeg(src); path = tmp; }
  if (kind === 'video' && ext !== '.mp4' && ext !== '.mov') throw new Error('vídeo precisa ser MP4 ou MOV.');
  try {
    // bucket público do app (mesmo do lipsync). A Meta busca a URL na hora de publicar.
    return await uploadViaTool(UPLOAD_TOOLS.lipsync, path, { kind: kind === 'video' ? 'video' : 'video' });
  } finally {
    if (tmp) { try { unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

// ─── Publicação ──────────────────────────────────────────────────────────────
async function waitContainer(id, token, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const s = await graph('GET', `/${id}`, { token, query: { fields: 'status_code,status' } });
    if (s.status_code === 'FINISHED') return s;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`container ${id}: ${s.status_code} — ${s.status || ''}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`container ${id} não ficou pronto em ${timeoutMs / 1000}s (status ${s.status_code}).`);
    await sleep(4000);
  }
}
async function publish(uid, creationId, token) {
  const r = await graph('POST', `/${uid}/media_publish`, { token, query: { creation_id: creationId } });
  const info = await graph('GET', `/${r.id}`, { token, query: { fields: 'id,permalink,media_type,timestamp' } }).catch(() => ({ id: r.id }));
  return info;
}

async function publishImage(c, { file, caption }) {
  const uid = await resolveUserId(c);
  const image_url = await toPublicUrl(file, 'image');
  const cont = await graph('POST', `/${uid}/media`, { token: c.access_token, query: { image_url, caption: caption || '' } });
  return publish(uid, cont.id, c.access_token);
}

async function publishCarousel(c, { files, caption }) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 10) throw new Error('carrossel: de 2 a 10 arquivos.');
  const uid = await resolveUserId(c);
  const children = [];
  for (const f of files) {
    const isVideo = /\.(mp4|mov)$/i.test(f);
    const url = await toPublicUrl(f, isVideo ? 'video' : 'image');
    const q = isVideo ? { media_type: 'VIDEO', video_url: url, is_carousel_item: true } : { image_url: url, is_carousel_item: true };
    const cont = await graph('POST', `/${uid}/media`, { token: c.access_token, query: q });
    if (isVideo) await waitContainer(cont.id, c.access_token);
    children.push(cont.id);
  }
  const parent = await graph('POST', `/${uid}/media`, { token: c.access_token, query: { media_type: 'CAROUSEL', children: children.join(','), caption: caption || '' } });
  await waitContainer(parent.id, c.access_token, { timeoutMs: 3 * 60 * 1000 }).catch(() => null);
  return publish(uid, parent.id, c.access_token);
}

async function publishStory(c, { file }) {
  const uid = await resolveUserId(c);
  const isVideo = /\.(mp4|mov)$/i.test(file) || (isUrl(file) && /\.(mp4|mov)(\?|$)/i.test(file));
  const url = await toPublicUrl(file, isVideo ? 'video' : 'image');
  const q = isVideo ? { media_type: 'STORIES', video_url: url } : { media_type: 'STORIES', image_url: url };
  const cont = await graph('POST', `/${uid}/media`, { token: c.access_token, query: q });
  await waitContainer(cont.id, c.access_token);
  return publish(uid, cont.id, c.access_token);
}

async function publishReel(c, { file, caption, cover, share_to_feed = true }) {
  const uid = await resolveUserId(c);
  const video_url = await toPublicUrl(file, 'video');
  const q = { media_type: 'REELS', video_url, caption: caption || '', share_to_feed: share_to_feed ? 'true' : 'false' };
  if (cover) q.cover_url = await toPublicUrl(cover, 'image');
  const cont = await graph('POST', `/${uid}/media`, { token: c.access_token, query: q });
  await waitContainer(cont.id, c.access_token);
  return publish(uid, cont.id, c.access_token);
}

// ─── Leitura ─────────────────────────────────────────────────────────────────
async function mediaList(c, { limit = 12 }) {
  return graph('GET', '/me/media', { token: c.access_token, query: { limit, fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count' } });
}
async function comments(c, { media_id, limit = 50 }) {
  return graph('GET', `/${media_id}/comments`, { token: c.access_token, query: { limit, fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}' } });
}
async function replyComment(c, { comment_id, message }) {
  if (!message) throw new Error('message é obrigatório.');
  return graph('POST', `/${comment_id}/replies`, { token: c.access_token, query: { message } });
}
async function insights(c, { media_id, metrics }) {
  const metric = metrics || 'reach,saved,likes,comments,shares,total_interactions';
  return graph('GET', `/${media_id}/insights`, { token: c.access_token, query: { metric } });
}
async function quota(c) {
  const uid = await resolveUserId(c);
  return graph('GET', `/${uid}/content_publishing_limit`, { token: c.access_token, query: { fields: 'quota_usage,config' } });
}
async function refreshToken(c) {
  const r = await graph('GET', '/refresh_access_token', { token: c.access_token, query: { grant_type: 'ig_refresh_token' } });
  c.access_token = r.access_token; c.expires_at = new Date(Date.now() + (r.expires_in || 0) * 1000).toISOString();
  writeCred(c);
  return { ok: true, expires_at: c.expires_at, expires_in_days: Math.round((r.expires_in || 0) / 86400) };
}

// ─── Tools (JSON Schema) ─────────────────────────────────────────────────────
const TOOLS = [
  { name: 'ig_whoami', description: 'Confirma a conexão com o Instagram: @, tipo de conta, quantidade de posts e validade do token.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ig_publish_image', description: 'Publica UMA imagem no feed. "file" = caminho local (PNG vira JPEG sozinho) ou URL pública. Retorna o permalink.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, caption: { type: 'string', description: 'Legenda (hashtags inclusas). Até 2.200 chars.' } }, required: ['file'], additionalProperties: false } },
  { name: 'ig_publish_carousel', description: 'Publica um CARROSSEL (2 a 10 itens) no feed, na ordem dada. Itens = caminhos locais ou URLs (imagem ou MP4).',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10 }, caption: { type: 'string' } }, required: ['files'], additionalProperties: false } },
  { name: 'ig_publish_story', description: 'Publica um STORY (imagem 1080x1920 ou vídeo MP4). Stories via API não têm sticker/link — só a mídia.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'], additionalProperties: false } },
  { name: 'ig_publish_reel', description: 'Publica um REEL (MP4 9:16). Aguarda o processamento da Meta (pode levar minutos).',
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, caption: { type: 'string' }, cover: { type: 'string', description: 'Opcional: imagem de capa.' }, share_to_feed: { type: 'boolean', default: true } }, required: ['file'], additionalProperties: false } },
  { name: 'ig_media_list', description: 'Lista os últimos posts (id, legenda, tipo, permalink, curtidas, comentários).', inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 12 } }, additionalProperties: false } },
  { name: 'ig_comments', description: 'Lê os comentários de um post (com respostas).', inputSchema: { type: 'object', properties: { media_id: { type: 'string' }, limit: { type: 'integer', default: 50 } }, required: ['media_id'], additionalProperties: false } },
  { name: 'ig_reply_comment', description: 'Responde um comentário. ATENÇÃO: publica em nome do @darkoautoedit — confirme o texto com o Silas antes.', inputSchema: { type: 'object', properties: { comment_id: { type: 'string' }, message: { type: 'string' } }, required: ['comment_id', 'message'], additionalProperties: false } },
  { name: 'ig_insights', description: 'Métricas de um post: reach, saved, likes, comments, shares, total_interactions (padrão) — ou passe "metrics".', inputSchema: { type: 'object', properties: { media_id: { type: 'string' }, metrics: { type: 'string' } }, required: ['media_id'], additionalProperties: false } },
  { name: 'ig_quota', description: 'Quantas publicações via API já foram feitas nas últimas 24h (limite da Meta: 100).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ig_refresh_token', description: 'Renova o token de longa duração (vale 60 dias; renove antes de vencer).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

async function runTool(name, args = {}) {
  const c = needCred();
  switch (name) {
    case 'ig_whoami': {
      const m = await me(c.access_token);
      return { ...m, token_expires_at: c.expires_at || '(desconhecido — rode ig_refresh_token)', cred_file: credPath() };
    }
    case 'ig_publish_image': return publishImage(c, args);
    case 'ig_publish_carousel': return publishCarousel(c, args);
    case 'ig_publish_story': return publishStory(c, args);
    case 'ig_publish_reel': return publishReel(c, args);
    case 'ig_media_list': return mediaList(c, args);
    case 'ig_comments': return comments(c, args);
    case 'ig_reply_comment': return replyComment(c, args);
    case 'ig_insights': return insights(c, args);
    case 'ig_quota': return quota(c);
    case 'ig_refresh_token': return refreshToken(c);
    default: throw new Error(`tool desconhecida: ${name}`);
  }
}

// ─── CLI de setup (fora do MCP) ──────────────────────────────────────────────
//   node mcp/instagram-mcp.mjs set-token <TOKEN>   → valida no /me e salva
//   node mcp/instagram-mcp.mjs whoami
if (process.argv[2] === 'set-token' || process.argv[2] === 'whoami') {
  const cmd = process.argv[2];
  (async () => {
    const token = cmd === 'set-token' ? process.argv[3] : (readCred() || {}).access_token;
    if (!token) { console.error('uso: node mcp/instagram-mcp.mjs set-token <TOKEN>'); process.exit(2); }
    const m = await me(token);
    if (cmd === 'set-token') {
      const cur = readCred() || {};
      writeCred({ ...cur, access_token: token, user_id: m.user_id || m.id, username: m.username, saved_at: new Date().toISOString() });
      console.log(`✔ conectado como @${m.username} (${m.account_type}, ${m.media_count} posts) — salvo em ${credPath()}`);
    } else {
      console.log(JSON.stringify(m, null, 2));
    }
  })().catch((e) => { console.error('✖', e.message); process.exit(1); });
} else {
  // ─── Transporte JSON-RPC (stdio / NDJSON) ─────────────────────────────────
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  let negotiatedProtocol = DEFAULT_PROTOCOL;

  async function handle(msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        negotiatedProtocol = typeof requested === 'string' ? requested : DEFAULT_PROTOCOL;
        return reply(id, { protocolVersion: negotiatedProtocol, capabilities: { tools: { listChanged: false } }, serverInfo: { name: NAME, version: VERSION } });
      }
      case 'tools/list': return reply(id, { tools: TOOLS });
      case 'tools/call': {
        const toolName = params && params.name; const args = (params && params.arguments) || {};
        try {
          const result = await runTool(toolName, args);
          return reply(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: `Erro: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
        }
      }
      case 'ping': return reply(id, {});
      default:
        if (method && method.startsWith('notifications/')) return;
        if (!isNotification) return replyError(id, -32601, `método não suportado: ${method}`);
    }
  }

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk; let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { replyError(null, -32700, 'parse error'); continue; }
      Promise.resolve(handle(msg)).catch((e) => console.error('[instagram-mcp] handler error:', e && e.message));
    }
  });
  process.stdin.on('end', () => { /* deixa requisições em voo terminarem */ });
}
