/**
 * Descobre QUAL pasta unpacked o Chrome carrega, de forma DETERMINISTICA.
 *
 * O Chrome deriva o id de uma extensao unpacked do CAMINHO ABSOLUTO da pasta:
 * SHA-256 do caminho (em UTF-16LE no Windows), primeiros 16 bytes, cada nibble
 * virando uma letra de 'a' a 'p'. Ou seja: dado o id que aparece na
 * chrome://extensions, da pra saber exatamente de que pasta ele veio.
 *
 * POR QUE ISTO EXISTE: a primeira versao do ext-sync escolhia a pasta pelo
 * manifest mais recente. Escolheu errado na segunda rodada e publicou numa
 * pasta que o Chrome nem carrega — o pior tipo de defeito, porque tudo "passa"
 * e nada muda no navegador.
 *
 *   node scripts/ext-id.mjs <id-da-extensao>
 *   node scripts/ext-id.mjs            # lista o id de cada pasta candidata
 */
import { createHash } from 'node:crypto';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = 'D:\\NOVOS DOWNLOADS';
const PREFIXO = 'auto-edit-heygen-extension';

export function idDaPasta(caminhoAbsoluto) {
  const h = createHash('sha256').update(Buffer.from(caminhoAbsoluto, 'utf16le')).digest();
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += String.fromCharCode(97 + (h[i] >> 4));
    s += String.fromCharCode(97 + (h[i] & 0x0f));
  }
  return s;
}

export function pastasCandidatas() {
  if (!existsSync(RAIZ)) return [];
  return readdirSync(RAIZ)
    .filter((n) => n.startsWith(PREFIXO))
    .map((n) => join(RAIZ, n))
    .filter((p) => existsSync(join(p, 'manifest.json')));
}

export function acharPastaPorId(id) {
  const alvo = String(id || '').trim().toLowerCase();
  if (!alvo) return null;
  for (const p of pastasCandidatas()) {
    if (idDaPasta(p) === alvo) return p;
  }
  return null;
}

// Rodado direto pela linha de comando? (comparar import.meta.url com argv[1]
// nao e confiavel no Windows por causa das barras e do prefixo do drive.)
if (/ext-id\.mjs$/i.test(process.argv[1] || '')) {
  const alvo = process.argv[2];
  if (alvo) {
    const p = acharPastaPorId(alvo);
    console.log(p ? `BATEU: ${p}` : `nenhuma pasta gera o id ${alvo}`);
  } else {
    for (const p of pastasCandidatas()) console.log(`${idDaPasta(p)}  ${p}`);
  }
}
