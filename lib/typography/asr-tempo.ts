/**
 * AFINAÇÃO DOS TEMPOS da transcrição contra a fala MEDIDA no áudio.
 *
 * Queixa do Silas (02.09): "as vezes bate um pouco no tempo errado a
 * legenda". O Whisper devolve timestamps bons, mas com dois vícios
 * conhecidos: palavra que NASCE cedo demais (o start cai no silêncio antes
 * da voz entrar) e palavra que MORRE tarde demais (o end atravessa a pausa).
 * Nos dois casos a legenda pisca fora da fala e o olho percebe.
 *
 * A régua aqui é a fala medida pelo detector do próprio arquivo (os spans
 * que a auditoria já calcula). As correções são COVARDES de propósito:
 * nenhuma palavra anda mais que SNAP_MS, nenhuma muda de ordem, nenhuma
 * some — quem acerta o grosso é o Whisper; isto só encosta a borda.
 */

import type { TWord } from './engine';
import type { Span } from './asr-gaps';

/** Até onde uma borda pode ser puxada pro encontro da fala. */
export const SNAP_MS = 260;
/** Duração mínima que sobra pra qualquer palavra depois da afinação. */
const MIN_DUR = 40;

/** O ponto está dentro de algum span de fala? */
function dentroDaFala(spans: Span[], t: number): boolean {
  for (const s of spans) {
    if (t >= s.start && t < s.end) return true;
    if (s.start > t) break; // spans vêm ordenados
  }
  return false;
}

/** Início de fala mais próximo DEPOIS de t (ou null). */
function proximoInicio(spans: Span[], t: number): number | null {
  for (const s of spans) if (s.start >= t) return s.start;
  return null;
}

/** Fim de fala mais próximo ANTES de t (ou null). */
function fimAnterior(spans: Span[], t: number): number | null {
  let melhor: number | null = null;
  for (const s of spans) {
    if (s.end <= t) melhor = s.end;
    else break;
  }
  return melhor;
}

/**
 * Afina os tempos das palavras contra a fala medida. Puro e determinístico;
 * devolve um array NOVO (não muta a entrada).
 */
export function afinarTempos(words: TWord[], fala: Span[]): TWord[] {
  if (words.length === 0) return [];
  const spans = fala.slice().sort((a, b) => a.start - b.start);
  const out: TWord[] = [];

  for (const w of words) {
    let start = w.start;
    let end = Math.max(w.end, w.start + MIN_DUR);

    // start caiu no silêncio e a voz entra logo adiante → nasce COM a voz
    if (spans.length > 0 && !dentroDaFala(spans, start)) {
      const on = proximoInicio(spans, start);
      if (on !== null && on - start > 0 && on - start <= SNAP_MS && on < end - MIN_DUR) {
        start = on;
      }
    }
    // end caiu no silêncio e a voz acabou logo atrás → morre COM a voz
    if (spans.length > 0 && !dentroDaFala(spans, end)) {
      const off = fimAnterior(spans, end);
      if (off !== null && end - off > 0 && end - off <= SNAP_MS && off > start + MIN_DUR) {
        end = off;
      }
    }

    // ordem e não-sobreposição: o start nunca volta pra trás do vizinho
    const prev = out[out.length - 1];
    if (prev && start < prev.end) start = prev.end;
    if (end < start + MIN_DUR) end = start + MIN_DUR;

    out.push({ ...w, start: Math.round(start), end: Math.round(end) });
  }
  return out;
}
