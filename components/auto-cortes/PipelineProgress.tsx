'use client';

/**
 * AUTO CORTES — o painel de PROGRESSO.
 *
 * Cinco etapas visíveis (Fonte → Áudio → Transcrição → Análise → Render), o
 * texto do que está rodando agora (`progress.label`, quem escreve é o
 * pipeline) e o tempo decorrido. O relógio é só da UI: nada aqui manda no
 * pipeline, então `Date.now()` não fere a regra de determinismo do render.
 */

import { useEffect, useState } from 'react';
import { CancelButton } from '@/components/CancelButton';
import type { ProjectPhase, ProjectWarning } from '@/lib/auto-cortes/types';
import { ErrorNote, ProgressBar, fmtClock } from './ui';

const STEPS: Array<{ key: string; label: string; phases: ProjectPhase[] }> = [
  { key: 'fonte', label: 'Fonte', phases: ['fonte', 'baixando'] },
  { key: 'audio', label: 'Áudio', phases: ['audio'] },
  { key: 'asr', label: 'Transcrição', phases: ['transcrevendo'] },
  { key: 'analise', label: 'Análise', phases: ['analisando'] },
  { key: 'render', label: 'Render', phases: ['renderizando'] },
];

/** Índice da etapa em curso; 'pronto' passa de todas. */
function stepIndex(phase: ProjectPhase): number {
  if (phase === 'pronto') return STEPS.length;
  const i = STEPS.findIndex((s) => s.phases.includes(phase));
  return i < 0 ? 0 : i;
}

const ACTIVE: ProjectPhase[] = ['baixando', 'audio', 'transcrevendo', 'analisando', 'renderizando'];

export function PipelineProgress({
  phase,
  progress,
  startedAt,
  endedAt,
  warnings,
  lastError,
  onCancel,
  onResume,
  /** etapa em que o erro aconteceu, pra pintar a bolinha certa */
  errorPhase,
}: {
  phase: ProjectPhase;
  progress: { ratio: number; label: string };
  /** epoch ms de quando o trabalho começou (só pro relógio) */
  startedAt: number | null;
  /** epoch ms de quando terminou — congela o relógio no total gasto */
  endedAt?: number | null;
  warnings: ProjectWarning[];
  lastError: string | null;
  onCancel: () => void;
  onResume?: () => void;
  errorPhase?: ProjectPhase | null;
}) {
  const running = ACTIVE.includes(phase);
  const [, tick] = useState(0);

  // relógio de 1 s só enquanto há trabalho; em aba oculta o browser
  // estrangula o intervalo, mas o valor é recalculado de Date.now() e
  // volta certo assim que a aba aparece
  useEffect(() => {
    if (!running || startedAt == null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const elapsed =
    startedAt != null ? Math.max(0, ((endedAt ?? Date.now()) - startedAt) / 1000) : 0;
  const cur = phase === 'erro' && errorPhase ? stepIndex(errorPhase) : stepIndex(phase);

  if (phase === 'fonte' && !progress.label) return null;

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-line/70 p-5 shadow-depth-1"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {phase === 'pronto'
              ? 'Cortes prontos'
              : phase === 'erro'
                ? 'Parou no meio'
                : 'Trabalhando'}
          </div>
          <div className="mt-1 truncate text-[15px] font-bold text-text" style={{ fontFamily: 'var(--font-tech)' }}>
            {progress.label || (phase === 'pronto' ? 'Tudo pronto' : 'Preparando…')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {startedAt != null ? (
            <span className="mono rounded-[9px] border border-line bg-bg/50 px-2.5 py-1 text-[11.5px] text-text-muted">
              {fmtClock(elapsed)}
            </span>
          ) : null}
          {running ? <CancelButton onClick={onCancel} /> : null}
          {phase === 'erro' && onResume ? (
            <button type="button" onClick={onResume} className="btn-primary !py-2 text-[13px]">
              Retomar
            </button>
          ) : null}
        </div>
      </div>

      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STEPS.map((s, i) => {
          const done = i < cur || phase === 'pronto';
          const active = i === cur && running;
          const failed = phase === 'erro' && i === cur;
          return (
            <li
              key={s.key}
              className={
                'flex items-center gap-2 rounded-[11px] border px-2.5 py-2 transition-colors ' +
                (failed
                  ? 'border-red-500/45 bg-red-500/10'
                  : done
                    ? 'border-lime/40 bg-lime/[0.07]'
                    : active
                      ? 'border-pink-400/55 bg-pink-400/[0.08]'
                      : 'border-line bg-bg/30')
              }
            >
              <span
                aria-hidden
                className={
                  'inline-block h-2 w-2 shrink-0 rounded-full ' +
                  (failed
                    ? 'bg-red-400'
                    : done
                      ? 'bg-lime'
                      : active
                        ? 'ac-pulse bg-pink-400'
                        : 'bg-text-dim')
                }
              />
              <span
                className={
                  'truncate text-[11.5px] font-bold ' +
                  (failed
                    ? 'text-red-300'
                    : done
                      ? 'text-lime'
                      : active
                        ? 'text-pink-200'
                        : 'text-text-dim')
                }
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <ProgressBar ratio={phase === 'pronto' ? 1 : progress.ratio} />

      {lastError ? <div className="mt-4"><ErrorNote>{lastError}</ErrorNote></div> : null}

      {warnings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {warnings.slice(-4).map((w, i) => (
            <li key={`${w.at}-${i}`} className="text-[11.5px] leading-relaxed text-yellow-300/90">
              ⚠ {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      <style jsx>{`
        .ac-pulse {
          animation: ac-pulse 1.4s ease-in-out infinite;
        }
        @keyframes ac-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.8); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ac-pulse { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
