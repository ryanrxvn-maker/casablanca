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
import { readFileSync } from 'node:fs';
import {
  loadConfig, saveConfig, configPath,
  api, uploadViaTool, download,
  runLipsync, runSepararAudio,
  isUrl, UPLOAD_TOOLS,
} from './core.mjs';
import * as pilot from './pilot.mjs';
import { medirArquivo, medirVideo, medirUrl } from './voz-medir.mjs';
import { revisarCopy, contarGraves } from '../lib/revisar-copy.ts';

const VERSION = '1.3.0';

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
  ${c.cyan('normalizar')} <arquivo|pasta> [--out saida.mp4]
        Normalizador de volume do AutoEdit: denoise + dynaudnorm +
        speechnorm + -16 LUFS / -1.5 dBTP. O MESMO motor da ferramenta.

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
  pilot: (a) => cmdPilot(a),
  voz: (a) => cmdVoz(a),
  normalizar: (a) => cmdNormalizar(a),
};

/**
 * `autoedit normalizar` - o Normalizador de volume do AutoEdit, local.
 *
 * A MESMA cadeia da ferramenta do app: denoise -> dynaudnorm (leveling macro)
 * -> speechnorm (leveling micro de fala) -> loudnorm -16 LUFS / -1.5 dBTP.
 * O video e' COPIADO, entao custa segundos e nao re-encoda imagem.
 *
 * Aceita um arquivo ou uma PASTA (nivela todo mp4 dentro dela, no lugar).
 *
 * Ordem que importa: no pipeline de AVA isto roda DEPOIS de decupar. O
 * speechnorm levanta o piso e a pausa sobe junto - decupar sobre audio ja'
 * nivelado e' decupar com o detector cego.
 */
async function cmdNormalizar({ positionals, flags }) {
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const alvo = positionals[0];
  if (!alvo) return warn('uso: autoedit normalizar <arquivo.mp4|pasta> [--out saida.mp4]');
  if (!fs.existsSync(alvo)) return warn('nao achei: ' + alvo);

  const CADEIAS = [
    'afftdn=nf=-25,dynaudnorm=f=200:g=17:p=0.9:m=8:r=0.6:s=6,speechnorm=p=0.95:e=6:c=2:t=0.001:r=0.0008:f=0.0008,loudnorm=I=-16:TP=-1.5:LRA=11',
    'afftdn=nf=-25,dynaudnorm=f=200:g=17:p=0.9:m=8:r=0.6:s=6,loudnorm=I=-16:TP=-1.5:LRA=11',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ];

  const nivelar = (entrada, saida) => {
    for (const af of CADEIAS) {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-y', '-i', entrada, '-c:v', 'copy',
        '-af', af, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
        '-movflags', '+faststart', saida], { encoding: 'utf8' });
      if (r.status === 0 && fs.existsSync(saida) && fs.statSync(saida).size > 1024) return true;
    }
    return false;
  };

  const ehPasta = fs.statSync(alvo).isDirectory();
  const arquivos = ehPasta
    ? fs.readdirSync(alvo).filter((f) => /[.]mp4$/i.test(f)).map((f) => path.join(alvo, f))
    : [alvo];
  if (!arquivos.length) return warn('nenhum .mp4 na pasta');

  let ok = 0;
  for (const f of arquivos) {
    const trocaNoLugar = !(flags.out && arquivos.length === 1);
    const saida = trocaNoLugar ? f + '.norm.mp4' : flags.out;
    process.stdout.write('  ' + path.basename(f) + ' ... ');
    if (nivelar(f, saida)) {
      if (trocaNoLugar) fs.renameSync(saida, f);
      console.log('OK -16 LUFS');
      ok++;
    } else {
      console.log('FALHOU (mantido como estava)');
      try { fs.unlinkSync(saida); } catch { /* nao chegou a existir */ }
    }
  }
  console.log('');
  console.log('  ' + ok + '/' + arquivos.length + ' normalizado(s) com o motor do AutoEdit');
}
/**
 * `autoedit pilot <sub>` — o lado LEGÍVEL do ClickUp Pilot, sem abrir aba.
 *
 * A orquestração (clicar, montar slot, disparar) só existe na página; mas
 * tudo que decide o plano — tasks, looks, vozes, conta ligada — vem de rota
 * autenticada. Conferir por aqui antes de colar lá é o que evita disparar com
 * look errado, que foi o que quase aconteceu em 23.08.
 */
