/**
 * AUTO CORTES — transcrição do vídeo INTEIRO, em pedaços, no navegador.
 *
 * Vídeo longo (podcast de 2-3 h, 2-4 GB) é o caso NORMAL desta tool, então
 * nada aqui carrega o arquivo no heap e nada de vídeo sobe pro servidor:
 *
 *   1. o MESMO `File` é montado (WORKERFS) em cada instância do pool — é o que
 *      permite `-ss/-t` direto no arquivo do disco, sem cópia;
 *   2. `planAudioChunks` fatia em pedaços de 9 min com 3 s de sobreposição;
 *   3. cada instância extrai o áudio do seu pedaço (opus 16k mono ~3 MB) e já
 *      manda pro `/api/auto-cortes/transcribe` — extração e upload andam em
 *      paralelo, limitados por `LIMITS.asrConcurrency`;
 *   4. as palavras voltam com tempo RELATIVO ao pedaço; `mergeChunkWords`
 *      rebaseia, corta a sobreposição no meio e tira duplicata de fronteira;
 *   5. `buildSentences` + `transcriptHash` fecham o `Transcript`.
 *
 * Blindagem: pedaço que falha 3× não derruba o lote (vira aviso e o resto
 * segue); 429 respeita o `retry-after` do servidor esperando em relógio de
 * Worker (aba em 2º plano não estrangula); cancelamento pelo `AbortSignal`
 * corta os fetches e o laço. Quem é dono do pool é quem chama — aqui só
 * montamos/desmontamos e devolvemos as instâncias no finally.
 *
 * O miolo puro (plano, merge, frases, hash) mora em `transcript.ts`.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { FriendlyError } from '@/lib/friendly-error';
import { withRetry } from '@/lib/retry';
import { sleepUnthrottled } from '@/lib/unthrottled-clock';
import {
  CANCELLED_ERROR,
  extractAsrChunk,
  isCancellationError,
  mountInputs, probeDurationMounted,
  pickTranscribeBitrateKbps,
} from '@/lib/ffmpeg-worker';
import { LIMITS } from './types';
import type { AudioChunkPlan, ChunkWords, Transcript, Word } from './types';
import { buildSentences, mergeChunkWords, planAudioChunks, transcriptHash } from './transcript';

const ASR_ENDPOINT = '/api/auto-cortes/transcribe';
/** Teto de bitrate do pedaço: 9 min × 48 kbps ≈ 3,2 MB (cabe no limite da rota). */
const ASR_KBPS = 48;
/** Segunda tentativa quando o pedaço passar de `LIMITS.audioChunkMaxBytes`. */
const ASR_KBPS_FALLBACK = 32;
/** Nunca dormir mais que isso por causa de um `retry-after` exagerado. */
const RETRY_AFTER_MAX_MS = 90_000;

export type TranscribeStage = 'audio' | 'asr';

export type TranscribeProgress = { stage: TranscribeStage; done: number; total: number };

/** Só o que usamos do `FFmpegPool` (lib/ffmpeg-pool.ts) — facilita testar. */
export type TranscribePool = {
  acquire(): Promise<FFmpeg>;
  release(ff: FFmpeg): void;
  readonly maxSize: number;
};

export type TranscribeSourceOptions = {
  /** duração do vídeo em segundos (já lida na ingestão). */
  durationSec: number;
  /** ISO-639-1 ('pt', 'en'…) ou 'auto'. */
  language: string;
  pool: TranscribePool;
  onProgress?: (p: TranscribeProgress) => void;
  /** Pedaço que falhou/veio mudo — o projeto guarda como aviso. */
  onWarning?: (message: string) => void;
  /** Duração lida do ffmpeg quando o chamador não sabia (durationSec <= 0). */
  onDuration?: (durationSec: number) => void;
  signal?: AbortSignal;
  /** Rota alternativa (só pra teste). */
  endpoint?: string;
};

// ───────────────────────────────────────────────────────────────────────────

