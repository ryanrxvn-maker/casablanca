/**
 * AUTO CORTES · CURADOR LOCAL — o orquestrador.
 *
 * Entra transcrição (+ envelope de energia, quando existe) e sai a MESMA
 * `FinalClip[]` que a análise por IA devolvia. Zero rede, zero chave, zero
 * cota: roda no navegador quantas vezes o cliente quiser.
 *
 *   frases ─► TF-IDF ─► fronteira de assunto ─► candidatos ─► notas
 *          ─► diversidade + anti-sobreposição ─► refino de borda ─► textos
 *
 * Duas coisas são deliberadamente conservadoras:
 *  - o refino de borda REUSA `refineBounds` de `analyze.ts` (mesma matemática
 *    de silêncio/palavra que o pipeline já confia);
 *  - a nota final é RANKING RELATIVO dentro do vídeo (o melhor vira 99), igual
 *    à copy do produto — nunca uma promessa de "vai viralizar".
 *
 * PURO: síncrono, sem DOM, sem rede, sem `Date.now()`, sem `Math.random()`.
 * Mesma entrada → exatamente a mesma saída.
 */

import { refineBounds, type FinalClip } from '../analyze';
import { sanitizeClipPlan } from '../analyze';
import { clampScore } from '../prompts';
import {
  autoClipCount,
  CLIP_LENGTH_RANGE_SEC,
  LIMITS,
  type ClipCountPreset,
  type ClipSettings,
  type Sentence,
  type Transcript,
} from '../types';
import { buildCandidates, overlapRatio, type CandidateSpan } from './candidates';
import { buildLexicon } from './lexicon';
import {
  buildSentenceFeatures,
  energyStats,
  focusTokensOf,
  scoreClip,
  MIN_TOTAL,
  type ClipScore,
  type ScoreContext,
} from './score';
import { buildTfidf, corpusStats } from './tfidf';
import { findTopics, type TopicMap } from './topics';
import { buildClipTexts } from './titles';

// ───────────────────────────────────────────────────────────────────────────
// Contrato
// ───────────────────────────────────────────────────────────────────────────

/**
 * Envelope de energia da fala: RMS em dBFS a cada `stepSec` segundos.
 * Produzido por `lib/auto-cortes/prosody.ts` (ffmpeg `astats`, lido do log).
 * `null` em qualquer falha — o curador pontua sem o sinal em vez de abortar.
 */
export type EnergyEnvelope = { stepSec: number; db: Float32Array };

export type CurateInput = {
  transcript: Transcript;
  energy: EnergyEnvelope | null;
  settings: ClipSettings;
  durationSec: number;
};

export type CurateResult = {
  clips: FinalClip[];
  /** índices (em `transcript.sentences`) onde cada assunto COMEÇA */
  topics: number[];
  warnings: string[];
};

/** Sobreposição máxima tolerada entre dois cortes escolhidos. */
export const MAX_OVERLAP = 0.25;
/** Piso relativo: nada abaixo desta fração do melhor corte entra no lote. */
export const RELATIVE_FLOOR = 0.45;

// ───────────────────────────────────────────────────────────────────────────
// curate()
// ───────────────────────────────────────────────────────────────────────────

