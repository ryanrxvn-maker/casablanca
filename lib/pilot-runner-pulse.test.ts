import assert from 'node:assert/strict';
import { overlayPilotRunnerPulse, type PilotRunnerPulse } from './pilot-runner-pulse';

const now = 10_000;
const saved: Record<string, {
  phase: string;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  economia?: boolean;
  progressoMotor?: number;
  economiaMetricas?: { totalMs: number; ttsMs: number; esperaTtsMs: number; renderMs: number };
  parts?: Array<{ label: string; videoId: string | null; videoStatus?: string; videoUrl?: string | null; error?: string | null }>;
}> = {
  task: {
    phase: 'recoverable',
    message: 'Execucao recuperada',
    startedAt: 1,
    finishedAt: 9,
    economia: true,
    parts: [
      { label: 'HOOK 1', videoId: null, videoStatus: 'processing' },
      { label: 'BODY 1', videoId: null, videoStatus: 'processing' },
    ],
  },
};

const pulse: PilotRunnerPulse = {
  ownerTabId: 'owner',
  heartbeatAt: now - 1_000,
  tasks: {
    task: {
      taskId: 'task',
      phase: 'rendering',
      message: 'BODY 1: renderizando',
      startedAt: 1,
      economia: true,
      progressoMotor: 61,
      economiaMetricas: { totalMs: 100_000, ttsMs: 8_000, esperaTtsMs: 2_000, renderMs: 90_000 },
      parts: [
        { label: 'HOOK 1', videoId: 'eco:g:0', videoStatus: 'completed', videoUrl: 'https://files.heygen.ai/hook.mp4' },
        { label: 'BODY 1', videoId: null, videoStatus: 'processing' },
      ],
    },
  },
};

const visible = overlayPilotRunnerPulse(saved, pulse, 'observer', now);
assert.equal(visible.task.phase, 'rendering');
assert.equal(visible.task.finishedAt, undefined);
assert.equal(visible.task.progressoMotor, 61);
assert.equal(visible.task.economiaMetricas?.renderMs, 90_000);
assert.equal(visible.task.parts?.[0].videoStatus, 'completed');
assert.equal(visible.task.parts?.[0].videoUrl, 'https://files.heygen.ai/hook.mp4');
assert.equal(visible.task.parts?.[1].videoStatus, 'processing');

const stale = overlayPilotRunnerPulse(saved, { ...pulse, heartbeatAt: now - 30_000 }, 'observer', now);
assert.equal(stale, saved, 'pulso vencido nao mascara o registro recuperavel');

const owner = overlayPilotRunnerPulse(saved, pulse, 'owner', now);
assert.equal(owner, saved, 'a aba dona nao sobrepoe o proprio estado');

console.log('pilot-runner-pulse: ok');
