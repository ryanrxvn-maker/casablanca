// Guardas da LANDING pública (07.10, landing v4). Cada uma trava uma regra que
// o Silas cobrou — se alguém (ou outra sessão) quebrar, o teste explica por quê.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ler = (f) => readFileSync(f, 'utf8');
const DIR = 'components/landing/v4';
const ARQUIVOS = readdirSync(DIR)
  .filter((f) => /\.(tsx?|mjs)$/.test(f))
  .map((f) => join(DIR, f).replace(/\\/g, '/'));
const PUBLICAS = [...ARQUIVOS, 'components/landing/v3/scenes.tsx', 'lib/faq.ts'];

/** tira comentários de código — regra de texto vale pro que a pessoa VÊ */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

test('landing não cita ferramenta interna (admin, Beta Pro ou automação)', () => {
  // Pilot, Famous Hey e companhia são privadas: nem o nome aparece pro público.
  const PROIBIDAS = [
    /\bPilot\b/i,
    /Famous\s*Hey/i,
    /Hey\s*Auto/i,
    /Auto\s*B-?roll/i,
    /Separador de [ÁA]udio/i,
    /Remover Legenda/i,
    /Marca d['’]?[ÁA]gua/i,
    /Decupagem Inteligente/i,
    /Auto Cortes/i,
    /\bLTX\b/,
    /Remover Silêncios por Copy/i,
    /Smart Stocks|StockFrame/i,
  ];
  for (const f of PUBLICAS) {
    const src = semComentarios(ler(f));
    for (const re of PROIBIDAS) {
      assert.doesNotMatch(src, re, `${f} cita ferramenta interna (${re})`);
    }
  }
});

test('zero travessão em texto visível da landing (regra da taste-skill adotada pelo Silas)', () => {
  for (const f of PUBLICAS) {
    const src = semComentarios(ler(f));
    const m = src.match(/.{0,40}[—–].{0,40}/);
    assert.ok(!m, `${f} tem travessão em texto: "${m && m[0].trim()}"`);
  }
});

test('a suíte da landing tem exatamente as ferramentas que o Premium libera', () => {
  // TIER_PATHS.basic (lib/use-tier.ts) menos o Histórico (página da conta) e a
  // Caixinha de Pergunta (é modelo do FakePrint, não ferramenta à parte).
  const tier = ler('lib/use-tier.ts');
  const basic = tier.slice(tier.indexOf('basic: new Set(['), tier.indexOf(']),', tier.indexOf('basic: new Set([')));
  const paths = [...basic.matchAll(/'\/tools\/([a-z0-9-]+)'/g)].map((m) => m[1]);
  const publicas = paths.filter((p) => p !== 'historico' && p !== 'caixinha-pergunta');
  const rest = ler(`${DIR}/Rest.tsx`);
  const grupos = rest.slice(rest.indexOf('const GROUPS'), rest.indexOf('export const FERRAMENTAS_NO_AR'));
  const nomes = [...grupos.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(nomes.length, publicas.length, `landing lista ${nomes.length} ferramentas, o Premium libera ${publicas.length} (${publicas.join(', ')})`);
});

test('landing v4: efeito de mouse nunca grava no :root nem escuta scroll da janela', () => {
  for (const f of ARQUIVOS) {
    const src = ler(f);
    assert.doesNotMatch(src, /documentElement\.style/, `${f}: variável/estilo no :root recalcula a página inteira`);
    assert.doesNotMatch(src, /addEventListener\(\s*['"]scroll['"]/, `${f}: listener de scroll na janela (use IntersectionObserver/CSS)`);
  }
  const hero = ler(`${DIR}/Hero.tsx`);
  for (const nome of ['mw-wipe', 'mw-wipe-in']) {
    const m = new RegExp('@keyframes ' + nome + '\\s*\\{([\\s\\S]*?)\\n\\s{8}\\}').exec(hero);
    assert.ok(m, `@keyframes ${nome} não encontrado`);
    assert.doesNotMatch(m[1], /clip-path|\bleft\s*:|box-shadow|width/, `@keyframes ${nome} anima propriedade de repintura`);
  }
});

test('o "Corrigir pela copy" da landing roda a função de verdade, não um resultado escrito à mão', () => {
  const src = ler(`${DIR}/Legendas.tsx`);
  assert.match(src, /import \{ correctBlocksByCopy \} from '@\/lib\/typography\/copy-fix'/);
  assert.match(src, /correctBlocksByCopy\(blocks, COPY\)/);
  assert.match(src, /\{data\.corrected\} \{data\.corrected === 1 \?/, 'a contagem de corrigidas vem do retorno da função');
  assert.match(src, /\{data\.added\}\{' '\}/, 'a contagem de devolvidas vem do retorno da função');
});

test('correção pela copy: o texto nunca gira nem inclina (cobrança de 07.10: "distorcendo os textos")', () => {
  const src = ler(`${DIR}/Legendas.tsx`);
  const css = src.slice(src.indexOf('export function CopyFixSection'));
  // só as regras que tocam TEXTO (o chão em grade decorativo pode ter perspectiva)
  const regras = [...css.matchAll(/\.(cf-(?:tile|from|to|sizer|word|panel|paper|zone)[^{]*)\{([^}]*)\}/g)];
  assert.ok(regras.length >= 6, 'regras do painel não encontradas');
  for (const [, sel, body] of regras) {
    assert.doesNotMatch(body, /rotateX|rotateY|backface-visibility|preserve-3d|perspective/, `${sel.trim()}: a troca é por deslize dentro da caixa, nunca giro 3D`);
  }
  assert.doesNotMatch(css, /className="cf-rig/, 'nada de inclinar o painel inteiro (o texto distorce)');
  assert.match(css, /\.cf-tile \{[^}]*overflow: hidden/, 'a palavra velha e a nova não podem vazar uma por cima da outra');
});

test('vitrine de legendas = a seleção do Silas (07.10)', () => {
  const src = ler(`${DIR}/Legendas.tsx`);
  const shelf = src.slice(src.indexOf('const SHELF'), src.indexOf('const ALL_IDS'));
  const virais = ['titulo-ouro', 'vermelho-sangue', 'extensao-script', 'automatico-arcoiris', 'g-fumaca-anton', 'manuscrito', 'poster-stack'];
  const simples = ['keynote', 'fade-limpo', 'papo-amarelo', 'empilhado', 'g-caixa-chip', 'palavra-box', 'solo-box'];
  for (const id of [...virais, ...simples]) assert.match(shelf, new RegExp(`'${id}'`), `falta o modelo ${id} na vitrine`);
  const presets = ler('lib/typography/presets.ts') + ler('lib/typography/presets-gen.ts');
  for (const id of [...virais, ...simples].filter((i) => !i.startsWith('g-'))) {
    assert.match(presets, new RegExp(`id: '${id}'`), `o modelo ${id} não existe mais no catálogo`);
  }
});
