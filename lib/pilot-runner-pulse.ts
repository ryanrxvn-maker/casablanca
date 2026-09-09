'use client';

export const PILOT_RUNNER_PULSE_KEY = 'darkolab:clickup-pilot:runner-pulse:v1';
export const PILOT_RUNNER_PULSE_INTERVAL_MS = 5_000;
export const PILOT_RUNNER_PULSE_STALE_MS = 20_000;

export type PilotRunnerPulseTask = {
  taskId: string;
  phase: string;
  message?: string;
  startedAt: number;
  economia?: boolean;
  progressoMotor?: number;
  economiaMetricas?: {
    totalMs: number;
    ttsMs: number;
    esperaTtsMs: number;
    renderMs: number;
  };
  /** Snapshot minimo dos takes. Permite que outra aba do Pilot mostre o MP4
   *  que acabou de ficar pronto sem assumir a execucao nem esperar o cloud. */
  parts?: Array<{
    label: string;
    videoId: string | null;
    videoStatus?: string;
    videoUrl?: string | null;
    error?: string | null;
  }>;
};

export type PilotRunnerPulse = {
  ownerTabId: string;
  heartbeatAt: number;
  tasks: Record<string, PilotRunnerPulseTask>;
};

export function readPilotRunnerPulse(): PilotRunnerPulse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PILOT_RUNNER_PULSE_KEY);
    if (!raw) return null;
    const pulse = JSON.parse(raw) as PilotRunnerPulse;
    if (!pulse || typeof pulse.ownerTabId !== 'string' || typeof pulse.heartbeatAt !== 'number' || !pulse.tasks) return null;
    return pulse;
  } catch {
    return null;
  }
}

export function writePilotRunnerPulse(pulse: PilotRunnerPulse): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(PILOT_RUNNER_PULSE_KEY, JSON.stringify(pulse)); } catch {}
}

export function clearPilotRunnerPulse(ownerTabId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = readPilotRunnerPulse();
    if (current?.ownerTabId === ownerTabId) localStorage.removeItem(PILOT_RUNNER_PULSE_KEY);
  } catch {}
}

export function isPilotRunnerPulseAlive(pulse: PilotRunnerPulse | null, now = Date.now()): pulse is PilotRunnerPulse {
  return !!pulse && now - pulse.heartbeatAt >= 0 && now - pulse.heartbeatAt < PILOT_RUNNER_PULSE_STALE_MS;
}

type DisplayableBatch = {
  phase: string;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  economia?: boolean;
  progressoMotor?: number;
  economiaMetricas?: {
    totalMs: number;
    ttsMs: number;
    esperaTtsMs: number;
    renderMs: number;
  };
  parts?: Array<{
    label: string;
    videoId: string | null;
    videoStatus?: string;
    videoUrl?: string | null;
    error?: string | null;
  }>;
};

/**
 * Troca apenas a REPRESENTAÇÃO de cards recuperados pelo estado anunciado pela
 * aba dona. O state React, o promoter e o persist continuam intocados: uma aba
 * observadora nunca assume nem re-dispara trabalho de outra aba.
 */
export function overlayPilotRunnerPulse<T extends DisplayableBatch>(
  states: Record<string, T>,
  pulse: PilotRunnerPulse | null,
  currentTabId: string,
  now = Date.now(),
): Record<string, T> {
  if (!isPilotRunnerPulseAlive(pulse, now) || pulse.ownerTabId === currentTabId) return states;
  let changed = false;
  const out = { ...states };
  for (const [taskId, live] of Object.entries(pulse.tasks)) {
    const saved = states[taskId];
    if (!saved) continue;
    changed = true;
    out[taskId] = {
      ...saved,
      phase: live.phase,
      message: `Rodando em outra aba · ${live.message || 'Processamento ativo'}`,
      startedAt: live.startedAt || saved.startedAt,
      finishedAt: undefined,
      economia: live.economia ?? saved.economia,
      progressoMotor: live.progressoMotor ?? saved.progressoMotor,
      economiaMetricas: live.economiaMetricas ?? saved.economiaMetricas,
      parts: live.parts?.length
        ? saved.parts?.map((part) => {
            const fresh = live.parts?.find((candidate) => candidate.label === part.label);
            return fresh ? { ...part, ...fresh } : part;
          })
        : saved.parts,
    };
  }
  return changed ? out : states;
}