async function cmdPilot({ positionals, flags }) {
  const sub = positionals.shift();
  const mostra = (x) => console.log(JSON.stringify(x, null, 1));
  if (sub === 'tasks') {
    return mostra(await pilot.tasks({ editor: flags.editor, status: flags.status }));
  }
  if (sub === 'avatares') return mostra(await pilot.avatares({ busca: flags.busca }));
  if (sub === 'vozes') return mostra(await pilot.vozes({ busca: flags.busca }));
  if (sub === 'identidade') return mostra(await pilot.identidade());
  if (sub === 'revisar') {
    // REVISA A COPY antes de virar take pago. Um AD ja saiu com o avatar
    // dizendo "que TA nao importa" (o doc truncou "tamanho"): o parser copia
    // fiel e ninguem le o texto de novo.
    const p = flags.cenas || positionals.shift();
    if (!p) return warn('uso: autoedit pilot revisar --cenas cenas.json');
    const cenas = JSON.parse(readFileSync(p, 'utf8'));
    const lista = Array.isArray(cenas) ? cenas : Object.values(cenas).flat();
    const papeis = [...new Set(lista.map((x) => x.papel).filter(Boolean))];
    let graves = 0;
    for (const cena of lista) {
      const achados = revisarCopy(cena.texto || '', papeis);
      if (!achados.length) continue;
      graves += contarGraves(achados);
      console.log(c.bold((cena.ad || '?') + ' cena ' + cena.n));
      achados.forEach((x) => console.log(
        '   ' + (x.peso === 'alto' ? c.red('!') : c.yellow('~')) + ' ' +
        (x.trecho ? '"' + x.trecho + '" ' : '') + x.motivo));
    }
    if (!graves) return console.log(c.green('copy sem defeito mecanico — o resto e leitura'));
    process.exitCode = 1;
    return;
  }
  if (sub === 'conferir') {
    const p = flags.cenas || positionals.shift();
    if (!p) return warn('uso: autoedit pilot conferir --cenas cenas.json');
    const cenas = JSON.parse(readFileSync(p, 'utf8'));
    const problemas = await pilot.conferirPlano(cenas);
    if (!problemas.length) return console.log(c.green('plano ok — pode colar no Pilot'));
    problemas.forEach((x) => console.log(c.red('  ✗ ' + x)));
    process.exitCode = 1;
    return;
  }
  console.log(`
${c.bold('autoedit pilot')} — ClickUp Pilot pela linha de comando

  ${c.cyan('tasks')} [--editor Silas] [--status "editando"]   tasks do workspace
  ${c.cyan('avatares')} [--busca catia]                       avatares + looks do HeyGen
  ${c.cyan('vozes')} [--busca martina]                        vozes PRIVADAS da conta
  ${c.cyan('identidade')}                                     qual conta HeyGen está ligada
  ${c.cyan('conferir')} --cenas cenas.json                    valida o plano contra o HeyGen
  ${c.cyan('revisar')} --cenas cenas.json                     revisa a COPY (typo, repetida, rotulo vazado)
`);
}

/**
 * `autoedit voz medir` — mede o pitch do que o HeyGen ENTREGOU.
 *
 * O rotulo `gender` do clone mente nos dois sentidos (medido em 23.08): a
 * Catia voltou "male" e saiu feminina; a `redheadedgurl` voltou "female" e
 * saiu grave no take. Decidir pelo campo ja custou video pronto errado.
 */
async function cmdVoz({ positionals, flags }) {
  const sub = positionals.shift();
  if (sub === 'medir') {
    // LOTE: `--videos id1,id2,...` mede tudo de uma vez e resume no fim.
    // Depois de corrigir 18 takes num lote, conferir um a um nao acontece.
    if (flags.videos) {
      const ids = String(flags.videos).split(/[,\s]+/).filter(Boolean);
      const ruins = [];
      for (const id of ids) {
        let laudo;
        try { laudo = medirVideo(id, flags.esperado); } catch (e) { console.log(c.red('  ! ' + id.slice(0, 10) + ' — ' + e.message)); ruins.push(id); continue; }
        const cor = laudo.sexo === 'feminina' ? c.green : laudo.sexo === 'AMBIGUA' ? c.yellow : c.red;
        const marca = laudo.alertas.length ? c.red('!') : c.green('ok');
        console.log('  ' + marca + ' ' + id.slice(0, 10) + '  ' + cor(String(Math.round(laudo.mediana)).padStart(3) + ' Hz') +
          '  p10 ' + String(Math.round(laudo.p10)).padStart(3) + '  sil ' + String(Math.round(laudo.silencioPct)).padStart(2) + '%' +
          (laudo.alertas.length ? '  ' + c.red(laudo.alertas[0]) : ''));
        if (laudo.alertas.length) ruins.push(id);
      }
      console.log('');
      if (!ruins.length) return console.log(c.green(ids.length + ' take(s) — nenhum alerta'));
      console.log(c.red(ruins.length + ' de ' + ids.length + ' take(s) com alerta'));
      process.exitCode = 1;
      return;
    }
    const alvo = flags.video || flags.arquivo || flags.url || positionals.shift();
    if (!alvo) return warn('uso: autoedit voz medir --video <videoId> | --arquivo take.mp4 | --url <preview>');
    let laudo;
    if (flags.video) laudo = medirVideo(flags.video, flags.esperado);
    else if (flags.url) laudo = medirUrl(flags.url, flags.esperado);
    else laudo = medirArquivo(alvo, flags.esperado);
    const cor = laudo.sexo === 'feminina' ? c.green : laudo.sexo === 'AMBIGUA' ? c.yellow : c.red;
    console.log('  mediana : ' + cor(laudo.mediana.toFixed(0) + ' Hz') + '  (' + laudo.sexo + ')');
    console.log('  p10/p90 : ' + laudo.p10.toFixed(0) + ' / ' + laudo.p90.toFixed(0) + ' Hz');
    console.log('  silencio: ' + laudo.silencioPct.toFixed(0) + '%');
    console.log('  picos   : ' + laudo.picos.map((x) => x.hz + ' Hz').join(', '));
    if (!laudo.alertas.length) return console.log(c.green('  ok — nada suspeito'));
    laudo.alertas.forEach((x) => console.log(c.red('  ! ' + x)));
    process.exitCode = 1;
    return;
  }
  console.log(`
${c.bold('autoedit voz')} — conferir o que o HeyGen entregou

  ${c.cyan('medir')} --video <videoId>     baixa o take e mede o pitch
  ${c.cyan('medir')} --arquivo take.mp4    mede um arquivo local
  ${c.cyan('medir')} --url <preview>       mede o preview de um clone
  ${c.cyan('medir')} --videos id1,id2,...  mede um LOTE e resume no fim
  ${c.dim ? c.dim('') : ''}       --esperado feminina|masculina   de quem e a cena (evita alerta falso)

  O campo ${c.bold('gender')} do clone MENTE. A medicao que vale e a do take.
`);
}

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
