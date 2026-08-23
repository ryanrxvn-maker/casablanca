/**
 * AUTO CORTES · CURADOR LOCAL — textos do corte (headline, título, gancho,
 * descrição, hashtags, "por quê").
 *
 * Regra número um: **não inventar fato**. Tudo que sai daqui é recorte do que
 * foi REALMENTE dito — o que muda é a moldura. Os moldes são os mesmos de
 * `HEADLINE_FORMULAS` (prompts.ts), só que agora viram código:
 *
 *   dado concreto  →  "<dado>: <payoff>"      ("R$ 30 milhões: o erro que quase quebrou")
 *   ordem direta   →  a própria ordem          ("Pare de brigar por preço")
 *   pergunta       →  a própria pergunta       ("Por que a equipe não performa?")
 *   nada disso     →  frase-chave comprimida
 *
 * ≤ 8 palavras, sem ponto final, sem emoji, sem aspas — saneado por
 * `sanitizeHeadline`, que é a mesma trava que a saída do LLM atravessava.
 *
 * PURO e determinístico.
 */

import type { Sentence } from '../types';
import { fmtClock, sanitizeHashtags, sanitizeHeadline } from '../prompts';
import type { Lexicon } from './lexicon';
import type { ClipScore, SentenceFeature } from './score';
import { bigramFor, topTerms, type TfidfModel } from './tfidf';
import {
  capitalizeFirst,
  clampChars,
  extractFactPhrase,
  foldCase,
  stripTrailingPunct,
} from './text';

export const HEADLINE_MAX_WORDS = 8;
export const TITLE_MAX_CHARS = 70;
export const HOOK_MAX_CHARS = 140;

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
// Limpeza da fala
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
  return words.slice(i).join(' ').replace(/^[\s,;:—–-]+/, '').trim();
}

/** Tira palavra pendurada do FIM ("…e o que acontece é que" → "…e o que acontece"). */
export function stripTrailingDangling(text: string, lex: Lexicon): string {
  let words = splitWords(stripTrailingPunct(text));
  let guard = 4;
  while (guard-- > 0 && words.length > 2) {
    const last = bare(words[words.length - 1]);
    // pendurado OU palavra vazia de sentido no fim ("…pela", "…muito")
    if (!lex.danglingEndings.has(last) && !lex.stopwords.has(last)) break;
    words = words.slice(0, -1);
  }
  return words.join(' ');
}

/**
 * Comprime pra no máximo `max` palavras SEM inventar nada:
 *  1. tira o ruído da frente;
 *  2. se ainda não cabe, procura a oração (entre vírgulas) mais densa que caiba;
 *  3. se nenhuma cabe, pega a janela de `max` palavras com maior densidade de
 *     termo raro que COMECE numa palavra de conteúdo.
 */
export function compressToWords(
  text: string,
  max: number,
  ctx: { model: TfidfModel; lex: Lexicon },
): string {
  const cleaned = stripLeadingNoise(stripTrailingPunct(text ?? ''), ctx.lex);
  if (max <= 0) return '';
  let words = splitWords(cleaned);
  if (words.length === 0) return '';
  if (words.length <= max) return stripTrailingDangling(cleaned, ctx.lex);

  const weightOf = (w: string): number => {
    const t = bare(w);
    if (!t || ctx.lex.stopwords.has(t)) return 0;
    return (ctx.model.idf.get(t) ?? ctx.model.maxIdf) / ctx.model.maxIdf;
  };

  // 2. oração inteira que caiba
  const clauses = cleaned
    .split(/[,;:—–]| - /)
    .map((c) => stripLeadingNoise(c.trim(), ctx.lex))
    .filter((c) => splitWords(c).length >= 3);
  let bestClause: { text: string; score: number } | null = null;
  for (const c of clauses) {
    const cw = splitWords(c);
    if (cw.length > max) continue;
    let s = 0;
    for (const w of cw) s += weightOf(w);
    s = s / Math.max(1, cw.length);
    if (!bestClause || s > bestClause.score) bestClause = { text: c, score: s };
  }
  if (bestClause) return stripTrailingDangling(bestClause.text, ctx.lex);

  // 3. janela mais densa que COMEÇA em palavra de conteúdo e, de preferência,
  //    termina numa quebra natural (vírgula ou fim da frase) — é o que evita
  //    manchete cortada no meio do sintagma ("…pela primeira").
  let bestStart = 0;
  let bestScore = -1;
  for (let a = 0; a + 1 < words.length; a++) {
    if (weightOf(words[a]) === 0) continue;
    const end = Math.min(words.length, a + max);
    let s = 0;
    for (let k = a; k < end; k++) s += weightOf(words[k]);
    // SOMA, não média: com média a janela de 2 palavras no fim da frase sempre
    // ganhava e a headline saía cortada ("…em dois anos").
    const natural = end >= words.length || /[,;:—–]$/.test(words[end - 1]);
    if (natural) s += 0.5;
    if (s > bestScore) {
      bestScore = s;
      bestStart = a;
    }
  }
  words = words.slice(bestStart, bestStart + max);
  return stripTrailingDangling(words.join(' '), ctx.lex);
}

