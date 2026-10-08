import { alvoDaLegendaNoLayout, regioesDaLegenda, aplicarSmartPosition, PEDACO_MIN_MS } from './pilot-legenda-smart';
import { palcoDoLayout, type LayoutInsert } from './pilot-inserts';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}
const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const W = 1080;
const H = 1920;

console.log('SMART POSITION — onde fica a dobra de cada formato:');
{
  ok(alvoDaLegendaNoLayout({ tipo: 'cheia' }, W, H) === null, 'tela cheia: a legenda fica onde o editor pôs');
  const faixas = alvoDaLegendaNoLayout({ tipo: 'faixas', avatar: 'cima' }, W, H)!;
  ok(perto(faixas.posY, 0.5) && faixas.posX === 0.5, 'dividida: exatamente na emenda (meio da tela)');
  const linha = alvoDaLegendaNoLayout({ tipo: 'linha', avatar: 'baixo', cor: '#22e06b' }, W, H)!;
  const pl = palcoDoLayout({ tipo: 'linha', avatar: 'baixo', cor: '#22e06b' }, W, H).linha!;
  ok(perto(linha.posY * H, pl.y + pl.h / 2), 'com linha: centrada NA linha colorida');
  for (const avatar of ['cima', 'baixo'] as const) {
    const p = palcoDoLayout({ tipo: 'cards', avatar }, W, H);
    const a = alvoDaLegendaNoLayout({ tipo: 'cards', avatar }, W, H)!;
    const [c, b] = p.avatar!.y < p.insert.y ? [p.avatar!, p.insert] : [p.insert, p.avatar!];
    ok(a.posY * H > c.y + c.h && a.posY * H < b.y && perto(a.posY * H, (c.y + c.h + b.y) / 2), `arredondada (avatar ${avatar}): no meio do respiro entre os dois cards`);
  }
  const mescla = alvoDaLegendaNoLayout({ tipo: 'mescla', avatar: 'cima' }, W, H)!;
  const pm = palcoDoLayout({ tipo: 'mescla', avatar: 'cima' }, W, H).degrade!;
  ok(mescla.posY * H > Math.min(pm.opaco, pm.some) && mescla.posY * H < Math.max(pm.opaco, pm.some), 'mescla: no meio do degradê (onde os dois vídeos se fundem)');
  const react = alvoDaLegendaNoLayout({ tipo: 'react', lado: 'esquerda' }, W, H)!;
  ok(react.posX === 0.5 && react.posY === 0.5, 'React: EXATAMENTE no meio');
  const paisagem = alvoDaLegendaNoLayout({ tipo: 'faixas', avatar: 'cima' }, 1920, 1080)!;
  ok(perto(paisagem.posY, 0.5), '16:9 também (a conta é do palco real)');
}

