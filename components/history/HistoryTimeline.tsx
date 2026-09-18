'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PilotBtn3D } from '@/components/PilotCardActions';
import {
  buildChains,
  canonicalTool,
  chainState,
  disparoNaFila,
  historyToolLabel,
  readHistory,
  removeHistoryEvent,
  type Chain,
  type HistoryEvent,
} from '@/lib/history';
import {
  aceitaAcaoDeFila,
  chainDeDownload,
  pedirAcaoDeFila,
  prefixosDoDisparo,
  taskIdDoEvento,
  temFilaDeDisparo,
} from '@/lib/history-acoes';
import {
  algumAtivo,
  resumoDeTakes,
  seloDoRegistro,
  statusDoDisparo,
  tempoCurto,
  type RegistroDeFila,
  type StatusDisparo,
} from '@/lib/history-fila';
import { readDurableRecords } from '@/lib/durable-records';
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
 * Existe UMA implementação de "listar o que foi feito e agir em cima", usada
 * por /tools/historico e pelo botão Histórico de cada ferramenta. Duplicar era
 * garantir divergência: um lado ganharia um conserto que o outro não teria.
 *
 * DESENHO (17.09, pedido do Silas: "menos textos, botão só ícone e animado"):
 * cada registro é uma linha limpa — marca colorida do estado, ícone da
 * ferramenta, o que foi feito, e os MESMOS botões do card pronto do Pilot
 * (baixar · remontar · debug · remover) em ícone, sem rótulo. Nada de texto
 * repetindo o que a cor e o ícone já dizem.
 */

const TOOL_ICON: Record<string, React.ReactNode> = {
  'clickup-pilot': <IconClickUpPilot size={18} />,
  'heygen-auto': <IconHeyGenAuto size={18} />,
  'auto-broll': <IconAutoBroll size={18} />,
  'auto-cortes': <IconAutoCortes size={18} />,
  lipsync: <IconLipsync size={18} />,
  decupagem: <IconDecupagem size={18} />,
  'decupagem-copy': <IconDecupageCopy size={18} />,
  'copy-srt': <IconCopySRT size={18} />,
  tipografia: <IconTipografia size={18} />,
  camuflagem: <IconCamuflagem size={18} />,
  compressor: <IconCompressor size={18} />,
  acelerador: <IconAcelerador size={18} />,
  'audio-split': <IconAudioSplit size={18} />,
  downloader: <IconDownloader size={18} />,
  fakepass: <IconFakePass size={18} />,
  'famous-hey': <IconFamousHey size={18} />,
  'ltx-video': <IconLtxVideo size={18} />,
  normalizador: <IconNormalizador size={18} />,
  'remover-elementos': <IconRemoverElementos size={18} />,
  'separador-audio': <IconSeparadorAudio size={18} />,
};

export function toolIcon(tool: string): React.ReactNode {
  return TOOL_ICON[canonicalTool(tool)] ?? <IconClickUpPilot size={18} />;
}

/** Estado do registro: vira COR (marca na lateral), nunca palavra. */
const KIND_ACCENT: Record<string, string> = {
  done: 'var(--hist-lime)',
  export: 'var(--hist-violet)',
  dispatch: 'var(--hist-cyan)',
  download: 'var(--hist-neutro)',
};

const KIND_TITULO: Record<string, string> = {
  done: 'Entrega pronta',
  export: 'Exportado',
  dispatch: 'Disparo',
  download: 'Download',
};

/**
 * Dentro da gaveta TODAS as linhas são da mesma ferramenta — repetir o ícone
 * dela 20 vezes é ruído. Ali o selo mostra o ESTADO do registro; na lista
 * geral, onde as ferramentas se misturam, ele mostra a ferramenta.
 */
const KIND_ICON: Record<string, React.ReactNode> = {
  done: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  export: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  ),
  dispatch: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  download: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="m5 12 7 7 7-7" />
    </svg>
  ),
};

