/**
 * FORMATO + TRANSIÇÃO automáticos do plano Smart Stocks (07.10).
 *
 * Silas: *"o Smart Stocks automaticamente já tem que vir com algumas
 * variações, não pode ser só tela cheia… a maioria dos takes deve ser tela
 * cheia sim, mas deve ter alguns react, outros tela dividida, principalmente
 * no hook"* e *"alguma transição de luz com cor mais avermelhada às vezes,
 * não precisa ser só branco"*.
 *
 * Regra de editor (puro, testável — nada de DOM):
 *  - ~2/3 do plano fica em TELA CHEIA; o resto varia;
 *  - o HOOK é o primeiro a variar: a abertura com o avatar dividindo a tela
 *    (ou reagindo) segura o polegar;
 *  - o FORMATO segue o que o take mostra: tela/celular, dinheiro, remédio,
 *    receita, gente bem e família pedem REACT (o avatar "comenta" a cena);
 *    anatomia, órgão, laboratório, médico, hospital e gente com o problema
 *    pedem TELA DIVIDIDA (explicação lado a lado). CTA = React;
 *  - nunca o mesmo formato variado em dois trechos seguidos, nunca três
 *    variados em sequência, e o React alterna o lado;
 *  - flash de take curto demais (< 1,6s) não varia: a divisão nem assenta;
 *  - cobertura 100% = só React como variação (é a que mantém o take em tela
 *    cheia — o "100% b-roll" continua verdade);
 *  - transição: escurecer no problema, luz na melhora/prova/CTA e LUZ
 *    VERMELHA em ~1 de cada 5 trocas (as de impacto primeiro), nunca duas
 *    vermelhas seguidas.
 *
 * O editor troca qualquer escolha depois; isto só define o ponto de partida.
 */

import type { SceneFamily } from './stockframe-director';
import type { Insert, LayoutInsert, TipoTransicao } from './pilot-inserts';
import type { SmartCoverage, SmartStockSegment, StockFrameCopyPart } from './stockframe-smart';
import type { StockFrameVideo } from './stockframe';

const FAMILIAS_REACT = new Set<SceneFamily>(['tela', 'dinheiro', 'remedio', 'receita', 'pessoa-bem', 'pessoa-rotina', 'familia']);
/** explicação lado a lado: o avatar fala, a tela mostra o que ele explica */
const FAMILIAS_DIVIDIDA = new Set<SceneFamily>(['anatomia', 'orgao-real', 'ciencia', 'medico', 'hospital', 'pessoa-problema']);
/** Ordem em que as divididas se revezam (a com linha abre — é a mais "ad"). */
const DIVIDIDAS: Array<'linha' | 'faixas' | 'mescla' | 'cards'> = ['linha', 'mescla', 'faixas', 'cards'];

const CTA = /\b(?:clic\w*|botao|link|saiba mais|assist\w*|toque|toca|aperte|click\w*|tap\w*|button|learn more|watch)\b/;
const IMPACTO = /\b(?:perigo\w*|alerta|urgente|grave|mort\w*|morre\w*|veneno|toxic\w*|nunca|pare|cuidado|atencao|choc\w*|segredo|proibid\w*|escondid\w*|mentira|danger\w*|warning|never|stop|secret|hidden)\b/;

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export type OpcoesDeFormato = {
  coverage: SmartCoverage;
  /** família de cena do take (stockframe-director.sceneProfileOf) */
  familiaDe: (video: StockFrameVideo) => SceneFamily;
};

type Item = {
  seg: SmartStockSegment;
  ordem: number;
  hook: boolean;
  primeiroDoHook: boolean;
  familia: SceneFamily;
  texto: string;
  cta: boolean;
};

/** O tipo de variação que o take pede (antes das regras de vizinhança). */
function variacaoPedida(item: Item): 'react' | 'dividida' {
  if (item.cta) return 'react';
  return FAMILIAS_REACT.has(item.familia) ? 'react' : 'dividida';
}

/**
 * Devolve os MESMOS segmentos com `formato` e `transicao` preenchidos nos que
 * têm take escolhido. Segmento que já tem formato escolhido pelo editor
 * (`formatoManual`) não é tocado.
 */
