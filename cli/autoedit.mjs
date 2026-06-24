#!/usr/bin/env node
/**
 * autoedit — CLI oficial do AutoEdit (darkoautoedit.com)
 *
 * Controle server-to-server do app pela linha de comando: dispara ferramentas
 * (lipsync, separador de áudio, etc.), sobe arquivos, e fala com QUALQUER rota
 * /api via `call`. Dirigível por humano, pelo Claude (Bash), cron e CI.
 *
 * Núcleo compartilhado com o servidor MCP em ./core.mjs.
 * Zero-dependência: roda em Node 18+ puro. Sem build, sem npm install.
 */

import { basename } from 'node:path';
import {
  loadConfig, saveConfig, configPath,
  api, uploadViaTool, download,
  runLipsync, runSepararAudio,
  isUrl, UPLOAD_TOOLS,
} from './core.mjs';

const VERSION = '1.1.0';

// ─── UI (cores opcionais — desligadas se não for TTY ou NO_COLOR) ────────────
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: (s) => paint('1', s),
  dim: (s) => paint('2', s),
  red: (s) => paint('31', s),
  green: (s) => paint('32', s),
  yellow: (s) => paint('33', s),
  cyan: (s) => paint('36', s),
};
const ok = (s) => console.log(`${c.green('✓')} ${s}`);
const info = (s) => console.log(`${c.cyan('›')} ${s}`);
const warn = (s) => console.error(`${c.yellow('!')} ${s}`);
function die(msg, code = 1) {
  console.error(`${c.red('✗')} ${msg instanceof Error ? msg.message : msg}`);
  process.exit(code);
}
const maskKey = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) + ` (${k.length} chars)` : '(vazio)');

// ─── Parser de argumentos ────────────────────────────────────────────────────
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

// ─── Registro de rotas conhecidas (pra `autoedit tools`) ─────────────────────
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
  ['HeyGen', [
    ['GET', '/api/heygen/avatars?q=&motor=', 'lista avatares'],
    ['GET', '/api/heygen/voices', 'lista vozes'],
  ]],
  ['LTX-Video', [
    ['GET', '/api/ltx-video/status', 'status do pool/job'],
  ]],
  ['Admin', [
    ['GET', '/api/admin/dashboard', 'métricas do app'],
    ['POST', '/api/admin/set-tier', 'muda tier de um usuário'],
  ]],
  ['CLI', [
    ['GET', '/api/cli/whoami', 'identidade + bootstrap (health-check)'],
  ]],
];

// ─── Comandos ─────────────────────────────────────────────────────────────────
async function cmdWhoami() {
  const i = await api('GET', '/api/cli/whoami');
  if (i.supabaseUrl && i.supabaseAnonKey) saveConfig({ supabaseUrl: i.supabaseUrl, supabaseAnonKey: i.supabaseAnonKey });
  ok('Conectado ao AutoEdit');
  console.log(`  ${c.dim('app')}     ${i.app}`);
  console.log(`  ${c.dim('userId')}  ${i.userId}`);
  console.log(`  ${c.dim('email')}   ${i.email || '-'}`);
  console.log(`  ${c.dim('tier')}    ${c.bold(i.tier)}${i.isAdmin ? c.green(' (admin)') : ''}`);
  console.log(`  ${c.dim('url')}     ${loadConfig().url}`);
}

function cmdConfig({ positionals, flags }) {
  if (positionals[0] === 'path') return console.log(configPath());
  let touched = false;
  if (typeof flags.url === 'string') { saveConfig({ url: flags.url.replace(/\/+$/, '') }); touched = true; }
  if (typeof flags.key === 'string') { saveConfig({ key: flags.key.trim() }); touched = true; }
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
  if (!flags.video || !flags.audio) die('uso: autoedit lipsync --video <file|url> --audio <file|url> [--out saida.mp4] [--audio-ms N]');
  if (!isUrl(flags.video)) info('Subindo vídeo (rosto)…');
  if (!isUrl(flags.audio)) info('Subindo áudio…');
  const { output_video_url, audio_ms } = await runLipsync({
    video: flags.video,
    audio: flags.audio,
    audioMs: flags['audio-ms'],
    onProgress: (el) => process.stdout.write(`\r  ${c.cyan('⏳')} renderizando… ${Math.round(el / 1000)}s   `),
  });
  if (COLOR) process.stdout.write('\n');
  info(`Áudio: ${(audio_ms / 1000).toFixed(1)}s`);
  const out = (typeof flags.out === 'string' && flags.out) || `lipsync-${Date.now()}.mp4`;
  const bytes = await download(output_video_url, out);
  ok(`Pronto: ${c.bold(out)} (${(bytes / 1024 / 1024).toFixed(1)}MB)`);
  console.log(c.dim(output_video_url));
}

async function cmdSepararAudio({ positionals, flags }) {
  const input = positionals[0];
  if (!input) die('uso: autoedit separar-audio <arquivo|url> [--out-dir pasta]');
  if (!isUrl(input)) info('Subindo áudio…');
  info('Separando trilhas (Demucs)… pode levar alguns minutos.');
  const res = await runSepararAudio({ input });
  const outDir = (typeof flags['out-dir'] === 'string' && flags['out-dir']) || `stems-${Date.now()}`;
  for (const [name, meta] of Object.entries(res.stems)) {
    if (!meta || !meta.url) continue;
    const p = `${outDir}/${name}.mp3`;
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

${c.bold('GLOBAIS')}  -h/--help · --version · AE_DEBUG=1 (loga status+vercel-id)

${c.bold('EXEMPLOS')}
  autoedit config --key $AUTOEDIT_CLI_KEY
  autoedit whoami
  autoedit lipsync --video rosto.mp4 --audio voz.mp3 --out out.mp4
  autoedit separar-audio musica.mp3 --out-dir ./stems
  autoedit call GET /api/heygen/avatars --query motor=V
`);
}

// ─── Router ───────────────────────────────────────────────────────────────────
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
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  if (flags.version) return console.log(VERSION);
  const cmd = positionals.shift();
  if (!cmd || flags.help || cmd === 'help') return cmdHelp();
  const handler = COMMANDS[cmd];
  if (!handler) { warn(`comando desconhecido: ${cmd}`); return cmdHelp(); }
  await handler({ positionals, flags });
}

main().catch((e) => die(e));
