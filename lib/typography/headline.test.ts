/**
 * Testes das HEADLINES — texto PARADO por cima do video, irmao da legenda.
 *
 * Pedido do Silas (31.08): "as headlines sao como as legendas, mas texto
 * parado... fica separado da legenda, consigo mexer ela na tela independente
 * e definir ate onde ela dura pela timeline, como uma nova barra".
 */
import {
  drawHeadline,
  getHeadlinePreset,
  HEADLINE_PRESETS,
  HEADLINE_STYLE_DEFAULT,
  headlineAtPoint,
  headlinePosBounds,
  headlinesAt,
  layoutHeadline,
  makeHeadline,
  wrapHeadline,
  type Headline,
  type Measurer,
} from './headline';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ' + String.fromCharCode(10003) + ' ' + msg);
  else { falhas++; console.error('  x FALHOU: ' + msg); }
}

/**
 * Medidor de mentira. 0,5 x corpo por caractere e a largura tipica de uma
 * fonte pesada em caixa alta (Montserrat Black) — com um valor menor nada
 * quebraria de linha e o teste passaria sem testar nada.
 */
const medir: Measurer = (text, font) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const px = m ? Number(m[1]) : 100;
  return text.length * px * 0.5;
};

const W = 1080;
const H = 1920;

function hl(over: Partial<Headline> = {}): Headline {
  return {
    id: 'h1',
    text: 'A GERACAO DE MULHERES COM LIPEDEMA QUE FAZ DIETA JA ESTA ENTRE NOS',
    start: 1000,
    end: 5000,
    style: { ...HEADLINE_STYLE_DEFAULT },
    ...over,
  };
}

console.log('\n-- quebra de linha --');
{
  const linhas = wrapHeadline('um dois tres quatro', 100, (s) => s.length * 10);
  ok(linhas.length > 1, 'quebra quando nao cabe');
  ok(linhas.every((l) => l.length * 10 <= 100 || l.split(' ').length === 1), 'nenhuma linha estoura (salvo palavra sozinha)');
  ok(linhas.join(' ') === 'um dois tres quatro', 'nenhuma palavra some nem duplica');
}
{
  const linhas = wrapHeadline('linha um\nlinha dois', 10_000, (s) => s.length * 10);
  ok(linhas.length === 2, 'o Enter do user vira quebra de verdade');
  ok(linhas[0] === 'linha um' && linhas[1] === 'linha dois', 'e cada paragrafo fica na sua linha');
}
{
  const linhas = wrapHeadline('PNEUMOULTRAMICROSCOPICOSSILICOVULCANOCONIOTICO', 50, (s) => s.length * 10);
  ok(linhas.length === 1, 'palavra gigante nao e partida no meio');
}
{
  ok(wrapHeadline('', 100, (s) => s.length).length === 1, 'texto vazio devolve uma linha vazia (nao quebra)');
  ok(wrapHeadline('   ', 100, (s) => s.length)[0] === '', 'so espaco vira linha vazia');
}

console.log('\n-- layout --');
{
  const L = layoutHeadline(medir, hl(), W, H);
  ok(L.lines.length >= 2, `o texto longo quebrou em ${L.lines.length} linhas`);
  ok(L.box.w > 0 && L.box.h > 0, 'a caixa do painel tem tamanho');
  ok(L.textW <= HEADLINE_STYLE_DEFAULT.width * W, 'o texto respeita a largura maxima pedida');
  ok(L.box.h >= L.textH, 'a caixa e pelo menos do tamanho do texto');
  ok(L.quotePx > 0, 'o modelo Aspas reserva espaco pras aspas');
}
{
  // a largura MANDA na quebra
  const estreita = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, width: 0.4 } }), W, H);
  const larga = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, width: 0.95 } }), W, H);
  ok(estreita.lines.length > larga.lines.length, 'caixa mais estreita = mais linhas');
}
{
  // o tamanho MANDA no corpo
  const g = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, fontScale: 2 } }), W, H);
  const p = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, fontScale: 1 } }), W, H);
  ok(g.fontPx > p.fontPx * 1.9, 'dobrar o tamanho dobra o corpo da fonte');
}
{
  const semPainel = layoutHeadline(
    medir,
    hl({ style: { ...HEADLINE_STYLE_DEFAULT, panel: 'nenhum', quote: false } }),
    W,
    H,
  );
  ok(Math.abs(semPainel.box.w - semPainel.textW) < 0.01, 'sem painel a caixa cola no texto');
}
{
  const vazia = layoutHeadline(medir, hl({ text: '' }), W, H);
  ok(vazia.lines.length === 1 && vazia.box.w > 0, 'headline sem texto nao quebra o layout');
}

