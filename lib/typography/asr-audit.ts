'use client';

/**
 * AUDITORIA DA TRANSCRIÇÃO no navegador: mede a fala do áudio, acha os
 * trechos que ficaram SEM legenda e manda transcrever de novo só eles.
 *
 * O Whisper vai numa tacada só com o áudio inteiro e, em vídeo longo, às
 * vezes desiste de um pedaço — volta sem palavra nenhuma ali, sem erro. A
 * ferramenta acreditava e o vídeo saía com um vão no meio.
 *
 * Aqui o áudio é decodificado e passa pelo MESMO detector de fala da
 * decupagem (`lib/speech-detect.ts`), que mede contra o piso do próprio
 * arquivo em vez de um limiar absoluto — é o que separa "pausa" de "room
 * tone" em gravação de sala. O que tem voz e não tem palavra é falha de
 * reconhecimento, e vai de volta pro Whisper recortado.
 *
 * A conta pura mora em `lib/typography/asr-gaps.ts` (testada); aqui é o
 * trabalho de navegador (decodificar, recortar, chamar a rota).
 */

import { decodeAudioRobust, encodeWAV } from '@/lib/audio-engine';
import { detectSpeechMask, extractFeatures } from '@/lib/speech-detect';
import type { TWord } from './engine';
import {
  describeGaps,
  findAsrGaps,
  gapWindow,
  maskToSpans,
  spliceRecovered,
  type AsrGap,
} from './asr-gaps';
import { afinarTempos } from './asr-tempo';

/** Teto de janelas re-enviadas — cada uma é uma chamada a mais na API. */
const MAX_RECUPERACOES = 6;

export type AuditResult = {
  words: TWord[];
  /** trechos com voz que estavam sem legenda ANTES da recuperação */
  falhasAntes: AsrGap[];
  /** o que continuou sem legenda mesmo depois de tentar de novo */
  falhasDepois: AsrGap[];
  /** vãos que são silêncio de verdade (não são defeito) */
  silencios: AsrGap[];
  /** palavras devolvidas pela recuperação */
  recuperadas: number;
  /** quantas janelas foram re-enviadas */
  janelas: number;
  /** ficou falha de fora por causa do teto de janelas? */
  limitado: boolean;
};

export type AuditOpts = {
  /** manda uma janela de áudio pro Whisper e devolve as palavras dela */
  transcreverJanela: (wav: Blob) => Promise<TWord[]>;
  onStage?: (s: string) => void;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

/** Recorta [iniMs, fimMs) do buffer decodificado num WAV mono. */
function fatiaWav(buf: AudioBuffer, iniMs: number, fimMs: number): Blob {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor((iniMs / 1000) * sr));
  const b = Math.min(buf.length, Math.ceil((fimMs / 1000) * sr));
  const n = Math.max(1, b - a);
  const canal = buf.getChannelData(0).subarray(a, b);
  const fatia = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
  fatia.copyToChannel(canal.length === n ? canal : new Float32Array(n), 0);
  return encodeWAV(fatia);
}

/**
 * Confere a transcrição contra a fala do áudio e tenta recuperar o que
 * faltou. Nunca joga fora palavra que já existia: só ACRESCENTA no vão.
 */
