import { alvoDaLegendaNoLayout, regioesDaLegenda, aplicarSmartPosition, semSobreposicao, BLOCO_MIN_MS, PEDACO_MIN_MS } from './pilot-legenda-smart';
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


console.log('\nLEGENDA NUNCA INVADE O TAKE SEGUINTE (08.10) — casos REAIS do AD01 CREATOR:');
{
  type B = { id: string; start: number; end: number; words: Array<{ text: string; start: number; end: number }> };
  const bl = (id: string, de: number, ate: number, texto: string): B => {
    const ws = texto.split(' ');
    const passo = (ate - de) / ws.length;
    return { id, start: de, end: ate, words: ws.map((t, i) => ({ text: t, start: de + i * passo, end: de + (i + 1) * passo })) };
  };
  // as 5 sobreposições medidas no SRT do AD01 CREATOR (ms)
  const reais: Array<[B, B]> = [
    [bl('a1', 8000, 8640, 'tinha 20.'), bl('b1', 8500, 9260, 'E o segredo')],
    [bl('a2', 13860, 14880, 'neurologista.'), bl('b2', 14460, 14940, 'Durante a')],
    [bl('a3', 27920, 28880, 'receita simples'), bl('b3', 28660, 29220, 'feita com')],
    [bl('a4', 38380, 38880, 'chamam de'), bl('b4', 38800, 39420, 'ferrugem')],
    [bl('a5', 47600, 48200, 'rapidamente'), bl('b5', 47740, 48720, 'para casos')],
  ];
  const todos = reais.flat();
  const { blocks: limpos, ajustes } = semSobreposicao(todos);
  ok(ajustes === 5, `as 5 sobreposições reais foram desencavaladas (${ajustes})`);
  ok(limpos.every((b, i) => i === 0 || limpos[i - 1].end <= b.start), 'nenhum bloco termina depois do seguinte começar');
  ok(limpos.every((b) => b.end - b.start >= BLOCO_MIN_MS), `todo bloco segue visível pelo menos ${BLOCO_MIN_MS} ms`);
  ok(limpos.every((b) => b.words.every((w) => w.start >= b.start - 1e-9 && w.end <= b.end + 1e-9 && w.end >= w.start)),
    'toda palavra fica dentro do bloco dela (aparada na borda nova)');
  const a5 = limpos.find((b) => b.id === 'a5')!;
  const b5 = limpos.find((b) => b.id === 'b5')!;
  ok(perto(a5.end, (48200 + 47740) / 2) && a5.end === b5.start, '"rapidamente" × "para casos": a borda vai pro MEIO da sobreposição (47,97 s)');
  ok(todos[8].end === 48200 && todos[8].words[0].end === 48200 && todos[9].start === 47740, 'nada do que entrou foi mutado');
  const sem = [bl('x', 0, 500, 'oi'), bl('y', 500, 900, 'tudo bem')];
  ok(semSobreposicao(sem).ajustes === 0 && semSobreposicao(sem).blocks[0].end === 500, 'blocos encostados (sem sobrepor) ficam iguais');
  // sobreposição enorme num bloco curto: os dois ficam com o mínimo de tela
  const curto = semSobreposicao([bl('c', 1000, 1300, 'já'), bl('d', 1050, 2000, 'agora vai')]).blocks;
  ok(curto[0].end - curto[0].start >= BLOCO_MIN_MS && curto[1].end - curto[1].start >= BLOCO_MIN_MS && curto[0].end === curto[1].start,
    'sobreposição grande num bloco curto: os dois continuam com o mínimo de tela, sem encavalar');

  // SMART POSITION DESLIGADO: corta na borda, NÃO mexe na posição
  const reg = [{ start: 29.427, end: 32.538, posX: 0.5, posY: 0.5 }];
  const cerebro = bl('k', 32000, 33100, 'do seu cérebro. Mas');
  const r = aplicarSmartPosition([cerebro], { perBlock: { k: { posY: 0.47 } } as Record<string, Record<string, unknown>> }, reg, { posicionar: false });
  const borda = 32538;
  ok(r.blocks.every((b) => !(b.start < borda - 1e-6 && b.end > borda + 1e-6)), 'botão DESLIGADO: nenhum bloco atravessa o fim da tela dividida (o "cérebro." da 09:39)');
  ok(r.blocks.some((b) => perto(b.end, borda)) && r.blocks.some((b) => perto(b.start, borda)) && r.blocks.length === 2, 'o pedaço da dividida termina NO corte e o do take seguinte nasce NO corte');
  ok(r.posicionados === 0 && r.blocks.every((b) => (r.style.perBlock?.[b.id] as { posY?: number } | undefined)?.posY === 0.47),
    'botão DESLIGADO: a legenda fica onde o editor pôs (posY do modelo nos dois pedaços)');
  const rOn = aplicarSmartPosition([cerebro], { perBlock: {} }, reg);
  ok(rOn.posicionados >= 1 && rOn.blocks.every((b) => !(b.start < borda - 1e-6 && b.end > borda + 1e-6)), 'botão LIGADO: corta igual e põe o pedaço da dividida na dobra');
  // pedaços em ordem de início (o motor para de procurar no 1º bloco que começa depois)
  const varios = aplicarSmartPosition([bl('m', 1000, 3000, 'um dois tres quatro'), bl('n', 3000, 5000, 'cinco seis sete oito')],
    { perBlock: {} }, [{ start: 2, end: 4, posX: 0.5, posY: 0.5 }], { posicionar: false });
  ok(varios.blocks.every((b, i) => i === 0 || varios.blocks[i - 1].start <= b.start), 'pedaços cortados saem em ordem de início');
}
console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-legenda-smart: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
