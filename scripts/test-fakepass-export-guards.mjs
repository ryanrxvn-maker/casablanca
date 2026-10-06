#!/usr/bin/env node
/**
 * Guardas do export do FakePass (06.10.2026) — sem navegador.
 *
 * 1. A correção-raiz do "texto baixo no PNG" (h2cFix em shared.tsx) mira o GIF
 *    da sonda de linha de base do html2canvas pelo src EXATO e anula o "+2" da
 *    conta dele com margin-bottom 1px. Se o html2canvas for atualizado e trocar o
 *    GIF ou a conta, a correção para CALADA e todo texto volta a descer ~0,4em.
 * 2. O padrão de emoji pega o emoji INTEIRO (tom de pele, keycap, ZWJ, bandeira)
 *    e deixa © ® ™ / números / #hashtag como texto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = fs.readFileSync(path.join(root, 'app/tools/fakepass/shared.tsx'), 'utf8');
const h2c = fs.readFileSync(path.join(root, 'node_modules/html2canvas/dist/html2canvas.esm.js'), 'utf8');

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) falhas++;
};

console.log('\n-- html2canvas: sonda de linha de base --');
const gifH2c = /SMALL_IMAGE = '([^']+)'/.exec(h2c)?.[1];
const gifNosso = /const H2C_PROBE_GIF = '([^']+)'/.exec(shared)?.[1];
ok(!!gifH2c && gifH2c === gifNosso, 'o GIF da sonda (SMALL_IMAGE) é o que o h2cFix mira');
ok(/var baseline = img\.offsetTop - span\.offsetTop \+ 2;/.test(h2c), 'a conta da linha de base ainda é offsetTop − offsetTop + 2 (o margin-bottom 1px anula o +2)');
ok(/img\[src="\$\{H2C_PROBE_GIF\}"\]\{display:inline!important;margin-bottom:1px!important\}/.test(shared), 'h2cFix devolve o GIF a inline e desconta 1px');

console.log('\n-- padrão de emoji --');
const lit = /export const EMOJI_RE =\s*(\/.+\/gu);/.exec(shared)?.[1];
ok(!!lit, 'EMOJI_RE encontrado');
const EMOJI_RE = new Function(`return ${lit}`)();
const toUnified = (e) => [...e].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('-');
const achar = (t) => [...t.matchAll(new RegExp(EMOJI_RE))].map((m) => toUnified(m[0]));
const casos = [
  ['🙏🏻', ['1f64f-1f3fb'], 'tom de pele fica junto (não vira 🙏 + quadrado de pele)'],
  ['👍🏽👍🏽', ['1f44d-1f3fd', '1f44d-1f3fd'], 'dois emojis com tom = dois emojis'],
  ['🙋🏻‍♀️', ['1f64b-1f3fb-200d-2640-fe0f'], 'ZWJ com tom e gênero inteiro'],
  ['👩🏾‍💻', ['1f469-1f3fe-200d-1f4bb'], 'profissão com tom inteiro'],
  ['🫱🏻‍🫲🏿', ['1faf1-1f3fb-200d-1faf2-1f3ff'], 'aperto de mão com 2 tons'],
  ['1️⃣', ['0031-fe0f-20e3'], 'keycap vira emoji (arquivo com 4 dígitos)'],
  ['🇧🇷', ['1f1e7-1f1f7'], 'bandeira'],
  ['❤️‍🔥', ['2764-fe0f-200d-1f525'], 'coração em chamas'],
  ['© 2025 Globo', [], '© sem VS16 fica texto'],
  ['Whey Pro™ e Nutri®', [], '™ ® ficam texto'],
  ['©️', ['00a9-fe0f'], '© COM VS16 é emoji'],
  ['R$ 1.000 #reels 100%', [], 'número, # e % não viram emoji'],
  ['obrigada 🙏🏻 de verdade ❤️', ['1f64f-1f3fb', '2764-fe0f'], 'frase com emojis'],
];
for (const [t, esperado, msg] of casos) {
  const got = achar(t);
  ok(JSON.stringify(got) === JSON.stringify(esperado), `${msg} — ${JSON.stringify(t)} → ${JSON.stringify(got)}`);
}

if (falhas) {
  console.error(`\nFALHOU fakepass-export-guards: ${falhas} guarda(s)`);
  process.exit(1);
}
console.log('\nOK fakepass-export-guards: tudo passou');
