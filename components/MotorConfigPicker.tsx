'use client';

import { useState } from 'react';
import { MOTORS, CREDIT_COST_PER_MIN, DEFAULT_TAKE_SECONDS, estimateCost, sanitizePercent, type Motor, type MotorConfig } from '@/lib/motor-config';
import { useHeyGenCredits } from '@/lib/use-heygen-credits';

/**
 * Componente UI compartilhado pra escolher motor (III/IV/V) de uma task.
 *
 * 3 modos:
 *   - global: 1 motor pra todos os takes
 *   - percent: % de III + IV + V (distribui aleatoriamente, sem cortar take)
 *   - individual: cada slot/take tem seu motor (UI separada por slot)
 *
 * Mostra previa de creditos consumidos baseado no takeCount.
 */
export function MotorConfigPicker({
  config,
  setConfig,
  takeCount,
  slotIds,
  takeSeconds,
}: {
  config: MotorConfig;
  setConfig: (c: MotorConfig) => void;
  takeCount: number;
  /** IDs dos slots quando modo individual. */
  slotIds?: string[];
  /** Duracoes individuais por take em segundos (calculadas da copy/audio).
   *  Se omitido, assume DEFAULT_TAKE_SECONDS pra cada take.
   *  Caller eh responsavel por estimar via estimateSecondsFromText. */
  takeSeconds?: number[];
}) {
  const [collapsed, setCollapsed] = useState(true); // minimizado por padrao
  // Duracao: usa array per-take quando disponivel (calculado da copy/audio),
  // senao DEFAULT_TAKE_SECONDS uniforme
  // Previa de creditos / saldo HeyGen REMOVIDOS a pedido — picker so
  // escolhe o motor. Sem fetch de saldo, sem calculo de custo.

  return (
    <div className="rounded-[12px] border border-cyan-500/30 bg-cyan-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="mono text-[10px] uppercase tracking-widest text-cyan-300">{'// MOTOR'}</span>
          <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
            {config.kind === 'global' && `global · ${config.motor}`}
            {config.kind === 'percent' && `% ${config.percent.III}/${config.percent.IV}/${config.percent.V}`}
            {config.kind === 'individual' && 'individual'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mono rounded border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-cyan-500/60 hover:text-cyan-300"
          >
            {collapsed ? '▶ Escolher motor' : '▼ Esconder'}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div className="mt-3 space-y-3">
          {/* Mode selector */}
          <div className="flex gap-1.5">
            {(['global', 'percent', 'individual'] as const).map((kind) => {
              const active = config.kind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    if (kind === 'global') setConfig({ kind: 'global', motor: 'III' });
                    else if (kind === 'percent') setConfig({ kind: 'percent', percent: { III: 100, IV: 0, V: 0 } });
                    else setConfig({ kind: 'individual', perSlot: {} });
                  }}
                  className={
                    'mono flex-1 rounded border px-2 py-1.5 text-[10px] uppercase tracking-widest transition ' +
                    (active
                      ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-100'
                      : 'border-line-strong bg-bg/40 text-text-muted hover:border-cyan-500/40')
                  }
                >
                  {kind === 'global' ? 'Global' : kind === 'percent' ? '% Mix' : 'Por avatar'}
                </button>
              );
            })}
          </div>

          {/* Mode-specific UI */}
          {config.kind === 'global' ? (
            <div>
              <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                Motor pra TODOS os takes:
              </div>
              <div className="flex gap-1.5">
                {MOTORS.map((m) => {
                  const active = config.motor === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setConfig({ kind: 'global', motor: m })}
                      className={
                        'mono flex-1 rounded border px-3 py-2 text-[11px] uppercase tracking-widest transition ' +
                        (active
                          ? m === 'III'
                            ? 'border-lime/60 bg-lime/20 text-lime'
                            : m === 'IV'
                            ? 'border-yellow-500/60 bg-yellow-500/20 text-yellow-200'
                            : 'border-fuchsia-500/60 bg-fuchsia-500/20 text-fuchsia-200'
                          : 'border-line-strong bg-bg/40 text-text-muted hover:border-cyan-500/40')
                      }
                      title={CREDIT_COST_PER_MIN[m] === 0 ? 'Gratuito (unlimited_regular)' : `Avatar ${m}: ${CREDIT_COST_PER_MIN[m]} créditos por minuto`}
                    >
                      Avatar {m}
                      <div className="mono text-[8px] opacity-70 mt-0.5">
                        {CREDIT_COST_PER_MIN[m] === 0 ? 'free' : `${CREDIT_COST_PER_MIN[m]}c/min`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {config.kind === 'percent' ? (
            <div>
              <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                Distribuir por % (random por take · {takeCount} takes total):
              </div>
              <div className="space-y-2">
                {MOTORS.map((m) => {
                  const value = config.percent[m];
                  return (
                    <div key={m} className="flex items-center gap-2">
                      <span
                        className={
                          'mono w-20 shrink-0 rounded px-2 py-1 text-center text-[10px] uppercase tracking-widest ' +
                          (m === 'III'
                            ? 'bg-lime/10 text-lime'
                            : m === 'IV'
                            ? 'bg-yellow-500/10 text-yellow-200'
                            : 'bg-fuchsia-500/10 text-fuchsia-200')
                        }
                      >
                        {m} ({CREDIT_COST_PER_MIN[m]}c/min)
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(e) => {
                          const newVal = Number(e.target.value);
                          const others = (['III', 'IV', 'V'] as Motor[]).filter((x) => x !== m);
                          // Reduz proporcionalmente os outros pra somar 100
                          const otherTotal = others.reduce((s, x) => s + config.percent[x], 0);
                          const remaining = 100 - newVal;
                          const newPct: Record<Motor, number> = { III: 0, IV: 0, V: 0 };
                          newPct[m] = newVal;
                          if (otherTotal > 0) {
                            for (const x of others) {
                              newPct[x] = Math.round((config.percent[x] / otherTotal) * remaining);
                            }
                          } else {
                            newPct[others[0]] = remaining;
                          }
                          setConfig({ kind: 'percent', percent: sanitizePercent(newPct) });
                        }}
                        className="flex-1 accent-cyan-400"
                      />
                      <span className="mono w-12 text-right text-[11px] text-white font-bold">
                        {value}%
                      </span>
                      <span className="mono w-12 text-right text-[10px] text-text-muted">
                        = {Math.round((value / 100) * takeCount)} t
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Soma */}
              <div className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted text-right">
                Total: {config.percent.III + config.percent.IV + config.percent.V}%
              </div>
            </div>
          ) : null}

          {config.kind === 'individual' ? (
            <div>
              <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                Modo INDIVIDUAL — escolha o motor em cada slot abaixo (na propria task).
              </div>
              <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-2 py-1 text-[10px] text-yellow-200">
                ⚠ Defina o motor em cada avatar listado. Default = III (gratuito).
              </div>
            </div>
          ) : null}

        </div>
      ) : null}
    </div>
  );
}

/** Slot individual: dropdown compacto pra escolher motor de UM take. */
export function MotorSlotPicker({
  slotId,
  motor,
  setMotor,
}: {
  slotId: string;
  motor: Motor;
  setMotor: (m: Motor) => void;
}) {
  return (
    <div className="inline-flex rounded border border-line-strong overflow-hidden">
      {MOTORS.map((m) => {
        const active = motor === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMotor(m)}
            title={CREDIT_COST_PER_MIN[m] === 0 ? `Avatar ${m} · gratuito` : `Avatar ${m} · ${CREDIT_COST_PER_MIN[m]} créditos por minuto`}
            className={
              'mono px-2 py-1 text-[10px] uppercase tracking-widest transition ' +
              (active
                ? m === 'III'
                  ? 'bg-lime/20 text-lime'
                  : m === 'IV'
                  ? 'bg-yellow-500/20 text-yellow-200'
                  : 'bg-fuchsia-500/20 text-fuchsia-200'
                : 'bg-bg/30 text-text-muted hover:bg-bg/60')
            }
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}
