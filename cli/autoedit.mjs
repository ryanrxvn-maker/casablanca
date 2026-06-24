#!/usr/bin/env node
/**
 * autoedit — CLI oficial do AutoEdit (darkoautoedit.com)
 *
 * Controle server-to-server do app pela linha de comando: dispara ferramentas
 * (lipsync, separador de áudio, etc.), sobe arquivos, e fala com QUALQUER rota
 * /api via `call`. Pensado pra ser dirigido por humano OU pelo Claude (via
 * Bash), cron e CI.
 *
 * Zero-dependência: roda em Node 18+ puro (fetch/FormData nativos). Sem build,
 * sem npm install.
 *
 * Auth: header `x-autoedit-key` = AUTOEDIT_CLI_KEY (a mesma chave setada no
 * ambiente da Vercel). Veja `autoedit config` e `autoedit whoami`.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, extname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const VERSION = '1.0.0';
const DEFAULT_URL = 'https://www.darkoautoedit.com';

// ─────────────────────────────────────────────────────────────────────────
// UI (cores opcionais — desligadas se não for TTY ou NO_COLOR)
// ─────────────────────────────────────────────────────────────────────────
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  blue: (s) => paint('34', s),
  cyan: (s) => paint('36', s),
};
const ok = (s) => console.log(`${c.green('✓')} ${s}`);
const info = (s) => console.log(`${c.cyan('›')} ${s}`);
const warn = (s) => console.error(`${c.yellow('!')} ${s}`);
function die(msg, code = 1) {
  console.error(`${c.red('✗')} ${msg instanceof Error ? msg.message : msg}`);
  process.exit(code);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────
// Config (~/.autoedit/config.json) — env sempre vence o arquivo
// ─────────────────────────────────────────────────────────────────────────
function configPath() {
  return join(homedir(), '.autoedit', 'config.json');
}
function readConfigFile() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
function loadConfig() {
  const f = readConfigFile();
  return {
    url: (process.env.AUTOEDIT_URL || f.url || DEFAULT_URL).replace(/\/+$/, ''),
    key: process.env.AUTOEDIT_CLI_KEY || f.key || '',
    supabaseUrl: f.supabaseUrl || '',
    supabaseAnonKey: f.supabaseAnonKey || '',
  };
}
function saveConfig(patch) {
  const next = { ...readConfigFile(), ...patch };
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}
const maskKey = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) + ` (${k.length} chars)` : '(vazio)');

// ─────────────────────────────────────────────────────────────────────────
// Parser de argumentos (flags longas --k v / --k=v / --flag; repetíveis viram array)
// ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('--')) {
      a = a.slice(2);
      let val;
      if (a.includes('=')) {
        const idx = a.indexOf('=');
        val = a.slice(idx + 1);
        a = a.slice(0, idx);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        val = argv[++i];
      } else {
        val = true;
      }
      if (a in flags) flags[a] = (Array.isArray(flags[a]) ? flags[a] : [flags[a]]).concat(val);
      else flags[a] = val;
    } else if (a === '-h') {
      flags.help = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}
/** "k=v" (ou array delas) → { k: v }. */
function collectKv(v) {
  if (!v) return {};
  const arr = Array.isArray(v) ? v : [v];
  const out = {};
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const i = item.indexOf('=');
    if (i < 0) continue;
    out[item.slice(0, i)] = item.slice(i + 1);
  }
  return out;
}
const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

// ─────────────────────────────────────────────────────────────────────────
// HTTP core — toda chamada autenticada com x-autoedit-key
// ─────────────────────────────────────────────────────────────────────────
async function api(method, path, { json, query, headers, raw } = {}) {
  const cfg = loadConfig();
  if (!cfg.key) {
    die('Sem AUTOEDIT_CLI_KEY. Rode: autoedit config --key <sua-chave>  (ou exporte AUTOEDIT_CLI_KEY)');
  }
  let url = isUrl(path) ? path : cfg.url + (path.startsWith('/') ? path : '/' + path);
  if (query && Object.keys(query).length) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
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
async function ensureSupabaseConfig() {
  let cfg = loadConfig();
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) return cfg;
  const info_ = await api('GET', '/api/cli/whoami');
  if (!info_.supabaseUrl || !info_.supabaseAnonKey) {
    throw new Error('Servidor não retornou config do Supabase (NEXT_PUBLIC_* ausentes?).');
  }
  saveConfig({ supabaseUrl: info_.supabaseUrl, supabaseAnonKey: info_.supabaseAnonKey });
  return loadConfig();
}

