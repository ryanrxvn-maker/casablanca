/**
 * AUTO CORTES — análise determinística em volta do modelo (PURO, testável).
 *
 * Nada aqui toca DOM, rede ou SDK: são as regras que transformam a saída do
 * Claude (que só fala em IDs de frase) em tempo de vídeo confiável.
 *
 *   planWindows        divide a transcrição em janelas de ~12 min com overlap
 *   resolveCandidates  ids de frase → tempo (+ filtro de faixa de duração)
 *   dedupCandidates    dois candidatos cobrindo o mesmo momento → fica um
 *   applyExtensions    ajuste fino em NÚMERO DE FRASES pedido pelo reduce
 *   refineBounds       snap em palavra/silêncio + faixa de duração
 *   finalizeClips      plano final saneado e ordenado por nota
 *
 * Ver docs/auto-cortes/ARQUITETURA.md §3.3 (passo 5 = refineBounds).
 */

import type {
  ClipLengthPreset,
  ClipPlan,
  MapResult,
  Ms,
  ResolvedCandidate,
  Sentence,
  ReduceResult,
  ScoreBreakdown,
  Word,
} from './types';
import { CLIP_LENGTH_RANGE_SEC, LIMITS } from './types';
import { CANDIDATE_KINDS, clampScore, sanitizeHashtags, sanitizeHeadline } from './prompts';

// ───────────────────────────────────────────────────────────────────────────
// Constantes de borda (ARQUITETURA §3.3 passo 5)
// ───────────────────────────────────────────────────────────────────────────

/** Respiro antes da 1ª palavra. */
export const LEAD_PAD_MS = 150;
/** Respiro depois da última palavra. */
export const TAIL_PAD_MS = 300;
/** Silêncio menor que isto antes da 1ª palavra = recua até o início dele. */
export const SILENCE_SNAP_MS = 250;
/** Tolerância da faixa de duração no filtro do MAP (o modelo estima pelo relógio). */
export const RANGE_TOLERANCE = 0.15;
/** Sobreposição (fração da MENOR duração) a partir da qual dois candidatos são o mesmo. */
export const DEDUP_OVERLAP = 0.6;
/** Corte do texto de `firstSentence`/`lastSentence` mandado pro reduce. */
export const SENTENCE_PREVIEW_CHARS = 160;

// ───────────────────────────────────────────────────────────────────────────
// 1. Janelas
// ───────────────────────────────────────────────────────────────────────────

export type AnalyzeWindow = { idx: number; sentences: Sentence[] };

export type PlanWindowsOpts = {
  windowSec?: number;
  overlapSec?: number;
  /** teto duro por janela (a rota recusa acima disso) */
  maxSentences?: number;
};

/**
 * Divide as frases em janelas de `windowSec` que avançam `windowSec - overlapSec`.
 * Uma frase entra na janela pelo seu INÍCIO (assim o overlap é exatamente a
 * cauda repetida, sem frase pela metade). Janela vazia e janela que não
 * acrescenta nada à anterior (cauda curta) são descartadas.
 */
