import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync('lib/pilot-runner-pulse.ts', 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = vm.createContext({ exports: {}, Date, JSON });
vm.runInContext(js, ctx);
const { overlayPilotRunnerPulse, overlayPilotBackgroundCheckpoint, isPilotRunnerPulseAlive } = ctx.exports;

const now = 100_000;
const saved = {
  ad1: { phase: 'failed', message: 'Registro recuperado', startedAt: 1, finishedAt: 9, economia: true },
  ad2: { phase: 'done', message: 'Pronto', startedAt: 2, finishedAt: 8 },
};
const live = {
  ownerTabId: 'tab-a', heartbeatAt: now - 1_000,
  tasks: { ad1: { taskId: 'ad1', phase: 'rendering', message: 'Cena 4/9', startedAt: 90_000, economia: true, progressoMotor: 44 } },
};

assert.equal(isPilotRunnerPulseAlive(live, now), true);
const display = overlayPilotRunnerPulse(saved, live, 'tab-b', now);
assert.equal(display.ad1.phase, 'rendering');
assert.equal(display.ad1.message, 'Rodando em outra aba · Cena 4/9');
assert.equal(display.ad1.startedAt, 90_000);
assert.equal(display.ad1.finishedAt, undefined);
assert.equal(display.ad1.progressoMotor, 44);
assert.equal(display.ad2.phase, 'done');
assert.equal(saved.ad1.phase, 'failed');

assert.equal(overlayPilotRunnerPulse(saved, live, 'tab-a', now), saved);
assert.equal(overlayPilotRunnerPulse(saved, { ...live, heartbeatAt: now - 25_000 }, 'tab-b', now), saved);

const checkpointed = overlayPilotBackgroundCheckpoint(saved, {
  ad1: { phase: 'dispatching', message: 'Studio: 3 cenas, sem crédito', startedAt: 91_000, economia: true, progressoMotor: 20 },
  ad2: { phase: 'done', message: 'Pronto', startedAt: 2 },
});
assert.equal(checkpointed.ad1.phase, 'dispatching');
assert.equal(checkpointed.ad1.message, 'Fila ativa · Studio: 3 cenas, sem crédito');
assert.equal(checkpointed.ad1.startedAt, 91_000);
assert.equal(checkpointed.ad1.finishedAt, undefined);
assert.equal(checkpointed.ad1.progressoMotor, 20);
assert.equal(checkpointed.ad2.phase, 'done');
assert.equal(saved.ad1.phase, 'failed');

console.log('pilot runner pulse: 19 checks passed');