export async function auditarTranscricao(
  audio: Blob,
  words: TWord[],
  durationMs: number,
  opts: AuditOpts,
): Promise<AuditResult> {
  opts.onStage?.('Conferindo se algum trecho ficou sem legenda...');
  const buf = await decodeAudioRobust(audio);
  const dur = durationMs > 0 ? durationMs : Math.round(buf.duration * 1000);
  const f = extractFeatures(buf.getChannelData(0), buf.sampleRate);
  const { mask } = detectSpeechMask(f);
  const fala = maskToSpans(mask, f.frameSec);

  // ⭐ AFINA os tempos contra a fala medida ANTES de medir os vãos: palavra
  // que nascia no silêncio (legenda piscando cedo) encosta na voz. Covarde
  // por contrato — ver lib/typography/asr-tempo.ts.
  words = afinarTempos(words, fala);

  const gaps = findAsrGaps(words, fala, dur);
  const { falhas, silencios } = describeGaps(gaps);
  const base: AuditResult = {
    words,
    falhasAntes: falhas,
    falhasDepois: [],
    silencios,
    recuperadas: 0,
    janelas: 0,
    limitado: false,
  };
  if (falhas.length === 0) return base;

  // as maiores primeiro: se o teto cortar, corta o que menos dói
  const alvos = falhas.slice().sort((a, b) => b.end - b.start - (a.end - a.start));
  const fila = alvos.slice(0, MAX_RECUPERACOES);
  let atual = words;
  let recuperadas = 0;
  let janelas = 0;

  for (let i = 0; i < fila.length; i++) {
    if (opts.signal?.aborted) break;
    const g = fila[i];
    const win = gapWindow(g, dur);
    opts.onStage?.(
      `Recuperando legenda do trecho ${fmt(g.start)} a ${fmt(g.end)} (${i + 1}/${fila.length})...`,
    );
    opts.onProgress?.((i + 0.5) / fila.length);
    try {
      const wav = fatiaWav(buf, win.start, win.end);
      const novas = await opts.transcreverJanela(wav);
      janelas += 1;
      const r = spliceRecovered(atual, novas, g, win.start);
      atual = r.words;
      recuperadas += r.added;
    } catch (e) {
      // uma janela que falha não pode derrubar a auditoria inteira
      console.warn('[asr-audit] janela não recuperada', g, e);
    }
  }

  // mede DE NOVO com as palavras novas: o que ainda ficou sem legenda?
  // (as recuperadas também passam pela afinação — chegaram cruas do Whisper)
  atual = afinarTempos(atual, fala);
  const depois = describeGaps(findAsrGaps(atual, fala, dur));
  return {
    words: atual,
    falhasAntes: falhas,
    falhasDepois: depois.falhas,
    silencios: depois.silencios,
    recuperadas,
    janelas,
    limitado: alvos.length > fila.length,
  };
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Frase honesta pro usuário, a partir do resultado da auditoria. */
export function resumoAuditoria(r: AuditResult): { tom: 'ok' | 'aviso' | 'erro'; texto: string } {
  const faltando = r.falhasDepois;
  if (r.falhasAntes.length === 0) {
    const sil = r.silencios.length;
    return {
      tom: 'ok',
      texto:
        sil > 0
          ? `Transcrição conferida contra o áudio: nenhum trecho falado ficou sem legenda (${sil} vão${sil === 1 ? '' : 's'} ${sil === 1 ? 'é' : 'são'} silêncio de verdade).`
          : 'Transcrição conferida contra o áudio: nenhum trecho falado ficou sem legenda.',
    };
  }
  if (faltando.length === 0) {
    return {
      tom: 'ok',
      texto:
        `${r.falhasAntes.length} trecho${r.falhasAntes.length === 1 ? '' : 's'} tinha${r.falhasAntes.length === 1 ? '' : 'm'} fala sem legenda ` +
        `(${r.falhasAntes.map((g) => `${fmt(g.start)} a ${fmt(g.end)}`).join(', ')}) — ` +
        `recuperado${r.falhasAntes.length === 1 ? '' : 's'} com ${r.recuperadas} palavra${r.recuperadas === 1 ? '' : 's'}.`,
    };
  }
  return {
    tom: 'erro',
    texto:
      `Ainda falta legenda em ${faltando.length} trecho${faltando.length === 1 ? '' : 's'} com fala: ` +
      `${faltando.map((g) => `${fmt(g.start)} a ${fmt(g.end)}`).join(', ')}. ` +
      (r.recuperadas > 0 ? `(${r.recuperadas} palavra${r.recuperadas === 1 ? '' : 's'} recuperada${r.recuperadas === 1 ? '' : 's'} nos outros.) ` : '') +
      (r.limitado ? 'Cliquei no máximo de trechos por vez — roda "Conferir de novo" pra continuar.' : 'Dá pra tentar de novo em "Conferir de novo".'),
  };
}
