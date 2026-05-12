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
}: {
  config: MotorConfig;
  setConfig: (c: MotorConfig) => void;
  takeCount: number;
  /** IDs dos slots quando modo individual. */
  slotIds?: string[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Duracao media por take em segundos (default 30s — pode ajustar)
  const [averageTakeSeconds, setAverageTakeSeconds] = useState<number>(DEFAULT_TAKE_SECONDS);
  const cost = estimateCost(config, takeCount, { slotIds, averageTakeSeconds });
  const { credits, loading: loadingCredits, refresh: refreshCredits } = useHeyGenCredits(true);

  const planCreditAvail = credits?.plan_credit?.amount ?? null;
  const planCreditTotal = credits?.plan_credit?.total ?? null;
  const unlimitedAvail = credits?.unlimited_regular?.amount ?? null;
  const unlimitedTotal = credits?.unlimited_regular?.total ?? null;
  const exceedsBudget = planCreditAvail != null && cost.total > planCreditAvail;

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
          {/* Preview creditos */}
          <span
            className={
              'mono rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ' +
              (cost.total === 0
                ? 'border border-lime/40 bg-lime/10 text-lime'
                : cost.total < 5
                ? 'border border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
                : 'border border-red-500/40 bg-red-500/10 text-red-300')
            }
            title={`HeyGen oficial: 1 min Avatar V/IV = 20 créditos · III free. Total previa: ${cost.total}c`}
          >
            {cost.total === 0 ? '✓ Free' : `${cost.total} créd`}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mono rounded border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-cyan-500/60 hover:text-cyan-300"
          >
            {collapsed ? '▶' : '▼'} {collapsed ? 'Mostrar' : 'Esconder'}
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

          {/* Duracao media por take (afeta calculo de creditos) */}
          <div className="flex items-center gap-2 rounded border border-line/40 bg-bg/40 px-3 py-2">
            <span className="mono shrink-0 text-[10px] uppercase tracking-widest text-text-muted">
              Duracao media por take:
            </span>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={averageTakeSeconds}
              onChange={(e) => setAverageTakeSeconds(Number(e.target.value))}
              className="flex-1 accent-cyan-400"
            />
            <span className="mono w-14 shrink-0 text-right text-[10px] font-bold text-cyan-300">
              {averageTakeSeconds}s
            </span>
          </div>

          {/* Resumo creditos — HeyGen cobra por MINUTO de video */}
          <div className="rounded border border-line/40 bg-bg/40 px-3 py-2 text-[11px]">
            <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">
              Previa de custo ({takeCount} takes × {averageTakeSeconds}s = {(takeCount * averageTakeSeconds / 60).toFixed(1)} min)
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="mono text-lime">
                III: {cost.byMotor.III} {cost.byMotor.III === 1 ? 'take' : 'takes'} ({cost.minutesByMotor.III.toFixed(1)}min · free)
              </span>
              <span className="mono text-yellow-200">
                IV: {cost.byMotor.IV} {cost.byMotor.IV === 1 ? 'take' : 'takes'} ({cost.minutesByMotor.IV.toFixed(1)}min · {Math.ceil(cost.minutesByMotor.IV * CREDIT_COST_PER_MIN.IV)}c)
              </span>
              <span className="mono text-fuchsia-200">
                V: {cost.byMotor.V} {cost.byMotor.V === 1 ? 'take' : 'takes'} ({cost.minutesByMotor.V.toFixed(1)}min · {Math.ceil(cost.minutesByMotor.V * CREDIT_COST_PER_MIN.V)}c)
              </span>
              <span className="ml-auto mono font-bold text-cyan-300">
                ≈ {cost.total} créditos
              </span>
            </div>
            <div className="mt-1 text-[9px] text-text-muted">
              HeyGen oficial: Avatar V/IV = <strong>20 créditos por minuto</strong>. Avatar III = free (consome priority slot).
            </div>
          </div>

          {/* Saldo REAL HeyGen */}
          <div className={
            'rounded border px-3 py-2 text-[11px] ' +
            (loadingCredits
              ? 'border-line/40 bg-bg/40'
              : exceedsBudget
              ? 'border-red-500/60 bg-red-500/10'
              : credits?.ok
              ? 'border-lime/40 bg-lime/5'
              : 'border-yellow-500/40 bg-yellow-500/5')
          }>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="mono text-[9px] uppercase tracking-widest text-text-muted">
                // SALDO HEYGEN {credits?.plan_name ? `(${credits.plan_name})` : ''}
              </span>
              <button
                type="button"
                onClick={() => refreshCredits(true)}
                disabled={loadingCredits}
                className="mono rounded border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-cyan-500/60 hover:text-cyan-300 disabled:opacity-40"
              >
                {loadingCredits ? '⟳ atualizando...' : '⟳ refresh'}
              </button>
            </div>
            {loadingCredits ? (
              <div className="text-text-muted">Carregando saldo da conta HeyGen...</div>
            ) : !credits?.ok ? (
              <div className="text-yellow-200">
                ⚠ Nao consegui ler o saldo HeyGen. {credits?.error ? `Erro: ${credits.error}.` : ''} Confirma que tem a aba app.heygen.com aberta + extension v4.9+ reloaded.
              </div>
            ) : (
              <div className="space-y-1">
                {/* Plan credit (Avatar IV/V) */}
                {planCreditAvail != null && planCreditTotal != null ? (
                  <div className="flex items-center justify-between">
                    <span className="mono text-text-muted">Créditos pagos (Avatar IV/V):</span>
                    <span className={'mono font-bold ' + (exceedsBudget ? 'text-red-300' : 'text-lime')}>
                      {planCreditAvail} / {planCreditTotal}
                    </span>
                  </div>
                ) : null}
                {/* Unlimited regular (Avatar III priority) */}
                {unlimitedAvail != null && unlimitedTotal != null ? (
                  <div className="flex items-center justify-between">
                    <span className="mono text-text-muted">Priority videos III (rápidos):</span>
                    <span className={'mono ' + (unlimitedAvail === 0 ? 'text-yellow-200' : 'text-lime')}>
                      {unlimitedAvail} / {unlimitedTotal}
                    </span>
                  </div>
                ) : null}
                {/* Days left */}
                {credits.left_days != null ? (
                  <div className="flex items-center justify-between">
                    <span className="mono text-text-muted">Renovacao em:</span>
                    <span className="mono text-text-muted">{credits.left_days} dias</span>
                  </div>
                ) : null}
                {/* Warning excedeu */}
                {exceedsBudget ? (
                  <div className="mt-2 rounded border border-red-500/60 bg-red-500/15 p-2 text-red-200">
                    <div className="mono font-bold uppercase tracking-widest text-[10px]">⚠ EXCEDE SALDO</div>
                    <div className="mt-1 text-[10px]">
                      Previa: <strong>{cost.total} créditos</strong> · Disponível: <strong>{planCreditAvail}</strong> · Faltam <strong>{cost.total - planCreditAvail}</strong> créditos.
                      Reduza % de IV/V ou aguarde renovação.
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
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