export function variarFormatosDoPlano<T extends SmartStockSegment>(
  segments: T[],
  parts: StockFrameCopyPart[],
  opcoes: OpcoesDeFormato,
): T[] {
  const ordemDaParte = new Map(parts.map((p, i) => [p.label, i]));
  const escolhidos = segments
    .filter((seg) => !!seg.selectedVideoId && !seg.formatoManual)
    .map((seg) => {
      const video = seg.candidates.find((c) => c.video.id === seg.selectedVideoId)?.video;
      const texto = normalizar(`${seg.text} ${seg.semanticText || ''}`);
      return {
        seg,
        ordem: (ordemDaParte.get(seg.anchor) ?? 99) * 10_000 + seg.wordFrom,
        hook: /^hook\b/i.test(seg.anchor),
        primeiroDoHook: false,
        familia: video ? opcoes.familiaDe(video) : 'outro',
        texto,
        cta: CTA.test(texto),
      } as Item;
    })
    .sort((a, b) => a.ordem - b.ordem);
  if (!escolhidos.length) return segments;
  const primeiroHook = escolhidos.find((i) => i.hook);
  if (primeiroHook) primeiroHook.primeiroDoHook = true;

  /* ── 1. QUAIS variam ── */
  const n = escolhidos.length;
  const quantos = n <= 1 ? 0 : n === 2 ? 1 : Math.max(1, Math.round(n * 0.34));
  /** o quanto o trecho PEDE uma variação, sem olhar os vizinhos */
  const vontade = (i: Item) =>
    (i.primeiroDoHook ? 10 : i.hook ? 3.5 : 0)
    + (i.cta ? 2.5 : 0)
    + (FAMILIAS_DIVIDIDA.has(i.familia) ? 1 : FAMILIAS_REACT.has(i.familia) ? 0.5 : 0)
    + (i.seg.targetSeconds >= 3.5 ? 0.8 : 0);
  const variados = new Set<Item>();
  const indice = new Map(escolhidos.map((it, k) => [it, k]));
  const sequenciaVariada = (k: number) => {
    // quantos variados SEGUIDOS ficariam se `k` variar
    let run = 1;
    for (let j = k - 1; j >= 0 && variados.has(escolhidos[j]); j--) run++;
    for (let j = k + 1; j < n && variados.has(escolhidos[j]); j++) run++;
    return run;
  };
  // Escolha GULOSA com espalhamento: a cada rodada vence quem mais pede
  // variação somado à distância dos já variados — AD longo ganha respiro no
  // body inteiro em vez de tudo se amontoar no começo.
  while (variados.size < quantos) {
    let melhor: Item | null = null;
    let melhorNota = -Infinity;
    for (let k = 0; k < n; k++) {
      const it = escolhidos[k];
      if (variados.has(it) || it.seg.targetSeconds < 1.6 || sequenciaVariada(k) > 2) continue;
      let distancia = 4;
      for (const v of variados) distancia = Math.min(distancia, Math.abs(indice.get(v)! - k));
      const nota = vontade(it) + distancia * 0.6;
      if (nota > melhorNota) { melhorNota = nota; melhor = it; }
    }
    if (!melhor) break;
    variados.add(melhor);
  }

  /* ── 2. QUE formato cada um ganha ── */
  const formato = new Map<Item, LayoutInsert>();
  let ladoReact: 'direita' | 'esquerda' = 'direita';
  let proxDividida = 0;
  for (let k = 0; k < n; k++) {
    const it = escolhidos[k];
    if (!variados.has(it)) { formato.set(it, { tipo: 'cheia' }); continue; }
    const anterior = k > 0 ? formato.get(escolhidos[k - 1]) : undefined;
    let pedido = opcoes.coverage === 100 ? 'react' : variacaoPedida(it);
    // nunca o mesmo formato variado colado no anterior
    if (anterior && anterior.tipo === 'react' && pedido === 'react' && opcoes.coverage !== 100) pedido = 'dividida';
    if (pedido === 'react') {
      if (anterior?.tipo === 'react' && opcoes.coverage === 100) { formato.set(it, { tipo: 'cheia' }); continue; }
      formato.set(it, { tipo: 'react', lado: ladoReact });
      ladoReact = ladoReact === 'direita' ? 'esquerda' : 'direita';
      continue;
    }
    let tipo = DIVIDIDAS[proxDividida % DIVIDIDAS.length];
    if (anterior && anterior.tipo === tipo) tipo = DIVIDIDAS[++proxDividida % DIVIDIDAS.length];
    proxDividida++;
    formato.set(it, tipo === 'linha' ? { tipo: 'linha', avatar: 'cima' } : { tipo, avatar: 'cima' });
  }

  /* ── 3. TRANSIÇÃO ── */
  const transicao = new Map<Item, TipoTransicao>();
  for (const it of escolhidos) {
    const melhora = it.seg.narrativeDirection === 'recovery' || it.seg.visualBeat === 'relief' || it.seg.visualBeat === 'proof' || it.cta;
    transicao.set(it, melhora ? 'luz' : 'escurecer');
  }
  const vermelhas = n < 3 ? 0 : Math.max(1, Math.round(n * 0.2));
  const impacto = (i: Item) => (IMPACTO.test(i.texto) ? 3 : 0) + (i.hook ? 2 : 0) + (i.seg.narrativeDirection === 'distress' ? 1 : 0);
  const comVermelha: number[] = [];
  // mesma escolha gulosa com espalhamento: impacto + distância das outras
  // vermelhas (nunca coladas) — o clarão vira pontuação, não tema.
  while (comVermelha.length < vermelhas) {
    let melhor = -1;
    let melhorNota = -Infinity;
    for (let k = 0; k < n; k++) {
      if (comVermelha.includes(k)) continue;
      let distancia = 6;
      for (const j of comVermelha) distancia = Math.min(distancia, Math.abs(j - k));
      if (distancia < 2) continue;
      const nota = impacto(escolhidos[k]) + distancia * 0.5 - k * 0.001;
      if (nota > melhorNota) { melhorNota = nota; melhor = k; }
    }
    if (melhor < 0) break;
    comVermelha.push(melhor);
    transicao.set(escolhidos[melhor], 'luz-vermelha');
  }

  const porId = new Map(escolhidos.map((it) => [it.seg.id, it]));
  return segments.map((seg) => {
    const it = porId.get(seg.id);
    if (!it) return seg;
    return { ...seg, formato: formato.get(it), transicao: transicao.get(it) };
  });
}