console.log('\n-- posicao: da pra pendurar pra fora, mas nao some --');
{
  const L = layoutHeadline(medir, hl(), W, H);
  const b = headlinePosBounds(L.box.w, L.box.h, W, H);
  ok(b.minX < 0 && b.maxX > 1, 'da pra sair pelos lados');
  ok(b.minY < 0 && b.maxY > 1, 'da pra sair por cima e por baixo');

  for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.maxY], [-9, 9], [9, -9]] as const) {
    const LL = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, posX: x, posY: y } }), W, H);
    const visX = Math.min(LL.box.x + LL.box.w, W) - Math.max(LL.box.x, 0);
    const visY = Math.min(LL.box.y + LL.box.h, H) - Math.max(LL.box.y, 0);
    ok(visX > 0 && visY > 0, `em (${x}, ${y}) ainda sobra ${Math.round(visX)}x${Math.round(visY)}px na tela`);
  }
}
{
  const centro = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, posX: 0.5, posY: 0.5 } }), W, H);
  ok(Math.abs(centro.box.x + centro.box.w / 2 - W / 2) < 0.5, 'posX 0.5 centraliza');
  ok(Math.abs(centro.box.y + centro.box.h / 2 - H / 2) < 0.5, 'posY 0.5 centraliza');
}

console.log('\n-- janela de tempo (a barra da timeline) --');
{
  const lista = [
    hl({ id: 'a', start: 0, end: 2000 }),
    hl({ id: 'b', start: 1500, end: 4000 }),
    hl({ id: 'c', start: 9000, end: 12000 }),
  ];
  ok(headlinesAt(lista, 500).map((h) => h.id).join() === 'a', 'em 0.5s so a primeira');
  ok(headlinesAt(lista, 1700).map((h) => h.id).join() === 'a,b', 'as duas podem viver ao mesmo tempo');
  ok(headlinesAt(lista, 5000).length === 0, 'no vao, nenhuma');
  ok(headlinesAt(lista, 2000).map((h) => h.id).join() === 'b', 'o fim e EXCLUSIVO (nao pisca no limite)');
  ok(headlinesAt(lista, 11999).map((h) => h.id).join() === 'c', 'a ultima aparece dentro da janela dela');
}
{
  const semTexto = [hl({ id: 'x', text: '   ', start: 0, end: 9000 })];
  ok(headlinesAt(semTexto, 100).length === 0, 'headline sem texto nao desenha nada');
}

console.log('\n-- clique acerta a headline certa --');
{
  const lista = [hl({ id: 'a', start: 0, end: 9000 })];
  const L = layoutHeadline(medir, lista[0], W, H);
  const meio = { x: L.box.x + L.box.w / 2, y: L.box.y + L.box.h / 2 };
  ok(headlineAtPoint(medir, lista, 100, meio.x, meio.y, W, H)?.headline.id === 'a', 'clique no meio pega a headline');
  ok(headlineAtPoint(medir, lista, 100, L.box.x - 40, meio.y, W, H) === null, 'clique fora nao pega nada');
  ok(headlineAtPoint(medir, lista, 99999, meio.x, meio.y, W, H) === null, 'fora da janela de tempo nao pega');
}
{
  // duas empilhadas: ganha a DE CIMA (a ultima da lista)
  const a = hl({ id: 'a', start: 0, end: 9000 });
  const b = hl({ id: 'b', start: 0, end: 9000 });
  const L = layoutHeadline(medir, a, W, H);
  const hit = headlineAtPoint(medir, [a, b], 100, L.box.x + 5, L.box.y + 5, W, H);
  ok(hit?.headline.id === 'b', 'empilhadas, o clique pega a de cima');
}

