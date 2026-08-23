/**
 * AUTO CORTES · CURADOR LOCAL — textos do corte (headline, título, gancho,
 * descrição, hashtags, "por quê").
 *
 * Regra número um: **não inventar fato**. Tudo que sai daqui é recorte do que
 * foi REALMENTE dito. Regra número dois, aprendida apanhando de transcrição de
 * verdade: **melhor simples e correto que esperto e quebrado**.
 *
 * Três travas nasceram do primeiro teste com Whisper real (podcast de 24 min,
 * 323 frases, PT), que produziu coisas como "Constância: Com nesses certeza",
 * "10 colaboradores: Vocês devem" e "10%: separa da nossa margem de lucro,":
 *
 *  1. **Recorte por ORAÇÃO, nunca por janela de palavras.** Todo texto que sai
 *     daqui é um pedaço contíguo do original que começa e termina em fronteira
 *     de oração (início/fim de frase, vírgula, ponto-e-vírgula, travessão).
 *     Isso mata sintagma cortado no meio.
 *  2. **Uma frase-chave só.** Headline e título saem do MESMO trecho — antes
 *     um pegava o dado de um lugar e o outro o payoff de outro, e os dois
 *     falavam de coisas diferentes.
 *  3. **A pergunta do entrevistador nunca vira título.** Frase interrogativa
 *     sai da disputa; quem entra é a RESPOSTA (a declarativa seguinte, que
 *     ainda ganha bônus por ser resposta).
 *
 * Os moldes continuam os de `HEADLINE_FORMULAS` (prompts.ts), agora como código:
 *
 *   frase-chave já cabe →  ela inteira, limpa      ("Vocês devem ter mais de 10 colaboradores")
 *   dado forte         →  "<dado>: <oração>"       ("R$ 30 milhões: investimos em tráfego pago")
 *   ordem direta       →  a própria ordem          ("Pare de brigar por preço")
 *   nada disso         →  a melhor oração que cabe
 *
 * PURO e determinístico.
 */

import type { Sentence } from '../types';
import { fmtClock, sanitizeHashtags, sanitizeHeadline } from '../prompts';
import type { Lexicon } from './lexicon';
import type { ClipScore, SentenceFeature } from './score';
import { topTerms, type TfidfModel } from './tfidf';
import {
  capitalizeFirst,
  clampChars,
  extractFactPhrase,
  foldCase,
  hasAdjacentRepeat,
  stripTrailingPunct,
  tidyFragment,
} from './text';

export const HEADLINE_MAX_WORDS = 8;
export const TITLE_MAX_WORDS = 11;
export const TITLE_MAX_CHARS = 70;
export const HOOK_MAX_CHARS = 140;
/** Abaixo disto não é frase, é caco de ASR — não serve de frase-chave. */
export const MIN_KEY_WORDS = 5;
/** Manchete com menos que isto não diz nada. */
export const MIN_HEADLINE_WORDS = 3;

export type TitleContext = {
  sentences: Sentence[];
  features: SentenceFeature[];
  model: TfidfModel;
  lex: Lexicon;
};

