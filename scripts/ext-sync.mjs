#!/usr/bin/env node
/**
 * Publica extension/ na pasta UNPACKED que o Chrome realmente carrega.
 *
 * POR QUE EXISTE: o Chrome do Silas nao carrega a extensao do repo — ele
 * carrega de uma pasta em "D:\NOVOS DOWNLOADS\auto-edit-heygen-extension (N)".
 * Editar o repo e pedir "Reload" na chrome://extensions le os arquivos ANTIGOS,
 * e isso ja custou rodadas inteiras de depuracao.
 *
 * Depois de rodar isto, a pagina do Pilot manda {type:'HG_RELOAD_EXT'} pela
 * ponte e a extensao se recarrega sozinha — sem ninguem tocar no navegador.
 *
 *   node scripts/ext-sync.mjs            # descobre a pasta viva e copia
 *   node scripts/ext-sync.mjs --alvo "D:/caminho/da/pasta"
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { acharPastaPorId } from './ext-id.mjs';

const RAIZ_DOWNLOADS = 'D:/NOVOS DOWNLOADS';
const PREFIXO = 'auto-edit-heygen-extension';
// Mesma lista que o ZIP distribuido usa (app/api/extension/download/route.ts).
const ARQUIVOS = ['manifest.json', 'background.js', 'bridge.js', 'heygen-content.js', 'README.md'];
const ICONES = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

function versaoDe(pasta) {
  try {
    const m = JSON.parse(readFileSync(join(pasta, 'manifest.json'), 'utf8'));
    return typeof m.version === 'string' ? m.version : null;
  } catch {
    return null;
  }
}

/** A pasta viva e a do prefixo com manifest MAIS RECENTE. Nao da pra usar a de
 *  maior "(N)": o Silas reinstala e o numero nem sempre cresce em ordem. */
function acharPastaViva() {
  if (!existsSync(RAIZ_DOWNLOADS)) return null;
  const cands = [];
  for (const nome of readdirSync(RAIZ_DOWNLOADS)) {
    if (!nome.startsWith(PREFIXO)) continue;
    const p = join(RAIZ_DOWNLOADS, nome);
    const mf = join(p, 'manifest.json');
    if (!existsSync(mf)) continue;
    cands.push({ pasta: p, mtime: statSync(mf).mtimeMs, versao: versaoDe(p) });
  }
  cands.sort((a, b) => b.mtime - a.mtime);
  return cands[0] || null;
}

const argAlvo = process.argv.indexOf('--alvo');
const argId = process.argv.indexOf('--id');

// ⚠ ORDEM IMPORTA. O id e a UNICA forma deterministica: o Chrome deriva o id
// de uma extensao unpacked do caminho absoluto da pasta, entao id -> pasta e
// exato. O palpite por "manifest mais recente" ja escolheu ERRADO e publicou
// numa pasta que o Chrome nem carrega — tudo passou e nada mudou no navegador.
// Pegue o id no HG_PONG da ponte (campo `id`) e passe aqui.
let escolhida = null;
if (argAlvo > -1) {
  escolhida = { pasta: process.argv[argAlvo + 1], versao: null, como: '--alvo' };
} else if (argId > -1) {
  const p = acharPastaPorId(process.argv[argId + 1]);
  if (!p) {
    console.error(`[ext-sync] nenhuma pasta gera o id ${process.argv[argId + 1]}`);
    process.exit(1);
  }
  escolhida = { pasta: p, versao: versaoDe(p), como: 'id' };
} else {
  escolhida = acharPastaViva();
  if (escolhida) {
    escolhida.como = 'palpite';
    console.warn('[ext-sync] AVISO: escolhendo pela data do manifest (palpite).');
    console.warn('[ext-sync] Prefira --id <id da extensao> — o HG_PONG da ponte devolve o id.');
  }
}

if (!escolhida || !escolhida.pasta) {
  console.error(`[ext-sync] nao achei nenhuma pasta "${PREFIXO}*" em ${RAIZ_DOWNLOADS}`);
  process.exit(1);
}

const origem = join(process.cwd(), 'extension');
const versaoRepo = versaoDe(origem);
const versaoAntes = versaoDe(escolhida.pasta);

let copiados = 0;
for (const nome of [...ARQUIVOS, ...ICONES]) {
  const de = join(origem, nome);
  if (!existsSync(de)) continue;
  const para = join(escolhida.pasta, nome);
  mkdirSync(dirname(para), { recursive: true });
  writeFileSync(para, readFileSync(de));
  copiados++;
}

const versaoDepois = versaoDe(escolhida.pasta);
if (versaoDepois !== versaoRepo) {
  console.error(`[ext-sync] FALHOU: destino ficou em ${versaoDepois}, repo esta em ${versaoRepo}`);
  process.exit(1);
}

console.log(`[ext-sync] ${copiados} arquivo(s) -> ${escolhida.pasta} (por ${escolhida.como})`);
console.log(`[ext-sync] versao ${versaoAntes} -> ${versaoDepois} (repo ${versaoRepo}) OK`);
