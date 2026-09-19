'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PilotBtn3D } from '@/components/PilotCardActions';
import {
  buildChains,
  canonicalTool,
  backfillHistoryChannels,
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
  agruparPorVersao,
  consolidarCiclosDeDisparo,
  chainDeDownload,
  origemDoEvento,
  pedirAcaoEEsperar,
  podeVirarCard,
  rotuloVersaoDoTaskId,
  tituloVisivelDoHistorico,
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
import { getClickUpToken, getTask } from '@/lib/clickup-client';
import { idDoBoardParaCanal, resolverCanaisDaTask } from '@/lib/pilot-canais';
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

/** A janela de previews só entra no bundle quando alguém clica no olho. */
const PreviewsDoDisparo = dynamic(
  () => import('./PreviewsDoDisparo').then((m) => m.PreviewsDoDisparo),
  { ssr: false },
);

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
/** Contraste do texto no chip de canal — mesma regra do card do Pilot, pra o
 *  chip amarelo do KWAI não sair com texto branco ilegível. */
function corDoTextoNoChip(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}

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

/** As chaves de zip-store que estes registros apontam (o que perguntar). */
export function chavesZipDosEventos(events: HistoryEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    for (const r of e.ref ?? []) if (r.via === 'zip') out.push(r.key);
  }
  return out;
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
export function useDisponibilidade(ativo: boolean, chavesZip: string[] = []): Disponibilidade {
  const [vaultKeys, setVaultKeys] = useState<Set<string>>(new Set());
  const [zipKeys, setZipKeys] = useState<Set<string>>(new Set());
  const [vaultInfo, setVaultInfo] = useState<{ files: number; bytes: number } | null>(null);
  const emVoo = useRef(false);
  // As chaves mudam a cada render da lista; o ref evita refazer a consulta por
  // identidade de array (e evita recriar o refresh, que reinicia o efeito).
  const chavesRef = useRef<string[]>(chavesZip);
  chavesRef.current = chavesZip;

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
        // PERGUNTA SÓ PELO QUE ESTÁ NA TELA. Enumerar o store inteiro lia os
        // bytes de cada entrega guardada (GBs), estourava o timeout e fazia
        // TODO botão de baixar dizer "expirou" com o arquivo ali do lado.
        const { zipKeysExistentes } = await import('@/lib/zip-store');
        const achadas = await zipKeysExistentes(chavesRef.current);
        setZipKeys(achadas);
      } catch {}
      emVoo.current = false;
    })();
  }, []);

  // Assinatura das chaves: só refaz a consulta quando o conjunto muda de fato.
  const assinatura = chavesZip.join('|');
  useEffect(() => {
    if (!ativo) return;
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [ativo, refresh, assinatura]);

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
  /** Canal do AD (YOUTUBE/META/KWAI) guardado no registro do disparo. */
  canais: Record<string, Array<{ label: string; color: string }>>;
  agora: number;
};