export type ClipTexts = {
  title: string;
  headline: string;
  hook: string;
  description: string;
  hashtags: string[];
  why: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Peças de texto
// ───────────────────────────────────────────────────────────────────────────

const PUNCT_EDGE = /^[\s"'“”‘’(\[]+|[\s"'“”‘’)\]]+$/g;

function bare(word: string): string {
  return foldCase(word.replace(PUNCT_EDGE, '').replace(/[.,;:!?…]+$/g, ''));
}

function splitWords(text: string): string[] {
  return (text ?? '').trim().split(/\s+/).filter(Boolean);
}

/** Nº de palavras como `sanitizeHeadline` conta (por espaço). */
export function spaceWordCount(text: string): number {
  return splitWords(text).length;
}

/**
 * Palavras que NÃO podem sobrar na borda de um recorte: preposição, artigo,
 * conjunção, possessivo. Cortar depois delas é o que produz "…pela primeira" e
 * "…10 colaboradores: Vocês devem".
 */
const EDGE_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'num', 'numa',
  'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'pras', 'pros',
  'com', 'sem', 'sob', 'sobre', 'entre', 'ate', 'desde', 'apos', 'contra',
  'a', 'o', 'as', 'os', 'ao', 'aos', 'um', 'uma', 'uns', 'umas',
  'e', 'ou', 'nem', 'mas', 'que', 'se', 'como', 'quando', 'porque', 'pois',
  'meu', 'minha', 'meus', 'minhas', 'teu', 'tua', 'seu', 'sua', 'seus', 'suas',
  'nosso', 'nossa', 'nossos', 'nossas', 'dele', 'dela', 'deles', 'delas',
  'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas',
  'aquele', 'aquela', 'aqueles', 'aquelas', 'isso', 'isto', 'aquilo',
  'muito', 'mais', 'menos', 'todo', 'toda', 'todos', 'todas', 'cada',
  'of', 'the', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'a', 'an', 'my',
  'your', 'our', 'their',
  // pronome no fim do recorte deixa a manchete no ar: "…e bagagem que vocês"
  'eu', 'tu', 'voce', 'voces', 'ele', 'ela', 'eles', 'elas', 'nos', 'me', 'te',
  'lhe', 'mim', 'ti', 'si', 'i', 'you', 'he', 'she', 'they', 'we', 'it',
]);

/**
 * Muleta PURA: palavra que só existe pra ganhar tempo na fala. Diferente da
 * lista de `stopwords.ts` (que tem "agora", "bem", "olha" — palavras com uso
 * legítimo), aqui só entra o que NUNCA faz sentido numa manchete. Sem isso
 * saía "Geralmente, aí toda semana o Wesley".
 */
const PURE_FILLERS: ReadonlySet<string> = new Set([
  'ai', 'ne', 'tipo', 'entao', 'ta', 'po', 'poxa', 'dai', 'ehh', 'eh', 'ah',
  'uh', 'hum', 'hein', 'viu', 'sei', 'digamos', 'enfim', 'assim',
  'uh', 'um', 'uhh', 'kkk', 'kkkk',
]);

/** Determinantes que, antes de um termo, indicam que ele é SUBSTANTIVO. */
const DETERMINERS: ReadonlySet<string> = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'do', 'da', 'dos', 'das',
  'no', 'na', 'nos', 'nas', 'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas',
  'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas',
  'aquele', 'aquela', 'nosso', 'nossa', 'nossos', 'nossas', 'seu', 'sua',
  'seus', 'suas', 'meu', 'minha', 'num', 'numa', 'the', 'el', 'la',
]);

/**
 * Forma que só verbo tem em PT: gerúndio, particípio e infinitivo. Testada
 * DEPOIS da whitelist nominal, então "apresentação" e "vendedor" não caem aqui.
 */
const VERB_SHAPE =
  /(ando|endo|indo|ado|ada|ados|adas|ido|ida|idos|idas|aram|eram|iram|ava|avam|asse|esse|isse|arei|aria|eria|iria)$|^(?=.{5,})(?:.*)(?:ar|er|ir)$/;

/** Sufixos que só existem em substantivo em PT (forma normalizada, sem acento). */
const NOMINAL_SUFFIX =
  /(cao|coes|sao|soes|dade|dades|mento|mentos|ismo|ismos|ista|istas|agem|agens|anca|ancas|ancia|ancias|encia|encias|eza|ezas|ura|uras|dor|dores|tor|tores|eiro|eiros|eira|eiras|aria|arias|ario|arios|tude|tudes|logia|grafia|nomia)$/;

/**
 * Tira muleta e conectivo do COMEÇO preservando acento e caixa do resto
 * ("Então, olha, o segredo é X" → "o segredo é X").
 */
export function stripLeadingNoise(text: string, lex: Lexicon): string {
  const words = splitWords(text);
  let i = 0;
  let removed = 0;
  while (i < words.length && removed < 4) {
    const w = bare(words[i]);
    if (!w) {
      i++;
      continue;
    }
    const noise =
      lex.fillers.openers.has(w) || lex.connectiveOpeners.has(w) || w === 'que' || w === 'e';
    if (!noise) break;
    i++;
    removed++;
  }
  if (i >= words.length) return text.trim();
  return tidyFragment(words.slice(i).join(' '));
}

