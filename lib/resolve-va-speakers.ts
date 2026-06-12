/**
 * RESOLVE QUEM FALA CADA TRECHO — fonte única de verdade (prévia 👁 E disparo).
 *
 * Hierarquia de assertividade (2026-06-11, após 3 iterações com o user):
 *   1. COPY-ANCHOR (quando o doc tem "Link da Copy"): o roteiro que o
 *      principal lê é GROUND TRUTH — trecho que casa = principal, resto =
 *      depoimento. Determinístico, imune a chute acústico.
 *   2. PITCH/F0 (sempre que há áudio): tom de voz separa homem/mulher por
 *      física. Confirma a copy; substitui quando não há copy.
 *   3. AssemblyAI speaker_labels: último recurso.
 *
 * Quando copy E pitch concordam → confiança máxima. Quando divergem, copy
 * vence (é o roteiro real) mas o caller é avisado.
 *
 * Retorna SEMPRE ranks por utterance (0 = principal / quem mais fala).
 */
import { clusterUtterancesByPitch } from './pitch-speaker';
import { attributeByCopy } from './copy-anchor';

export type ResolveUtt = { speaker: string; start: number; end: number; text: string };

export type ResolveResult = {
  /** rank por utterance: 0 = principal, 1 = depoimento, ... */
  ranks: number[];
  /** método vencedor (UI/card) */
  method: string;
  /** detalhe pra log/painel */
  reason: string;
  /** true quando a separação é confiável (copy ou pitch) vs só AAI */
  confident: boolean;
};

export type ResolveInput = {
  utterances: ResolveUtt[];
  expectedSpeakers: number;
  /** canal 0 do áudio (voz isolada de preferência) pra pitch */
  channelData?: Float32Array | null;
  sampleRate?: number | null;
  /** texto do doc da copy (roteiro do principal) — habilita copy-anchor */
  copyText?: string | null;
};

/** Concordância entre dois vetores de rank (fração de utterances iguais). */
function agreement(a: number[], b: number[]): number {
  if (a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

/** Rank por tempo de fala dos speaker_labels da AssemblyAI (fallback). */
function ranksFromAaiLabels(utts: ResolveUtt[]): number[] {
  const talk = new Map<string, number>();
  for (const u of utts) talk.set(u.speaker, (talk.get(u.speaker) || 0) + (u.end - u.start));
  const ranked = Array.from(talk.entries()).sort((x, y) => y[1] - x[1]).map(([s]) => s);
  const rankBy: Record<string, number> = {};
  ranked.forEach((s, i) => { rankBy[s] = i; });
  return utts.map((u) => rankBy[u.speaker] ?? 0);
}

export function resolveVaSpeakers(input: ResolveInput): ResolveResult {
  const { utterances, expectedSpeakers } = input;
  if (!utterances.length) {
    return { ranks: [], method: 'vazio', reason: 'sem utterances', confident: false };
  }

  // só roteamos multi-locutor pra 2 papéis (caso real); >2 cai no AAI
  const twoRoles = expectedSpeakers === 2;

  // --- 1. COPY-ANCHOR ---
  let copyRanks: number[] | null = null;
  let copyReason = '';
  if (twoRoles && input.copyText && input.copyText.trim().length > 0) {
    const c = attributeByCopy(utterances.map((u) => ({ text: u.text })), input.copyText);
    copyReason = c.reason;
    if (c.confident && c.ranks) copyRanks = c.ranks;
  }

  // --- 2. PITCH/F0 ---
  let pitchRanks: number[] | null = null;
  let pitchReason = '';
  let pitchHz: number[] | null = null;
  if (twoRoles && input.channelData && input.sampleRate) {
    const p = clusterUtterancesByPitch(
      input.channelData,
      input.sampleRate,
      utterances.map((u) => ({ start: u.start, end: u.end })),
      2,
    );
    pitchReason = p.reason;
    if (p.confident && p.ranks) { pitchRanks = p.ranks; pitchHz = p.clusterHz; }
  }

  // --- combinação ---
  if (copyRanks && pitchRanks) {
    // alinha rótulos: pitch pode ter principal/depoimento invertido vs copy
    const agree = agreement(copyRanks, pitchRanks);
    const agreeFlipped = agreement(copyRanks, pitchRanks.map((r) => (r === 0 ? 1 : r === 1 ? 0 : r)));
    const best = Math.max(agree, agreeFlipped);
    const hz = pitchHz ? ` · ${pitchHz.map((h) => h.toFixed(0) + 'Hz').join(' vs ')}` : '';
    return {
      ranks: copyRanks, // copy é a verdade
      method: best >= 0.8 ? `copy + tom de voz (concordam ${(best * 100).toFixed(0)}%)${hz}` : `copy (roteiro)${hz}`,
      reason: `${copyReason}; pitch: ${pitchReason}; concordância ${(best * 100).toFixed(0)}%`,
      confident: true,
    };
  }
  if (copyRanks) {
    return { ranks: copyRanks, method: 'copy (roteiro)', reason: copyReason, confident: true };
  }
  if (pitchRanks) {
    const hz = pitchHz ? ` · ${pitchHz.map((h) => h.toFixed(0) + 'Hz').join(' vs ')}` : '';
    return { ranks: pitchRanks, method: `tom de voz${hz}`, reason: pitchReason, confident: true };
  }

  // --- 3. AssemblyAI labels (último recurso) ---
  const reasons = [copyReason, pitchReason].filter(Boolean).join(' · ');
  return {
    ranks: ranksFromAaiLabels(utterances),
    method: 'AssemblyAI',
    reason: reasons ? `copy/pitch inconclusivos (${reasons})` : 'speaker_labels AssemblyAI',
    confident: false,
  };
}
