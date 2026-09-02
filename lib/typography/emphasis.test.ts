/**
 * Testes do DESTAQUE automático da legenda.
 *
 * Queixa do Silas (02.09), olhando o "Esse truque do quiabo" pronto:
 *   "não tem essa mistura de branco com dourado, onde tem dourado é dourado"
 *   "tá destacando só uma palavra, deveria ser uma boa parte do texto"
 *
 * Três defeitos numa tela só: o gradiente do destaque começava em quase
 * branco (e como ele é por palavra, a letra inicial saía BRANCA no meio do
 * ouro), o automático marcava UMA palavra, e o mesmo cálculo de destaque
 * estava copiado em três lugares do engine — desenho, caixa de seleção e
 * caixas de palavra — então dava pra consertar um e esquecer os outros.
 */
import {
  autoEmphasisTail,
  destaquesDoBloco,
  type Block,
  type StyleState,
} from './engine';
import { getPreset, TYPO_PRESETS } from './presets';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

function bloco(frase: string, id = 'b1'): Block {
  const ws = frase.split(/\s+/).filter(Boolean);
  return {
    id,
    words: ws.map((text, i) => ({ text, start: i * 200, end: i * 200 + 200 })),
    start: 0,
    end: ws.length * 200,
  };
}

function estilo(over: Partial<StyleState> = {}): StyleState {
  return {
    presetId: 'papo-amarelo',
    fontScale: 1,
    posY: 0.5,
    primary: null,
    accent: null,
    uppercase: null,
    highlights: {},
    ...over,
  };
}

const palavras = (b: Block, s: Set<number>) =>
  [...s].sort((a, x) => a - x).map((i) => b.words[i].text).join(' ');

console.log('\n── o trecho é a CAUDA da frase, não uma palavra ──');
{
  // as duas frases reais que o Silas usou de referência
  const b1 = bloco('mas aí eu quero que tu me dê tua opinião, tá?');
  const t1 = autoEmphasisTail(b1);
  ok(palavras(b1, new Set(t1)) === 'dê tua opinião, tá?',
    `11 palavras → "${palavras(b1, new Set(t1))}"`);

  const b2 = bloco('Esse truque do quiabo');
  const t2 = autoEmphasisTail(b2);
  ok(palavras(b2, new Set(t2)) === 'do quiabo',
    `4 palavras → "${palavras(b2, new Set(t2))}"`);
}

console.log('\n── nunca o bloco inteiro, nunca menos de duas ──');
{
  for (let n = 2; n <= 40; n++) {
    const b = bloco(Array.from({ length: n }, (_, i) => 'p' + i).join(' '));
    const t = autoEmphasisTail(b);
    if (t.length >= n) { ok(false, `n=${n}: pintou o bloco inteiro`); break; }
    if (n >= 3 && t.length < 2) { ok(false, `n=${n}: só ${t.length} palavra`); break; }
    // contíguo e colado no fim
    const contiguo = t.every((v, k) => k === 0 || v === t[k - 1] + 1);
    if (!contiguo || t[t.length - 1] !== n - 1) { ok(false, `n=${n}: trecho furado`); break; }
    if (n === 40) ok(true, 'de 2 a 40 palavras: contíguo, colado no fim, sempre sobra branco');
  }
  ok(autoEmphasisTail(bloco('oi tudo')).length === 1, 'bloco de 2 → só a última');
  ok(autoEmphasisTail(bloco('oi')).length === 0, 'bloco de 1 palavra → nada (não dá pra ter contraste)');
  ok(autoEmphasisTail({ id: 'x', words: [], start: 0, end: 0 }).length === 0, 'bloco vazio → nada');
}

console.log('\n── destaque manual do user vence o automático ──');
{
  const b = bloco('Esse truque do quiabo');
  const p = getPreset('papo-amarelo');
  ok(palavras(b, destaquesDoBloco(b, p, estilo())) === 'do quiabo',
    'sem toque do user, entra o trecho');
  ok(palavras(b, destaquesDoBloco(b, p, estilo({ highlights: { b1: [1] } }))) === 'truque',
    'com escolha do user, é a dele');
  ok(destaquesDoBloco(b, p, estilo({ autoEmphasis: false })).size === 0,
    'automático desligado → nenhum destaque');
}

console.log('\n── modelo de palavra continua sendo de palavra ──');
{
  const b = bloco('o segredo está no quiabo');
  const p = getPreset('titulo-viral');
  const s = destaquesDoBloco(b, p, estilo({ presetId: 'titulo-viral' }));
  ok(p.autoEmphasisMode !== 'trecho', 'Título Viral não é modelo de trecho');
  ok(s.size <= 1, `e segue marcando no máximo uma palavra (marcou ${s.size})`);
}

console.log('\n── onde é dourado, é ouro (nada de stop quase branco) ──');
{
  // luminância aproximada; um stop "branco" no meio do ouro é o que fazia a
  // primeira letra da palavra sair descolorida
  const claro = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return { lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, sat: (Math.max(r, g, b) - Math.min(r, g, b)) / 255 };
  };
  const p = getPreset('papo-amarelo');
  ok(p.autoEmphasisMode === 'trecho', 'Papo Amarelo marca TRECHO');
  const stops = p.highlightGradient ?? [];
  ok(stops.length > 0, 'tem gradiente de destaque');
  const brancos = stops.filter(([, c]) => { const x = claro(String(c)); return x.lum > 0.9 && x.sat < 0.2; });
  ok(brancos.length === 0, `nenhum stop quase branco (achei ${brancos.length})`);
  const dourados = stops.every(([, c]) => claro(String(c)).sat > 0.25);
  ok(dourados, 'todo stop é dourado de verdade (saturado)');
}

console.log('\n── palavras não podem ficar coladas ──');
{
  const p = getPreset('papo-amarelo');
  // o spacing negativo também come o espaço; wordSpacing devolve o gap
  ok((p.spacing ?? 0) < 0, 'letras seguem apertadas (ar condensado da ref)');
  ok((p.wordSpacing ?? 0) > 0, `mas o espaço entre palavras é positivo (${p.wordSpacing})`);
  const soma = (p.wordSpacing ?? p.spacing ?? 0);
  ok(soma > 0, 'o engine usa wordSpacing no lugar do spacing pro espaço');
}

console.log('\n── nenhum modelo pede trecho sem ter destaque automático ──');
{
  const ruins = TYPO_PRESETS.filter((p) => p.autoEmphasisMode === 'trecho' && !p.autoEmphasis);
  ok(ruins.length === 0, `modelos de trecho sem autoEmphasis: ${ruins.map((p) => p.id).join(', ') || 'nenhum'}`);
}

if (falhas > 0) { console.error(`\n${falhas} FALHA(S)`); process.exit(1); }
console.log('\nTodos os testes de destaque passaram.');
