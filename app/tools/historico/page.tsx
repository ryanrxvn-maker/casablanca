'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ToolHero } from '@/components/tool-kit';
import {
  HistoryTimeline,
  chavesZipDosEventos,
  fmtBytes,
  useDisponibilidade,
  useHistoryEvents,
} from '@/components/history/HistoryTimeline';
import {
  FiltrosDeOrigemEData,
  useFiltroDeOrigemEData,
} from '@/components/history/FiltrosHistorico';
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

  // Link direto por ferramenta (/tools/historico?tool=decupagem). Lido do
  // window em vez de useSearchParams pra não exigir Suspense nesta página.
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tool');
      if (t && HISTORY_TOOLS.some((x) => x.id === t)) setTool(t);
    } catch {}
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

  const porFerramenta = useMemo(() => filterHistory(events, { tool }), [events, tool]);
  // Data e origem entram entre a ferramenta e a busca: os contadores dos chips
  // de origem falam da ferramenta escolhida, que e' o que esta' na tela.
  const filtro = useFiltroDeOrigemEData(porFerramenta);
  const filtered = useMemo(
    () => filterHistory(filtro.eventos, { query }),
    [filtro.eventos, query],
  );
  const chavesZip = useMemo(() => chavesZipDosEventos(filtered), [filtered]);
  const disponibilidade = useDisponibilidade(true, chavesZip);

  const toolChips = HISTORY_TOOLS.filter((t) => (counts.get(t.id) ?? 0) > 0);
  const vaultInfo = disponibilidade.vaultInfo;

  return (
    <div className="container-app flex flex-col gap-6">
      <ToolHero
        eyebrow="SEU TRABALHO · ÚLTIMOS 7 DIAS"
        title="Histórico geral"
        subtitle="Tudo que você produziu nos últimos 7 dias, de todas as ferramentas, pronto pra baixar de novo."
        hue="rgba(167,139,250,0.45)"
        icon={
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v4h4" />
            <path d="M12 8v4l3 2" />
          </svg>
        }
      />

      {/* Resumo — números grandes, rótulo miúdo: a faixa inteira cabe num olhar */}
      <div className="hist-faixa">
        <Stat valor={String(events.length)} rotulo="registros" />
        <span className="hist-faixa__div" aria-hidden />
        <Stat valor={String(recuperaveis)} rotulo="com arquivo" tom="var(--hist-lime)" />
        <span className="hist-faixa__div" aria-hidden />
        <Stat
          valor={vaultInfo ? fmtBytes(vaultInfo.bytes) : '—'}
          rotulo="neste navegador"
          tom="var(--hist-cyan)"
          dica={vaultInfo ? `${vaultInfo.files} arquivo${vaultInfo.files === 1 ? '' : 's'} guardados — limpa sozinho` : undefined}
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
      <div className="hist-filtros-geral">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={tool === 'all'}
            onClick={() => setTool('all')}
            label={`Tudo ${events.length}`}
          />
          {toolChips.map((t) => (
            <FilterChip
              key={t.id}
              active={tool === t.id}
              onClick={() => setTool(tool === t.id ? 'all' : t.id)}
              label={`${t.label} ${counts.get(t.id)}`}
            />
          ))}
        </div>
        <FiltrosDeOrigemEData {...filtro} solto />

        <div className="flex items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar no histórico"
            className="hist-busca flex-1"
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
              ? 'Suas entregas aparecem aqui por 7 dias.'
              : 'Tente outra ferramenta ou limpe a busca.'}
          </p>
        </div>
      ) : (
        <HistoryTimeline events={filtered} disponibilidade={disponibilidade} />
      )}
    </div>
  );
}

function Stat({
  valor,
  rotulo,
  tom,
  dica,
}: {
  valor: string;
  rotulo: string;
  tom?: string;
  dica?: string;
}) {
  return (
    <span className="hist-stat" title={dica}>
      <b className="hist-stat__valor" style={tom ? { color: tom } : undefined}>
        {valor}
      </b>
      <span className="hist-stat__rotulo">{rotulo}</span>
    </span>
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
      className={'hist-chip' + (active ? ' hist-chip--on' : '')}
    >
      {label}
    </button>
  );
}
