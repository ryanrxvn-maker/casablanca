/**
 * Trava os NÚMEROS que o site anuncia contra o catálogo real.
 *
 * Quem acrescenta um modelo de legenda ou de FakePrint quebra este teste e é
 * obrigado a atualizar lib/numeros-do-site.ts — senão a landing volta a
 * anunciar um catálogo que não existe (ou que já cresceu).
 *
 * O FakePrint é contado no FONTE (uma `category: '…'` por modelo): o registro
 * importa next/font e não roda no node. O total por fonte bate com MODELS.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TYPO_PRESETS } from './typography/presets';
import {
  FAKEPRINT_MODELOS,
  FAKEPRINT_TELEJORNAIS,
  LEGENDAS_MODELOS,
} from './numeros-do-site';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

console.log('\nGARANTIA — números que o site anuncia:');

ok(
  TYPO_PRESETS.length === LEGENDAS_MODELOS,
  `legendas: site diz ${LEGENDAS_MODELOS}, galeria tem ${TYPO_PRESETS.length}`,
);

const dir = path.join(process.cwd(), 'app', 'tools', 'fakepass');
const categorias: string[] = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.tsx')) continue;
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  // Sem âncora de linha: alguns modelos declaram tudo numa linha só.
  for (const m of src.matchAll(/\bcategory: '([a-z]+)'/g)) categorias.push(m[1]);
}
ok(
  categorias.length === FAKEPRINT_MODELOS,
  `FakePrint: site diz ${FAKEPRINT_MODELOS} modelos, catálogo tem ${categorias.length}`,
);
const telejornais = categorias.filter((c) => c === 'news').length;
ok(
  telejornais === FAKEPRINT_TELEJORNAIS,
  `FakePrint: site diz ${FAKEPRINT_TELEJORNAIS} telejornais, catálogo tem ${telejornais}`,
);

// Nenhuma página pública pode voltar a escrever estes números à mão.
const publicas = [
  'components/landing/v4/LandingV4.tsx',
  'components/landing/v4/Hero.tsx',
  'components/landing/v4/Legendas.tsx',
  'components/landing/v4/FakePrint.tsx',
  'components/landing/v4/Audio.tsx',
  'components/landing/v4/Rest.tsx',
  'components/landing/v4/Numbers.tsx',
  'components/landing/v3/scenes.tsx',
  'components/AuthShowcase.tsx',
  'components/ToolsHub.tsx',
  'app/layout.tsx',
  'lib/faq.ts',
];
for (const p of publicas) {
  const src = fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const fixo = src.match(/\b\d{2,3} (modelos|telejornais|emissoras)\b/);
  ok(!fixo, `${p} não escreve contagem de catálogo à mão${fixo ? ` (achou "${fixo[0]}")` : ''}`);
}

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed > 0) process.exit(1);
