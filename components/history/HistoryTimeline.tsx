'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildChains,
  canonicalTool,
  chainState,
  historyToolLabel,
  readHistory,
  type Chain,
  type ChainState,
  type HistoryEvent,
} from '@/lib/history';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconAutoCortes,
  IconCamuflagem,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
  IconFamousHey,
  IconHeyGenAuto,
  IconLipsync,
  IconLtxVideo,
  IconNormalizador,
  IconRemoverElementos,
  IconSeparadorAudio,
  IconTipografia,
} from '@/components/ToolIcons';

/**
 * TIMELINE DO HISTÓRICO — o miolo compartilhado.
 *
 * Existe UMA implementação de "listar registros e baixar de novo", usada por:
 *   - /tools/historico          (histórico geral, todas as ferramentas)
 *   - ToolHistoryPanel          (botão Histórico dentro de cada ferramenta)
 *
 * Duplicar isso era garantir divergência: um lado ganharia um conserto que o
 * outro não teria. Aqui moram a leitura ao vivo, a disponibilidade dos
 * arquivos (cofre + zip-store) e a cadeia de resgate do botão Baixar.
 */

const TOOL_ICON: Record<string, React.ReactNode> = {
  'clickup-pilot': <IconClickUpPilot size={20} />,
  'heygen-auto': <IconHeyGenAuto size={20} />,
  'auto-broll': <IconAutoBroll size={20} />,
  'auto-cortes': <IconAutoCortes size={20} />,
  lipsync: <IconLipsync size={20} />,
  decupagem: <IconDecupagem size={20} />,
  'decupagem-copy': <IconDecupageCopy size={20} />,
  'copy-srt': <IconCopySRT size={20} />,
  tipografia: <IconTipografia size={20} />,
  camuflagem: <IconCamuflagem size={20} />,
  compressor: <IconCompressor size={20} />,
  acelerador: <IconAcelerador size={20} />,
  'audio-split': <IconAudioSplit size={20} />,
  downloader: <IconDownloader size={20} />,
  fakepass: <IconFakePass size={20} />,
  'famous-hey': <IconFamousHey size={20} />,
  'ltx-video': <IconLtxVideo size={20} />,
  normalizador: <IconNormalizador size={20} />,
  'remover-elementos': <IconRemoverElementos size={20} />,
  'separador-audio': <IconSeparadorAudio size={20} />,
};

export function toolIcon(tool: string): React.ReactNode {
  return TOOL_ICON[canonicalTool(tool)] ?? <IconClickUpPilot size={20} />;
}

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  done: { label: 'PRONTO', cls: 'border-lime/35 bg-lime/10 text-lime' },
  export: { label: 'EXPORT', cls: 'border-violet/35 bg-violet/10 text-violet' },
  dispatch: { label: 'DISPARO', cls: 'border-cyan/35 bg-cyan/10 text-cyan' },
  download: { label: 'DOWNLOAD', cls: 'border-line-strong bg-bg/60 text-text-muted' },
};

export function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

export function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

// ---------- Hooks compartilhados ------------------------------------------

/**
 * Lê o histórico e mantém a lista viva: qualquer ferramenta que registra algo
 * dispara 'autoedit:history' (lib/history.ts) e a lista se atualiza sozinha —
 * inclusive com o painel aberto por cima da ferramenta que acabou de entregar.
 */
export function useHistoryEvents(debounceMs = 250): HistoryEvent[] {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let vivo = true;
    // DISJUNTOR: ler o histórico pode, num armazenamento local danificado,
    // fazer durable-records avisar a falha — e o aviso dispara o mesmo
    // 'autoedit:history' que manda ler de novo. Sem teto, isso viraria um
    // giro eterno em TODA ferramenta (o botão mora no layout). Passou do
    // teto na janela, este mount para de acompanhar ao vivo; a lista que já
    // está na tela continua servindo e um F5 recomeça limpo.
    const JANELA_MS = 10_000;
    const TETO = 60;
    let cargas = 0;
    let janela = Date.now();
    const load = () => {
      if (!vivo) return;
      const agora = Date.now();
      if (agora - janela > JANELA_MS) {
        janela = agora;
        cargas = 0;
      }
      cargas += 1;
      if (cargas > TETO) {
        vivo = false;
        return;
      }
      setEvents(readHistory());
    };
    // O evento 'autoedit:history' tambem e' disparado a cada gravacao de
    // registro (durable-records) — num disparo grande do Pilot isso e' MUITO
    // frequente. Reler e re-renderizar a cada tiro faria a instrumentacao
    // pesar na ferramenta; o agendamento com atraso junta a rajada num load.
    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, debounceMs);
    };
    load();
    window.addEventListener('autoedit:history', agendar);
    window.addEventListener('storage', agendar);
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('autoedit:history', agendar);
      window.removeEventListener('storage', agendar);
    };
  }, [debounceMs]);
  return events;
}

export type Disponibilidade = {
  vaultKeys: Set<string>;
  zipKeys: Set<string>;
  vaultInfo: { files: number; bytes: number } | null;
  refresh: () => void;
};

