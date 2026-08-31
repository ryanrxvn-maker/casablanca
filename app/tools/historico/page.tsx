'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ToolHero } from '@/components/tool-kit';
import {
  canonicalTool,
  clearHistory,
  historyToolLabel,
  readHistory,
  HISTORY_TOOLS,
  type FileRef,
  type HistoryEvent,
} from '@/lib/history';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
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
 * /tools/historico — Histórico geral RECUPERÁVEL.
 *
 * Tudo que o usuário produziu nos últimos 7 dias, em todas as ferramentas,
 * agrupado por dia — e BAIXÁVEL de novo. Cada registro carrega referências
 * (lib/history.ts FileRef): bytes no cofre local (history-vault), pacote no
 * zip-store dos disparos, ou receita de resgate pelo HeyGen (videoIds). O
 * botão Baixar percorre a cadeia até achar. Nada sobe pra servidor.
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Cadeia de download: refs de MESMO nome viram um botão só (fallback em ordem). */
type Chain = { name: string; label: string; refs: FileRef[] };

function buildChains(refs: FileRef[]): Chain[] {
  const out: Chain[] = [];
  for (const r of refs) {
    const existing = out.find((c) => c.name === r.name);
    if (existing) existing.refs.push(r);
    else out.push({ name: r.name, label: r.label || r.name, refs: [r] });
  }
  return out;
}

type ChainState = 'local' | 'remote' | 'gone';

