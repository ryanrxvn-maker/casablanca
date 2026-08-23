/**
 * AUTO CORTES — orquestração da análise NO NAVEGADOR.
 *
 * A rota /api/auto-cortes/analyze faz UMA chamada ao Claude por requisição
 * (teto de 300 s da Vercel). Quem encadeia map → dedup → reduce, controla a
 * concorrência, re-tenta janela que falhou e emite progresso é este arquivo.
 *
 * Blindagem ([[feedback_blindagem_fluxos]]):
 *  - janela que falha 3× vira WARNING e o lote segue (uma abertura de podcast
 *    sem corte bom não pode derrubar a análise inteira);
 *  - espera de `retry-after` usa `sleepUnthrottled` (aba em 2º plano);
 *  - tudo cancelável por `AbortSignal`;
 *  - erro sempre `FriendlyError` em PT-BR.
 */

import { FriendlyError, toFriendlyMessage } from '@/lib/friendly-error';
import { withRetry } from '@/lib/retry';
import { sleepUnthrottled } from '@/lib/unthrottled-clock';
import {
  dedupCandidates,
  finalizeClips,
  planWindows,
  type FinalClip,
} from './analyze';
import {
  LIMITS,
  autoClipCount,
  type AnalyzeErrorResponse,
  type AnalyzeInfo,
  type AnalyzeMapRequest,
  type AnalyzeMapResponse,
  type AnalyzeProgress,
  type AnalyzeReduceRequest,
  type AnalyzeReduceResponse,
  type AnalyzeSettings,
  type ClipSettings,
  type ResolvedCandidate,
  type Sec,
  type Transcript,
} from './types';

const ENDPOINT = '/api/auto-cortes/analyze';
const MAP_TRIES = 3;
const REDUCE_TRIES = 2;
/** Teto de espera antes de re-tentar (o retry-after do servidor manda, mas com limite). */
const MAX_WAIT_SEC = 45;

export type AnalyzeInput = {
  transcript: Transcript;
  settings: ClipSettings;
  source: { name: string; durationSec: Sec };
};

export type AnalyzeOptions = {
  onProgress?: (p: AnalyzeProgress) => void;
  signal?: AbortSignal;
};

export type AnalyzeOutcome = {
  candidates: ResolvedCandidate[];
  clips: FinalClip[];
  warnings: string[];
};

/**
 * Erro de UMA chamada à rota. Estende `FriendlyError` porque a mensagem já vem
 * pronta em PT-BR do servidor — e carrega o status pra decidir se vale
 * re-tentar, se é problema de conta e quanto esperar.
 */
export class AnalyzeCallError extends FriendlyError {
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly showConfig?: boolean;
  /** true = não adianta re-tentar (chave, plano, corpo inválido, recusa). */
  readonly fatal: boolean;

  constructor(message: string, opts: { status: number; retryAfterSec?: number; showConfig?: boolean }) {
    super(message);
    this.name = 'AnalyzeCallError';
    this.status = opts.status;
    if (typeof opts.retryAfterSec === 'number') this.retryAfterSec = opts.retryAfterSec;
    if (opts.showConfig) this.showConfig = true;
    this.fatal =
      opts.status === 400 ||
      opts.status === 401 ||
      opts.status === 403 ||
      opts.status === 422 ||
      opts.status === 503;
  }
}

function aborted(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

function throwIfAborted(signal?: AbortSignal) {
  if (aborted(signal)) throw new FriendlyError('Cancelado por você.');
}

function analyzeSettings(s: ClipSettings): AnalyzeSettings {
  return {
    length: s.length,
    count: s.count,
    genre: s.genre,
    language: s.language,
    focusPrompt: s.focusPrompt ?? '',
  };
}

async function postAnalyze<T>(
  body: AnalyzeMapRequest | AnalyzeReduceRequest,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (aborted(signal)) throw new FriendlyError('Cancelado por você.');
    throw new AnalyzeCallError(toFriendlyMessage(e, 'A internet falhou ao falar com a IA de texto.'), {
      status: 0,
    });
  }

  if (!res.ok) {
    let payload: AnalyzeErrorResponse | null = null;
    try {
      payload = (await res.json()) as AnalyzeErrorResponse;
    } catch {
      /* corpo não-JSON */
    }
    const headerRetry = Number(res.headers.get('retry-after'));
    const retryAfterSec =
      payload?.retryAfterSec ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : undefined);
    throw new AnalyzeCallError(
      payload?.error || 'A análise falhou. Tente de novo em instantes.',
      { status: res.status, retryAfterSec, showConfig: payload?.showConfig },
    );
  }

  return (await res.json()) as T;
}