console.log('\nSMART POSITION — a legenda troca de lugar NO corte, nem antes nem depois:');
{
  const layouts: Record<string, LayoutInsert> = { d: { tipo: 'faixas', avatar: 'cima' }, c: { tipo: 'cheia' }, r: { tipo: 'react', lado: 'direita' } };
  const janelas = [{ id: 'd', start: 2, end: 5 }, { id: 'c', start: 5, end: 8 }, { id: 'r', start: 10, end: 12 }];
  const regioes = regioesDaLegenda(janelas, (id) => layouts[id], W, H);
  ok(regioes.length === 2 && regioes[0].start === 2 && regioes[1].posY === 0.5, 'regiões só das divididas e do React (cheia fica de fora)');

  const w = (text: string, start: number, end: number) => ({ text, start, end });
  const blocks = [
    // atravessa a ENTRADA da dividida (2s): metade antes, metade depois
    { id: 'b1', start: 1500, end: 2600, words: [w('Isso', 1500, 1800), w('aqui', 1850, 1990), w('muda', 2050, 2300), w('tudo', 2320, 2600)] },
    // inteiro dentro da dividida
    { id: 'b2', start: 2700, end: 4000, words: [w('olha', 2700, 3000), w('so', 3050, 3400)] },
    // atravessa a SAÍDA da dividida (5s) pra tela cheia
    { id: 'b3', start: 4600, end: 5600, words: [w('no', 4600, 4800), w('meio', 4820, 4990), w('do', 5010, 5200), w('take', 5220, 5600)] },
    // começa 40ms antes do React (10s) — não pode engolir o take anterior
    { id: 'b4', start: 9960, end: 11000, words: [w('react', 10010, 10400), w('aqui', 10420, 11000)] },
  ];
  const style: {
    perBlock: Record<string, Record<string, unknown>>;
    highlights: Record<string, number[]>;
    wordStyles: Record<string, Record<number, unknown>>;
  } = { perBlock: { b1: { presetId: 'keynote' } }, highlights: { b1: [0, 3], b3: [2] }, wordStyles: { b3: { 3: { color: '#f00' } } } };
  const r = aplicarSmartPosition(blocks, style, regioes);
  const por = (id: string) => r.blocks.find((b) => b.id === id)!;
  const lugar = (id: string) => r.style.perBlock?.[id] as { posY?: number; posX?: number } | undefined;

  // b1 → b1 (antes, normal) + b1~1 (dentro, na dobra)
  ok(por('b1').end === 2000 && por('b1~1').start === 2000, 'bloco que atravessa a entrada: a parte de antes TERMINA no corte e a de depois NASCE nele');
  ok(por('b1').words.map((x) => x.text).join(' ') === 'Isso aqui' && por('b1~1').words.map((x) => x.text).join(' ') === 'muda tudo',
    'cada palavra fica do lado em que o MEIO dela cai');
  ok(lugar('b1')?.posY === undefined && perto(lugar('b1~1')!.posY!, 0.5), 'antes do corte: lugar de sempre · depois: na dobra');
  ok((r.style.perBlock!['b1'] as { presetId?: string }).presetId === 'keynote' && (r.style.perBlock!['b1~1'] as { presetId?: string }).presetId === 'keynote',
    'o estilo do bloco (modelo do hook/body) vai junto pros dois pedaços');
  ok(JSON.stringify(r.style.highlights!['b1']) === '[0]' && JSON.stringify(r.style.highlights!['b1~1']) === '[1]',
    'destaques re-indexados em cada pedaço (a palavra destacada continua destacada)');
  ok(perto(lugar('b2')!.posY!, 0.5), 'bloco inteiro dentro da dividida: na dobra');
  ok(por('b3').end === 5000 && por('b3~1').start === 5000 && perto(lugar('b3')!.posY!, 0.5) && lugar('b3~1')?.posY === undefined,
    'saída pra tela cheia: a legenda da dobra SOME no corte e a seguinte nasce no lugar normal (não atropela o take)');
  ok(JSON.stringify(r.style.wordStyles!['b3~1']) === JSON.stringify({ 1: { color: '#f00' } }), 'estilo por palavra re-indexado');
  ok(por('b4').start === 10000 && perto(lugar('b4')!.posY!, 0.5), 'bloco que começaria 40ms antes do React: nasce no corte (não engole o take anterior)');
  ok(!r.blocks.some((b) => b.id.startsWith('b4~')), '40ms antes do corte não vira um pedaço-relâmpago');

  // nenhuma legenda com lugar da dobra fora da dobra, nenhuma fora no lugar de dentro
  const dentroDe = (t: number) => regioes.find((x) => t >= x.start * 1000 && t < x.end * 1000);
  let vazou = 0;
  for (const b of r.blocks) {
    for (let t = b.start; t < b.end; t += 10) {
      const reg = dentroDe(t);
      const pos = lugar(b.id)?.posY;
      if (reg ? pos === undefined || !perto(pos, reg.posY) : pos !== undefined) vazou++;
    }
  }
  ok(vazou === 0, 'varredura a cada 10ms: nenhum instante com a legenda no lugar errado pro quadro');
  ok(r.cortes >= 3 && r.posicionados >= 4, `relatório: ${r.cortes} cortes, ${r.posicionados} blocos posicionados`);
  // nada mutado
  ok(blocks[0].end === 2600 && !('b1~1' in (style.perBlock as object)), 'não muta os blocos nem o estilo que entraram');

  // pedaço curto demais vai pro vizinho
  const curto = aplicarSmartPosition(
    [{ id: 'x', start: 1900, end: 3000, words: [w('a', 1900, 1950), w('b', 2050, 3000)] }],
    {},
    [{ start: 2, end: 6, posX: 0.5, posY: 0.5 }],
  );
  ok(curto.blocks.length === 1 && curto.blocks[0].start === 2000 && curto.blocks[0].words.length === 2,
    `pedaço de menos de ${PEDACO_MIN_MS}ms não pisca sozinho: as palavras dele entram com o pedaço vizinho`);
  ok(aplicarSmartPosition(blocks, style, []).blocks === blocks, 'sem tela dividida/React no AD: nada muda');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-legenda-smart: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