export default function HistoricoPage() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [tool, setTool] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vaultKeys, setVaultKeys] = useState<Set<string>>(new Set());
  const [zipKeys, setZipKeys] = useState<Set<string>>(new Set());
  const [vaultInfo, setVaultInfo] = useState<{ files: number; bytes: number } | null>(null);
  // Estado por evento: baixando qual cadeia + mensagem de progresso/erro.
  const [rowState, setRowState] = useState<
    Record<string, { busy?: string; msg?: string; err?: string; ofereceResgate?: boolean }>
  >({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Disponibilidade: quais chaves ainda existem no cofre e no zip-store.
  // Só METADADOS (2 cursores) — barato mesmo com centenas de registros.
  const refreshAvailability = useCallback(() => {
    void (async () => {
      try {
        const { vaultList, vaultStats } = await import('@/lib/history-vault');
        const list = await vaultList();
        setVaultKeys(new Set(list.map((r) => r.key)));
        setVaultInfo(await vaultStats().catch(() => null));
      } catch {}
      try {
        const { listZipKeys } = await import('@/lib/zip-store');
        const zips = await listZipKeys();
        setZipKeys(new Set(zips.map((z) => z.key)));
      } catch {}
    })();
  }, []);

  // Carrega + atualiza ao vivo; poda o cofre em idle no primeiro load.
  useEffect(() => {
    const load = () => {
      setEvents(readHistory());
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refreshAvailability, 800);
    };
    load();
    void import('@/lib/history-vault').then((v) => v.scheduleVaultPrune()).catch(() => {});
    window.addEventListener('autoedit:history', load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener('autoedit:history', load);
      window.removeEventListener('storage', load);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refreshAvailability]);

  function chainState(chain: Chain): ChainState {
    for (const r of chain.refs) {
      if (r.via === 'vault' && vaultKeys.has(r.key)) return 'local';
      if (r.via === 'zip' && zipKeys.has(r.key)) return 'local';
    }
    if (chain.refs.some((r) => r.via === 'heygen')) return 'remote';
    return 'gone';
  }

  async function baixarChain(ev: HistoryEvent, chain: Chain) {
    const st = rowState[ev.id];
    if (st?.busy) return;
    const patch = (p: Partial<{ busy?: string; msg?: string; err?: string; ofereceResgate?: boolean }>) =>
      setRowState((prev) => ({ ...prev, [ev.id]: { ...prev[ev.id], ...p } }));
    patch({ busy: chain.name, msg: 'Localizando…', err: undefined, ofereceResgate: false });
    try {
      const { recoverRef } = await import('@/lib/history-vault');
      let lastReason = 'Arquivo não encontrado.';
      let sugerirHeygen = false;
      for (const r of chain.refs) {
        const res = await recoverRef(r, (m) => patch({ msg: m }));
        if (res.ok) {
          patch({ busy: undefined, msg: undefined, err: undefined });
          return;
        }
        lastReason = res.reason;
        sugerirHeygen = sugerirHeygen || !!res.sugerirHeygen;
      }
      const temResgate = (ev.ref ?? []).some((r) => r.via === 'heygen') &&
        !chain.refs.some((r) => r.via === 'heygen');
      patch({
        busy: undefined,
        msg: undefined,
        err: lastReason,
        ofereceResgate: sugerirHeygen && temResgate,
      });
    } catch (e) {
      patch({ busy: undefined, msg: undefined, err: (e as Error)?.message || 'Falha inesperada.' });
    } finally {
      refreshAvailability();
    }
  }

  // Contagem por ferramenta (pros chips) — só ferramentas com eventos.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const c = canonicalTool(e.tool);
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [events]);

  const recuperaveis = useMemo(
    () => events.filter((e) => (e.ref?.length ?? 0) > 0).length,
    [events],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (tool !== 'all' && canonicalTool(e.tool) !== tool) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        (e.meta ?? '').toLowerCase().includes(q) ||
        (e.ref ?? []).some((r) => r.name.toLowerCase().includes(q)) ||
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
        subtitle="Tudo que você produziu, em todas as ferramentas — e baixável de novo. Arquivo pequeno fica guardado no navegador; avatar do HeyGen a gente resgata pelo ID mesmo que o cache tenha sido limpo. Some sozinho depois de 7 dias."
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
            className="input-field flex-1"
          />
          {events.length > 0 ? (
            confirmClear ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
                    void import('@/lib/history-vault')
                      .then((v) => v.clearVault())
                      .then(() => refreshAvailability())
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
          <p className="max-w-[440px] text-[13px] leading-relaxed text-text-muted">
            {events.length === 0
              ? 'Assim que você processar, exportar ou disparar algo em qualquer ferramenta, o registro aparece aqui — baixável de novo por 7 dias.'
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
                  const chains = buildChains(e.ref ?? []);
                  const st = rowState[e.id];
                  const resgate = chains.find((c) => c.refs.some((r) => r.via === 'heygen'));
                  return (
                    <li
                      key={e.id}
                      className="group rounded-[14px] border border-line/60 px-4 py-3 shadow-depth-1 transition-all duration-300 hover:-translate-y-px hover:border-violet/30 md:px-5"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.12)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                      }}
                    >
                      <div className="flex items-center gap-3.5">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-line-strong bg-bg/50"
                          aria-hidden
                        >
                          {TOOL_ICON[canonicalTool(e.tool)] ?? <IconClickUpPilot size={20} />}
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
                      </div>

                      {/* Downloads: um botão por arquivo, com estado honesto */}
                      {chains.length > 0 ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[54px]">
                          {chains.map((c) => {
                            const state = chainState(c);
                            const busy = st?.busy === c.name;
                            const isHg = c.refs.every((r) => r.via === 'heygen');
                            return (
                              <button
                                key={c.name}
                                type="button"
                                disabled={!!st?.busy || state === 'gone'}
                                onClick={() => baixarChain(e, c)}
                                title={
                                  state === 'gone'
                                    ? 'Esse arquivo já expirou do navegador e não tem resgate remoto'
                                    : state === 'remote'
                                      ? 'Re-baixa do HeyGen pelos IDs salvos (precisa da extensão + aba logada)'
                                      : `Baixar ${c.name}`
                                }
                                className={
                                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all active:scale-[0.96] disabled:cursor-not-allowed ' +
                                  (state === 'gone'
                                    ? 'border-line/50 text-text-dim opacity-60'
                                    : busy
                                      ? 'border-violet/50 text-violet'
                                      : isHg || state === 'remote'
                                        ? 'border-cyan/45 bg-cyan/10 text-cyan hover:bg-cyan/20'
                                        : 'border-lime/40 bg-lime/10 text-lime hover:bg-lime/20')
                                }
                                style={{ fontFamily: 'var(--font-tech)' }}
                              >
                                {busy ? (
                                  <span
                                    aria-hidden
                                    className="inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-current border-t-transparent"
                                  />
                                ) : (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M12 3v12" />
                                    <path d="m7 10 5 5 5-5" />
                                    <path d="M5 21h14" />
                                  </svg>
                                )}
                                {state === 'gone' ? `${c.label} · expirou` : c.label}
                              </button>
                            );
                          })}
                          {st?.msg ? (
                            <span className="mono text-[10.5px] text-text-muted">{st.msg}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {st?.err ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[54px]">
                          <p className="text-[11.5px] leading-relaxed text-amber-300/90">
                            {st.err}
                          </p>
                          {st.ofereceResgate && resgate ? (
                            <button
                              type="button"
                              onClick={() => baixarChain(e, resgate)}
                              className="rounded-full border border-cyan/45 bg-cyan/10 px-3 py-1 text-[11px] font-bold text-cyan transition hover:bg-cyan/20"
                              style={{ fontFamily: 'var(--font-tech)' }}
                            >
                              Resgatar do HeyGen
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
