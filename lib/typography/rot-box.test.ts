/**
 * Testes de ROTAÇÃO e LARGURA DA CAIXA da legenda (alças estilo CapCut).
 *
 * Pedido do Silas (02.09): girar a legenda e mudar ONDE o texto quebra
 * (alça lateral), em vez de escalar o texto todo — no preview e no painel.
 * O preview e o export usam o MESMO caminho (drawCaptions/captionBBoxAt),
 * então testar o bbox aqui é testar o que sai no MP4.
 */
import { captionBBoxAt, type Block, type StyleState } from './engine';
import { getPreset } from './presets';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  x FALHOU: ' + msg); }
}

/** ctx de mentira: só o que o measureLayout usa (font + measureText). */
function fakeCtx(): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    measureText(t: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
      const px = m ? Number(m[1]) : 40;
      return { width: t.length * px * 0.55 } as TextMetrics;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const W = 1080;
const H = 1920;

function bloco(frase: string): Block {
  const ws = frase.split(' ');
  return {
    id: 'b1',
    words: ws.map((text, i) => ({ text, start: i * 300, end: i * 300 + 300 })),
    start: 0,
    end: ws.length * 300 + 500,
  };
}

function estilo(over: Partial<StyleState> = {}): StyleState {
  return {
    presetId: 'keynote',
    fontScale: 1,
    posY: 0.5,
    posX: 0.5,
    primary: null,
    accent: null,
    uppercase: null,
    highlights: {},
    autoEmphasis: false,
    ...over,
  };
}

const b = bloco('uma frase comprida o bastante para quebrar em varias linhas aqui');
const preset = getPreset('keynote');

console.log('\n-- largura da caixa aperta a quebra --');
{
  const cheia = captionBBoxAt(fakeCtx(), [b], preset, estilo(), 100, W, H)!;
  const magra = captionBBoxAt(fakeCtx(), [b], preset, estilo({ boxWidth: 0.5 }), 100, W, H)!;
  ok(cheia !== null && magra !== null, 'os dois layouts saem');
  ok(magra.w < cheia.w, `caixa 50% é mais estreita (${Math.round(magra.w)} < ${Math.round(cheia.w)})`);
  ok(magra.h > cheia.h, `e mais alta — o texto requebrou (${Math.round(magra.h)} > ${Math.round(cheia.h)})`);
}

console.log('\n-- clamp da caixa --');
{
  const zero = captionBBoxAt(fakeCtx(), [b], preset, estilo({ boxWidth: 0.01 }), 100, W, H)!;
  const meio = captionBBoxAt(fakeCtx(), [b], preset, estilo({ boxWidth: 0.3 }), 100, W, H)!;
  ok(Math.abs(zero.w - meio.w) < 1, 'abaixo de 30% trava em 30% (nunca vira um fio)');
  // teto NOVO (02.09): 1.163 — a caixa alcanca a BORDA da tela (0.86x1.163
  // = 1.0); antes parava em 86% e "voltava pro centro"
  const dois = captionBBoxAt(fakeCtx(), [b], preset, estilo({ boxWidth: 2 }), 100, W, H)!;
  const teto = captionBBoxAt(fakeCtx(), [b], preset, estilo({ boxWidth: 1.163 }), 100, W, H)!;
  ok(Math.abs(dois.w - teto.w) < 1, 'acima do teto trava no teto (borda da tela)');
  ok(teto.w >= W * 0.99, `no teto a caixa alcanca a borda (${Math.round(teto.w)} >= ${Math.round(W * 0.99)})`);
}

console.log('\n-- rotação sai no bbox pro overlay girar junto --');
{
  const reto = captionBBoxAt(fakeCtx(), [b], preset, estilo(), 100, W, H)!;
  ok(reto.rot === 0, 'sem rotação, rot = 0');
  const torto = captionBBoxAt(fakeCtx(), [b], preset, estilo({ rotation: 90 }), 100, W, H)!;
  ok(Math.abs(torto.rot - Math.PI / 2) < 1e-9, '90° vira PI/2 radianos');
  ok(typeof torto.cx === 'number' && typeof torto.cy === 'number', 'e o pivô (cx,cy) vem junto');
  ok(Math.abs(torto.cx - reto.cx) < 1 && Math.abs(torto.cy - reto.cy) < 1,
    'girar não desloca o pivô (a caixa gira em volta do próprio centro)');
}

console.log('\n-- rotação por BLOCO via perBlock (cadeado congela junto) --');
{
  const st = estilo({ perBlock: { b1: { rotation: 45, boxWidth: 0.5 } } });
  const r = captionBBoxAt(fakeCtx(), [b], preset, st, 100, W, H)!;
  ok(Math.abs(r.rot - Math.PI / 4) < 1e-9, 'perBlock.rotation vence o global');
  const cheia = captionBBoxAt(fakeCtx(), [b], preset, estilo(), 100, W, H)!;
  ok(r.w < cheia.w, 'perBlock.boxWidth também aperta a quebra');
}

if (falhas > 0) { console.error(`\n${falhas} FALHA(S)`); process.exit(1); }
console.log('\nOK rot-box: tudo passou');
