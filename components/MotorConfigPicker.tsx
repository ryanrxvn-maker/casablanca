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

  // Label compacto pro botao 3D
  const motorLabel =
    config.kind === 'global' ? `Avatar ${config.motor}` :
    config.kind === 'percent' ? `Mix %` : 'Por avatar';
  const motorColor =
    config.kind === 'global'
      ? (config.motor === 'III' ? 'lime' : config.motor === 'IV' ? 'amber' : 'fuchsia')
      : 'cyan';
  const colorClasses: Record<string, string> = {
    lime: 'border-lime/55 bg-gradient-to-b from-lime/22 via-lime/10 to-transparent text-lime shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(190,242,100,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_10px_22px_-5px_rgba(190,242,100,0.6)]',
    amber: 'border-amber-400/60 bg-gradient-to-b from-amber-400/22 via-amber-400/10 to-transparent text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(251,191,36,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_-5px_rgba(251,191,36,0.6)]',
    fuchsia: 'border-fuchsia-400/55 bg-gradient-to-b from-fuchsia-400/22 via-fuchsia-400/10 to-transparent text-fuchsia-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(217,70,239,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_-5px_rgba(217,70,239,0.6)]',
    cyan: 'border-cyan-400/55 bg-gradient-to-b from-cyan-400/22 via-cyan-400/10 to-transparent text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_3px_10px_-3px_rgba(34,211,238,0.4)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_-5px_rgba(34,211,238,0.6)]',
  };

  return (
    <div className={collapsed ? '' : 'rounded-[12px] border border-cyan-500/30 bg-cyan-500/5 p-3'}>
      {collapsed ? (
        // ═══ MODO COLAPSADO — botao 3D icon-only com label do motor atual ═══
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className={`group/motor relative inline-flex h-9 items-center gap-2 rounded-full border px-3 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] active:translate-y-0 active:scale-[0.98] ${colorClasses[motorColor]}`}
          title="Escolher motor de avatar (III / IV / V)"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
          {/* Chip icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="relative">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 4v-2M15 4v-2M9 22v-2M15 22v-2M4 9h-2M4 15h-2M22 9h-2M22 15h-2" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
          <span className="label-tech relative text-[10px] font-bold uppercase tracking-[0.14em]">{motorLabel}</span>
        </button>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Fechar"
            aria-label="Fechar"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 transition-all hover:scale-110 hover:border-cyan-500/70 hover:bg-cyan-500/20"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      )}

      {!collapsed ? (
        <div className="mt-3 space-y-3.5">
          {/* MODE SELECTOR — segmented control pro estilo */}
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            {(['global', 'percent', 'individual'] as const).map((kind) => {
              const active = config.kind === kind;
              const label = kind === 'global' ? 'Todos iguais' : kind === 'percent' ? 'Misturar %' : 'Por avatar';
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
                    'label-tech rounded-full px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-all ' +
                    (active
                      ? 'bg-gradient-to-b from-cyan-400/30 to-cyan-400/10 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-2px_rgba(34,211,238,0.4)]'
                      : 'text-text-muted hover:text-white')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* CARDS DE MOTOR — pro design */}
          {config.kind === 'global' ? (
            <div>
              <div className="grid grid-cols-3 gap-2">
                {MOTORS.map((m) => {
                  const active = config.motor === m;
                  const palettes = {
                    III: {
                      active: 'border-lime/65 bg-gradient-to-br from-lime/22 via-lime/8 to-transparent text-lime shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-4px_rgba(190,242,100,0.45)]',
                      idle: 'border-white/8 bg-gradient-to-br from-white/[0.03] to-transparent text-text-muted hover:border-lime/40 hover:text-lime hover:bg-lime/[0.06]',
                    },
                    IV: {
                      active: 'border-amber-400/65 bg-gradient-to-br from-amber-400/22 via-amber-400/8 to-transparent text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-4px_rgba(251,191,36,0.45)]',
                      idle: 'border-white/8 bg-gradient-to-br from-white/[0.03] to-transparent text-text-muted hover:border-amber-400/40 hover:text-amber-700 hover:bg-amber-400/[0.06]',
                    },
                    V: {
                      active: 'border-fuchsia-400/65 bg-gradient-to-br from-fuchsia-400/22 via-fuchsia-400/8 to-transparent text-fuchsia-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-4px_rgba(217,70,239,0.45)]',
                      idle: 'border-white/8 bg-gradient-to-br from-white/[0.03] to-transparent text-text-muted hover:border-fuchsia-400/40 hover:text-fuchsia-200 hover:bg-fuchsia-400/[0.06]',
                    },
                  };
                  const palette = palettes[m as 'III' | 'IV' | 'V'];
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setConfig({ kind: 'global', motor: m })}
                      className={
                        'group relative rounded-[12px] border px-3 py-3 transition-all duration-200 will-change-transform hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-[0.98] ' +
                        (active ? palette.active : palette.idle)
                      }
                      title={`Usar Avatar ${m}`}
                    >
                      {active ? (
                        <span className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-current shadow-[0_2px_6px_rgba(0,0,0,0.3)]">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        </span>
                      ) : null}
                      <div className="text-[20px] font-extrabold tabular-nums leading-none" style={{ fontFamily: 'var(--font-tech)' }}>
                        {m}
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
                          'mono w-14 shrink-0 rounded-md px-2 py-1 text-center text-[11px] font-bold uppercase tracking-widest ' +
                          (m === 'III'
                            ? 'bg-lime/15 text-lime border border-lime/30'
                            : m === 'IV'
                            ? 'bg-amber-400/15 text-amber-700 border border-amber-400/30'
                            : 'bg-fuchsia-400/15 text-fuchsia-200 border border-fuchsia-400/30')
                        }
                      >
                        {m}
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
            <div className="rounded-[12px] border border-amber-400/45 bg-gradient-to-br from-amber-400/12 to-transparent p-3">
              <div className="label-tech text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
                Por avatar
              </div>
              <div className="mt-1 text-[11.5px] text-foreground/85" style={{ fontFamily: 'var(--font-tech)' }}>
                Escolha o motor de cada avatar embaixo, no card dele. Padrão = III.
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
