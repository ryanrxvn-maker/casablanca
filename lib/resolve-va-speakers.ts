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

  // --- COPY: cobertura por utterance (conteúdo do roteiro do principal) ---
  // Usada como (a) ORIENTAÇÃO do pitch (qual cluster é o principal) e (b)
  // FALLBACK quando o pitch não separa (locutores do mesmo sexo).
  let copyCoverage: number[] | null = null;
  let copyRanks: number[] | null = null;
  let copyReason = '';
  if (twoRoles && input.copyText && input.copyText.trim().length > 0) {
    const c = attributeByCopy(utterances.map((u) => ({ text: u.text })), input.copyText);
    copyReason = c.reason;
    copyCoverage = c.coverage;
    if (c.confident && c.ranks) copyRanks = c.ranks;
  }

  // --- PITCH/F0: separação ACÚSTICA (física) — PRIMÁRIA quando confiante ---
  // Voz é o sinal mais confiável de QUEM fala (homem ~110Hz vs mulher
  // ~200Hz = inequívoco). O copy (que pode ser um briefing bagunçado) só
  // ORIENTA qual cluster é o principal e VALIDA — nunca sobrescreve a
  // física. Corrige o bug 2026-06-11 (copy errado mandava trecho do Doutor
  // pro depoimento mesmo com vozes claramente distintas).
  if (twoRoles && input.channelData && input.sampleRate) {
    const p = clusterUtterancesByPitch(
      input.channelData,
      input.sampleRate,
      utterances.map((u) => ({ start: u.start, end: u.end })),
      2,
    );
    if (p.confident && p.clusters) {
      // orienta: qual cluster CRU (0/1) é o principal?
      let principalCluster: number;
      let orientNote: string;
      if (copyCoverage) {
        // principal = cluster cujos trechos casam MAIS com a copy
        const sum = [0, 0];
        const cnt = [0, 0];
        for (let i = 0; i < utterances.length; i++) {
          const cl = p.clusters[i];
          if (cl === 0 || cl === 1) {
            const cov = copyCoverage[i] >= 0 ? copyCoverage[i] : 0;
            sum[cl] += cov; cnt[cl]++;
          }
        }
        const avg0 = cnt[0] ? sum[0] / cnt[0] : 0;
        const avg1 = cnt[1] ? sum[1] / cnt[1] : 0;
        principalCluster = avg0 >= avg1 ? 0 : 1;
        orientNote = `copy orientou principal (cobertura ${(Math.max(avg0, avg1) * 100).toFixed(0)}% vs ${(Math.min(avg0, avg1) * 100).toFixed(0)}%)`;
      } else {
        // sem copy: principal = quem mais fala (rank 0 do pitch)
        principalCluster = p.clusters[p.ranks!.findIndex((r) => r === 0)] ?? 0;
        orientNote = 'quem mais fala = principal';
      }
      const ranks = utterances.map((_, i) => {
        const cl = p.clusters![i];
        if (cl === -1) return i > 0 ? (p.clusters![i - 1] === principalCluster ? 0 : 1) : 0;
        return cl === principalCluster ? 0 : 1;
      });
      // validação opcional pela copy: concordância entre pitch-orientado e copy-anchor
      let valNote = '';
      if (copyRanks) {
        const agree = agreement(ranks, copyRanks);
        valNote = ` · validado pela copy (${(agree * 100).toFixed(0)}%)`;
      }
      const lo = (p.clusterHzRaw?.[0] ?? 0).toFixed(0);
      const hi = (p.clusterHzRaw?.[1] ?? 0).toFixed(0);
      return {
        ranks,
        method: `tom de voz · ${lo}Hz vs ${hi}Hz${valNote}`,
        reason: `${p.reason}; ${orientNote}${copyReason ? `; copy: ${copyReason}` : ''}`,
        confident: true,
      };
    }
    // pitch não confiante (mesmo sexo / gap fraco) — cai pra copy
    copyReason = copyReason ? `${copyReason}; pitch: ${p.reason}` : `pitch: ${p.reason}`;
  }

  // --- COPY-ONLY (pitch indisponível/inconclusivo, mas copy separou) ---
  if (copyRanks) {
    return { ranks: copyRanks, method: 'copy (roteiro)', reason: copyReason, confident: true };
  }

  // --- AssemblyAI labels (último recurso) ---
  return {
    ranks: ranksFromAaiLabels(utterances),
    method: 'AssemblyAI',
    reason: copyReason ? `copy/pitch inconclusivos (${copyReason})` : 'speaker_labels AssemblyAI',
    confident: false,
  };
}