function cancelledError(): Error {
  const e = new Error(CANCELLED_ERROR);
  e.name = 'AbortError';
  return e;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}

function extOf(file: File): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(file.name || '');
  return m ? m[1].toLowerCase() : 'mp4';
}

function fmtGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',');
}

/** `retry-after` em segundos ou data HTTP → ms (0 quando não dá pra ler). */
function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, RETRY_AFTER_MAX_MS);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), RETRY_AFTER_MAX_MS);
  return 0;
}

function guardSource(file: File): void {
  if (!file || file.size === 0) {
    throw new FriendlyError('Não recebi nenhum arquivo pra transcrever. Escolha o vídeo e tente de novo.');
  }
  if (file.size > LIMITS.maxInputBytes) {
    throw new FriendlyError(
      `Esse arquivo tem ${fmtGb(file.size)} GB e o limite do Auto Cortes é ${fmtGb(LIMITS.maxInputBytes)} GB. ` +
        'Comprime ele no Compressor (ou corta em partes) e tenta de novo.',
    );
  }
}

function guardDuration(durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new FriendlyError(
      'Não consegui ler a duração desse vídeo. Tenta outro formato (MP4, MOV ou WEBM).',
    );
  }
  if (durationSec > LIMITS.maxDurationSec) {
    const h = (durationSec / 3600).toFixed(1).replace('.', ',');
    const max = LIMITS.maxDurationSec / 3600;
    throw new FriendlyError(
      `Esse vídeo tem ${h} h e o limite do Auto Cortes é ${max} h. Corta ele em partes e roda uma de cada vez.`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Áudio de um pedaço
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extrai o áudio de UM pedaço com bitrate que cabe no limite da rota. Se ainda
 * assim estourar (áudio muito denso), refaz a 32 kbps — o Whisper aguenta bem.
 */
async function extractChunkAudio(
  ff: FFmpeg,
  mountedPath: string,
  chunk: AudioChunkPlan,
): Promise<Blob> {
  const kbps = Math.min(ASR_KBPS, pickTranscribeBitrateKbps(chunk.durSec));
  let audio = await extractAsrChunk(ff, mountedPath, chunk.startSec, chunk.durSec, kbps);
  if (audio.size > LIMITS.audioChunkMaxBytes) {
    audio = await extractAsrChunk(ff, mountedPath, chunk.startSec, chunk.durSec, ASR_KBPS_FALLBACK);
  }
  if (audio.size > LIMITS.audioChunkMaxBytes) {
    throw new FriendlyError(
      'Um pedaço do áudio ficou grande demais pra enviar mesmo na qualidade mínima. ' +
        'Comprime o vídeo no Compressor e tenta de novo.',
    );
  }
  return audio;
}

// ───────────────────────────────────────────────────────────────────────────
// Upload de um pedaço
// ───────────────────────────────────────────────────────────────────────────

type ChunkAsr = { words: Word[]; provider: string; language?: string };

async function uploadChunk(
  audio: Blob,
  idx: number,
  language: string,
  opts: TranscribeSourceOptions,
): Promise<ChunkAsr> {
  const endpoint = opts.endpoint ?? ASR_ENDPOINT;
  // Erro que NÃO adianta repetir (chave/plano/tamanho) — guardado aqui pra
  // curto-circuitar as tentativas restantes do withRetry sem mentir no texto.
  let fatal: Error | null = null;

  return withRetry(
    async () => {
      if (fatal) throw fatal;
      throwIfAborted(opts.signal);

      const name = `chunk_${String(idx + 1).padStart(3, '0')}.opus`;
      const fd = new FormData();
      fd.append('audio', new File([audio], name, { type: 'audio/ogg' }), name);
      fd.append('language', language);

      let res: Response;
      try {
        res = await fetch(endpoint, { method: 'POST', body: fd, signal: opts.signal });
      } catch (e) {
        if (opts.signal?.aborted) {
          fatal = cancelledError();
          throw fatal;
        }
        throw e; // blip de rede — vale repetir
      }

      if (res.status === 429) {
        const waitMs = parseRetryAfter(res.headers.get('retry-after'));
        // Espera em relógio de Worker: aba em 2º plano não estrangula.
        if (waitMs > 0) await sleepUnthrottled(waitMs);
        throwIfAborted(opts.signal);
        throw new Error(`O serviço de transcrição está lotado (pedaço ${idx + 1}).`);
      }

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => '');
        fatal = new FriendlyError(
          pickServerMessage(body) ??
            'Sua conta não tem acesso ao Auto Cortes agora. Confira o plano em /planos e tente de novo.',
        );
        throw fatal;
      }

      if (res.status === 413) {
        fatal = new FriendlyError(
          'Um pedaço do áudio foi recusado por tamanho pelo servidor. ' +
            'Comprime o vídeo no Compressor e tenta de novo.',
        );
        throw fatal;
      }

      const text = await res.text();
      let json: { words?: Word[]; provider?: string; language?: string; error?: string };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        if (/Request Entity Too Large/i.test(text)) {
          fatal = new FriendlyError(
            'Um pedaço do áudio foi recusado por tamanho pelo servidor. ' +
              'Comprime o vídeo no Compressor e tenta de novo.',
          );
          throw fatal;
        }
        throw new Error(`O servidor respondeu fora do esperado (${res.status}) no pedaço ${idx + 1}.`);
      }

      if (!res.ok || !Array.isArray(json.words)) {
        throw new Error(
          json.error || `Não consegui transcrever o pedaço ${idx + 1} (${res.status}).`,
        );
      }

      return {
        words: json.words,
        provider: json.provider ?? '',
        ...(typeof json.language === 'string' && json.language ? { language: json.language } : {}),
      };
    },
    { tries: 3, baseMs: 800 },
  );
}