/**
 * Tira palavra pendurada do FIM: preposição, artigo, conjunção (lista fixa) e
 * tudo que o léxico do idioma já marca como fim pendurado (auxiliares, "há",
 * "né", "o cara"). É a última rede antes do texto sair.
 */
export function trimEdges(text: string, lex?: Lexicon): string {
  let words = splitWords(tidyFragment(stripTrailingPunct(text)));
  let guard = 5;
  while (guard-- > 0 && words.length > 2) {
    const last = bare(words[words.length - 1]);
    if (!EDGE_FUNCTION_WORDS.has(last) && !(lex && lex.danglingEndings.has(last))) break;
    words = words.slice(0, -1);
  }
  return tidyFragment(words.join(' '));
}

/**
 * Um recorte só pode sair daqui se DIZ alguma coisa: tamanho mínimo, pelo
 * menos duas palavras de conteúdo, sem palavra repetida colada e sem terminar
 * pendurado. Foi esta porta que faltou na primeira rodada — "A gente está mais
 * ou menos aí" tem 7 palavras e nenhuma informação.
 */
export function fragmentIsUsable(
  text: string,
  ctx: { model: TfidfModel; lex: Lexicon },
  max: number,
): boolean {
  const words = splitWords(text);
  if (words.length < MIN_HEADLINE_WORDS || words.length > max) return false;
  if (hasAdjacentRepeat(text)) return false;
  const last = bare(words[words.length - 1]);
  if (EDGE_FUNCTION_WORDS.has(last) || ctx.lex.danglingEndings.has(last)) return false;
  let content = 0;
  for (const w of words) {
    const t = bare(w);
    if (PURE_FILLERS.has(t)) return false; // "aí", "né", "tipo" no meio da manchete
    if (t && !ctx.lex.stopwords.has(t) && t.length >= 3) content++;
  }
  return content >= 2;
}

// ── Orações ────────────────────────────────────────────────────────────────

type Piece = { text: string; from: number; to: number };

/**
 * Divide a frase em ORAÇÕES pelas marcas que a fala realmente tem (vírgula,
 * ponto-e-vírgula, dois-pontos, travessão). O recorte final é sempre uma
 * sequência contígua dessas orações, então nunca sai do meio de um sintagma.
 */
function clausePieces(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /[,;:]+|\s+[—–]\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: text.slice(last, m.index), from: last, to: m.index });
    last = m.index + m[0].length;
  }
  out.push({ text: text.slice(last), from: last, to: text.length });
  return out.filter((p) => p.text.trim().length > 0);
}

type RunPick = { text: string; words: number; hasFact: boolean };

/**
 * A melhor sequência de orações da frase que cabe em `max` palavras.
 * `null` quando nenhuma cabe — e aí quem chamou decide o plano B em vez de
 * receber um pedaço truncado.
 */
function bestClauseRun(
  text: string,
  max: number,
  ctx: { model: TfidfModel; lex: Lexicon },
  fact?: string | null,
): RunPick | null {
  const exato = clauseRun(text, max, max, ctx, fact, false);
  if (exato) return exato;
  // Fala real tem oração longa: se nenhuma cabe inteira, pega a melhor até
  // 2,5× o orçamento e corta ANTES da preposição. Continua começando em
  // fronteira de oração — só o fim é aparado.
  return clauseRun(text, max, Math.ceil(max * 2.5), ctx, fact, true);
}