export function useFilaAoVivo(ativo: boolean): FilaAoVivo {
  const [fila, setFila] = useState<FilaAoVivo>(() => ({ status: {}, inicio: {}, url: {}, canais: {}, agora: Date.now() }));

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | null = null;
    let atraso: ReturnType<typeof setTimeout> | null = null;

    const ler = () => {
      if (!vivo) return;
      try {
        const recs = readDurableRecords<
          RegistroDeFila & {
            startedAt?: number;
            taskUrl?: string;
            channels?: Array<{ label: string; color: string }>;
          }
        >('background');
        const status: Record<string, StatusDisparo | null> = {};
        const inicio: Record<string, number> = {};
        const url: Record<string, string> = {};
        const canais: Record<string, Array<{ label: string; color: string }>> = {};
        for (const [id, r] of Object.entries(recs)) {
          // Arquivo morto/rascunho/Hey Auto nunca viram card: manter no mapa
          // acenderia acao que a tela do Pilot nao tem como executar.
          if (!podeVirarCard(id)) continue;
          status[id] = statusDoDisparo(r);
          if (typeof r?.startedAt === 'number') inicio[id] = r.startedAt;
          if (typeof r?.taskUrl === 'string' && r.taskUrl) url[id] = r.taskUrl;
          if (Array.isArray(r?.channels) && r.channels.length) canais[id] = r.channels;
        }
        setFila({ status, inicio, url, canais, agora: Date.now() });
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
  const [previews, setPreviews] = useState<{ taskId: string; titulo: string } | null>(null);
  /** Versão escolhida em cada grupo de versões (chave do grupo -> id do evento). */
  const [versaoEscolhida, setVersaoEscolhida] = useState<Record<string, string>>({});
  /**
   * Menu de versões ABERTO: posição na tela e as irmãs.
   *
   * Vai em portal com posição fixa porque a lista rola dentro de um container
   * com overflow — ancorado na linha, o menu era cortado pela borda e aparecia
   * pela metade, em cima das outras linhas.
   */
  const [menuVersoes, setMenuVersoes] = useState<{
    chave: string;
    x: number;
    y: number;
    praCima: boolean;
    eventos: HistoryEvent[];
  } | null>(null);
  const filaReal = useFilaAoVivo(!filaDeTeste);
  const fila = filaDeTeste ?? filaReal;
  const router = useRouter();
  const confirmTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const canaisLegadosTentados = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timers = confirmTimer.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  /**
   * MIGRAÇÃO DO CANAL EM HISTÓRICOS ANTIGOS.
   *
   * Antes do snapshot de canal existir, a entrega pronta guardava arquivo e
   * taskId, mas não YOUTUBE/TIKTOK/META. O chip parecia funcionar enquanto a
   * fila viva ainda conhecia a task e sumia depois que ela era removida. Aqui
   * recuperamos primeiro do registro durável e, se necessário, fazemos apenas
   * GET da task no ClickUp. O resultado volta para o próprio evento e fica
   * sincronizado na conta; não é um remendo apenas visual desta sessão.
   */
  useEffect(() => {
    if (filaDeTeste) return;
    const faltantes = consolidarCiclosDeDisparo(events)
      .filter((evento) =>
        canonicalTool(evento.tool) === 'clickup-pilot' &&
        origemDoEvento(evento) === 'clickup' &&
        !evento.channels?.length,
      )
      .map(taskIdDoEvento)
      .filter((taskId): taskId is string => !!taskId && podeVirarCard(taskId));
    const taskIds = [...new Set(faltantes)].filter((taskId) => !canaisLegadosTentados.current.has(taskId));
    if (!taskIds.length) return;
    taskIds.forEach((taskId) => canaisLegadosTentados.current.add(taskId));

    void (async () => {
      const locais = readDurableRecords<{ channels?: Array<{ label: string; color: string }> }>('background');
      const resolvidos: Record<string, Array<{ label: string; color: string }>> = {};
      const aindaSemCanal: string[] = [];
      for (const taskId of taskIds) {
        const canais = locais[taskId]?.channels || locais[idDoBoardParaCanal(taskId)]?.channels;
        if (canais?.length) resolvidos[taskId] = canais;
        else aindaSemCanal.push(taskId);
      }
      if (Object.keys(resolvidos).length) await backfillHistoryChannels(resolvidos);
      if (!aindaSemCanal.length || !getClickUpToken()) return;

      // Uma task pode ter irmã `-yt`; uma única leitura da mãe repara as duas.
      const porTaskDoBoard = new Map<string, string[]>();
      for (const taskId of aindaSemCanal) {
        const boardId = idDoBoardParaCanal(taskId);
        porTaskDoBoard.set(boardId, [...(porTaskDoBoard.get(boardId) || []), taskId]);
      }
      const idsDoBoard = [...porTaskDoBoard.keys()];
      // Quatro GETs por rodada, com respiro entre rodadas, respeitam a API e
      // fazem os primeiros chips aparecerem em poucos segundos.
      for (let i = 0; i < idsDoBoard.length; i += 4) {
        const lote = idsDoBoard.slice(i, i + 4);
        const encontrados: Record<string, Array<{ label: string; color: string }>> = {};
        await Promise.all(lote.map(async (boardId) => {
          try {
            const canais = resolverCanaisDaTask(await getTask(boardId));
            if (!canais.length) return;
            for (const taskId of porTaskDoBoard.get(boardId) || []) encontrados[taskId] = canais;
          } catch {
            // Registro e tela continuam íntegros; uma próxima abertura tenta
            // novamente caso tenha sido uma indisponibilidade temporária.
            for (const taskId of porTaskDoBoard.get(boardId) || []) canaisLegadosTentados.current.delete(taskId);
          }
        }));
        if (Object.keys(encontrados).length) await backfillHistoryChannels(encontrados);
        if (i + 4 < idsDoBoard.length) await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    })().catch(() => {
      // Histórico é observabilidade: uma migração não pode derrubar a lista.
      for (const taskId of taskIds) canaisLegadosTentados.current.delete(taskId);
    });
  }, [events, filaDeTeste]);

  // Menu de versões fecha com ESC ou clique fora — nunca fica preso na tela.
  useEffect(() => {
    if (!menuVersoes) return;
    const fechar = () => setMenuVersoes(null);
    const noEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    const noClique = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      // O menu vive em portal: o clique nele (ou no proprio botao) nao fecha.
      if (alvo?.closest('.hist-versoes__menu, .hist-versoes__botao')) return;
      fechar();
    };
    document.addEventListener('keydown', noEsc);
    document.addEventListener('mousedown', noClique);
    // Posição fixa não acompanha rolagem: rolou, o menu fecha em vez de flutuar
    // solto longe do botão que o abriu.
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('keydown', noEsc);
      document.removeEventListener('mousedown', noClique);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [menuVersoes]);

  const groups = useMemo(() => {
    const porDia: { day: string; items: HistoryEvent[] }[] = [];
    // Começo + entrega pronta são um único ciclo da task. A consolidação roda
    // antes da divisão por dia para também cobrir renders que atravessam meia-noite.
    for (const e of consolidarCiclosDeDisparo(events)) {
      const day = dayLabel(e.t);
      const last = porDia[porDia.length - 1];
      if (last && last.day === day) last.items.push(e);
      else porDia.push({ day, items: [e] });
    }
    // As VERSÕES do mesmo AD viram uma linha só, com seletor — igual à fila do
    // Pilot, que também colapsa as irmãs num card.
    return porDia.map((d) => ({ day: d.day, grupos: agruparPorVersao(d.items) }));
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

  /**
   * ABRIR / REMONTAR / DEBUG — quem executa é a página da fila (Pilot).
   *
   * A gaveta só fecha quando a ferramenta CONFIRMA que fez. Se não deu (o card
   * não está nesta lista, o disparo saiu da fila), o motivo aparece na própria
   * linha em vez de o clique morrer calado.
   */
  async function acaoDeFila(
    ev: HistoryEvent,
    acao: 'retomar' | 'debug' | 'abrir',
    taskId: string,
  ): Promise<boolean> {
    patch(ev.id, { err: undefined, msg: 'Abrindo…' });
    const r = await pedirAcaoEEsperar(acao, taskId);
    if ('navegar' in r) {
      patch(ev.id, { msg: undefined });
      aoAgir?.();
      router.push(r.navegar);
      return true;
    }
    if (r.ok) {
      patch(ev.id, { msg: undefined });
      aoAgir?.();
      return true;
    }
    patch(ev.id, { msg: undefined, err: r.motivo });
    return false;
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
        <section key={g.day + (g.grupos[0]?.chave ?? "")}>
          <div className="hist-dia-linha">
            <h3 className="hist-dia">{g.day}</h3>
            <span className="hist-hairline" aria-hidden />
          </div>
          <ul className="hist-lista">
            {g.grupos.map((grupo) => {
              const escolhido = versaoEscolhida[grupo.chave];
              const e =
                (escolhido && grupo.eventos.find((x) => x.id === escolhido)) || grupo.eventos[0];
              const temVersoes = grupo.eventos.length > 1;
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
              // CANAL: o evento carrega o seu desde 18.09; disparo mais antigo
              // ainda tem o canal no registro da fila, então o chip aparece do
              // mesmo jeito enquanto a task estiver lá.
              const canais =
                (e.channels?.length ? e.channels : taskId ? fila.canais[taskId] : undefined) ?? [];
              const tituloVisivel = tituloVisivelDoHistorico(e.title);
              return (
                <li
                  key={grupo.chave}
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
                      <p className="hist-row__titulo" title={tituloVisivel}>
                        {tituloVisivel}
                      </p>
                      {/* CANAL do AD (YOUTUBE/META/KWAI). Fica gravado no
                          evento: a task já saiu do board quando alguém vem
                          olhar o histórico. */}
                      {canais.length ? (
                        <span className="hist-canais">
                          {canais.map((ch, i) => (
                            <span
                              key={`${ch.label}-${i}`}
                              className="hist-canal"
                              style={{
                                backgroundColor: ch.color,
                                color: corDoTextoNoChip(ch.color),
                              }}
                              title={`Canal: ${ch.label}`}
                            >
                              {ch.label}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      <span className="hist-selo" data-tom={selo.tom}>
                        {vivo?.ativo ? <i className="hist-selo__ponto" aria-hidden /> : null}
                        {selo.rotulo}
                      </span>
                      {temVersoes ? (
                        <button
                          type="button"
                          className={
                            'hist-versoes__botao' +
                            (menuVersoes?.chave === grupo.chave ? ' hist-versoes__botao--on' : '')
                          }
                          aria-haspopup="listbox"
                          aria-expanded={menuVersoes?.chave === grupo.chave}
                          title={`${grupo.eventos.length} versões deste AD`}
                          onClick={(ev) => {
                            if (menuVersoes?.chave === grupo.chave) {
                              setMenuVersoes(null);
                              return;
                            }
                            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                            const altura = Math.min(grupo.eventos.length, 6) * 34 + 16;
                            const praCima = r.bottom + altura > window.innerHeight - 16;
                            setMenuVersoes({
                              chave: grupo.chave,
                              x: r.left,
                              y: praCima ? r.top - 8 : r.bottom + 8,
                              praCima,
                              eventos: grupo.eventos,
                            });
                          }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="3" y="7" width="12" height="14" rx="2.5" />
                            <path d="M7 4h11a2 2 0 0 1 2 2v11" />
                          </svg>
                          {rotuloVersaoDoTaskId(taskId) || 'v1'}
                          <b>{grupo.eventos.length}</b>
                        </button>
                      ) : null}
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
                    {/* OLHO: abre a janela com os takes AQUI MESMO. Nada de
                        mandar o usuário pra outra tela pra ver o que ele fez. */}
                    {ehDisparo && taskId ? (
                      <PilotBtn3D
                        size={30}
                        color="fuchsia"
                        icon={<IcoOlho />}
                        title="Ver os takes deste disparo"
                        onClick={() => setPreviews({ taskId, titulo: tituloVisivel })}
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
                          onClick={() => void acaoDeFila(e, 'retomar', taskId)}
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
                          onClick={() => void acaoDeFila(e, 'debug', taskId)}
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

      {menuVersoes && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="listbox"
              aria-label="Versões deste AD"
              className={
                'hist-versoes__menu' + (menuVersoes.praCima ? ' hist-versoes__menu--cima' : '')
              }
              style={{
                left: menuVersoes.x,
                ...(menuVersoes.praCima
                  ? { bottom: Math.max(8, window.innerHeight - menuVersoes.y) }
                  : { top: menuVersoes.y }),
              }}
            >
              {menuVersoes.eventos.map((irma) => {
                const idIrma = taskIdDoEvento(irma);
                const st2 = idIrma ? fila.status[idIrma] ?? null : null;
                const marca = st2
                  ? { rotulo: st2.rotulo, tom: st2.tom }
                  : seloDoRegistro(irma.kind);
                const atual =
                  (versaoEscolhida[menuVersoes.chave] ?? menuVersoes.eventos[0].id) === irma.id;
                return (
                  <button
                    key={irma.id}
                    type="button"
                    role="option"
                    aria-selected={atual}
                    className={'hist-versoes__item' + (atual ? ' hist-versoes__item--on' : '')}
                    onClick={() => {
                      setVersaoEscolhida((p) => ({ ...p, [menuVersoes.chave]: irma.id }));
                      setMenuVersoes(null);
                    }}
                  >
                    <b>{rotuloVersaoDoTaskId(idIrma) || 'v1'}</b>
                    <span className="hist-versoes__estado" data-tom={marca.tom}>
                      {marca.rotulo}
                    </span>
                    <span className="hist-versoes__hora">{timeLabel(irma.t)}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}

      {previews ? (
        <PreviewsDoDisparo
          taskId={previews.taskId}
          titulo={previews.titulo}
          onClose={() => setPreviews(null)}
        />
      ) : null}
    </div>
  );
}