/**
 * `withRetry` com a espera longa (retry-after) feita por Worker clock, pra não
 * ser estrangulada em aba de segundo plano. O backoff próprio do withRetry fica
 * mínimo (baseMs 1) justamente porque quem espera de verdade é o `fn`.
 */
async function callWithRetry<T>(
  run: () => Promise<T>,
  tries: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  let attempt = 0;
  /** Erro que não deve ser re-tentado: as tentativas restantes saem sem rede. */
  let stop: Error | null = null;

  return withRetry(
    async () => {
      if (stop) throw stop;
      if (aborted(signal)) {
        stop = new FriendlyError('Cancelado por você.');
        throw stop;
      }
      attempt++;
      if (attempt > 1) {
        await sleepUnthrottled(Math.min(8, 2 ** (attempt - 1)) * 1000);
        if (aborted(signal)) {
          stop = new FriendlyError('Cancelado por você.');
          throw stop;
        }
      }
      try {
        return await run();
      } catch (e) {
        if (e instanceof AnalyzeCallError) {
          if (e.fatal) stop = e; // chave/plano/corpo: re-tentar não muda nada
          else if (e.retryAfterSec && attempt < tries) {
            await sleepUnthrottled(Math.min(MAX_WAIT_SEC, e.retryAfterSec) * 1000);
          }
        } else if (e instanceof FriendlyError) {
          stop = e; // cancelamento
        }
        throw e;
      }
    },
    { tries, baseMs: 1 },
  );
}

/**
 * Transcrição → candidatos (map por janela) → seleção final (reduce) → cortes
 * com bordas refinadas. Não renderiza nada: só decide O QUE cortar.
 */