function pickServerMessage(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: string };
    const msg = (j?.error ?? '').trim();
    return msg ? msg : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Orquestração
// ───────────────────────────────────────────────────────────────────────────

/**
 * Transcreve o vídeo inteiro e devolve o `Transcript` pronto (palavras +
 * frases + hash). Não persiste nada: quem salva no IDB é o pipeline.
 */
export async function transcribeSource(
  file: File,
  opts: TranscribeSourceOptions,
): Promise<Transcript> {
  const { language, pool } = opts;
  let durationSec = opts.durationSec;
  guardSource(file);
  throwIfAborted(opts.signal);

  // A duração pode chegar desconhecida (o `<video>` não entrega metadata em aba
  // de 2º plano). Nesse caso ela é lida do log do ffmpeg logo após a 1ª montagem,
  // e só então o plano de pedaços é feito.
  let plan: ReturnType<typeof planAudioChunks> = [];
  let total = 0;
  let results: Array<ChunkWords | null> = [];
  let audioDone = 0;
  let asrDone = 0;
  const report = (stage: TranscribeStage) =>
    opts.onProgress?.({ stage, done: stage === 'audio' ? audioDone : asrDone, total });
  report('audio');

  const inputName = `ac_src.${extOf(file)}`;
  const slots: Array<{ ff: FFmpeg; path: string; cleanup: () => Promise<void> }> = [];
  const wanted = Math.max(1, Math.min(LIMITS.asrConcurrency, pool.maxSize));
  let providerSeen = '';
  // idioma detectado pelo Whisper (vem do servidor quando o cliente escolheu 'auto');
  // conta por voto: o mais frequente entre os pedaços vence
  const langVotes = new Map<string, number>();
  let failure: unknown = null;

  try {
    for (let i = 0; i < wanted; i++) {
      throwIfAborted(opts.signal);
      const ff = await pool.acquire();
      try {
        const m = await mountInputs(ff, [{ name: inputName, data: file }]);
        slots.push({
          ff,
          path: `${m.dir}/${inputName}`,
          cleanup: async () => {
            await m.cleanup();
            pool.release(ff);
          },
        });
      } catch (e) {
        pool.release(ff);
        if (isCancellationError(e)) throw e;
        // Sem instância extra não é erro: segue com menos paralelismo. Só a
        // PRIMEIRA é obrigatória (sem ela não dá pra extrair nada).
        if (slots.length === 0) throw e;
        break;
      }
    }
    if (slots.length > 0 && !(Number.isFinite(durationSec) && durationSec > 0)) {
      durationSec = await probeDurationMounted(slots[0].ff, slots[0].path);
      if (durationSec > 0) opts.onDuration?.(durationSec);
    }
    guardDuration(durationSec);
    plan = planAudioChunks(durationSec, {
      chunkSec: LIMITS.audioChunkSec,
      overlapSec: LIMITS.audioChunkOverlapSec,
    });
    if (plan.length === 0) {
      throw new FriendlyError('Não consegui dividir esse vídeo pra transcrever. Tenta outro arquivo.');
    }
    total = plan.length;
    results = new Array<ChunkWords | null>(total).fill(null);
    report('audio');

    if (slots.length === 0) {
      throw new FriendlyError(
        'Não consegui abrir esse vídeo pra tirar o áudio. Tenta outro formato (MP4, MOV ou WEBM).',
      );
    }

    let next = 0;
    const runOn = async (slot: { ff: FFmpeg; path: string }) => {
      while (failure === null) {
        const i = next++;
        if (i >= total) break;
        try {
          throwIfAborted(opts.signal);
          const chunk = plan[i];
          const audio = await extractChunkAudio(slot.ff, slot.path, chunk);
          audioDone++;
          report('audio');

          const { words, provider, language: detected } = await uploadChunk(audio, i, language, opts);
          if (provider && !providerSeen) providerSeen = provider;
          if (detected) langVotes.set(detected, (langVotes.get(detected) ?? 0) + 1);
          results[i] = { idx: chunk.idx, startSec: chunk.startSec, durSec: chunk.durSec, words };
        } catch (e) {
          if (isCancellationError(e) || opts.signal?.aborted || e instanceof FriendlyError) {
            failure = e;
            throw e;
          }
          // Pedaço que não voltou não derruba o lote: entra vazio e vira aviso.
          console.error(`[auto-cortes] pedaço ${i + 1}/${total} falhou:`, e);
          results[i] = {
            idx: plan[i].idx,
            startSec: plan[i].startSec,
            durSec: plan[i].durSec,
            words: [],
          };
          const de = Math.round(plan[i].startSec / 60);
          const ate = Math.round((plan[i].startSec + plan[i].durSec) / 60);
          opts.onWarning?.(
            `Não consegui transcrever o trecho de ${de} min a ${ate} min — os cortes desse pedaço podem faltar.`,
          );
        }
        asrDone++;
        report('asr');
      }
    };

    const settled = await Promise.allSettled(slots.map((s) => runOn(s)));
    const rejected = settled.find((s) => s.status === 'rejected');
    if (rejected) throw (rejected as PromiseRejectedResult).reason;
  } finally {
    for (const s of slots) {
      try {
        await s.cleanup();
      } catch {
        /* desmontar não pode derrubar o resultado */
      }
    }
  }

  const gathered = results.filter((c): c is ChunkWords => !!c);
  const words = mergeChunkWords(gathered, LIMITS.audioChunkOverlapSec);
  if (words.length === 0) {
    throw new FriendlyError(
      'Não achei fala nenhuma nesse vídeo. Confere se ele tem áudio e se o idioma escolhido bate com o que é falado.',
    );
  }

  let finalLanguage = language;
  if (language === 'auto' && langVotes.size > 0) {
    finalLanguage = [...langVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return {
    words,
    sentences: buildSentences(words, finalLanguage),
    language: finalLanguage,
    provider: providerSeen || 'desconhecido',
    hash: transcriptHash(words, finalLanguage),
  };
}
