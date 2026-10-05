// Guardas de PERFORMANCE (05.10). Cada uma trava um gargalo que foi MEDIDO e
// removido — se alguém (ou outra sessão) reintroduzir, o teste explica o
// porquê em vez de o site voltar a ficar pesado calado.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(f, 'utf8');

/** Corpo do PRIMEIRO bloco CSS cujo seletor é exatamente `sel`. */
function blocoCss(css, sel) {
  const re = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'g');
  const m = re.exec(css);
  assert.ok(m, `bloco ${sel} não encontrado`);
  const ini = m.index + m[0].length;
  return css.slice(ini, css.indexOf('}', ini));
}

test('spotlight do mouse NÃO grava variável no :root (recalculava a página inteira a cada movimento)', () => {
  const src = ler('components/MouseGlow.tsx');
  assert.doesNotMatch(src, /documentElement\.style\.setProperty/,
    'variável no :root é herdada por todo elemento — ~22 ms por movimento na landing, travava as ferramentas');
  assert.match(src, /style\.transform\s*=/, 'o spotlight deve andar por transform (só GPU)');
  const css = ler('app/globals.css');
  assert.doesNotMatch(css, /var\(--mx\)\s+var\(--my\)/,
    'nada no CSS global pode ler --mx/--my do :root');
});

test('bolhas do fundo sem filtro/blend (blur de 70px refeito a cada quadro, em toda página)', () => {
  const css = ler('app/globals.css');
  const orb = blocoCss(css, '.orb');
  assert.doesNotMatch(orb, /filter\s*:/, '.orb não pode ter filter (o blur vem assado no gradiente)');
  assert.doesNotMatch(orb, /mix-blend-mode/, '.orb não pode ter mix-blend-mode');
  for (const k of ['.orb-a', '.orb-b', '.orb-c']) {
    assert.match(blocoCss(css, k), /animation:[^;]*steps\(/,
      `${k}: drift em degraus — suave contínuo = 60 redesenhos/s pra sempre`);
  }
});

test('modo descanso: enfeites pausam sem foco/ociosos, e o layout monta o AmbientCalm', () => {
  assert.match(ler('app/layout.tsx'), /<AmbientCalm\s*\/>/);
  const css = ler('app/globals.css');
  assert.match(css, /html\.ae-calm \.ae-ambient[\s\S]*?animation-play-state:\s*paused !important/);
  assert.match(ler('components/WhatsAppFab.tsx'), /wa-pulse ae-ambient/);
});

test('Pilot não re-renderiza a PÁGINA inteira a cada segundo (relógio vive no card)', () => {
  const page = ler('app/tools/clickup-pilot/page.tsx');
  assert.doesNotMatch(page, /setNowTick\(/, 'tick de 1s na página = ~20 mil linhas re-renderizando por segundo');
  assert.match(page, /elapsedLive=\{/);
  assert.match(ler('components/BatchJobCard3D.tsx'), /function ElapsedClock\(/);
});

test('landing: animações do herói só com transform/opacity (clip-path/left/box-shadow repintavam a cada quadro)', () => {
  const src = ler('components/landing/v3/scenes.tsx');
  for (const nome of ['bc-wipe', 'bc-wipe-in', 'bc-line', 'tj-breathe']) {
    const m = new RegExp('@keyframes ' + nome + '\\s*\\{([\\s\\S]*?)\\n\\s{8}\\}').exec(src);
    if (!m) continue; // bc-line hoje reaproveita o bc-wipe
    assert.doesNotMatch(m[1], /clip-path|\bleft\s*:|box-shadow/, `@keyframes ${nome} voltou a animar propriedade de repintura`);
  }
});
