'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ToolShell } from '@/components/ToolShell';
import { MedalCard } from '@/components/MedalCard';
import {
  POINTS_TIERS,
  tierAchieved,
  nextTier,
  pointsToNext,
  tierProgress,
  fmtBRL,
  currentMonthKey,
  loadHistory,
  saveHistory,
  recordMonth,
  filterHistoryByMonths,
  totalBRL,
  consecutiveStreak,
  type MonthHistory,
} from '@/lib/points-system';
import { getClickUpToken, listTeams, listTasks, getCurrentUser } from '@/lib/clickup-client';

/**
 * Sistema de Pontos DARKO LAB.
 *
 * - Pontos calculados ao vivo das tasks ClickUp do user (custom field PESO)
 * - Medalhas 3D animadas (ROOKIE/ELITE/CHAMPION/LEGEND)
 * - Modo Financeiro (admin-only) com previsibilidade + grafico
 * - Historico mensal persistido (zera no fim do mes)
 */
export default function PointsPage() {
  // === User + admin check ===
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supa = createClient();
      const { data: { user } } = await supa.auth.getUser();
      if (!user) return;
      if (cancelled) return;
      setUserId(user.id);
      const { data: profile } = await supa.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      if (!cancelled) setIsAdmin(!!profile?.is_admin);
    })();
    return () => { cancelled = true; };
  }, []);

  // === Modo financeiro toggle (so admin pode ligar) ===
  const [financialMode, setFinancialMode] = useState(false);
  const [chartMode, setChartMode] = useState(false);

  // === Pontos atuais (fetch ClickUp) ===
  const [currentPoints, setCurrentPoints] = useState<number | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);

  async function fetchPoints() {
    if (!getClickUpToken()) {
      setPointsError('Configure o token ClickUp em /tools/clickup-pilot primeiro.');
      return;
    }
    setLoadingPoints(true);
    setPointsError(null);
    try {
      const teams = await listTeams();
      const teamId = teams[0]?.id;
      if (!teamId) { setPointsError('Sem teams ClickUp.'); return; }
      const me = await getCurrentUser();
      // Lista TODAS tasks do mes corrente (sem filtro de status)
      // ClickUp date_created_gt = unix ms do dia 1 do mes
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      // listTasks nao tem date_created direto — pega tudo + filtra
      const r = await listTasks(teamId, { assigneeIds: [String(me.id)], page: 0, subtasks: false });
      // Custom field PESO: soma valor numerico
      let total = 0;
      for (const t of r.tasks) {
        // So inclui tasks deste mes (created OU updated)
        const created = Number(t.date_created) || 0;
        if (created > 0 && created < firstOfMonth) continue;
        const peso = (t.custom_fields || []).find((f: any) => /^peso$|^pontos$|^points$/i.test(f.name || ''));
        if (peso?.value != null) {
          const val = parseFloat(String(peso.value));
          if (!isNaN(val)) total += val;
        }
      }
      setCurrentPoints(total);
    } catch (e) {
      setPointsError((e as Error)?.message || 'Erro fetch pontos');
    } finally {
      setLoadingPoints(false);
    }
  }

  useEffect(() => {
    fetchPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Historico (localStorage, snapshot ao mudar de mes) ===
  const [history, setHistory] = useState<MonthHistory[]>([]);
  const [filterMonths, setFilterMonths] = useState(3); // default 3 meses

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Snapshot do mes anterior se houver mudanca de mes
  useEffect(() => {
    if (currentPoints == null) return;
    const cur = currentMonthKey();
    const all = loadHistory();
    const lastEntry = all[all.length - 1];
    // Se ultimo registro for de mes anterior, ele ficou pendente — mas como pontos atuais sao do
    // mes corrente, nao da pra recuperar o final do mes passado. Snapshot eh feito manual via botao
    // OR cron — pra MVP fica explicito.
  }, [currentPoints]);

  const filteredHistory = useMemo(() => filterHistoryByMonths(history, filterMonths), [history, filterMonths]);
  const periodTotal = useMemo(() => totalBRL(filteredHistory), [filteredHistory]);
  const streak = useMemo(() => consecutiveStreak(history), [history]);

  // === Derivados ===
  const points = currentPoints ?? 0;
  const cur = tierAchieved(points);
  const nx = nextTier(points);
  const ptsToNext = pointsToNext(points);
  const progress = tierProgress(points);

  return (
    <ToolShell
      title="Sistema de Pontos"
      description="Visor tecnológico com seus pontos mensais. Bate metas (60/90/120/150) e desbloqueia bônus + medalhas."
    >
      {/* === VISOR PRINCIPAL === */}
      <div className="relative rounded-[16px] border border-cyan-500/40 bg-gradient-to-br from-bg-soft/80 to-bg/60 p-6 mb-5 overflow-hidden">
        {/* Scan lines decorativas */}
        <div aria-hidden className="absolute inset-0 pointer-events-none opacity-20" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.08) 2px, rgba(34,211,238,0.08) 3px)',
        }} />
        <div className="relative z-10">
          <div className="mono text-[10px] uppercase tracking-widest text-cyan-300 opacity-70">// CURRENT MONTH</div>
          <div className="flex flex-wrap items-baseline gap-4 mt-1">
            <div
              className="font-bold text-[72px] leading-none"
              style={{
                background: cur ? `linear-gradient(135deg, ${cur.primaryColor}, ${cur.secondaryColor})` : 'linear-gradient(135deg, #22D3EE, #06B6D4)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: cur ? `0 0 40px ${cur.primaryColor}40` : '0 0 40px rgba(34,211,238,0.3)',
              }}
            >
              {loadingPoints ? '...' : points}
            </div>
            <div className="flex flex-col">
              <div className="mono text-[11px] uppercase tracking-widest text-cyan-200">PONTOS</div>
              {cur ? (
                <div className="mono text-[11px] uppercase tracking-widest" style={{ color: cur.primaryColor }}>
                  ★ {cur.englishName} · {fmtBRL(cur.bonusBRL)}
                </div>
              ) : (
                <div className="mono text-[10px] uppercase tracking-widest text-text-muted">Ainda sem meta</div>
              )}
            </div>
            <div className="ml-auto flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={fetchPoints}
                disabled={loadingPoints}
                className="mono rounded border border-line-strong px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime disabled:opacity-40"
              >
                {loadingPoints ? '⟳ Carregando...' : '⟳ Atualizar'}
              </button>
              <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
                {currentMonthKey()}
              </div>
            </div>
          </div>

          {/* Progress to next */}
          {nx ? (
            <div className="mt-4">
              <div className="mono mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-text-muted">
                <span>Próxima meta: <span style={{ color: nx.primaryColor }}>{nx.englishName}</span> · {nx.minPoints} pts · {fmtBRL(nx.bonusBRL)}</span>
                <span style={{ color: nx.primaryColor }}>{ptsToNext} pts faltam</span>
              </div>
              <div className="h-2 rounded-full bg-bg/60 overflow-hidden border border-line">
                <div
                  className="h-full transition-all duration-700"
                  style={{
                    width: `${progress * 100}%`,
                    background: `linear-gradient(to right, ${nx.primaryColor}, ${nx.secondaryColor})`,
                    boxShadow: `0 0 12px ${nx.primaryColor}80`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 mono text-[10px] uppercase tracking-widest text-amber-300">
              ★ LEGEND atingido · meta máxima · {fmtBRL(POINTS_TIERS[POINTS_TIERS.length - 1].bonusBRL)}
            </div>
          )}

          {pointsError ? (
            <div className="mt-3 rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
              {pointsError}
            </div>
          ) : null}
        </div>
      </div>

      {/* === MEDALHAS === */}
      <div className="mb-6">
        <div className="mono mb-4 text-[10px] uppercase tracking-widest text-text-muted">// TIERS</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-3 py-6">
          {POINTS_TIERS.map((t) => (
            <MedalCard
              key={t.minPoints}
              tier={t}
              achieved={points >= t.minPoints}
              currentPoints={points}
            />
          ))}
        </div>
      </div>

      {/* === MODO FINANCEIRO (admin-only) === */}
      {isAdmin ? (
        <div className="rounded-[16px] border border-amber-400/40 bg-gradient-to-br from-amber-500/5 to-bg/60 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="mono text-[10px] uppercase tracking-widest text-amber-300">// CONFIDENTIAL · ADMIN ONLY</div>
              <h3 className="text-lg font-bold text-white">Modo Financeiro</h3>
              <div className="text-[11px] text-text-muted">Previsibilidade · histórico mensal · gráfico trade</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFinancialMode((v) => !v)}
                className={
                  'mono rounded-full border px-4 py-1.5 text-[10px] uppercase tracking-widest transition-all duration-300 ' +
                  (financialMode
                    ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_20px_-4px_rgba(251,191,36,0.6)]'
                    : 'border-line-strong text-text-muted hover:border-amber-400 hover:text-amber-300')
                }
              >
                {financialMode ? '◉ Financeiro ON' : '○ Financeiro OFF'}
              </button>
              <button
                type="button"
                onClick={() => setChartMode((v) => !v)}
                className={
                  'mono rounded-full border px-4 py-1.5 text-[10px] uppercase tracking-widest transition-all duration-300 ' +
                  (chartMode
                    ? 'border-cyan-400 bg-cyan-400/20 text-cyan-200 shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)]'
                    : 'border-line-strong text-text-muted hover:border-cyan-400 hover:text-cyan-200')
                }
              >
                {chartMode ? '◉ Gráfico ON' : '○ Gráfico OFF'}
              </button>
            </div>
          </div>

          {financialMode ? (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap gap-1">
                {[1, 3, 6, 12, 24, 60, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFilterMonths(m)}
                    className={
                      'mono rounded-md px-3 py-1 text-[10px] uppercase tracking-widest transition ' +
                      (filterMonths === m
                        ? 'border border-amber-400 bg-amber-400/20 text-amber-300'
                        : 'border border-line-strong text-text-muted hover:border-amber-400 hover:text-white')
                    }
                  >
                    {m === 1 ? '1 mês' : m < 12 ? `${m} meses` : m === 12 ? '1 ano' : `${Math.floor(m / 12)} anos`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                <div className="rounded-[10px] border border-amber-400/40 bg-amber-400/5 p-3">
                  <div className="mono text-[9px] uppercase tracking-widest text-amber-300">Total faturado</div>
                  <div className="mono text-xl text-amber-300 font-bold">{fmtBRL(periodTotal)}</div>
                </div>
                <div className="rounded-[10px] border border-line bg-bg-soft/40 p-3">
                  <div className="mono text-[9px] uppercase tracking-widest text-text-muted">Meses no histórico</div>
                  <div className="mono text-xl text-white">{filteredHistory.length}</div>
                </div>
                <div className="rounded-[10px] border border-lime/40 bg-lime/5 p-3">
                  <div className="mono text-[9px] uppercase tracking-widest text-lime">Streak (meses seguidos)</div>
                  <div className="mono text-xl text-lime">{streak}</div>
                </div>
              </div>

              {/* GRAFICO TRADE-STYLE */}
              {chartMode ? (
                <div className="rounded-[10px] border border-cyan-500/40 bg-bg p-3">
                  <div className="mono mb-2 text-[9px] uppercase tracking-widest text-cyan-200">// MONTHLY EARNINGS · TRADE VIEW</div>
                  <TradeChart history={filteredHistory} />
                </div>
              ) : null}

              {/* HISTORICO TABELA */}
              <div className="mt-4 rounded-[10px] border border-line bg-bg-soft/30 p-3 max-h-[400px] overflow-y-auto">
                <div className="mono mb-2 text-[9px] uppercase tracking-widest text-text-muted">// HISTORY</div>
                {filteredHistory.length === 0 ? (
                  <div className="text-[11px] text-text-muted text-center py-4">
                    Sem histórico de meses ainda. Snapshot eh criado ao fechar cada mês.
                  </div>
                ) : (
                  <div className="grid gap-1">
                    {[...filteredHistory].reverse().map((h) => (
                      <div key={h.monthKey} className="flex items-center justify-between rounded border border-line bg-bg/40 px-3 py-1.5 text-[11px]">
                        <span className="mono text-white">{h.monthKey}</span>
                        <span className="mono text-text-muted">{h.finalPoints} pts</span>
                        {h.tier ? (
                          <span className="mono" style={{ color: h.tier.primaryColor }}>★ {h.tier.englishName}</span>
                        ) : (
                          <span className="mono text-text-muted">sem meta</span>
                        )}
                        <span className="mono font-bold" style={{ color: h.bonusBRL > 0 ? '#10B981' : '#71717A' }}>{fmtBRL(h.bonusBRL)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Botao snapshot manual */}
              {currentPoints != null ? (
                <button
                  type="button"
                  onClick={() => {
                    const m = currentMonthKey();
                    const existing = history.findIndex(h => h.monthKey === m);
                    const entry = recordMonth(m, currentPoints);
                    const next = existing >= 0
                      ? history.map((h, i) => (i === existing ? entry : h))
                      : [...history, entry];
                    saveHistory(next);
                    setHistory(next);
                  }}
                  className="mono mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-400/20"
                >
                  📸 Snapshot do mês atual ({currentMonthKey()})
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <Link href="/tools" className="mono text-[10px] uppercase tracking-widest text-text-muted hover:text-lime">
          ← Voltar pra ferramentas
        </Link>
      </div>
    </ToolShell>
  );
}

/** Mini grafico estilo trade — velas verdes (bateu meta) / vermelhas (faltou) */
function TradeChart({ history }: { history: MonthHistory[] }) {
  if (history.length === 0) return <div className="text-center text-[11px] text-text-muted py-6">Sem dados</div>;
  const sorted = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const maxBRL = Math.max(10000, ...sorted.map(h => h.bonusBRL));
  const chartH = 180;
  return (
    <div className="relative">
      <div className="flex items-end gap-1" style={{ height: chartH }}>
        {sorted.map((h, i) => {
          const heightPct = (h.bonusBRL / maxBRL) * 100;
          const isGreen = h.bonusBRL > 0;
          const prevH = i > 0 ? sorted[i - 1].bonusBRL : 0;
          const goingUp = h.bonusBRL >= prevH;
          return (
            <div key={h.monthKey} className="flex-1 flex flex-col items-center gap-1 min-w-[18px]">
              <div className="mono text-[8px] text-text-muted">{h.bonusBRL > 0 ? `${(h.bonusBRL/1000).toFixed(0)}k` : '-'}</div>
              <div className="relative w-full flex justify-center" style={{ height: chartH - 24 }}>
                <div
                  className="absolute bottom-0 rounded-sm transition-all"
                  style={{
                    width: '70%',
                    height: `${Math.max(2, heightPct)}%`,
                    background: isGreen
                      ? (goingUp ? 'linear-gradient(to top, #10B981, #34D399)' : 'linear-gradient(to top, #10B981, #6EE7B7)')
                      : 'linear-gradient(to top, #DC2626, #EF4444)',
                    boxShadow: isGreen ? '0 0 8px rgba(16,185,129,0.4)' : '0 0 8px rgba(220,38,38,0.4)',
                  }}
                />
                {/* "Wick" line */}
                <div
                  className="absolute bottom-0 w-0.5"
                  style={{
                    height: `${Math.max(2, heightPct)}%`,
                    background: isGreen ? '#10B981' : '#DC2626',
                  }}
                />
              </div>
              <div className="mono text-[8px] text-text-muted truncate w-full text-center">{h.monthKey.slice(5)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