export function planWindows(sentences: Sentence[], opts: PlanWindowsOpts = {}): AnalyzeWindow[] {
  const list = sentences.filter(Boolean);
  if (list.length === 0) return [];

  const windowMs = Math.max(1, (opts.windowSec ?? LIMITS.analyzeWindowSec)) * 1000;
  const overlapMs = Math.max(0, Math.min(windowMs - 1, (opts.overlapSec ?? LIMITS.analyzeWindowOverlapSec) * 1000));
  const stepMs = Math.max(1, windowMs - overlapMs);
  const maxSentences = Math.max(1, opts.maxSentences ?? 400);

  const first = list[0].startMs;
  const last = list[list.length - 1].startMs;

  const groups: Sentence[][] = [];
  for (let t = first; t <= last; t += stepMs) {
    const inWindow = list.filter((s) => s.startMs >= t && s.startMs < t + windowMs);
    if (inWindow.length === 0) continue;
    const prev = groups[groups.length - 1];
    // Cauda que já está inteira na janela anterior não vira janela nova.
    if (prev && inWindow[inWindow.length - 1].id === prev[prev.length - 1].id) continue;
    groups.push(inWindow);
  }
  if (groups.length === 0) groups.push(list);

  // Teto de frases por janela (fala muito rápida): quebra em pedaços na ordem.
  const out: AnalyzeWindow[] = [];
  for (const g of groups) {
    if (g.length <= maxSentences) {
      out.push({ idx: out.length, sentences: g });
      continue;
    }
    for (let i = 0; i < g.length; i += maxSentences) {
      out.push({ idx: out.length, sentences: g.slice(i, i + maxSentences) });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Candidatos: ids de frase → tempo
// ───────────────────────────────────────────────────────────────────────────

function clamp100(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clampBreakdown(s: Partial<ScoreBreakdown> | undefined): ScoreBreakdown {
  return {
    hook: clamp100(s?.hook),
    value: clamp100(s?.value),
    emotion: clamp100(s?.emotion),
    completeness: clamp100(s?.completeness),
    shareability: clamp100(s?.shareability),
  };
}

export function scoreSum(s: ScoreBreakdown): number {
  return s.hook + s.value + s.emotion + s.completeness + s.shareability;
}

/** Preview de frase mandada pro reduce — nunca passa de SENTENCE_PREVIEW_CHARS. */
export function previewSentence(text: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= SENTENCE_PREVIEW_CHARS) return t;
  return `${t.slice(0, SENTENCE_PREVIEW_CHARS - 1).trimEnd()}…`;
}

const KIND_SET = new Set<string>(CANDIDATE_KINDS);

/**
 * Resolve a saída crua do MAP de UMA janela.
 * Descarta o que não dá pra confiar: id inexistente, ordem invertida e
 * duração fora da faixa pedida (com `RANGE_TOLERANCE` de folga).
 */
export function resolveCandidates(
  windowIdx: number,
  raw: MapResult,
  sentences: Sentence[],
  lengthPreset: ClipLengthPreset,
): ResolvedCandidate[] {
  const range = CLIP_LENGTH_RANGE_SEC[lengthPreset] ?? CLIP_LENGTH_RANGE_SEC.auto;
  const minSec = range.min * (1 - RANGE_TOLERANCE);
  const maxSec = range.max * (1 + RANGE_TOLERANCE);

  const indexById = new Map<string, number>();
  sentences.forEach((s, i) => indexById.set(s.id, i));

  const out: ResolvedCandidate[] = [];
  const list = Array.isArray(raw?.candidates) ? raw.candidates : [];

  for (const c of list) {
    if (!c) continue;
    const i0 = indexById.get(String(c.startId));
    const i1 = indexById.get(String(c.endId));
    if (i0 === undefined || i1 === undefined) continue; // id inventado
    if (i0 > i1) continue; // ordem invertida

    const start = sentences[i0];
    const end = sentences[i1];
    const startMs = start.startMs;
    const endMs = end.endMs;
    const durationSec = (endMs - startMs) / 1000;
    if (!(durationSec > 0)) continue;
    if (durationSec < minSec || durationSec > maxSec) continue;

    const iHook = indexById.get(String(c.hookId));
    const hookId = iHook !== undefined && iHook >= i0 && iHook <= i1 ? sentences[iHook].id : start.id;

    out.push({
      id: `w${windowIdx}c${out.length}`,
      startId: start.id,
      endId: end.id,
      hookId,
      topic: String(c.topic ?? '').trim(),
      why: String(c.why ?? '').trim(),
      scores: clampBreakdown(c.scores),
      kind: KIND_SET.has(String(c.kind)) ? c.kind : 'outro',
      startMs,
      endMs,
      durationSec,
      firstSentence: previewSentence(start.text),
      lastSentence: previewSentence(end.text),
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Dedup global (as janelas se sobrepõem de propósito)
// ───────────────────────────────────────────────────────────────────────────

export function overlapMs(a: { startMs: Ms; endMs: Ms }, b: { startMs: Ms; endMs: Ms }): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

/**
 * Sobreposição > `DEDUP_OVERLAP` da MENOR duração = mesmo momento; fica o de
 * maior soma de notas (empate: o que começa antes; depois o id, pra ser estável).
 * Saída ordenada por tempo.
 */
export function dedupCandidates(all: ResolvedCandidate[]): ResolvedCandidate[] {
  const ranked = [...all].sort((a, b) => {
    const d = scoreSum(b.scores) - scoreSum(a.scores);
    if (d !== 0) return d;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const kept: ResolvedCandidate[] = [];
  for (const c of ranked) {
    const dupe = kept.some((k) => {
      const shorter = Math.min(k.endMs - k.startMs, c.endMs - c.startMs);
      if (shorter <= 0) return false;
      return overlapMs(k, c) > DEDUP_OVERLAP * shorter;
    });
    if (!dupe) kept.push(c);
  }

  return kept.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Ajuste em número de frases pedido pelo REDUCE
// ───────────────────────────────────────────────────────────────────────────

function clampExtend(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(-2, Math.min(2, v));
}

/**
 * `extendStartSentences` positivo = COMEÇA n frases antes; negativo encurta.
 * `extendEndSentences` positivo = TERMINA n frases depois; negativo encurta.
 * `sentences` é a lista COMPLETA da transcrição (o candidato guarda os ids).
 */
export function applyExtensions(
  plan: Pick<ClipPlan, 'extendStartSentences' | 'extendEndSentences'>,
  candidate: Pick<ResolvedCandidate, 'startId' | 'endId' | 'startMs' | 'endMs'>,
  sentences: Sentence[],
): { startMs: Ms; endMs: Ms } {
  const i0 = sentences.findIndex((s) => s.id === candidate.startId);
  const i1 = sentences.findIndex((s) => s.id === candidate.endId);
  if (i0 < 0 || i1 < 0 || i0 > i1) return { startMs: candidate.startMs, endMs: candidate.endMs };

  const dStart = clampExtend(plan.extendStartSentences);
  const dEnd = clampExtend(plan.extendEndSentences);

  let a = Math.max(0, Math.min(sentences.length - 1, i0 - dStart));
  let b = Math.max(0, Math.min(sentences.length - 1, i1 + dEnd));
  if (a > b) {
    // Encurtou dos dois lados até se cruzar: mantém o miolo original.
    a = i0;
    b = i1;
  }

  return { startMs: sentences[a].startMs, endMs: sentences[b].endMs };
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Refino de bordas (ARQUITETURA §3.3 passo 5)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bordas finais do corte:
 *  - início = `palavra.start - 150 ms`; se o silêncio até a palavra anterior é
 *    menor que 250 ms, recua até o INÍCIO desse silêncio (fim da palavra
 *    anterior) — nunca come a palavra de trás;
 *  - fim = `palavra.end + 300 ms`, sem invadir a próxima palavra;
 *  - duração dentro da faixa do preset, mexendo só em palavras INTEIRAS.
 */
export function refineBounds(
  startMs: Ms,
  endMs: Ms,
  words: Word[],
  lengthPreset: ClipLengthPreset,
): { startMs: Ms; endMs: Ms } {
  if (!words || words.length === 0) {
    const s = Math.max(0, Math.round(startMs));
    return { startMs: s, endMs: Math.max(s + 1, Math.round(endMs)) };
  }

  const range = CLIP_LENGTH_RANGE_SEC[lengthPreset] ?? CLIP_LENGTH_RANGE_SEC.auto;

  // 1ª palavra que sobrevive ao corte (termina depois do início pedido).
  let i0 = words.findIndex((w) => w.end > startMs);
  if (i0 < 0) i0 = words.length - 1;
  // Última palavra que começa antes do fim pedido.
  let i1 = i0;
  for (let i = i0; i < words.length; i++) {
    if (words[i].start < endMs) i1 = i;
    else break;
  }
  if (i1 < i0) i1 = i0;

  const boundsFor = (a: number, b: number): { startMs: Ms; endMs: Ms } => {
    const prev = a > 0 ? words[a - 1] : null;
    const next = b + 1 < words.length ? words[b + 1] : null;
    const first = words[a];
    const last = words[b];

    let s: number;
    if (prev && first.start - prev.end < SILENCE_SNAP_MS) {
      s = prev.end; // snap no início do silêncio curto
    } else {
      s = first.start - LEAD_PAD_MS;
      if (prev) s = Math.max(s, prev.end); // nunca no meio da palavra anterior
    }
    s = Math.max(0, Math.round(s));

    let e = last.end + TAIL_PAD_MS;
    if (next) e = Math.min(e, next.start); // nunca no meio da próxima palavra
    e = Math.max(Math.round(last.end), Math.round(e));
    if (e <= s) e = s + 1;

    return { startMs: s, endMs: e };
  };

  const durOf = (a: number, b: number) => {
    const { startMs: s, endMs: e } = boundsFor(a, b);
    return (e - s) / 1000;
  };

  // Passou do máximo: solta palavras pelo FIM (o gancho fica).
  while (i1 > i0 && durOf(i0, i1) > range.max) i1--;

  // Abaixo do mínimo: puxa mais palavra pelo fim, depois pelo início.
  let guard = words.length * 2;
  while (guard-- > 0 && durOf(i0, i1) < range.min) {
    if (i1 + 1 < words.length && durOf(i0, i1 + 1) <= range.max) {
      i1++;
      continue;
    }
    if (i0 > 0 && durOf(i0 - 1, i1) <= range.max) {
      i0--;
      continue;
    }
    break;
  }

  return boundsFor(i0, i1);
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Plano final
// ───────────────────────────────────────────────────────────────────────────

export type FinalizeSettings = {
  length: ClipLengthPreset;
  /** nº máximo de cortes (já resolvido; `auto` vira número no cliente). */
  count?: number;
};

export type FinalClip = { plan: ClipPlan; startMs: Ms; endMs: Ms };

function cleanText(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Saneamento de UM corte do REDUCE (o schema garante a forma; isto garante o
 * estilo). Usado tanto pela rota (resposta do reduce) quanto por finalizeClips.
 */
export function sanitizeClipPlan(raw: Partial<ClipPlan> | null | undefined, candidateId?: string): ClipPlan {
  return {
    candidateId: candidateId ?? String(raw?.candidateId ?? ''),
    title: cleanText(raw?.title, 90),
    headline: sanitizeHeadline(String(raw?.headline ?? '')),
    hook: cleanText(raw?.hook, 160),
    description: String(raw?.description ?? '').trim().slice(0, 600),
    hashtags: sanitizeHashtags(Array.isArray(raw?.hashtags) ? raw!.hashtags.map(String) : []),
    score: clampScore(Number(raw?.score)),
    scoreBreakdown: clampBreakdown(raw?.scoreBreakdown),
    why: cleanText(raw?.why, 200),
    extendStartSentences: clampExtend(raw?.extendStartSentences),
    extendEndSentences: clampExtend(raw?.extendEndSentences),
  };
}

/**
 * Junta REDUCE + candidatos + palavras: cada corte vira `{ plan, startMs, endMs }`
 * com texto saneado, nota clampada e bordas refinadas. Ordenado por nota.
 */
export function finalizeClips(
  reduce: ReduceResult,
  candidates: ResolvedCandidate[],
  sentences: Sentence[],
  words: Word[],
  settings: FinalizeSettings,
): FinalClip[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: FinalClip[] = [];

  const clips = Array.isArray(reduce?.clips) ? reduce.clips : [];
  for (const raw of clips) {
    if (!raw) continue;
    const candidate = byId.get(String(raw.candidateId));
    if (!candidate) continue; // id inventado pelo modelo
    if (seen.has(candidate.id)) continue; // mesmo trecho duas vezes
    seen.add(candidate.id);

    const plan = sanitizeClipPlan(raw, candidate.id);
    const extended = applyExtensions(plan, candidate, sentences);
    const bounds = refineBounds(extended.startMs, extended.endMs, words, settings.length);

    out.push({ plan, startMs: bounds.startMs, endMs: bounds.endMs });
  }

  out.sort((a, b) => b.plan.score - a.plan.score || a.startMs - b.startMs);

  const limit = settings.count;
  return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out;
}
