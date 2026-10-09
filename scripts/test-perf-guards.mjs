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
  // o pulso do botão de ajuda (substituiu o do WhatsApp em 07.10) é enfeite infinito
  assert.match(ler('components/HelpChat.tsx'), /\$\{s\.pulse\} ae-ambient/);
});

test('Pilot não re-renderiza a PÁGINA inteira a cada segundo (relógio vive no card)', () => {
  const page = ler('app/tools/clickup-pilot/page.tsx');
  assert.doesNotMatch(page, /setNowTick\(/, 'tick de 1s na página = ~20 mil linhas re-renderizando por segundo');
  assert.match(page, /elapsedLive=\{/);
  assert.match(ler('components/BatchJobCard3D.tsx'), /function ElapsedClock\(/);
});

test('Pilot (acabamento Hardware 09.10): fumaça barata, nada de blur por cima dela, mouse sem re-render', () => {
  const smoke = ler('components/pilot/PilotSmoke.tsx');
  assert.match(smoke, /isCalm\(\)/, 'a fumaça para no modo descanso / aba oculta');
  assert.match(smoke, /keepAliveRefs\(\) > 0 \? 15 : 30/, 'com disparo/montagem/render rodando a fumaça cai pra 15 quadros/s');
  const css = ler('app/pilot-hw.css');
  // blur de vidro por cima de canvas animado = desfoque refeito a cada quadro
  assert.match(css, /\.pilot-hw \[class\*='backdrop-blur'\] \{[\s\S]*?backdrop-filter: none !important/);
  // o card de disparo inclinava com setState a cada mousemove: o card inteiro,
  // com os vídeos dos takes, re-renderizava por pixel que o mouse andava
  assert.doesNotMatch(ler('components/BatchJobCard3D.tsx'), /setTilt\(/);
  // a pílula do visor anda por transform, não por `left`
  assert.doesNotMatch(ler('components/PilotModeHub.tsx'), /left 460ms/);
});

test('landing: animações do herói só com transform/opacity (clip-path/left/box-shadow repintavam a cada quadro)', () => {
  const src = ler('components/landing/v3/scenes.tsx');
  for (const nome of ['bc-wipe', 'bc-wipe-in', 'bc-line', 'tj-breathe']) {
    const m = new RegExp('@keyframes ' + nome + '\\s*\\{([\\s\\S]*?)\\n\\s{8}\\}').exec(src);
    if (!m) continue; // bc-line hoje reaproveita o bc-wipe
    assert.doesNotMatch(m[1], /clip-path|\bleft\s*:|box-shadow/, `@keyframes ${nome} voltou a animar propriedade de repintura`);
  }
});

test('StockFrame: modal sem blur de fundo em tela cheia/rodapé/selos e sem pulso que repinta box-shadow', () => {
  const css = ler('components/PilotStockFrame.module.css');
  // O modal cobre quase a tela inteira; o blur do fundo (e o do rodapé por
  // cima da lista rolando, e um por selo de cada card sobre vídeo) era
  // recalculado a cada quadro em que algo mexia atrás — "pesado pra mexer".
  for (const sel of ['.backdrop', '.footer', '.duration,.ratio', '.header']) {
    assert.doesNotMatch(blocoCss(css.replace(/\}/g, '}\n'), sel), /backdrop-filter/, `${sel} voltou a usar backdrop-filter`);
  }
  assert.doesNotMatch(css, /@keyframes stockframeOnPulse/, 'o pulso do ON anima opacidade de um brilho fixo, não box-shadow');
  assert.match(css, /@keyframes stockframeOnGlow\{50%\{opacity:1\}\}/);
  assert.doesNotMatch(blocoCss(css.replace(/\}/g, '}\n'), '.logoGlyph b'), /animation/, 'anel do logo girando pra sempre = 60 redesenhos/s');
});

test('Smart Stocks: placar não normaliza a copy inteira por take (dezenas de milhares de vezes por análise)', () => {
  const src = ler('lib/stockframe-smart.ts');
  const body = src.slice(src.indexOf('function scoreVideo('), src.indexOf('export function rankStockFrameVideos('));
  assert.ok(body.length > 1000, 'scoreVideo não encontrado');
  assert.doesNotMatch(body, /normalize\(segment\.campaignText/, 'a leitura da campanha é feita uma vez (readCampaign), não por take');
  assert.match(src, /function memoScore\(/, 'o mesmo take no mesmo trecho não é pontuado duas vezes');
  const component = ler('components/PilotStockFrame.tsx');
  assert.match(component, /await yieldToUi\(\)/, 'o ranking devolve a tela para a UI entre blocos');
  assert.match(component, /const TakeCard = memo\(/, 'cards da biblioteca memorizados (digitar na busca não re-renderiza 48 cards)');
  assert.match(component, /useMemo\(\(\) => incomingParts, \[partsKey\]\)/, 'parts estabilizado pelo conteúdo (a página recria o array a cada render)');
});

test('registros da conta: F5 baixa só o que mudou (antes 11 páginas em fila, ~7 s com a ferramenta em "Recuperando…")', () => {
  const rec = ler('lib/durable-records.ts');
  assert.match(rec, /function pullPlan\(/, 'a busca incremental (cursor por conta) sumiu');
  assert.match(rec, /'x-records-owner'/, 'o cursor tem que ir com a conta dona dele');
  assert.match(rec, /await pullWith\(null, onPage\)/, 'incremental que falha precisa cair na busca completa');
  const route = ler('app/api/user/records/route.ts');
  assert.match(route, /\.gt\('updated_at', since\)/, 'a rota deixou de filtrar por updated_at');
  assert.match(route, /x-records-owner'\) === user\.id/, 'filtro só vale pra conta da sessão');
});

test('registros: varreduras internas não redecodificam ~3 MB a cada checkpoint do Pilot', () => {
  const rec = ler('lib/durable-records.ts');
  assert.match(rec, /function scanLocal\(\)/);
  for (const fn of ['refreshStatus', 'compactLocalRows', 'reconcileLocalConflicts']) {
    const ini = rec.indexOf(`function ${fn}(`);
    assert.ok(ini >= 0, `${fn} não encontrado`);
    assert.match(rec.slice(ini, ini + 200), /scanLocal\(\)/, `${fn} voltou a usar readLocal() (parse da conta inteira)`);
  }
  assert.match(rec, /scanLocal\(\)\.filter\(r => r\.pending/, 'a fila de envio usa a varredura com cache');
});

test('leitores em loop pulam execuções arquivadas e buscas por id leem um registro só', () => {
  for (const f of ['components/history/HistoryTimeline.tsx', 'components/BackgroundTasksButton.tsx', 'components/ClickUpPilotButton.tsx']) {
    assert.match(ler(f), /skipArchived: true/, `${f}: voltou a decodificar as execuções arquivadas a cada leitura`);
  }
  const page = ler('app/tools/clickup-pilot/page.tsx');
  const fn = page.slice(page.indexOf('function loadPersistedReplan('), page.indexOf('function planoDoReplan('));
  assert.match(fn, /readDurableRecord</, 'o plano salvo de UMA task não pode decodificar a fila inteira (roda no render do painel de montagem)');
});

test('menu de ferramentas e busca não perguntam ao servidor se a conta é admin (o useTier já sabe, em cache)', () => {
  for (const f of ['components/SubSidebar.tsx', 'components/GlobalSearch.tsx']) {
    const src = ler(f);
    assert.doesNotMatch(src, /auth\.getUser\(\)/, `${f}: getUser() de rede a cada montagem — itens internos "pulavam" na lista`);
    assert.match(src, /=== 'admin'/);
  }
});