/**
 * Quais chaves ainda EXISTEM no navegador — é o que faz o botão dizer a
 * verdade ("baixar" × "expirou") antes do clique. Lê só METADADOS (o cofre tem
 * store separado pra isso: cursor sobre bytes já custou um boot de 70s aqui).
 */
export function useDisponibilidade(ativo: boolean): Disponibilidade {
  const [vaultKeys, setVaultKeys] = useState<Set<string>>(new Set());
  const [zipKeys, setZipKeys] = useState<Set<string>>(new Set());
  const [vaultInfo, setVaultInfo] = useState<{ files: number; bytes: number } | null>(null);
  const emVoo = useRef(false);

  const refresh = useCallback(() => {
    if (emVoo.current) return;
    emVoo.current = true;
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
      emVoo.current = false;
    })();
  }, []);

  useEffect(() => {
    if (!ativo) return;
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [ativo, refresh]);

  return { vaultKeys, zipKeys, vaultInfo, refresh };
}

// ---------- Timeline -------------------------------------------------------

type RowState = { busy?: string; msg?: string; err?: string; ofereceResgate?: boolean };

/**
 * Lista de registros agrupada por dia, com o botão Baixar por arquivo.
 *
 * `compacto` é o modo do painel dentro da ferramenta: linhas mais estreitas e
 * sem a coluna de ferramenta (lá todos os registros são da mesma).
 */
export function HistoryTimeline({
  events,
  disponibilidade,
  compacto = false,
  mostrarFerramenta = true,
}: {
  events: HistoryEvent[];
  disponibilidade: Disponibilidade;
  compacto?: boolean;
  mostrarFerramenta?: boolean;
}) {
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const groups = useMemo(() => {
    const out: { day: string; items: HistoryEvent[] }[] = [];
    for (const e of events) {
      const day = dayLabel(e.t);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events]);

  async function baixarChain(ev: HistoryEvent, chain: Chain) {
    const st = rowState[ev.id];
    if (st?.busy) return;
    const patch = (p: Partial<RowState>) =>
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
      const temResgate =
        (ev.ref ?? []).some((r) => r.via === 'heygen') &&
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
      disponibilidade.refresh();
    }
  }

  const recuo = compacto ? 'pl-[44px]' : 'pl-[54px]';

  return (
    <div className={'flex flex-col ' + (compacto ? 'gap-5' : 'gap-7 pb-4')}>
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
              const chains = buildChains(e.ref);
              const st = rowState[e.id];
              const resgate = chains.find((c) => c.refs.some((r) => r.via === 'heygen'));
              return (
                <li
                  key={e.id}
                  className={
                    'group rounded-[14px] border border-line/60 shadow-depth-1 transition-all duration-300 hover:-translate-y-px hover:border-violet/30 ' +
                    (compacto ? 'px-3.5 py-2.5' : 'px-4 py-3 md:px-5')
                  }
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.12)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                  }}
                >
                  <div className={'flex items-center ' + (compacto ? 'gap-3' : 'gap-3.5')}>
                    <span
                      className={
                        'flex shrink-0 items-center justify-center rounded-[11px] border border-line-strong bg-bg/50 ' +
                        (compacto ? 'h-8 w-8' : 'h-10 w-10')
                      }
                      aria-hidden
                    >
                      {toolIcon(e.tool)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          'truncate font-semibold text-text ' +
                          (compacto ? 'text-[12.5px]' : 'text-[13.5px]')
                        }
                        title={e.title}
                      >
                        {e.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-muted">
                        {mostrarFerramenta ? (
                          <span className="font-bold" style={{ fontFamily: 'var(--font-tech)' }}>
                            {historyToolLabel(e.tool)}
                          </span>
                        ) : null}
                        {e.meta ? (
                          <>
                            {mostrarFerramenta ? (
                              <span aria-hidden className="text-text-dim">
                                ·
                              </span>
                            ) : null}
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
                    <span className="mono shrink-0 text-[11px] text-text-dim">{timeLabel(e.t)}</span>
                  </div>

                  {/* Downloads: um botão por arquivo, com estado honesto */}
                  {chains.length > 0 ? (
                    <div className={'mt-2.5 flex flex-wrap items-center gap-2 ' + recuo}>
                      {chains.map((c) => {
                        const state: ChainState = chainState(c, disponibilidade);
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
                              'inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all active:scale-[0.96] disabled:cursor-not-allowed ' +
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
                                className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[2px] border-current border-t-transparent"
                              />
                            ) : (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="shrink-0"
                                aria-hidden
                              >
                                <path d="M12 3v12" />
                                <path d="m7 10 5 5 5-5" />
                                <path d="M5 21h14" />
                              </svg>
                            )}
                            <span className="truncate">
                              {state === 'gone' ? `${c.label} · expirou` : c.label}
                            </span>
                          </button>
                        );
                      })}
                      {st?.msg ? (
                        <span className="mono text-[10.5px] text-text-muted">{st.msg}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {st?.err ? (
                    <div className={'mt-2 flex flex-wrap items-center gap-2 ' + recuo}>
                      <p className="text-[11.5px] leading-relaxed text-amber-300/90">{st.err}</p>
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
  );
}