/**
 * O RASCUNHO do plano conversa com a MONTAGEM (07.10). O plano Smart fica
 * salvo na sessão; enquanto a janela estava fechada, a montagem pode ter
 * mudado por fora — formato trocado ou take tirado pela janela de Inserts do
 * PC, trecho ajustado no editor de takes. Ao reabrir, o rascunho adota o que
 * está na montagem (por take: o plano nunca repete take), senão o "Aplicar e
 * concluir" desfaria a edição feita lá.
 *
 * `aplicados` = ids dos trechos que JÁ foram pra montagem: se o take deles
 * sumiu, foi tirado por fora e o trecho volta pro avatar. Trecho nunca
 * aplicado continua como escolha pendente.
 */
export function reconciliarPlanoComMontagem<T extends SmartStockSegment>(
  segments: T[],
  inserts: Insert[],
  aplicados: Iterable<string>,
  parts: StockFrameCopyPart[],
): T[] {
  const jaAplicados = new Set(aplicados);
  const daMontagem = inserts.filter((ins) => ins.source === 'stockframe' && ins.stockFrame?.smart && ins.stockFrame.videoId);
  let mudou = false;
  const proximos = segments.map((seg) => {
    if (!seg.selectedVideoId) return seg;
    const ins = daMontagem.find((i) => i.stockFrame!.videoId === seg.selectedVideoId);
    if (!ins) {
      if (!jaAplicados.has(seg.id)) return seg;
      mudou = true;
      return { ...seg, selectedVideoId: undefined };
    }
    const de = Math.min(ins.palavraDe, ins.palavraAte);
    const ate = Math.max(ins.palavraDe, ins.palavraAte);
    const mesmoTrecho = ins.ancora === seg.anchor && de === seg.wordFrom && ate === seg.wordTo;
    const mesmoFormato = JSON.stringify(ins.layout) === JSON.stringify(seg.formato || { tipo: 'cheia' })
      && (ins.transicao || 'escurecer') === (seg.transicao || 'escurecer');
    if (mesmoTrecho && mesmoFormato) return seg;
    mudou = true;
    const palavras = parts.find((p) => p.label === ins.ancora)?.text.match(/\S+/g) || [];
    return {
      ...seg,
      ...(mesmoTrecho ? {} : { anchor: ins.ancora, wordFrom: de, wordTo: ate, text: palavras.slice(de, ate + 1).join(' ') || seg.text }),
      formato: ins.layout,
      transicao: ins.transicao,
      formatoManual: true,
    };
  });
  return mudou ? proximos : segments;
}