export function curate(input: CurateInput): CurateResult {
  const warnings: string[] = [];
  const transcript = input.transcript;
  const words = transcript?.words ?? [];
  const allSentences = transcript?.sentences ?? [];

  if (allSentences.length === 0) {
    return { clips: [], topics: [], warnings: ['Sem frases na transcrição — nada a curar.'] };
  }

  // 1. faixa pedida no pré-disparo ("Trecho do vídeo")
  const { sentences, sourceIndex } = applyRange(allSentences, input.settings.range);
  if (sentences.length === 0) {
    return {
      clips: [],
      topics: [],
      warnings: ['O trecho escolhido não tem fala transcrita.'],
    };
  }

  // 2. léxico do idioma (transcrição manda; `auto` cai em PT+EN)
  const lang =
    transcript.language && transcript.language !== 'auto'
      ? transcript.language
      : input.settings.language;
  const lex = buildLexicon(lang);

  // 3. TF-IDF do próprio vídeo + fronteiras de assunto + features por frase
  const model = buildTfidf(sentences.map((s) => s.text), lex.stopwords);
  const corpus = corpusStats(model);
  const topics = findTopics(model, sentences);
  const features = buildSentenceFeatures(sentences, model, lex);

  // 4. candidatos
  const range = CLIP_LENGTH_RANGE_SEC[input.settings.length] ?? CLIP_LENGTH_RANGE_SEC.auto;
  const built = buildCandidates({ sentences, features, topics, range });
  if (built.noPunctuation) {
    warnings.push(
      'A transcrição veio sem pontuação final — o fim dos cortes foi decidido pelas pausas.',
    );
  }
  if (built.relaxed) {
    warnings.push(
      'Nenhum trecho abria numa fronteira limpa: as travas de abertura foram afrouxadas.',
    );
  }
  if (built.spans.length === 0) {
    warnings.push('Nenhum trecho cabe na duração escolhida. Tente outra faixa de duração.');
    return { clips: [], topics: topics.boundaries.map((i) => sourceIndex[i]), warnings };
  }

  // 5. notas
  const energyRef = energyStats(input.energy?.db ?? null);
  if (!input.energy || !energyRef) {
    warnings.push('Sem leitura de energia do áudio: a nota de emoção usou só o texto.');
  }
  const ctx: ScoreContext = {
    sentences,
    features,
    model,
    corpus,
    topics,
    lex,
    energy: energyRef ? (input.energy as EnergyEnvelope) : null,
    energyRef,
    focusTokens: focusTokensOf(input.settings.focusPrompt ?? '', lex.stopwords),
  };

  type Scored = { span: CandidateSpan; score: ClipScore };
  const approved: Scored[] = [];
  const rejectedReasons = new Map<string, number>();
  for (const span of built.spans) {
    const score = scoreClip(span.i0, span.i1, ctx);
    if (score.rejected) {
      rejectedReasons.set(score.rejected, (rejectedReasons.get(score.rejected) ?? 0) + 1);
      continue;
    }
    approved.push({ span, score });
  }

  if (approved.length === 0) {
    // Último recurso: aceita quem só pecou na NOTA (nunca quem abre em muleta,
    // anáfora, conectivo ou logística — essas travas não afrouxam).
    for (const span of built.spans) {
      const score = scoreClip(span.i0, span.i1, ctx);
      if (score.rejected !== 'nota abaixo do piso' && score.rejected !== 'gancho fraco') continue;
      approved.push({ span, score });
    }
    if (approved.length > 0) {
      warnings.push('Nenhum trecho passou do piso de qualidade; entregando os menos fracos.');
    }
  }

  if (approved.length === 0) {
    warnings.push(
      'Este vídeo não tem trecho que funcione sozinho (só apresentação, logística ou fala solta).',
    );
    return { clips: [], topics: topics.boundaries.map((i) => sourceIndex[i]), warnings };
  }

  // 6. ordenação estável
  approved.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.span.startMs - b.span.startMs ||
      a.span.i0 - b.span.i0 ||
      a.span.i1 - b.span.i1,
  );

  // 7. seleção: diversidade de assunto primeiro, sem sobreposição
  const count = resolveCount(input.settings.count, input.durationSec);
  const bestTotal = approved[0].score.total;
  const floor = Math.max(MIN_TOTAL, RELATIVE_FLOOR * bestTotal);
  const picked = selectDiverse(approved, count, floor, topics);

  if (picked.length < count) {
    warnings.push(
      `Só ${picked.length} trecho(s) chegaram na qualidade mínima (você pediu ${count}). ` +
        'Preferimos entregar menos a entregar corte fraco.',
    );
    const motivos = Array.from(rejectedReasons.entries()).sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    );
    if (motivos.length > 0) {
      warnings.push(`Motivo mais comum de descarte: ${motivos[0][0]} (${motivos[0][1]} trechos).`);
    }
  }

  // 8. borda final (reusa a matemática de silêncio do pipeline) + anti-colisão
  type Final = { span: CandidateSpan; score: ClipScore; startMs: number; endMs: number };
  const refined: Final[] = [];
  for (const p of picked) {
    const b = refineBounds(p.span.startMs, p.span.endMs, words, input.settings.length);
    const collide = refined.some((r) => overlapRatio(r, b) > MAX_OVERLAP);
    if (collide) continue; // o de nota maior já ocupou o momento
    refined.push({ span: p.span, score: p.score, startMs: b.startMs, endMs: b.endMs });
  }

  // 9. nota relativa (o melhor do vídeo = 99) + textos
  const top = refined.reduce((m, r) => Math.max(m, r.score.total), 0) || 1;
  const clips: FinalClip[] = refined.map((r) => {
    const texts = buildClipTexts(
      r.span.i0,
      r.span.i1,
      r.score,
      { sentences, features, model, lex },
      r.endMs - r.startMs,
    );
    const candidateId = `local-${sentences[r.span.i0].id}-${sentences[r.span.i1].id}`;
    const plan = sanitizeClipPlan(
      {
        candidateId,
        title: texts.title,
        headline: texts.headline,
        hook: texts.hook,
        description: texts.description,
        hashtags: texts.hashtags,
        score: clampScore(Math.round((99 * r.score.total) / top)),
        scoreBreakdown: r.score.breakdown,
        why: texts.why,
        extendStartSentences: 0,
        extendEndSentences: 0,
      },
      candidateId,
    );
    return { plan, startMs: r.startMs, endMs: r.endMs };
  });

  clips.sort((a, b) => b.plan.score - a.plan.score || a.startMs - b.startMs);

  return { clips, topics: topics.boundaries.map((i) => sourceIndex[i]), warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// Peças
// ───────────────────────────────────────────────────────────────────────────

/**
 * Recorte pela faixa pedida. Uma frase entra se está INTEIRA dentro dela; se
 * nenhuma estiver (faixa curta demais), entram as que encostam — o cliente
 * pediu aquele pedaço, não um erro.
 */
function applyRange(
  sentences: Sentence[],
  range: ClipSettings['range'],
): { sentences: Sentence[]; sourceIndex: number[] } {
  if (!range) return { sentences, sourceIndex: sentences.map((_, i) => i) };
  const a = Math.max(0, range.startSec * 1000);
  const b = Math.max(a, range.endSec * 1000);

  const inside: number[] = [];
  const touching: number[] = [];
  sentences.forEach((s, i) => {
    if (s.startMs >= a && s.endMs <= b) inside.push(i);
    if (s.endMs > a && s.startMs < b) touching.push(i);
  });
  const idx = inside.length > 0 ? inside : touching;
  return { sentences: idx.map((i) => sentences[i]), sourceIndex: idx };
}

export function resolveCount(preset: ClipCountPreset, durationSec: number): number {
  const raw = preset === 'auto' ? autoClipCount(durationSec) : Number(preset);
  const n = Number.isFinite(raw) ? Math.round(raw) : LIMITS.minClips;
  return Math.max(1, Math.min(LIMITS.maxClips, n));
}

/**
 * Diversidade: primeira passada dá 1 corte por assunto, a segunda permite 2, e
 * só então libera. É o que evita entregar 5 cortes do mesmo trecho quando o
 * vídeo tem 6 assuntos — e é a diferença mais visível pro cliente.
 */
function selectDiverse<T extends { span: CandidateSpan; score: ClipScore }>(
  ranked: T[],
  count: number,
  floor: number,
  topics: TopicMap,
): T[] {
  const picked: T[] = [];
  const taken = new Set<number>();
  const perTopic = new Map<number, number>();
  const caps = [1, 2, Number.POSITIVE_INFINITY];

  for (const cap of caps) {
    for (let i = 0; i < ranked.length; i++) {
      if (picked.length >= count) break;
      if (taken.has(i)) continue;
      const cand = ranked[i];
      if (cand.score.total < floor) continue;
      const t = topics.topicOf[cand.span.i0] ?? 0;
      if ((perTopic.get(t) ?? 0) >= cap) continue;
      // Dois cortes não podem compartilhar frase — a mesma fala aparecendo em
      // dois clipes é o cheiro mais forte de curadoria automática.
      if (picked.some((p) => cand.span.i0 <= p.span.i1 && p.span.i0 <= cand.span.i1)) continue;
      picked.push(cand);
      taken.add(i);
      perTopic.set(t, (perTopic.get(t) ?? 0) + 1);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

// ───────────────────────────────────────────────────────────────────────────
// Re-exports (o pipeline e o prosody.ts importam daqui)
// ───────────────────────────────────────────────────────────────────────────

export type { CandidateSpan } from './candidates';
export type { Lexicon } from './lexicon';
export type { ClipScore, ClipSignals, SentenceFeature } from './score';
export type { CorpusStats, TfidfModel } from './tfidf';
export type { TopicMap } from './topics';
export type { ClipTexts } from './titles';
export { buildCandidates, overlapRatio } from './candidates';
export { buildLexicon } from './lexicon';
export { buildSentenceFeatures, energyStats, scoreClip } from './score';
export { buildTfidf, corpusStats } from './tfidf';
export { findTopics } from './topics';
export { buildClipTexts } from './titles';