const CONTENT_TYPES = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
const contentTypeFor = (ext) => CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream';

/**
 * Sobe um arquivo local DIRETO pro Supabase Storage via signed upload URL
 * emitida por uma rota *-upload-url do app. Devolve a publicUrl pra alimentar
 * a rota da ferramenta. O arquivo NUNCA passa pela Vercel (sem limite 4.5MB).
 */
async function uploadViaTool(uploadUrlPath, filePath, { kind } = {}) {
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

/** Baixa uma URL pra um caminho local. */
async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(outPath) || '.', { recursive: true });
  writeFileSync(outPath, buf);
  return buf.length;
}

/** Duração de um áudio/vídeo em ms via ffprobe (precisa do ffprobe no PATH). */
function durationMs(filePath) {
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

async function resolveAudioMs(audio, flags) {
  if (flags['audio-ms']) return Number(flags['audio-ms']);
  if (!isUrl(audio)) return durationMs(audio);
  const tmp = join(tmpdir(), `ae-audio-${Date.now()}.${(audio.split('.').pop() || 'mp3').slice(0, 4)}`);
  await download(audio, tmp);
  try {
    return durationMs(tmp);
  } finally {
    try { unlinkSync(tmp); } catch { /* noop */ }
  }
}

/** Loop de poll genérico. fn(n) → {done, value} | {done:false}. */
async function poll(fn, { intervalMs = 5000, timeoutMs = 30 * 60 * 1000, onTick } = {}) {
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

// ─────────────────────────────────────────────────────────────────────────
// Registro de rotas conhecidas (pra `autoedit tools`)
// ─────────────────────────────────────────────────────────────────────────
const ROUTES = [
  ['Lipsync (DreamFace)', [
    ['POST', '/api/tools/lipsync', 'inicia geração (async) → { job }'],
    ['GET', '/api/tools/lipsync/status?job=', 'poll do render → { status, output_video_url }'],
    ['POST', '/api/tools/lipsync/upload-url', 'signed URL p/ subir rosto/áudio'],
  ]],
  ['Separador de Áudio (Demucs)', [
    ['POST', '/api/separador-audio', 'separa em 4 trilhas → { stems }'],
    ['POST', '/api/separador-audio/upload-url', 'signed URL p/ subir o áudio'],
  ]],
  ['Decupagem (servidor/Modal)', [
    ['POST', '/api/tools/decupagem/ticket', 'ticket HMAC p/ upload direto no worker'],
    ['POST', '/api/tools/decupagem/start', 'dispara decupagem → { job }'],
    ['GET', '/api/tools/decupagem/status?job=', 'poll da decupagem'],
  ]],
  ['Removedor de Legenda (vmake)', [
    ['POST', '/api/tools/remove-subtitle', 'dispara remoção'],
    ['GET', '/api/tools/remove-subtitle/status', 'poll'],
  ]],
  ['HeyGen', [
    ['GET', '/api/heygen/avatars?q=&motor=', 'lista avatares'],
    ['GET', '/api/heygen/voices', 'lista vozes'],
  ]],
  ['LTX-Video', [
    ['POST', '/api/ltx-video/generate', 'gera vídeo (multipart) — admin'],
    ['GET', '/api/ltx-video/status', 'status do pool/job'],
  ]],
  ['Admin', [
    ['GET', '/api/admin/list-users', 'lista usuários'],
    ['POST', '/api/admin/set-tier', 'muda tier de um usuário'],
    ['GET', '/api/admin/dashboard', 'métricas do app'],
  ]],
  ['CLI', [
    ['GET', '/api/cli/whoami', 'identidade + bootstrap (health-check)'],
  ]],
];

// ─────────────────────────────────────────────────────────────────────────
// Comandos
// ─────────────────────────────────────────────────────────────────────────
async function cmdWhoami() {
  const info_ = await api('GET', '/api/cli/whoami');
  if (info_.supabaseUrl && info_.supabaseAnonKey) {
    saveConfig({ supabaseUrl: info_.supabaseUrl, supabaseAnonKey: info_.supabaseAnonKey });
  }
  ok('Conectado ao AutoEdit');
  console.log(`  ${c.dim('app')}     ${info_.app}`);
  console.log(`  ${c.dim('userId')}  ${info_.userId}`);
  console.log(`  ${c.dim('email')}   ${info_.email || '-'}`);
  console.log(`  ${c.dim('tier')}    ${c.bold(info_.tier)}${info_.isAdmin ? c.green(' (admin)') : ''}`);
  console.log(`  ${c.dim('url')}     ${loadConfig().url}`);
}

function cmdConfig({ positionals, flags }) {
  if (positionals[0] === 'path') {
    console.log(configPath());
    return;
  }
  let touched = false;
  if (typeof flags.url === 'string') {
    saveConfig({ url: flags.url.replace(/\/+$/, '') });
    touched = true;
  }
  if (typeof flags.key === 'string') {
    saveConfig({ key: flags.key.trim() });
    touched = true;
  }
  const cfg = loadConfig();
  if (touched) ok(`Config salva em ${configPath()}`);
  console.log(`  ${c.dim('url')}            ${cfg.url}`);
  console.log(`  ${c.dim('key')}            ${maskKey(cfg.key)}`);
  console.log(`  ${c.dim('supabaseUrl')}    ${cfg.supabaseUrl || c.dim('(auto no 1º uso)')}`);
  console.log(`  ${c.dim('supabaseAnon')}   ${cfg.supabaseAnonKey ? maskKey(cfg.supabaseAnonKey) : c.dim('(auto)')}`);
  if (process.env.AUTOEDIT_CLI_KEY) console.log(c.dim('  (AUTOEDIT_CLI_KEY do ambiente está sobrescrevendo a key)'));
}

async function cmdCall({ positionals, flags }) {
  const method = (positionals[0] || 'GET').toUpperCase();
  const path = positionals[1];
  if (!path) die('uso: autoedit call <GET|POST|...> <caminho> [--json \'{...}\'] [--data k=v] [--query k=v]');
  const query = collectKv(flags.query);
  let json;
  if (typeof flags.json === 'string') json = flags.json;
  else if (flags.data) json = collectKv(flags.data);
  const data = await api(method, path, { json, query });
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const UPLOAD_TOOLS = {
  lipsync: '/api/tools/lipsync/upload-url',
  separador: '/api/separador-audio/upload-url',
};
async function cmdUpload({ positionals, flags }) {
  const file = positionals[0];
  const path = flags['upload-path'] || UPLOAD_TOOLS[flags.tool || 'lipsync'];
  if (!file) die('uso: autoedit upload <arquivo> [--tool lipsync|separador] [--kind video|audio]');
  if (!path) die(`--tool inválido. Conhecidos: ${Object.keys(UPLOAD_TOOLS).join(', ')} (ou use --upload-path /api/.../upload-url)`);
  info(`Subindo ${basename(file)}…`);
  const url = await uploadViaTool(path, file, { kind: flags.kind });
  ok('No Storage:');
  console.log(url);
}

async function cmdLipsync({ flags }) {
  const video = flags.video;
  const audio = flags.audio;
  if (!video || !audio) {
    die('uso: autoedit lipsync --video <file|url> --audio <file|url> [--out saida.mp4] [--audio-ms N]');
  }
  const video_url = isUrl(video)
    ? video
    : (info('Subindo vídeo (rosto)…'), await uploadViaTool(UPLOAD_TOOLS.lipsync, video, { kind: 'video' }));
  const audio_url = isUrl(audio)
    ? audio
    : (info('Subindo áudio…'), await uploadViaTool(UPLOAD_TOOLS.lipsync, audio, { kind: 'audio' }));
  const audio_ms = await resolveAudioMs(audio, flags);
  info(`Disparando lipsync (${(audio_ms / 1000).toFixed(1)}s de áudio)…`);
  const started = await api('POST', '/api/tools/lipsync', { json: { video_url, audio_url, audio_ms } });
  if (!started.job) die('servidor não devolveu job: ' + JSON.stringify(started));
  const outUrl = await poll(
    async () => {
      const s = await api('GET', '/api/tools/lipsync/status', { query: { job: started.job } });
      if (s.status === 'done') return { done: true, value: s.output_video_url };
      if (s.status === 'failed') throw new Error(s.error || 'a geração falhou.');
      return { done: false };
    },
    { intervalMs: 5000, onTick: (_n, el) => process.stdout.write(`\r  ${c.cyan('⏳')} renderizando… ${Math.round(el / 1000)}s   `) },
  );
  if (COLOR) process.stdout.write('\n');
  const out = (typeof flags.out === 'string' && flags.out) || `lipsync-${Date.now()}.mp4`;
  const bytes = await download(outUrl, out);
  ok(`Pronto: ${c.bold(out)} (${(bytes / 1024 / 1024).toFixed(1)}MB)`);
  console.log(c.dim(outUrl));
}

async function cmdSepararAudio({ positionals, flags }) {
  const input = positionals[0];
  if (!input) die('uso: autoedit separar-audio <arquivo|url> [--out-dir pasta]');
  const audioUrl = isUrl(input)
    ? input
    : (info('Subindo áudio…'), await uploadViaTool(UPLOAD_TOOLS.separador, input, {}));
  const filename = isUrl(input) ? 'audio' : basename(input);
  info('Separando trilhas (Demucs)… pode levar alguns minutos.');
  const res = await api('POST', '/api/separador-audio', { json: { audioUrl, filename } });
  const stems = res.stems || {};
  const names = Object.keys(stems);
  if (!names.length) die('nenhuma trilha retornada: ' + JSON.stringify(res));
  const outDir = (typeof flags['out-dir'] === 'string' && flags['out-dir']) || `stems-${Date.now()}`;
  for (const name of names) {
    const meta = stems[name];
    if (!meta || !meta.url) continue;
    const p = join(outDir, `${name}.mp3`);
    const bytes = await download(meta.url, p);
    ok(`${c.bold(name)} → ${p} (${(bytes / 1024 / 1024).toFixed(1)}MB)`);
  }
}

function cmdTools() {
  console.log(c.bold('\nRotas controláveis pelo CLI (via `autoedit call`):\n'));
  for (const [group, rows] of ROUTES) {
    console.log('  ' + c.cyan(group));
    for (const [m, path, desc] of rows) {
      console.log(`    ${c.yellow(m.padEnd(4))} ${path}`);
      console.log(`         ${c.dim(desc)}`);
    }
    console.log('');
  }
  console.log(c.dim('  Ex.: autoedit call GET /api/heygen/avatars --query motor=V --query q=ana'));
  console.log(c.dim('       autoedit call POST /api/admin/set-tier --json \'{"userId":"…","tier":"pro"}\'\n'));
}

function cmdHelp() {
  console.log(`
${c.bold('autoedit')} ${c.dim('v' + VERSION)} — controle do AutoEdit pela linha de comando

${c.bold('USO')}
  autoedit <comando> [opções]

${c.bold('SETUP')}
  ${c.cyan('config')} --url <url> --key <chave>   salva URL do app + AUTOEDIT_CLI_KEY
  ${c.cyan('config')} [show|path]                 mostra a config / caminho do arquivo
  ${c.cyan('whoami')}                             testa a conexão (identidade + tier)

${c.bold('FERRAMENTAS')}
  ${c.cyan('lipsync')} --video <f|url> --audio <f|url> [--out a.mp4]
        gera lipsync: sobe os arquivos, dispara e baixa o MP4 pronto.
  ${c.cyan('separar-audio')} <f|url> [--out-dir pasta]
        separa em vocals/drums/bass/other (Demucs) e baixa as trilhas.
  ${c.cyan('upload')} <arquivo> [--tool lipsync|separador] [--kind video|audio]
        sobe um arquivo pro Storage e imprime a URL pública.

${c.bold('GENÉRICO (controle total)')}
  ${c.cyan('call')} <MÉTODO> <caminho> [--json '<body>'] [--data k=v] [--query k=v]
        chama QUALQUER rota /api autenticada. Imprime o JSON da resposta.
  ${c.cyan('tools')}                              lista as rotas conhecidas

${c.bold('GLOBAIS')}
  --url <url>            sobrescreve a URL do app nesta chamada (env AUTOEDIT_URL)
  -h, --help            ajuda     |     --version    versão

${c.bold('EXEMPLOS')}
  autoedit config --key $AUTOEDIT_CLI_KEY
  autoedit whoami
  autoedit lipsync --video rosto.mp4 --audio voz.mp3 --out out.mp4
  autoedit separar-audio musica.mp3 --out-dir ./stems
  autoedit call GET /api/heygen/avatars --query motor=V
`);
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────
const COMMANDS = {
  help: () => cmdHelp(),
  config: (a) => cmdConfig(a),
  whoami: () => cmdWhoami(),
  ping: () => cmdWhoami(),
  call: (a) => cmdCall(a),
  upload: (a) => cmdUpload(a),
  lipsync: (a) => cmdLipsync(a),
  'separar-audio': (a) => cmdSepararAudio(a),
  separador: (a) => cmdSepararAudio(a),
  tools: () => cmdTools(),
};

async function main() {
  const argv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(argv);

  if (flags.version) return console.log(VERSION);
  const cmd = positionals.shift();
  if (!cmd || flags.help || cmd === 'help') return cmdHelp();

  const handler = COMMANDS[cmd];
  if (!handler) {
    warn(`comando desconhecido: ${cmd}`);
    return cmdHelp();
  }
  await handler({ positionals, flags });
}

main().catch((e) => die(e));
