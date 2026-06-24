/**
 * core.mjs — núcleo COMPARTILHADO do AutoEdit (CLI + MCP).
 *
 * Tudo que fala com o app vive aqui: config (~/.autoedit/config.json), o client
 * HTTP autenticado com x-autoedit-key, upload direto pro Supabase Storage,
 * download, ffprobe e poll de job. Sem efeito colateral em stdout (nenhum
 * console.log — só stderr quando AE_DEBUG), pra poder ser usado dentro de um
 * servidor MCP (onde stdout é reservado pro protocolo).
 *
 * Zero-dependência: Node 18+ (fetch/Buffer nativos).
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_URL = 'https://www.darkoautoedit.com';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

// ─── Config ────────────────────────────────────────────────────────────────
export function configPath() {
  return join(homedir(), '.autoedit', 'config.json');
}
export function readConfigFile() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
export function loadConfig() {
  const f = readConfigFile();
  return {
    url: (process.env.AUTOEDIT_URL || f.url || DEFAULT_URL).replace(/\/+$/, ''),
    key: process.env.AUTOEDIT_CLI_KEY || f.key || '',
    supabaseUrl: f.supabaseUrl || '',
    supabaseAnonKey: f.supabaseAnonKey || '',
  };
}
export function saveConfig(patch) {
  const next = { ...readConfigFile(), ...patch };
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ─── HTTP autenticado ────────────────────────────────────────────────────────
export async function api(method, path, { json, query, headers, raw } = {}) {
  const cfg = loadConfig();
  if (!cfg.key) {
    throw new Error('Sem AUTOEDIT_CLI_KEY. Rode: autoedit config --key <sua-chave> (ou exporte AUTOEDIT_CLI_KEY).');
  }
  // Git Bash (MSYS) no Windows converte um arg que começa com "/" num caminho
  // Windows — "/api/x" vira "C:/Program Files/Git/api/x". Recupera a rota real.
  if (!isUrl(path) && path.includes('/api/')) path = path.slice(path.indexOf('/api/'));
  let url = isUrl(path) ? path : cfg.url + (path.startsWith('/') ? path : '/' + path);
  if (query && Object.keys(query).length) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    url = u.toString();
  }
  const h = { 'x-autoedit-key': cfg.key, accept: 'application/json', ...(headers || {}) };
  let body;
  if (json !== undefined) {
    h['content-type'] = 'application/json';
    body = typeof json === 'string' ? json : JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(url, { method, headers: h, body });
  } catch (e) {
    throw new Error(`rede: ${e.message} (${url})`);
  }
  if (process.env.AE_DEBUG) {
    console.error(`[AE_DEBUG] ${method} ${url} -> ${res.status} ct=${res.headers.get('content-type')} redir=${res.redirected} finalUrl=${res.url} vid=${res.headers.get('x-vercel-id')}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && data.error
        ? data.error
        : typeof data === 'string' && data
          ? data.slice(0, 400)
          : `HTTP ${res.status}`;
    const err = new Error(`[${res.status}] ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return raw ? text : data;
}

/** Garante supabaseUrl/anonKey em cache (pega de /api/cli/whoami se faltar). */
export async function ensureSupabaseConfig() {
  let cfg = loadConfig();
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) return cfg;
  const info = await api('GET', '/api/cli/whoami');
  if (!info.supabaseUrl || !info.supabaseAnonKey) {
    throw new Error('Servidor não retornou config do Supabase (NEXT_PUBLIC_* ausentes?).');
  }
  saveConfig({ supabaseUrl: info.supabaseUrl, supabaseAnonKey: info.supabaseAnonKey });
  return loadConfig();
}

// ─── Upload / download / mídia ───────────────────────────────────────────────
const CONTENT_TYPES = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
export const contentTypeFor = (ext) => CONTENT_TYPES[String(ext).toLowerCase()] || 'application/octet-stream';

export const UPLOAD_TOOLS = {
  lipsync: '/api/tools/lipsync/upload-url',
  separador: '/api/separador-audio/upload-url',
};

/**
 * Sobe um arquivo local DIRETO pro Supabase Storage via signed upload URL.
 * Devolve a publicUrl pra alimentar a rota da ferramenta (sem limite 4.5MB da
 * Vercel — o arquivo nunca passa pela função serverless).
 */
