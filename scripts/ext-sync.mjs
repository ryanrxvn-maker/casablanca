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
const escolhida = argAlvo > -1 ? { pasta: process.argv[argAlvo + 1], versao: null } : acharPastaViva();

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

console.log(`[ext-sync] ${copiados} arquivo(s) -> ${escolhida.pasta}`);
console.log(`[ext-sync] versao ${versaoAntes} -> ${versaoDepois} (repo ${versaoRepo}) OK`);