function clauseRun(
  text: string,
  max: number,
  maxBruto: number,
  ctx: { model: TfidfModel; lex: Lexicon },
  fact: string | null | undefined,
  aparar: boolean,
): RunPick | null {
  const pieces = clausePieces(text);
  if (pieces.length === 0) return null;
  const factLow = fact ? foldCase(fact) : null;

  const weightOf = (w: string): number => {
    const t = bare(w);
    if (!t || ctx.lex.stopwords.has(t)) return 0;
    return (ctx.model.idf.get(t) ?? ctx.model.maxIdf) / ctx.model.maxIdf;
  };

  let best: RunPick | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < pieces.length; i++) {
    for (let j = i; j < pieces.length; j++) {
      const raw = text.slice(pieces[i].from, pieces[j].to);
      let limpo = trimEdges(stripLeadingNoise(raw, ctx.lex), ctx.lex);
      if (splitWords(limpo).length > maxBruto) continue;
      let foiAparado = false;
      if (aparar && splitWords(limpo).length > max) {
        limpo = trimAtSyntagm(limpo, max, ctx.lex);
        foiAparado = true;
      }
      const words = splitWords(limpo);
      if (words.length < MIN_HEADLINE_WORDS || words.length > max) continue;
      if (aparar && !fragmentIsUsable(limpo, ctx, max)) continue;

      let content = 0;
      let peso = 0;
      for (const w of words) {
        const v = weightOf(w);
        if (v > 0) content++;
        peso += v;
      }
      if (content < 2) continue; // recorte só com palavra de função não diz nada

      const temFato = factLow !== null && foldCase(limpo).includes(factLow);
      let s = peso / Math.max(1, words.length);
      if (i === 0) s += 0.3; // começa onde a frase começa
      // "termina onde ela termina" só conta se o recorte NÃO foi aparado —
      // senão um run cortado no meio ganhava bônus de fecho que não tem.
      if (j === pieces.length - 1 && !foiAparado) s += 0.3;
      if (temFato) s += 0.5;
      s += (0.25 * words.length) / max; // aproveita o orçamento
      if (EDGE_FUNCTION_WORDS.has(bare(words[0]))) s -= 0.6;

      if (s > bestScore) {
        bestScore = s;
        best = { text: limpo, words: words.length, hasFact: temFato };
      }
    }
  }
  return best;
}

/**
 * Plano B quando nenhuma oração cabe: corta ANTES da última preposição da
 * janela, nunca depois dela. "Hoje a gente separa 10% da nossa margem" vira
 * "Hoje a gente separa 10%" em vez de terminar pendurado no "da".
 */
function trimAtSyntagm(text: string, max: number, lex: Lexicon): string {
  const words = splitWords(trimEdges(stripLeadingNoise(text, lex), lex));
  if (words.length <= max) return tidyFragment(words.join(' '));

  let cut = max;
  for (let k = cut - 1; k >= MIN_HEADLINE_WORDS; k--) {
    const t = bare(words[k]);
    if (EDGE_FUNCTION_WORDS.has(t) || lex.danglingEndings.has(t)) {
      cut = k;
      break;
    }
  }
  return trimEdges(words.slice(0, cut).join(' '), lex);
}

// ───────────────────────────────────────────────────────────────────────────
// Frase-chave: uma só, e nunca a pergunta do entrevistador
// ───────────────────────────────────────────────────────────────────────────

export type KeySentence = { index: number; degraded: boolean };

/**
 * Ordena as frases do corte por "quem merece virar manchete". Fora da disputa
 * na primeira leva: pergunta (é o entrevistador), caco de ASR, continuação em
 * minúscula, logística e retomada. Quem RESPONDE uma pergunta ganha bônus — a
 * resposta é o payoff, e foi exatamente isso que faltou quando o título saiu
 * "Qual a função que o Dijasso exerce na empresa?".
 *
 * Devolve LISTA, não um índice: o gerador de texto desce a lista até um recorte
 * passar no teste de qualidade, em vez de insistir numa frase impossível.
 */
