'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ToolHero } from '@/components/tool-kit';
import {
  clearHistory,
  historyToolLabel,
  readHistory,
  HISTORY_TOOLS,
  type HistoryEvent,
} from '@/lib/history';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCaixinhaPergunta,
  IconCamuflagem,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
  IconHeyGenAuto,
  IconLipsync,
  IconLtxVideo,
  IconNormalizador,
  IconSeparadorAudio,
} from '@/components/ToolIcons';

/**
 * /tools/historico — Histórico geral.
 *
 * Tudo que o usuário produziu nos últimos 7 dias, em todas as ferramentas,
 * agrupado por dia e filtrável por ferramenta. Alimentado por logHistory()
 * (lib/history.ts) — armazenamento local, nada sobe pra servidor.
 */

const TOOL_ICON: Record<string, React.ReactNode> = {
  'clickup-pilot': <IconClickUpPilot size={20} />,
  'heygen-auto': <IconHeyGenAuto size={20} />,
  'auto-broll': <IconAutoBroll size={20} />,
  lipsync: <IconLipsync size={20} />,
  decupagem: <IconDecupagem size={20} />,
  'decupagem-copy': <IconDecupageCopy size={20} />,
  'copy-srt': <IconCopySRT size={20} />,
  camuflagem: <IconCamuflagem size={20} />,
  compressor: <IconCompressor size={20} />,
  acelerador: <IconAcelerador size={20} />,
  'audio-split': <IconAudioSplit size={20} />,
  downloader: <IconDownloader size={20} />,
  fakepass: <IconFakePass size={20} />,
  'caixinha-pergunta': <IconCaixinhaPergunta size={20} />,
  'ltx-video': <IconLtxVideo size={20} />,
  normalizador: <IconNormalizador size={20} />,
  'separador-audio': <IconSeparadorAudio size={20} />,
};

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  done: { label: 'PRONTO', cls: 'border-lime/35 bg-lime/10 text-lime' },
  export: { label: 'EXPORT', cls: 'border-violet/35 bg-violet/10 text-violet' },
  dispatch: { label: 'DISPARO', cls: 'border-cyan/35 bg-cyan/10 text-cyan' },
  download: { label: 'DOWNLOAD', cls: 'border-line-strong bg-bg/60 text-text-muted' },
};

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
}

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoricoPage() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [tool, setTool] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  // Carrega + atualiza ao vivo quando qualquer ferramenta registra evento.
  useEffect(() => {
    const load = () => setEvents(readHistory());
    load();
    window.addEventListener('autoedit:history', load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener('autoedit:history', load);
      window.removeEventListener('storage', load);
    };
  }, []);

  // Contagem por ferramenta (pros chips) — só ferramentas com eventos.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.tool, (m.get(e.tool) ?? 0) + 1);
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (tool !== 'all' && e.tool !== tool) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        (e.meta ?? '').toLowerCase().includes(q) ||
        historyToolLabel(e.tool).toLowerCase().includes(q)
      );
    });
  }, [events, tool, query]);

  // Agrupa por dia preservando a ordem (mais novo primeiro).
  const groups = useMemo(() => {
    const out: { day: string; items: HistoryEvent[] }[] = [];
    for (const e of filtered) {
      const day = dayLabel(e.t);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [filtered]);

  const toolChips = HISTORY_TOOLS.filter((t) => (counts.get(t.id) ?? 0) > 0);

  return (
    <div className="container-app flex flex-col gap-6">
      <ToolHero
        eyebrow="SEU TRABALHO · ÚLTIMOS 7 DIAS"
        title="Histórico geral"
        subtitle="Tudo que você produziu, em todas as ferramentas — agrupado por dia, filtrável e pesquisável. Fica só no seu navegador."
        hue="rgba(167,139,250,0.45)"
        icon={
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v4h4" />
            <path d="M12 8v4l3 2" />
          </svg>
        }
      />

      {/* Acessos rápidos que saíram da barra superior */}
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
        <Link
          href="/tools/lipsync-history"
          className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-bg-soft/60 px-4 py-2 text-[12px] font-semibold text-text-muted transition-all hover:-translate-y-px hover:border-violet/45 hover:text-text"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          ZIPs de avatar (histórico de disparos)
        </Link>
      </div>

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
            className="input-field flex-1"
          />
          {events.length > 0 ? (
            confirmClear ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
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
      {groups.length === 0 ? (
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
          <p className="max-w-[420px] text-[13px] leading-relaxed text-text-muted">
            {events.length === 0
              ? 'Assim que você processar, exportar ou disparar algo em qualquer ferramenta, o registro aparece aqui — e fica guardado por 7 dias.'
              : 'Tente outra ferramenta ou limpe a busca.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-7 pb-4">
          {groups.map((g) => (
            <section key={g.day + g.items[0].id}>
              <div className="mb-3 flex items-center gap-3">
                <h3
                  className="text-[12px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {g.day}
                </h3>
                <span className="divider-grad flex-1" aria-hidden />
                <span className="mono text-[10.5px] text-text-dim">
                  {g.items.length} {g.items.length === 1 ? 'registro' : 'registros'}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {g.items.map((e) => {
                  const kind = KIND_LABEL[e.kind] ?? KIND_LABEL.done;
                  return (
                    <li
                      key={e.id}
                      className="group flex items-center gap-3.5 rounded-[14px] border border-line/60 px-4 py-3 shadow-depth-1 transition-all duration-300 hover:-translate-y-px hover:border-violet/30 md:px-5"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.12)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                      }}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-line-strong bg-bg/50"
                        aria-hidden
                      >
                        {TOOL_ICON[e.tool] ?? <IconClickUpPilot size={20} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-text">
                          {e.title}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-muted">
                          <span
                            className="font-bold"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            {historyToolLabel(e.tool)}
                          </span>
                          {e.meta ? (
                            <>
                              <span aria-hidden className="text-text-dim">
                                ·
                              </span>
                              <span className="mono">{e.meta}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span
                        className={
                          'hidden shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] sm:inline-block ' +
                          kind.cls
                        }
                        style={{ fontFamily: 'var(--font-label)' }}
                      >
                        {kind.label}
                      </span>
                      <span className="mono shrink-0 text-[11px] text-text-dim">
                        {timeLabel(e.t)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
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