console.log('\n-- modelos --');
{
  ok(HEADLINE_PRESETS.length >= 5, `tem ${HEADLINE_PRESETS.length} modelos de headline`);
  const ref = HEADLINE_PRESETS[0];
  ok(ref.id === 'cartela-citacao', 'o primeiro modelo e o da REFERENCIA (cartela de citacao)');
  ok(ref.fullBleed && ref.radius === 0, 'faixa de borda a borda, sem canto arredondado');
  ok(ref.align === 'center', 'texto centralizado (nao a esquerda)');
  ok(ref.quote && ref.quoteColor !== null, 'aspas com COR PROPRIA, nao a do texto');
  ok(ref.panelOpacity === 1 && ref.panelColor !== '#000000', 'painel opaco e colorido (verde-petroleo), nao preto translucido');
  ok(getHeadlinePreset('nao-existe').id === HEADLINE_PRESETS[0].id, 'id desconhecido cai no primeiro (nunca quebra)');
  const ids = HEADLINE_PRESETS.map((p) => p.id);
  ok(new Set(ids).size === ids.length, 'nenhum id repetido');
  for (const p of HEADLINE_PRESETS) {
    const L = layoutHeadline(medir, hl({ style: { ...HEADLINE_STYLE_DEFAULT, presetId: p.id } }), W, H);
    if (!(L.box.w > 0 && L.box.h > 0 && L.lines.length > 0)) {
      ok(false, `modelo ${p.id} produziu layout valido`);
    }
  }
  ok(true, 'todo modelo produz um layout valido');
}

console.log('\n-- headline nova --');
{
  const h = makeHeadline(3200, 12000);
  ok(h.start === 3200, 'comeca onde a agulha esta');
  ok(h.end - h.start === 4000, 'dura no maximo 4s por padrao');
  const curta = makeHeadline(0, 900);
  ok(curta.end - curta.start === 900, 'em video curtinho, respeita o que sobra');
  const minima = makeHeadline(0, 100);
  ok(minima.end - minima.start >= 600, 'mas nunca nasce curta demais pra ser vista');
  ok(makeHeadline(-50, 4000).start === 0, 'nao nasce com tempo negativo');
  ok(makeHeadline(0, 4000).id !== makeHeadline(0, 4000).id, 'cada headline nasce com id proprio');
}

console.log('\n-- desenho nao quebra --');
{
  // ctx de mentira: so precisa aceitar as chamadas
  const chamadas: string[] = [];
  const ctx = {
    save: () => chamadas.push('save'),
    restore: () => chamadas.push('restore'),
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {}, closePath: () => {},
    fill: () => chamadas.push('fill'),
    fillText: (t: string) => chamadas.push('text:' + t),
    measureText: (t: string) => ({ width: t.length * 10 }),
    font: '', fillStyle: '', textBaseline: '', textAlign: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  drawHeadline(ctx, hl(), W, H);
  ok(chamadas.filter((c) => c.startsWith('text:')).length >= 2, 'desenhou as linhas de texto');
  ok(chamadas.includes('fill'), 'desenhou o painel');
  ok(chamadas[0] === 'save' && chamadas[chamadas.length - 1] === 'restore', 'abriu e fechou o estado do canvas');
}

console.log(falhas === 0 ? '\nOK headline: tudo passou' : `\nFALHOU headline: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
