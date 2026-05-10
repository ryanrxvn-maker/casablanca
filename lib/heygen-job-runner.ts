/**
 * Runner de jobs HeyGen com paralelismo. Extraido de page.tsx pra evitar
 * ambiguidade SWC (Array<...> em TSX confunde com JSX).
 */
import {
  processJob,
  type EngineKey,
  type ProcessJobInput,
} from './heygen-api-direct';

export type RunnerJob = {
  label: string;
  copy?: string;
  audio?: File;
};

export type RunnerResult = {
  index: number;
  label: string;
  videoId: string | null;
  error: string | null;
};

export type RunnerOptions = {
  parallel: number;
  mode: 'copy' | 'audio';
  avatarId: string;
  voiceId?: string;
  motor: 'III' | 'IV' | 'V';
  adNameSafe: string;
  isCancelled: () => boolean;
  onProgress: (msg: string) => void;
  onResult: (result: RunnerResult) => void;
};

function motorToEngine(m: 'III' | 'IV' | 'V'): EngineKey {
  if (m === 'III') return 'iii';
  if (m === 'IV') return 'iv';
  return 'v';
}

export async function runHeyGenJobs(
  jobs: RunnerJob[],
  opts: RunnerOptions,
): Promise<RunnerResult[]> {
  const results: RunnerResult[] = new Array(jobs.length);
  let cursor = 0;

  function pickNext(): number {
    if (opts.isCancelled()) return -1;
    return cursor < jobs.length ? cursor++ : -1;
  }

  async function worker(): Promise<void> {
    while (true) {
      const idx = pickNext();
      if (idx < 0) return;
      const job = jobs[idx];
      const label = job.label;
      try {
        opts.onProgress(`Disparando ${label} (${idx + 1}/${jobs.length})...`);
        // Modo copy sem voiceId = processJob faz lookup automatico do default
        // voice do avatar (voz original). Modo copy com voiceId = override.
        const input: ProcessJobInput = {
          file: opts.mode === 'audio' ? job.audio : undefined,
          text: opts.mode === 'copy' ? job.copy : undefined,
          voiceId: opts.mode === 'copy' ? opts.voiceId : undefined,
          title: `${opts.adNameSafe}_${label}`,
          avatarId: opts.avatarId,
          engine: motorToEngine(opts.motor),
          orientation: 'portrait',
        };
        const result = await processJob(input, {
          onProgress: (stage) => opts.onProgress(`${label}: ${stage}`),
        });
        results[idx] = {
          index: idx + 1,
          label,
          videoId: result.videoId,
          error: null,
        };
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        results[idx] = {
          index: idx + 1,
          label,
          videoId: null,
          error: msg,
        };
        console.error(`[HeyGen Runner] Job ${label} falhou:`, e);
      }
      opts.onResult(results[idx]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < opts.parallel; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