export async function analyzeTranscript(
  input: AnalyzeInput,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeOutcome> {
  const { transcript, settings, source } = input;
  const { onProgress, signal } = opts;
  throwIfAborted(signal);

  const warningsInit: string[] = [];
  const sentences = transcript?.sentences ?? [];
  if (sentences.length === 0) {
    throw new FriendlyError('A transcrição ficou vazia — não dá pra encontrar cortes. Confira o áudio do vídeo.');
  }

  // Quem decide o tamanho da janela é o provedor (Groq free tier cabe menos
  // tokens por minuto que o Claude). Sem resposta → defaults do LIMITS.
  const info = await fetchAnalyzeInfo(signal);
  if (info?.free) warningsInit.push(`IA gratuita (${info.model}) — até ${info.maxClips} cortes por análise.`);
  const windows = planWindows(sentences, {
    windowSec: info?.windowSec ?? LIMITS.analyzeWindowSec,
    overlapSec: info?.windowOverlapSec ?? LIMITS.analyzeWindowOverlapSec,
  });
  const total = windows.length;
  const warnings: string[] = [...warningsInit];
  const perWindow: ResolvedCandidate[][] = new Array(total).fill(null).map(() => []);
  const settingsForApi = analyzeSettings(settings);

  let done = 0;
  let candidatesSoFar = 0;
  const emitMap = () => onProgress?.({ stage: 'map', done, total, candidatesSoFar });
  emitMap();

  // Pool simples: N workers puxando da mesma fila de índices.
  let next = 0;
  /** Erro de conta: derruba TODAS as pistas (senão as outras gastariam chamadas à toa). */
  let abortAll: Error | null = null;
  const runOne = async () => {
    for (;;) {
      if (abortAll) throw abortAll;
      throwIfAborted(signal);
      const i = next++;
      if (i >= total) return;
      const w = windows[i];
      try {
        const res = await callWithRetry<AnalyzeMapResponse>(
          () =>
            postAnalyze<AnalyzeMapResponse>(
              {
                op: 'map',
                windowIdx: w.idx,
                windowTotal: total,
                sentences: w.sentences,
                settings: settingsForApi,
                source,
              },
              signal,
            ),
          MAP_TRIES,
          signal,
        );
        perWindow[i] = res.candidates ?? [];
        candidatesSoFar += perWindow[i].length;
      } catch (e) {
        if (aborted(signal)) throw new FriendlyError('Cancelado por você.');
        // Problema de CONTA (chave, plano, manutenção): não adianta seguir com
        // as outras janelas — o lote inteiro pararia igual, só mais tarde.
        if (
          e instanceof AnalyzeCallError &&
          (e.showConfig || e.status === 401 || e.status === 403 || e.status === 503)
        ) {
          abortAll = e;
          throw e;
        }
        const msg = `Trecho ${i + 1} de ${total} não pôde ser analisado (${toFriendlyMessage(e, 'falha na IA de texto')}). Segui sem ele.`;
        warnings.push(msg);
        onProgress?.({ stage: 'warning', message: msg });
      } finally {
        done++;
        emitMap();
      }
    }
  };

  const lanes = Math.max(1, Math.min(info?.mapConcurrency ?? LIMITS.analyzeMapConcurrency, total));
  await Promise.all(Array.from({ length: lanes }, () => runOne()));
  throwIfAborted(signal);

  if (warnings.length === total) {
    throw new FriendlyError(
      'Nenhum trecho do vídeo pôde ser analisado pela IA de texto. Confira sua chave em /configuracoes/api e clique em Retomar.',
    );
  }

  const candidates = dedupCandidates(perWindow.flat());
  if (candidates.length === 0) {
    throw new FriendlyError(
      'A IA não encontrou nenhum trecho que funcione sozinho neste vídeo. Tente uma duração de corte diferente ou descreva os momentos que você quer.',
    );
  }

  const count =
    settings.count === 'auto' ? autoClipCount(source.durationSec || 0) : Number(settings.count);
  const maxClips = Math.min(LIMITS.maxClips, info?.maxClips ?? LIMITS.maxClips);
  const finalCount = Math.max(1, Math.min(maxClips, Math.min(count, candidates.length)));

  onProgress?.({ stage: 'reduce' });
  const reduce = await callWithRetry<AnalyzeReduceResponse>(
    () =>
      postAnalyze<AnalyzeReduceResponse>(
        {
          op: 'reduce',
          candidates,
          settings: settingsForApi,
          source,
          count: finalCount,
        },
        signal,
      ),
    REDUCE_TRIES,
    signal,
  );
  throwIfAborted(signal);

  const clips = finalizeClips(
    { clips: reduce.clips ?? [] },
    candidates,
    sentences,
    transcript.words ?? [],
    { length: settings.length, count: finalCount },
  );

  if (clips.length === 0) {
    throw new FriendlyError(
      'A IA não conseguiu fechar a seleção de cortes. Clique em "Refazer análise" — a transcrição já está salva.',
    );
  }

  return { candidates, clips, warnings };
}

/** Pergunta à rota qual IA vai rodar (e seus limites). Falha = null (usa defaults). */
export async function fetchAnalyzeInfo(signal?: AbortSignal): Promise<AnalyzeInfo | null> {
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', signal, cache: 'no-store' });
    if (!res.ok) {
      // chave/plano faltando: deixa o POST do map produzir o erro amigável completo
      return null;
    }
    const j = (await res.json()) as Partial<AnalyzeInfo>;
    if (!j || (j.provider !== 'groq' && j.provider !== 'anthropic')) return null;
    return {
      provider: j.provider,
      model: String(j.model ?? ''),
      free: Boolean(j.free),
      windowSec: Number(j.windowSec) > 0 ? Number(j.windowSec) : LIMITS.analyzeWindowSec,
      windowOverlapSec:
        Number(j.windowOverlapSec) >= 0 ? Number(j.windowOverlapSec) : LIMITS.analyzeWindowOverlapSec,
      mapConcurrency: Number(j.mapConcurrency) > 0 ? Number(j.mapConcurrency) : LIMITS.analyzeMapConcurrency,
      maxClips: Number(j.maxClips) > 0 ? Number(j.maxClips) : LIMITS.maxClips,
      reduceMaxCandidates: Number(j.reduceMaxCandidates) > 0 ? Number(j.reduceMaxCandidates) : 400,
    };
  } catch {
    return null;
  }
}