// ---------- Ícones das ações (mesma família do card do Pilot) --------------

const IcoDownload = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
const IcoRefresh = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
    <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M3 21v-5h5" />
  </svg>
);
const IcoBug = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="6" width="8" height="14" rx="4" />
    <path d="M9 12H3M21 12h-6M9 8.5l-3-3M18 5.5l-3 3M9 15.5l-3 3M18 18.5l-3-3" />
  </svg>
);
const IcoX = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);
const IcoOlho = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IcoCheck = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 13 4 4L19 7" />
  </svg>
);
const Girando = ({ size = 15 }: { size?: number }) => (
  <span
    aria-hidden
    className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
    style={{ height: size, width: size }}
  />
);

// ---------- Rótulos de tempo e tamanho ------------------------------------

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
 * verdade (baixa × expirou) antes do clique. Lê só METADADOS (o cofre tem
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

/**
 * A FILA AO VIVO — o que faz o histórico acompanhar em vez de só lembrar.
 *
 * Enquanto um disparo trabalha, o card do Pilot e a linha do histórico leem o
 * MESMO registro de background. Aqui ele é lido de tempos em tempos e virado em
 * status; quando nada está em curso, a leitura para e só volta quando um
 * registro muda (o app avisa por evento).
 */
export type FilaAoVivo = {
  status: Record<string, StatusDisparo | null>;
  inicio: Record<string, number>;
  /** Link da task no ClickUp, quando o disparo guardou. */
  url: Record<string, string>;
  agora: number;
};

export function useFilaAoVivo(ativo: boolean): FilaAoVivo {
  const [fila, setFila] = useState<FilaAoVivo>(() => ({ status: {}, inicio: {}, url: {}, agora: Date.now() }));

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | null = null;
    let atraso: ReturnType<typeof setTimeout> | null = null;

    const ler = () => {
      if (!vivo) return;
      try {
        const recs = readDurableRecords<RegistroDeFila & { startedAt?: number; taskUrl?: string }>('background');
        const status: Record<string, StatusDisparo | null> = {};
        const inicio: Record<string, number> = {};
        const url: Record<string, string> = {};
        for (const [id, r] of Object.entries(recs)) {
          status[id] = statusDoDisparo(r);
          if (typeof r?.startedAt === 'number') inicio[id] = r.startedAt;
          if (typeof r?.taskUrl === 'string' && r.taskUrl) url[id] = r.taskUrl;
        }
        setFila({ status, inicio, url, agora: Date.now() });
        // Com trabalho em curso a barra precisa andar; parada a fila, ler de
        // novo seria puro desperdício (a leitura varre o armazenamento todo).
        if (relogio) clearTimeout(relogio);
        if (algumAtivo(status)) relogio = setTimeout(ler, 1200);
      } catch {
        /* instrumentação nunca derruba a tela */
      }
    };

    const agendar = () => {
      if (atraso) clearTimeout(atraso);
      atraso = setTimeout(ler, 400);
    };

    ler();
    window.addEventListener('autoedit:durable-records', agendar);
    window.addEventListener('autoedit:history', agendar);
    return () => {
      vivo = false;
      if (relogio) clearTimeout(relogio);
      if (atraso) clearTimeout(atraso);
      window.removeEventListener('autoedit:durable-records', agendar);
      window.removeEventListener('autoedit:history', agendar);
    };
  }, [ativo]);

  return fila;
}

// ---------- Timeline -------------------------------------------------------

type RowState = { busy?: 'baixar' | 'remover'; msg?: string; err?: string; confirmar?: boolean };

/**
 * Lista de registros agrupada por dia, com as ações de cada um.
 * `compacto` é o modo da gaveta dentro da ferramenta: linhas mais estreitas e
 * sem repetir o nome da ferramenta (lá todos os registros são da mesma).
 */
