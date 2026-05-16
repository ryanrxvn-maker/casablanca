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
  /** Modo dinamico: avatarId override por parte (cai pra opts.avatarId se ausente) */
  avatarId?: string;
  /** Modo dinamico: voiceId override por parte (cai pra opts.voiceId se ausente) */
  voiceId?: string;
  /** Override de motor por job — vence opts.motor. Permite mix de
   *  III/IV/V dentro do mesmo batch (config 'percent' ou 'individual'). */
  motor?: 'III' | 'IV' | 'V';
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
        // Per-job override (modo dinamico) > opts global > undefined (lookup auto)
        const effectiveAvatarId = job.avatarId || opts.avatarId;
        const effectiveVoiceId =
          opts.mode === 'copy' ? (job.voiceId || opts.voiceId) : undefined;
        const effectiveMotor = job.motor || opts.motor;
        const input: ProcessJobInput = {
          file: opts.mode === 'audio' ? job.audio : undefined,
          text: opts.mode === 'copy' ? job.copy : undefined,
          voiceId: effectiveVoiceId,
          title: `${opts.adNameSafe}_${label}`,
          avatarId: effectiveAvatarId,
          engine: motorToEngine(effectiveMotor),
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