export function rankKeySentences(
  i0: number,
  i1: number,
  ctx: TitleContext,
  score: ClipScore,
): KeySentence[] {
  const F = ctx.features;

  const nota = (i: number): number => {
    let n = F[i].quotability;
    if (i === i0) n += 6; // o gancho costuma ser o melhor resumo do corte
    if (i === score.signals.quoteIndex) n += 4;
    if (F[i].answersQuestion) n += 8; // é a RESPOSTA
    if (F[i].facts.hasMoney || F[i].facts.hasPercent || F[i].facts.hasCountQty) n += 8;
    n += Math.min(10, 2 * F[i].contentWords);
    n -= 6 * F[i].externalRefHits;
    n -= 4 * F[i].hapaxContent;
    n -= 6 * F[i].fillerHits;
    return n;
  };

  const limpa = (i: number) =>
    !F[i].isQuestion &&
    !F[i].startsLower &&
    !F[i].suspectAsr &&
    F[i].words >= MIN_KEY_WORDS &&
    F[i].contentWords >= 2 &&
    F[i].logisticsHits === 0 &&
    F[i].externalRefHits === 0;

  const boas: number[] = [];
  const resto: number[] = [];
  for (let i = i0; i <= i1; i++) (limpa(i) ? boas : resto).push(i);

  const ordenar = (xs: number[]) => xs.sort((a, b) => nota(b) - nota(a) || a - b);
  ordenar(boas);
  ordenar(resto);
  // Na degradação, o que é PEDAÇO de frase vai pro fim de tudo: continuação em
  // minúscula e pergunta não conseguem virar manchete que se sustente sozinha.
  const castigo = (i: number) => (F[i].startsLower ? 2 : 0) + (F[i].isQuestion ? 1 : 0);
  resto.sort((a, b) => castigo(a) - castigo(b));

  const out: KeySentence[] = boas.map((index) => ({ index, degraded: false }));
  for (const index of resto) out.push({ index, degraded: true });
  if (out.length === 0) out.push({ index: i0, degraded: true });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Tema (o que vem antes dos dois-pontos no título)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Grafia original (com acento) de uma sequência de tokens, como ela aparece no
 * corte. Sem isso o título sairia "trafego pago" em vez de "tráfego pago".
 */
function surfaceOfTokens(
  tokens: string[],
  i0: number,
  i1: number,
  sentences: Sentence[],
): string | null {
  for (let i = i0; i <= i1 && i < sentences.length; i++) {
    const words = splitWords(sentences[i].text);
    for (let a = 0; a + tokens.length <= words.length; a++) {
      let bate = true;
      for (let k = 0; k < tokens.length; k++) {
        if (bare(words[a + k]) !== tokens[k]) {
          bate = false;
          break;
        }
      }
      if (!bate) continue;
      const trecho = words
        .slice(a, a + tokens.length)
        .map((w) => w.replace(PUNCT_EDGE, '').replace(/[.,;:!?…]+$/g, ''))
        .join(' ');
      return trecho.toLowerCase();
    }
  }
  return null;
}

/**
 * O tema só entra no título se for **substantivo plausível**. Dois testes, os
 * dois sem lista fechada:
 *  - sufixo nominal de PT (-ção, -dade, -mento, -ância, -ista, -agem…), ou
 *  - aparece no corte precedido de DETERMINANTE ("a margem", "o criativo",
 *    "no Youtube") — o que em português só acontece com substantivo.
 * Verbo ("Rodar", "Acha", "Vira", "Manter") e quantificador ("Cada") caem fora
 * nos dois, e aí o título sai sem prefixo — que é melhor que prefixo errado.
 */
function isPlausibleNoun(term: string, i0: number, i1: number, ctx: TitleContext): boolean {
  if (term.length < 4) return false;
  if (ctx.lex.stopwords.has(term)) return false;
  if (NOMINAL_SUFFIX.test(term)) return true;
  if (VERB_SHAPE.test(term)) return false; // "saindo", "rodar", "mantido"

  for (let i = i0; i <= i1 && i < ctx.sentences.length; i++) {
    const words = splitWords(ctx.sentences[i].text);
    for (let a = 1; a < words.length; a++) {
      if (bare(words[a]) === term && DETERMINERS.has(bare(words[a - 1]))) return true;
    }
  }
  return false;
}

/**
 * Tema do corte. Prefere SINTAGMA ("tráfego pago", "margem de lucro"): duas
 * palavras que andam juntas são quase sempre um substantivo composto e leem
 * muito melhor no título. Sem sintagma recorrente, cai no termo mais forte —
 * e só se ele passar no teste de substantivo. Senão devolve ''.
 */
export function pickTema(i0: number, i1: number, ctx: TitleContext): string {
  const { model, sentences, lex } = ctx;
  const conteudo = (t: string) => t.length >= 3 && !lex.stopwords.has(t) && !/^\d/.test(t);
  const pesoDe = (t: string) => (model.idf.get(t) ?? model.maxIdf) / model.maxIdf;

  const frases: string[][] = [];
  for (let i = i0; i <= i1 && i < model.n; i++) frases.push(model.all[i]);

  // sintagmas: "X Y" e "X de Y"
  const contagem = new Map<string, { n: number; tokens: string[] }>();
  const anota = (tokens: string[]) => {
    const k = tokens.join(' ');
    const atual = contagem.get(k);
    if (atual) atual.n++;
    else contagem.set(k, { n: 1, tokens });
  };
  for (const toks of frases) {
    for (let a = 0; a + 1 < toks.length; a++) {
      if (!conteudo(toks[a]) || !conteudo(toks[a + 1])) continue;
      anota([toks[a], toks[a + 1]]);
    }
    for (let a = 0; a + 2 < toks.length; a++) {
      if (toks[a + 1] !== 'de' && toks[a + 1] !== 'do' && toks[a + 1] !== 'da') continue;
      if (!conteudo(toks[a]) || !conteudo(toks[a + 2])) continue;
      anota([toks[a], toks[a + 1], toks[a + 2]]);
    }
  }

  let melhor: { chave: string; tokens: string[]; nota: number } | null = null;
  for (const chave of Array.from(contagem.keys()).sort()) {
    const item = contagem.get(chave);
    if (!item || item.n < 2) continue; // sintagma tem que RECORRER no corte
    let peso = 0;
    for (const t of item.tokens) if (conteudo(t)) peso += pesoDe(t);
    const nota = peso * (1 + 0.3 * item.n);
    if (!melhor || nota > melhor.nota) melhor = { chave, tokens: item.tokens, nota };
  }
  if (melhor) {
    const grafia = surfaceOfTokens(melhor.tokens, i0, i1, sentences);
    if (grafia) return grafia;
  }

  const dfNoCorte = (t: string): number => {
    let n = 0;
    for (let i = i0; i <= i1 && i < model.n; i++) if (model.content[i].includes(t)) n++;
    return n;
  };
  for (const { term } of topTerms(model, i0, i1, 8, 2)) {
    // termo que aparece numa frase só do CORTE não é tema do corte
    if (dfNoCorte(term) < 2) continue;
    if (!isPlausibleNoun(term, i0, i1, ctx)) continue;
    const grafia = surfaceOfTokens([term], i0, i1, sentences);
    if (grafia) return grafia;
  }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────
// Montagem
// ───────────────────────────────────────────────────────────────────────────

/** Remove a ocorrência literal do dado e limpa o destroço gramatical. */
function removePhrase(text: string, phrase: string): string {
  const idx = foldCase(text).indexOf(foldCase(phrase));
  if (idx < 0) return text;
  const joined = `${text.slice(0, idx)} ${text.slice(idx + phrase.length)}`;
  return joined
    .replace(/\s+/g, ' ')
    .replace(/\b(?:de|do|da|dos|das|em|no|na|por|of)\s+(?=(?:e|ou|and|y)\b|[,.;:])/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildClipTexts(
  i0: number,
  i1: number,
  score: ClipScore,
  ctx: TitleContext,
  durationMs: number,
): ClipTexts {
  const { sentences, features: F, model, lex } = ctx;
  const budget = { model, lex };
  const firstText = sentences[i0].text;

  // ── uma frase-chave só, e headline + título saem os dois DELA
  const escolha = buildFromKey(i0, i1, ctx, score);
  const key = escolha.key;
  const keyText = sentences[key.index].text;
  const headline = escolha.headline;
  const payoff = escolha.payoff;
  const fact = escolha.fact;

  // ── título: "<Tema>: <payoff>" — tema só se for substantivo plausível
  const tema = key.degraded ? '' : pickTema(i0, i1, ctx);
  const ecoDoTema = tema !== '' && foldCase(payoff).includes(foldCase(tema));
  // O título TEM que conter o miolo da headline (é a trava de coerência). Se o
  // teto de 70 caracteres comer o miolo, cai pro título sem prefixo — e, no
  // limite, pro próprio miolo. Nunca sai um título falando de outra coisa.
  const montar = (t: string) =>
    trimEdges(clampChars(t, TITLE_MAX_CHARS), lex);
  const alvo = foldCase(escolha.miolo);
  const comTema =
    tema && !ecoDoTema
      ? montar(`${capitalizeFirst(tema)}: ${capitalizeFirst(payoff)}`)
      : '';
  const semTema = montar(capitalizeFirst(payoff));
  const title = foldCase(comTema).includes(alvo)
    ? comTema
    : foldCase(semTema).includes(alvo)
      ? semTema
      : montar(capitalizeFirst(escolha.miolo));

  // ── gancho: a 1ª frase, limpa
  const hook = clampChars(
    capitalizeFirst(trimEdges(stripLeadingNoise(firstText, lex), lex)),
    HOOK_MAX_CHARS,
  );

  // ── descrição: o que a pessoa vai ver + o dado mais forte
  const linha1 = capitalizeFirst(
    bestClauseRun(keyText, 24, budget)?.text ?? trimAtSyntagm(keyText, 24, lex),
  );
  const partes: string[] = [`Corte de ${fmtClock(durationMs)}`];
  if (tema) partes.push(`sobre ${tema}`);
  const linha2 = `${partes.join(' ')}${fact ? `, com "${fact}" dito na fala` : ''}.`;
  const description = `${linha1 ? `${linha1}.` : ''}
${linha2}`.trim().slice(0, 600);

  // ── hashtags: só termo que RECORRE no vídeo (hapax é lixo de ASR)
  const tags = topTerms(model, i0, i1, 8, 2)
    .map((t) => t.term)
    .filter((t) => t.length >= 4)
    .slice(0, 4);
  const hashtags = sanitizeHashtags([...tags, 'cortes']);

  const why = buildWhy(score, F[i0], durationMs);

  return { title, headline, hook, description, hashtags, why };
}

type Escolha = {
  key: KeySentence;
  headline: string;
  payoff: string;
  fact: string | null;
  /** o recorte de onde headline E título saem — a garantia de coerência */
  miolo: string;
};

/**
 * Desce a lista de frases-chave até uma produzir headline QUE PRESTA, e monta
 * o payoff do título a partir do MESMO recorte — o título sempre contém a
 * headline, então os dois falam do mesmo fato.
 */
function buildFromKey(
  i0: number,
  i1: number,
  ctx: TitleContext,
  score: ClipScore,
): Escolha {
  const ranked = rankKeySentences(i0, i1, ctx, score);
  let fallback: Escolha | null = null;

  for (const key of ranked.slice(0, 6)) {
    const montado = tentarChave(i0, i1, key, ctx);
    if (!montado) continue;
    if (montado.ok) return montado.escolha;
    if (!fallback) fallback = montado.escolha;
  }
  if (fallback) return fallback;

  // Nada prestou: entrega a 1ª frase limpa, sem inventar molde nenhum.
  const key = ranked[0];
  const bruto = trimEdges(stripLeadingNoise(ctx.sentences[key.index].text, ctx.lex), ctx.lex);
  const curto = trimAtSyntagm(bruto, HEADLINE_MAX_WORDS, ctx.lex);
  return {
    key,
    headline: finishHeadline(curto),
    payoff: trimAtSyntagm(bruto, TITLE_MAX_WORDS, ctx.lex) || curto,
    fact: null,
    miolo: curto,
  };
}

function tentarChave(
  i0: number,
  i1: number,
  key: KeySentence,
  ctx: TitleContext,
): { escolha: Escolha; ok: boolean } | null {
  const { sentences, features: F, model, lex } = ctx;
  const budget = { model, lex };
  const keyText = sentences[key.index].text;

  const kf = F[key.index].facts;
  const factStrong = kf.hasMoney || kf.hasPercent || kf.hasCountQty || kf.hasBigNumber;
  const fact = key.degraded ? null : extractFactPhrase(keyText);

  // ── o "miolo": um recorte por ORAÇÃO da frase-chave, nunca janela solta
  let miolo: string | null = null;

  const inteira = trimEdges(stripLeadingNoise(keyText, lex), lex);
  if (fragmentIsUsable(inteira, budget, HEADLINE_MAX_WORDS)) {
    miolo = inteira; // 1. já cabe: usa ela inteira, limpa
  }

  let headline: string | null = null;

  // 2. dado forte + oração da MESMA frase: "<dado>: <payoff>"
  if (!miolo && fact && factStrong) {
    const room = HEADLINE_MAX_WORDS - spaceWordCount(fact);
    if (room >= MIN_HEADLINE_WORDS) {
      const oracao = bestClauseRun(removePhrase(keyText, fact), room, budget);
      if (oracao && fragmentIsUsable(oracao.text, budget, room)) {
        miolo = oracao.text;
        headline = finishHeadline(`${capitalizeFirst(fact)}: ${oracao.text}`);
      }
    }
  }

  // 3. a melhor oração da frase-chave (prefere a que carrega o dado)
  if (!miolo) {
    const oracao = bestClauseRun(keyText, HEADLINE_MAX_WORDS, budget, fact);
    if (oracao && fragmentIsUsable(oracao.text, budget, HEADLINE_MAX_WORDS)) miolo = oracao.text;
  }

  // 4. ordem direta dita em qualquer lugar do corte vale headline sozinha
  if (!miolo) {
    for (let i = i0; i <= i1; i++) {
      if (!F[i].imperativeStart || F[i].startsLower || F[i].suspectAsr) continue;
      const o = bestClauseRun(sentences[i].text, HEADLINE_MAX_WORDS, budget);
      if (o && fragmentIsUsable(o.text, budget, HEADLINE_MAX_WORDS)) {
        miolo = o.text;
        break;
      }
    }
  }

  const ok = miolo !== null;
  if (!miolo) {
    // Só como último recurso: corta antes da preposição (nunca no sintagma).
    const bruto = trimAtSyntagm(keyText, HEADLINE_MAX_WORDS, lex);
    if (spaceWordCount(bruto) < MIN_HEADLINE_WORDS) return null;
    miolo = bruto;
  }

  if (!headline) headline = finishHeadline(miolo);

  return {
    escolha: { key, headline, payoff: buildPayoff(key.index, miolo, ctx), fact, miolo },
    ok,
  };
}

/**
 * Payoff do título: a menor oração que CONTÉM o miolo da headline e cabe em
 * `TITLE_MAX_WORDS`. Assim o título é sempre uma versão mais longa da mesma
 * fala — nunca outro assunto do mesmo corte.
 */
function buildPayoff(keyIdx: number, miolo: string, ctx: TitleContext): string {
  const { sentences, model, lex } = ctx;
  const keyText = sentences[keyIdx].text;
  const alvo = foldCase(miolo);

  const inteira = trimEdges(stripLeadingNoise(keyText, lex), lex);
  if (spaceWordCount(inteira) <= TITLE_MAX_WORDS && foldCase(inteira).includes(alvo)) {
    return inteira;
  }
  const oracao = bestClauseRun(keyText, TITLE_MAX_WORDS, { model, lex });
  if (oracao && foldCase(oracao.text).includes(alvo)) return oracao.text;
  // A melhor oração pode ser outra parte da frase; então tenta a versão mais
  // longa do MESMO começo antes de desistir e repetir a headline.
  const maisLongo = trimAtSyntagm(keyText, TITLE_MAX_WORDS, lex);
  if (
    foldCase(maisLongo).includes(alvo) &&
    spaceWordCount(maisLongo) > spaceWordCount(miolo) &&
    fragmentIsUsable(maisLongo, { model, lex }, TITLE_MAX_WORDS)
  ) {
    return maisLongo;
  }
  return miolo;
}

function finishHeadline(raw: string): string {
  return sanitizeHeadline(capitalizeFirst(tidyFragment(raw)));
}

function buildWhy(score: ClipScore, head: SentenceFeature, durationMs: number): string {
  const s = score.signals;
  const abre = s.hookFact
    ? 'Abre com dado concreto'
    : s.question
      ? 'Abre com pergunta direta'
      : s.imperative
        ? 'Abre com ordem direta'
        : s.hookMarker
          ? 'Abre com gancho forte'
          : head.words <= 16
            ? 'Abre curto e direto'
            : 'Abre já dentro do assunto';

  const meio = s.energyHigh
    ? 'pega um pico de energia da fala'
    : s.emotional
      ? 'tem carga emocional'
      : s.quotability >= 55
        ? 'tem frase citável'
        : s.contrast
          ? 'tem virada no meio'
          : 'desenvolve a ideia sem enrolação';

  const fecha = s.endsFinal
    ? `fecha a ideia em ${fmtClock(durationMs)}`
    : `dura ${fmtClock(durationMs)}`;

  const foco = s.focusMatch >= 0.5 ? ' Bate com os momentos que você pediu.' : '';
  return `${abre}, ${meio} e ${fecha}.${foco}`.slice(0, 200);
}