export function HistoryTimeline({
  events,
  disponibilidade,
  compacto = false,
  mostrarFerramenta = true,
  aoAgir,
  filaDeTeste,
}: {
  events: HistoryEvent[];
  disponibilidade: Disponibilidade;
  compacto?: boolean;
  mostrarFerramenta?: boolean;
  /** Chamado quando a ação leva o usuário pra outro lugar (a gaveta fecha). */
  aoAgir?: () => void;
  /** Só a página de preview dev-only passa isto (app/dev/historico-ferramenta). */
  filaDeTeste?: FilaAoVivo;
}) {
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const filaReal = useFilaAoVivo(!filaDeTeste);
  const fila = filaDeTeste ?? filaReal;
  const router = useRouter();
  const confirmTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = confirmTimer.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

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

  const patch = useCallback((id: string, p: Partial<RowState>) => {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }, []);

  /** BAIXAR — percorre a cadeia (cofre → zip → resgate) até achar os bytes. */
  async function baixar(ev: HistoryEvent, chain: Chain) {
    if (rowState[ev.id]?.busy) return;
    patch(ev.id, { busy: 'baixar', msg: undefined, err: undefined });
    try {
      const { recoverRef } = await import('@/lib/history-vault');
      let motivo = 'Arquivo não encontrado.';
      for (const r of chain.refs) {
        const res = await recoverRef(r, (m) => patch(ev.id, { msg: m }));
        if (res.ok) {
          patch(ev.id, { busy: undefined, msg: undefined, err: undefined });
          return;
        }
        motivo = res.reason;
      }
      patch(ev.id, { busy: undefined, msg: undefined, err: motivo });
    } catch (e) {
      patch(ev.id, { busy: undefined, msg: undefined, err: (e as Error)?.message || 'Falha inesperada.' });
    } finally {
      disponibilidade.refresh();
    }
  }

  /** ABRIR / REMONTAR / DEBUG — quem executa é a página da fila (Pilot). */
  function acaoDeFila(acao: 'retomar' | 'debug' | 'abrir', taskId: string) {
    const r = pedirAcaoDeFila(acao, taskId);
    aoAgir?.();
    if (r.modo === 'navegar') router.push(r.rota);
  }

  /**
   * REMOVER — dois toques. O primeiro arma (botão fica vermelho e vira ✓), o
   * segundo apaga o registro e os arquivos daquele disparo. Sem janela de
   * confirmação: menos texto na tela, e nada some com um toque só.
   */
  async function remover(ev: HistoryEvent) {
    const st = rowState[ev.id];
    if (st?.busy) return;
    if (!st?.confirmar) {
      patch(ev.id, { confirmar: true, err: undefined });
      clearTimeout(confirmTimer.current[ev.id]);
      confirmTimer.current[ev.id] = setTimeout(() => patch(ev.id, { confirmar: false }), 4000);
      return;
    }
    clearTimeout(confirmTimer.current[ev.id]);
    patch(ev.id, { busy: 'remover', confirmar: false });
    try {
      // 1. os bytes do cofre que só este registro apontava
      const chavesCofre = (ev.ref ?? []).filter((r) => r.via === 'vault').map((r) => r.key);
      if (chavesCofre.length > 0) {
        await import('@/lib/history-vault').then((v) => v.vaultDelete(chavesCofre)).catch(() => {});
      }
      // 2. o pacote do disparo no zip-store (montado/takes/partes)
      const taskId = taskIdDoEvento(ev);
      if (taskId && !disparoNaFila(taskId).rodando) {
        const zs = await import('@/lib/zip-store').catch(() => null);
        if (zs) for (const p of prefixosDoDisparo(taskId)) await zs.deletePrefix(p).catch(() => {});
      }
      // 3. o registro
      await removeHistoryEvent(ev.id);
    } catch (e) {
      patch(ev.id, { busy: undefined, err: (e as Error)?.message || 'Não consegui remover.' });
      return;
    }
    patch(ev.id, { busy: undefined });
    disponibilidade.refresh();
  }

  return (
    <div className={'flex flex-col ' + (compacto ? 'gap-5' : 'gap-7 pb-4')}>
      {groups.map((g) => (
        <section key={g.day + g.items[0].id}>
          <div className="hist-dia-linha">
            <h3 className="hist-dia">{g.day}</h3>
            <span className="hist-hairline" aria-hidden />
          </div>
          <ul className="hist-lista">
            {g.items.map((e) => {
              const st = rowState[e.id];
              const chains = buildChains(e.ref);
              const alvo = chainDeDownload(e, chains);
              const estado = alvo ? chainState(alvo, disponibilidade) : 'gone';
              const taskId = taskIdDoEvento(e);
              const ehDisparo = temFilaDeDisparo(e.tool) && !!taskId;
              const podeAgir = ehDisparo && !!taskId && aceitaAcaoDeFila(taskId);
              // Status AO VIVO: enquanto a task esta' na fila, a linha acompanha
              // o MESMO registro que o card do Pilot le'.
              const vivo = taskId ? fila.status[taskId] ?? null : null;
              const inicio = taskId ? fila.inicio[taskId] : undefined;
              const naFila = { existe: !!vivo, rodando: !!vivo?.ativo };
              const baixando = st?.busy === 'baixar';
              const removendo = st?.busy === 'remover';
              const acento = vivo?.ativo
                ? 'var(--hist-fuchsia)'
                : vivo?.fase === 'failed'
                  ? 'var(--hist-rose)'
                  : KIND_ACCENT[e.kind] ?? KIND_ACCENT.download;
              const corrido = vivo?.ativo && inicio ? tempoCurto(fila.agora - inicio) : '';
              const takes = resumoDeTakes(vivo);
              // SELO EM TODA LINHA: com a task na fila ele mostra a fase ao
              // vivo; sem ela, o estado do próprio registro. Linha sem selo do
              // lado de linha com selo lê como defeito, e é.
              const selo = vivo ? { rotulo: vivo.rotulo, tom: vivo.tom } : seloDoRegistro(e.kind);
              const linkTask = taskId ? fila.url[taskId] : undefined;
              const podeVer = (podeAgir && !!taskId && naFila.existe) || !!linkTask;
              return (
                <li
                  key={e.id}
                  className={
                    'hist-row' +
                    (compacto ? ' hist-row--compacta' : '') +
                    (vivo?.ativo ? ' hist-row--viva' : '')
                  }
                  style={{ ['--hist-accent' as string]: acento }}
                >
                  <span className="hist-row__marca" aria-hidden />
                  <span className="hist-row__icone" aria-hidden>
                    {vivo?.ativo ? (
                      <Girando size={15} />
                    ) : mostrarFerramenta ? (
                      toolIcon(e.tool)
                    ) : (
                      KIND_ICON[e.kind] ?? KIND_ICON.done
                    )}
                  </span>

                  <div className="hist-row__corpo">
                    <div className="hist-row__topo">
                      <p className="hist-row__titulo" title={e.title}>
                        {e.title}
                      </p>
                      <span className="hist-selo" data-tom={selo.tom}>
                        {vivo?.ativo ? <i className="hist-selo__ponto" aria-hidden /> : null}
                        {selo.rotulo}
                      </span>
                    </div>
                    <p className="hist-row__meta">
                      {mostrarFerramenta ? <span>{historyToolLabel(e.tool)}</span> : null}
                      {/* Rodando, o que importa e o ANDAMENTO (4/10 takes);
                          parado, o resumo da entrega (takes + tamanho). */}
                      {vivo?.ativo && takes ? (
                        <span>{takes}</span>
                      ) : e.meta ? (
                        <span>{e.meta}</span>
                      ) : takes ? (
                        <span>{takes}</span>
                      ) : null}
                      {corrido ? <span>{corrido}</span> : <span>{timeLabel(e.t)}</span>}
                    </p>
                    {vivo?.ativo ? (
                      <span
                        className="hist-barra"
                        role="progressbar"
                        aria-valuenow={vivo.pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <i style={{ width: `${vivo.pct}%` }} />
                      </span>
                    ) : null}
                  </div>

                  <div className="hist-row__acoes">
                    {podeVer ? (
                      <PilotBtn3D
                        size={30}
                        color="fuchsia"
                        icon={<IcoOlho />}
                        title={
                          podeAgir && taskId && naFila.existe
                            ? 'Ver a task: abre o card com os previews dos takes'
                            : 'Abrir a task no ClickUp'
                        }
                        onClick={() => {
                          if (podeAgir && taskId && naFila.existe) {
                            acaoDeFila('abrir', taskId);
                            return;
                          }
                          if (linkTask) window.open(linkTask, '_blank', 'noopener');
                        }}
                      />
                    ) : null}
                    <PilotBtn3D
                      size={30}
                      color={estado === 'gone' ? 'neutral' : baixando ? 'cyan' : 'lime'}
                      icon={baixando ? <Girando /> : <IcoDownload />}
                      disabled={!alvo || estado === 'gone' || !!st?.busy}
                      title={
                        !alvo
                          ? vivo?.ativo
                            ? 'O arquivo aparece aqui quando a montagem terminar'
                            : 'Esse registro não guardou arquivo pra baixar'
                          : estado === 'gone'
                            ? `${alvo.name} expirou do navegador (7 dias)`
                            : estado === 'remote'
                              ? `Resgatar do HeyGen: ${alvo.name}`
                              : `Baixar ${alvo.name}`
                      }
                      onClick={alvo ? () => void baixar(e, alvo) : undefined}
                    />
                    {podeAgir && taskId && naFila.existe && !vivo?.ativo ? (
                      <>
                        <PilotBtn3D
                          size={30}
                          color="cyan"
                          icon={<IcoRefresh />}
                          disabled={!naFila.existe || naFila.rodando || !!st?.busy}
                          title={
                            !naFila.existe
                              ? 'Esse disparo não está mais na fila do Pilot'
                              : naFila.rodando
                                ? 'Espere terminar pra remontar'
                                : 'Remontar no Pilot'
                          }
                          onClick={() => acaoDeFila('retomar', taskId)}
                        />
                        <PilotBtn3D
                          size={30}
                          color="violet"
                          icon={<IcoBug />}
                          disabled={!naFila.existe || naFila.rodando || !!st?.busy}
                          title={
                            !naFila.existe
                              ? 'Esse disparo não está mais na fila do Pilot'
                              : naFila.rodando
                                ? 'Espere terminar pra reiniciar'
                                : 'Reiniciar o disparo (pergunta se quer editar antes)'
                          }
                          onClick={() => acaoDeFila('debug', taskId)}
                        />
                      </>
                    ) : null}
                    {/* Enquanto gera, remover nao aparece: o disparo em curso nao
                        pode ser apagado, e botao travado so' ocupa espaco. */}
                    {vivo?.ativo ? null : (
                      <PilotBtn3D
                        size={30}
                        color={st?.confirmar ? 'rose' : 'neutral'}
                        icon={removendo ? <Girando size={13} /> : st?.confirmar ? <IcoCheck /> : <IcoX />}
                        disabled={!!st?.busy}
                        pulse={st?.confirmar}
                        title={
                          st?.confirmar
                            ? 'Confirmar: apaga o registro e os arquivos guardados'
                            : 'Remover do histórico'
                        }
                        onClick={() => void remover(e)}
                      />
                    )}
                  </div>

                  {st?.msg || st?.err ? (
                    <p className={'hist-row__recado ' + (st.err ? 'hist-row__recado--erro' : '')}>
                      {st.err ?? st.msg}
                    </p>
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