/**
 * Grafia original (com acento) de um termo normalizado, como ele aparece no
 * corte. Sem isso o título sairia "trafego pago" em vez de "tráfego pago".
 */
export function surfaceOf(
  term: string,
  i0: number,
  i1: number,
  sentences: Sentence[],
): string {
  const counts = new Map<string, number>();
  for (let i = i0; i <= i1 && i < sentences.length; i++) {
    for (const w of splitWords(sentences[i].text)) {
      const clean = w.replace(PUNCT_EDGE, '').replace(/[.,;:!?…]+$/g, '');
      if (foldCase(clean) !== term) continue;
      const key = clean.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = term;
  let bestN = 0;
  for (const k of Array.from(counts.keys()).sort()) {
    const c = counts.get(k) ?? 0;
    if (c > bestN) {
      bestN = c;
      best = k;
    }
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────────
// Montagem
// ───────────────────────────────────────────────────────────────────────────

/**
 * Remove a ocorrência literal do dado da frase (pra ele não repetir na
 * headline) e limpa o destroço gramatical que sobra — "passou DE E o caixa"
 * vira "passou e o caixa". Sem isso a manchete saía com preposição órfã.
 */
function removePhrase(text: string, phrase: string): string {
  const idx = foldCase(text).indexOf(foldCase(phrase));
  if (idx < 0) return text;
  const joined = `${text.slice(0, idx)} ${text.slice(idx + phrase.length)}`;
  return joined
    .replace(/\s+/g, ' ')
    .replace(/(?:de|do|da|dos|das|em|no|na|por|of)\s+(?=(?:e|ou|and|y)|[,.;:])/gi, '')
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
  const quoteIdx = Math.min(Math.max(score.signals.quoteIndex, i0), i1);
  const quote = sentences[quoteIdx].text;
  const firstText = sentences[i0].text;
  const clipText = sentences
    .slice(i0, i1 + 1)
    .map((s) => s.text)
    .join(' ');

  // ── tema (termo mais forte do corte, na grafia falada)
  const terms = topTerms(model, i0, i1, 6);
  let tema = '';
  if (terms.length > 0) {
    const head = terms[0].term;
    const bi = bigramFor(model, i0, i1, head, lex.stopwords);
    tema = surfaceOf(head, i0, i1, sentences);
    if (bi) tema = `${tema} ${surfaceOf(bi, i0, i1, sentences)}`;
  }

  // ── o dado mais forte, JUNTO da frase em que ele foi dito (o payoff sai da
  //    mesma frase — senão a headline cola dois pedaços que não conversam)
  const fonte = pickFactSentence(i0, i1, quoteIdx, ctx, score);
  const fact = fonte?.fact ?? extractFactPhrase(clipText);

  // ── headline
  const headline = buildHeadline({ i0, i1, quoteIdx, fonte, ctx });

  // ── título "<Tema>: <payoff>" (≤ 70 chars)
  let payoff = compressToWords(quote, 10, { model, lex });
  if (!payoff) payoff = compressToWords(firstText, 10, { model, lex });
  if (foldCase(payoff) === foldCase(headline) && quoteIdx !== i0) {
    payoff = compressToWords(firstText, 10, { model, lex }) || payoff;
  }
  // "Criativo: Criativo bom salva verba" — se o payoff já abre com o tema, o
  // prefixo vira eco e some.
  const ecoDoTema = tema !== '' && foldCase(payoff).includes(foldCase(tema));
  const title =
    tema && !ecoDoTema
      ? clampChars(`${capitalizeFirst(tema)}: ${capitalizeFirst(payoff)}`, TITLE_MAX_CHARS)
      : clampChars(capitalizeFirst(payoff), TITLE_MAX_CHARS);

  // ── gancho: a 1ª frase, limpa
  const hook = clampChars(capitalizeFirst(stripLeadingNoise(firstText, lex)), HOOK_MAX_CHARS);

  // ── descrição: o que a pessoa vai ver + o dado mais forte
  const line1 = capitalizeFirst(compressToWords(quote, 22, { model, lex }));
  const parts: string[] = [`Corte de ${fmtClock(durationMs)}`];
  if (tema) parts.push(`sobre ${tema}`);
  const line2 = `${parts.join(' ')}${fact ? `, com "${fact}" dito na fala` : ''}.`;
  const description = `${line1 ? `${line1}.` : ''}\n${line2}`.trim().slice(0, 600);

  // ── hashtags: 4 termos do corte + o de formato
  const tags = terms
    .map((t) => t.term)
    .filter((t) => t.length >= 4)
    .slice(0, 4);
  const hashtags = sanitizeHashtags([...tags, 'cortes']);

  // ── por quê (mostrado no card)
  const why = buildWhy(score, F[i0], durationMs);

  return { title, headline, hook, description, hashtags, why };
}

export type FactSource = { index: number; fact: string; strong: boolean };

/**
 * De onde sai o "<dado>" da headline. Prioridade: a frase de GANCHO (é o dado
 * que o espectador ouve nos 3 primeiros segundos), depois a frase-chave,
 * depois a de maior citabilidade que tenha algum dado. `strong` distingue
 * dinheiro/porcentagem/quantidade (que sustentam manchete sozinhos) de tempo
 * solto ("dois anos"), que sozinho vira manchete fraca.
 */
function pickFactSentence(
  i0: number,
  i1: number,
  quoteIdx: number,
  ctx: TitleContext,
  score: ClipScore,
): FactSource | null {
  const { sentences, features: F } = ctx;
  const forte = (i: number) => {
    const f = F[i].facts;
    return f.hasMoney || f.hasPercent || f.hasCountQty || f.hasBigNumber;
  };
  const ordem: number[] = [i0, quoteIdx];
  for (let i = i0; i <= i1; i++) ordem.push(i);

  let fallback: FactSource | null = null;
  for (const i of ordem) {
    if (i < i0 || i > i1) continue;
    const fact = extractFactPhrase(sentences[i].text);
    if (!fact) continue;
    if (forte(i)) return { index: i, fact, strong: true };
    if (!fallback) fallback = { index: i, fact, strong: false };
  }
  // sinal do corte inteiro só serve pra confirmar que existe algo concreto
  return score.signals.facts.hasNumber ? fallback : fallback;
}

function buildHeadline(args: {
  i0: number;
  i1: number;
  quoteIdx: number;
  fonte: FactSource | null;
  ctx: TitleContext;
}): string {
  const { i0, i1, quoteIdx, fonte, ctx } = args;
  const { sentences, features: F, model, lex } = ctx;
  const quote = sentences[quoteIdx].text;
  const budget = { model, lex };

  // 1. molde do dado: "<dado>: <payoff>" — só com dado que SUSTENTA manchete
  if (fonte && fonte.strong) {
    const room = HEADLINE_MAX_WORDS - spaceWordCount(fonte.fact);
    if (room >= 2) {
      const source = removePhrase(sentences[fonte.index].text, fonte.fact);
      const payoff = compressToWords(source, room, budget);
      if (spaceWordCount(payoff) >= 2) {
        return finishHeadline(`${capitalizeFirst(fonte.fact)}: ${payoff}`);
      }
    }
  }

  // 2. ordem direta (imperativo) — vale headline sozinha
  for (let i = i0; i <= i1; i++) {
    if (!F[i].imperativeStart) continue;
    const h = compressToWords(sentences[i].text, HEADLINE_MAX_WORDS, budget);
    if (spaceWordCount(h) >= 3) return finishHeadline(h);
  }

  // 3. pergunta direta
  for (let i = i0; i <= i1; i++) {
    if (!F[i].isQuestion || !F[i].questionStart) continue;
    const raw = sentences[i].text.trim();
    const h = compressToWords(raw, HEADLINE_MAX_WORDS, budget);
    if (spaceWordCount(h) >= 3) return `${finishHeadline(h)}?`;
  }

  // 4. frase-chave comprimida
  const h = compressToWords(quote, HEADLINE_MAX_WORDS, budget);
  if (spaceWordCount(h) >= 3) return finishHeadline(h);

  // 5. sobrou o dado fraco ("dois anos") — melhor que manchete de 2 palavras
  if (fonte) {
    const room = HEADLINE_MAX_WORDS - spaceWordCount(fonte.fact);
    const payoff = compressToWords(removePhrase(sentences[fonte.index].text, fonte.fact), room, budget);
    if (spaceWordCount(payoff) >= 2) {
      return finishHeadline(`${capitalizeFirst(fonte.fact)}: ${payoff}`);
    }
  }
  return finishHeadline(compressToWords(sentences[i0].text, HEADLINE_MAX_WORDS, budget));
}

function finishHeadline(raw: string): string {
  return sanitizeHeadline(capitalizeFirst(raw.replace(/\s+/g, ' ').trim()));
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
