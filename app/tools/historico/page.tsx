'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ToolHero } from '@/components/tool-kit';
import {
  HistoryTimeline,
  fmtBytes,
  useDisponibilidade,
  useHistoryEvents,
} from '@/components/history/HistoryTimeline';
import {
  clearHistory,
  countByTool,
  filterHistory,
  HISTORY_TOOLS,
} from '@/lib/history';

/**
 * /tools/historico — Histórico geral RECUPERÁVEL.
 *
 * Tudo que o usuário produziu nos últimos 7 dias, em todas as ferramentas,
 * agrupado por dia — e BAIXÁVEL de novo. Cada registro carrega referências
 * (lib/history.ts FileRef): bytes no cofre local (history-vault), pacote no
 * zip-store dos disparos, ou receita de resgate pelo HeyGen (videoIds). O
 * botão Baixar percorre a cadeia até achar. Nada sobe pra servidor.
 *
 * A lista e o botão Baixar vivem em components/history/HistoryTimeline — o
 * MESMO motor do botão de histórico que cada ferramenta tem. Esta página é a
 * visão geral (todas as ferramentas, filtros, limpeza); o painel da ferramenta
 * é a visão de quem está trabalhando e só quer o que fez ali.
 */
export default function HistoricoPage() {
  const [tool, setTool] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const events = useHistoryEvents();
  const disponibilidade = useDisponibilidade(true);

  // Atalhos internos (Pilot/Hey Auto) — só admin vê.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poda o cofre em ocioso no primeiro load (nunca no caminho quente).
  useEffect(() => {
    void import('@/lib/history-vault').then((v) => v.scheduleVaultPrune()).catch(() => {});
  }, []);

  // Contagem por ferramenta (pros chips) — só ferramentas com eventos.
  const counts = useMemo(() => countByTool(events), [events]);

  const recuperaveis = useMemo(
    () => events.filter((e) => (e.ref?.length ?? 0) > 0).length,
    [events],
  );

  const filtered = useMemo(() => filterHistory(events, { tool, query }), [events, tool, query]);

  const toolChips = HISTORY_TOOLS.filter((t) => (counts.get(t.id) ?? 0) > 0);
  const vaultInfo = disponibilidade.vaultInfo;

  return (
    <div className="container-app flex flex-col gap-6">
      <ToolHero
        eyebrow="SEU TRABALHO · ÚLTIMOS 7 DIAS"
        title="Histórico geral"
        subtitle="Consulte suas entregas dos últimos 7 dias e baixe novamente os arquivos disponíveis. Arquivos pequenos ficam neste navegador; avatares do HeyGen também podem ser recuperados pelo ID. Os registros expiram após 7 dias."
        hue="rgba(167,139,250,0.45)"
        icon={
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v4h4" />
            <path d="M12 8v4l3 2" />
          </svg>
        }
      />

      {/* Resumo: registros, recuperáveis e cofre local */}
      <div className="grid grid-cols-3 gap-2 sm:max-w-[560px]">
        <StatCard label="REGISTROS" value={String(events.length)} tone="text-text" />
        <StatCard label="DISPONÍVEIS" value={String(recuperaveis)} tone="text-lime" />
        <StatCard
          label="COFRE LOCAL"
          value={vaultInfo ? fmtBytes(vaultInfo.bytes) : '—'}
          tone="text-cyan"
          hint={vaultInfo ? `${vaultInfo.files} arquivo${vaultInfo.files === 1 ? '' : 's'} · limpa sozinho` : undefined}
        />
      </div>

      {/* Acessos rápidos das filas internas — só admin (uso interno) */}
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/tools/background"
            className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-bg-soft/60 px-4 py-2 text-[12px] font-semibold text-text-muted transition-all hover:-translate-y-px hover:border-violet/45 hover:text-text"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet"
            />
            Tarefas em segundo plano (ao vivo)
          </Link>
        </div>
      ) : null}

      {/* Filtros */}
      <div
        className="flex flex-col gap-3 rounded-[18px] border border-line/60 p-4 shadow-depth-1 md:p-5"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.14)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={tool === 'all'}
            onClick={() => setTool('all')}
            label={`Tudo · ${events.length}`}
          />
          {toolChips.map((t) => (
            <FilterChip
              key={t.id}
              active={tool === t.id}
              onClick={() => setTool(tool === t.id ? 'all' : t.id)}
              label={`${t.label} · ${counts.get(t.id)}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por arquivo, ferramenta, detalhe…"
            aria-label="Buscar no histórico"
            className="input-field flex-1"
          />
          {events.length > 0 ? (
            confirmClear ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try { await clearHistory(); } catch { return; }
                    void import('@/lib/history-vault')
                      .then((v) => v.clearVault())
                      .then(() => disponibilidade.refresh())
                      .catch(() => {});
                    setConfirmClear(false);
                  }}
                  className="rounded-full border border-red-500/45 px-3.5 py-2 text-[11.5px] font-bold text-red-300 transition hover:bg-red-500/10"
                >
                  Apagar tudo
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="btn-ghost !py-2 !text-[11.5px]"
                >
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="btn-ghost !py-2 !text-[11.5px]"
              >
                Limpar histórico
              </button>
            )
          ) : null}
        </div>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-[20px] border border-line/60 px-6 py-16 text-center"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.14)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
          }}
        >
          <span
            className="flex h-14 w-14 items-center justify-center rounded-[16px] border border-line-strong bg-bg/50"
            aria-hidden
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--text-dim))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <p
            className="text-[15px] font-bold text-text"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {events.length === 0
              ? 'Nada por aqui ainda'
              : 'Nenhum resultado com esse filtro'}
          </p>
          <p className="max-w-[440px] text-[13px] leading-relaxed text-text-muted">
            {events.length === 0
              ? 'Suas próximas entregas aparecerão aqui. Os registros ficam disponíveis por 7 dias, com acesso aos arquivos que puderem ser recuperados.'
              : 'Tente outra ferramenta ou limpe a busca.'}
          </p>
        </div>
      ) : (
        <HistoryTimeline events={filtered} disponibilidade={disponibilidade} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-[14px] border border-line/60 px-3.5 py-2.5 shadow-depth-1"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.12)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <p
        className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-text-dim"
        style={{ fontFamily: 'var(--font-label)' }}
      >
        {label}
      </p>
      <p className={`mt-0.5 text-[17px] font-bold leading-tight ${tone}`} style={{ fontFamily: 'var(--font-tech)' }}>
        {value}
      </p>
      {hint ? <p className="mono mt-0.5 text-[9.5px] text-text-dim">{hint}</p> : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-3.5 py-1.5 text-[11.5px] font-bold transition-all duration-200 active:scale-[0.96] ' +
        (active
          ? 'border-violet/60 text-text'
          : 'border-line-strong text-text-muted hover:border-violet/40 hover:text-text')
      }
      style={{
        fontFamily: 'var(--font-tech)',
        ...(active
          ? {
              background:
                'linear-gradient(160deg, rgba(167,139,250,0.18), rgba(124,58,237,0.06)), rgb(var(--bg-elev))',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px -6px rgba(139,92,246,0.6)',
            }
          : {}),
      }}
    >
      {label}
    </button>
  );
}