export async function uploadViaTool(uploadUrlPath, filePath, { kind } = {}) {
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    throw new Error(`arquivo não encontrado: ${filePath}`);
  }
  const ext = (extname(filePath).slice(1) || 'bin').toLowerCase();
  const body = { ext };
  if (kind) body.kind = kind;

  const meta = await api('POST', uploadUrlPath, { json: body });
  if (!meta || !meta.publicUrl || !meta.token) {
    throw new Error('upload-url não retornou {publicUrl, token}: ' + JSON.stringify(meta));
  }

  const { supabaseAnonKey } = await ensureSupabaseConfig();
  const MARK = '/storage/v1/object/public/';
  const i = meta.publicUrl.indexOf(MARK);
  if (i < 0) throw new Error('publicUrl inesperada: ' + meta.publicUrl);
  const host = meta.publicUrl.slice(0, i);
  const bucketAndPath = meta.publicUrl.slice(i + MARK.length);
  const signUrl = `${host}/storage/v1/object/upload/sign/${bucketAndPath}?token=${encodeURIComponent(meta.token)}`;

  let res;
  try {
    res = await fetch(signUrl, {
      method: 'PUT',
      headers: {
        'content-type': contentTypeFor(ext),
        'x-upsert': 'true',
        'cache-control': '3600',
        apikey: supabaseAnonKey,
        authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: buf,
    });
  } catch (e) {
    throw new Error(`rede no upload p/ Storage: ${e.message}`);
  }
  if (!res.ok) {
    throw new Error(`upload p/ Storage falhou (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return meta.publicUrl;
}

/** Baixa uma URL pra um caminho local. Retorna bytes gravados. */
export async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outPath) || '.', { recursive: true });
  writeFileSync(outPath, buf);
  return buf.length;
}

/** Duração de um áudio/vídeo em ms via ffprobe (precisa do ffprobe no PATH). */
export function durationMs(filePath) {
  let out;
  try {
    out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { encoding: 'utf8' },
    );
  } catch {
    throw new Error('ffprobe não encontrado no PATH (instale o ffmpeg) ou arquivo inválido.');
  }
  const sec = parseFloat(String(out).trim());
  if (!isFinite(sec) || sec <= 0) throw new Error('ffprobe não mediu uma duração válida.');
  return Math.round(sec * 1000);
}

export async function resolveAudioMs(audio, audioMsHint) {
  if (audioMsHint) return Number(audioMsHint);
  if (!isUrl(audio)) return durationMs(audio);
  const tmp = join(tmpdir(), `ae-audio-${process.pid}-${Math.round(performance.now())}.${(audio.split('.').pop() || 'mp3').slice(0, 4)}`);
  await download(audio, tmp);
  try {
    return durationMs(tmp);
  } finally {
    try { unlinkSync(tmp); } catch { /* noop */ }
  }
}

/** Loop de poll genérico. fn(n) → {done:true,value} | {done:false}. */
export async function poll(fn, { intervalMs = 5000, timeoutMs = 30 * 60 * 1000, onTick } = {}) {
  const start = Date.now();
  let n = 0;
  for (;;) {
    const r = await fn(n);
    if (r && r.done) return r.value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout aguardando o job.');
    if (onTick) onTick(++n, Date.now() - start);
    await sleep(intervalMs);
  }
}

// ─── Fluxos de alto nível (compartilhados CLI + MCP) ─────────────────────────

/** Lipsync ponta-a-ponta: sobe (se local), dispara, faz poll e devolve a URL do MP4. */
export async function runLipsync({ video, audio, audioMs, onProgress } = {}) {
  if (!video || !audio) throw new Error('video e audio são obrigatórios (caminho local ou URL).');
  const video_url = isUrl(video) ? video : await uploadViaTool(UPLOAD_TOOLS.lipsync, video, { kind: 'video' });
  const audio_url = isUrl(audio) ? audio : await uploadViaTool(UPLOAD_TOOLS.lipsync, audio, { kind: 'audio' });
  const ms = await resolveAudioMs(audio, audioMs);
  const started = await api('POST', '/api/tools/lipsync', { json: { video_url, audio_url, audio_ms: ms } });
  if (!started.job) throw new Error('servidor não devolveu job: ' + JSON.stringify(started));
  const output_video_url = await poll(
    async () => {
      const s = await api('GET', '/api/tools/lipsync/status', { query: { job: started.job } });
      if (s.status === 'done') return { done: true, value: s.output_video_url };
      if (s.status === 'failed') throw new Error(s.error || 'a geração falhou.');
      return { done: false };
    },
    { intervalMs: 5000, onTick: (_n, el) => onProgress && onProgress(el) },
  );
  return { output_video_url, audio_ms: ms };
}

/** Separa um áudio nas trilhas (Demucs). Devolve { stems: {nome: {url,size}} }. */
export async function runSepararAudio({ input } = {}) {
  if (!input) throw new Error('input é obrigatório (caminho local ou URL).');
  const audioUrl = isUrl(input) ? input : await uploadViaTool(UPLOAD_TOOLS.separador, input, {});
  const filename = isUrl(input) ? 'audio' : input.split(/[\\/]/).pop();
  const res = await api('POST', '/api/separador-audio', { json: { audioUrl, filename } });
  if (!res.stems || !Object.keys(res.stems).length) throw new Error('nenhuma trilha retornada: ' + JSON.stringify(res));
  return res;
}
