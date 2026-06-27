'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHeroVideo } from '@/components/ToolHeroVideo';
import { DocImport3DButton } from '@/components/DocImport3DButton';
import { Toggle3DIcon } from '@/components/Toggle3DIcon';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import { Toggle3D } from '@/components/Toggle3D';
import { upsertSharedBatch } from '@/lib/heygen-batch-store';
import { extractAudio, muxAudioIntoVideo } from '@/lib/ffmpeg-worker';
import { camuflar } from '@/lib/camuflagem';
import {
  detectExtension,
  splitCopyIntoParts,
  testHeygenSession,
  type ExtensionStatus,
} from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerJob, type RunnerResult } from '@/lib/heygen-job-runner';
import {
  buildDisparosFromDoc,
  buildDisparosFromNomenclatures,
  type AvatarCandidate,
  type DiscoveredDisparo,
  type DisparoAvatar,
} from '@/lib/doc-to-disparos';
import type { DocLink } from '@/lib/copy-parser';
import { MotorConfigPicker } from '@/components/MotorConfigPicker';
import { defaultMotorConfig, resolveMotors, estimateSecondsFromText, estimateSecondsFromAudio, type MotorConfig } from '@/lib/motor-config';
import {
  heygenApiFetch,
  REQUIRED_EXT_VERSION,
  pollVideosUntilReady,
  downloadVideoBytes,
  type VideoStatus,
} from '@/lib/heygen-api-direct';
import {
  HeyGenAvatarPicker,
  type AvatarOption,
} from '@/components/HeyGenAvatarPicker';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { CompactVoiceSelector } from '@/components/CompactVoiceSelector';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { getLibrarySnapshot, reloadLibrary, subscribeLibrary } from '@/lib/heygen-library-cache';
import {
  HeyGenVoicePicker,
  type VoiceOption,
  type ClonedVoice,
} from '@/components/HeyGenVoicePicker';
import { TierGate } from '@/components/TierGate';
import { BatchJobCard3D, type BatchJob3DPhase } from '@/components/BatchJobCard3D';
import { EditPartModal } from '@/components/EditPartModal';

/**
 * Hey Auto Avatar — automacao do HeyGen sem API.
 *
 * Como funciona:
 *  1. User instala a extensao DARKO LAB (Chrome)
 *  2. Faz login no HeyGen normalmente
 *  3. Aqui na ferramenta: escolhe avatar (preview via API, lookup), motor,
 *     voz (default ou override), modo (copy ou audios)
 *  4. Cola copy ou faz upload das partes de audio
 *  5. Clica gerar — extensao automatiza o HeyGen no fundo, parte por parte
 *  6. Recebe ZIP com parte1.mp4, parte2.mp4, ... na ordem certa
 *
 * IMPORTANTE: a geracao via extensao NAO consome a API HeyGen — usa a
 * mensalidade do user. So previews (lookup avatar/voz) usam a API.
 */

type Motor = 'III' | 'IV' | 'V';
type Mode = 'copy' | 'audio';
type SessionTest = {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  detail?: string;
};

type PartResult = RunnerResult;

export default function HeyGenAutoPage() {
  return (
    <TierGate require="pro" toolName="Hey Auto">
      <HeyGenAutoInner />
    </TierGate>
  );
}

function HeyGenAutoInner() {
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    connected: false,
  });
  const [extLoading, setExtLoading] = useState(true);

  const [adName, setAdName] = useToolState<string>('hgauto:adName', '');
  const [motor, setMotor] = useToolState<Motor>('hgauto:motor', 'IV');
  // Motor config avancado (global/percent/individual) — sobrepoe `motor` se usado
  const [motorConfig, setMotorConfig] = useToolState<MotorConfig>('hgauto:motorConfig', { kind: 'global', motor: 'III' });
  const [mode, setMode] = useToolState<Mode>('hgauto:mode', 'copy');
  const [avatarQuery, setAvatarQuery] = useToolState<string>(
    'hgauto:avatarQuery',
    '',
  );
  const [selectedAvatar, setSelectedAvatar] = useToolState<AvatarOption | null>(
    'hgauto:avatar',
    null,
  );
  const [voiceQuery, setVoiceQuery] = useToolState<string>('hgauto:voiceQuery', '');
  const [selectedVoice, setSelectedVoice] = useToolState<VoiceOption | null>(
    'hgauto:voice',
    null,
  );
  const [overrideVoice, setOverrideVoice] = useToolState<boolean>(
    'hgauto:overrideVoice',
    false,
  );

  const [copy, setCopy] = useToolState<string>('hgauto:copy', '');
  const [audioParts, setAudioParts] = useState<File[]>([]);
  // Duracoes reais dos audios (lidas quando audioParts muda)
  const [audioPartsSeconds, setAudioPartsSeconds] = useState<number[]>([]);
  // Avatar First toggle (avatar nao existe na biblioteca, cria via foto+audio)
  const [avatarFirstEnabled, setAvatarFirstEnabled] = useState(false);

  /* ----- Inputs estruturados (multi-hook + body) — feature parity com clickup-pilot ----- */
  /** SEMPRE ativo. Inputs separados pra cada HOOK (1-10) + 1 BODY opcional.
   *  Cada hook vira 1 take. Body e splitado em ~20s pra cada take.
   *  Output final: 3 ZIPs igual clickup-pilot (takes individuais, montados
   *  HOOK[N]+BODY decupados, camuflados opcional). */
  // Hook: 1 áudio por hook (cada hook que você adicionar vira 1 take final).
  // Body: pode ter múltiplos áudios (parte1, parte2, parte3…) ordenados.
  type StructuredInput = { text: string; audio: File | null };
  const [structuredHooks, setStructuredHooks] = useState<StructuredInput[]>([
    { text: '', audio: null },
  ]);
  const [structuredBody, setStructuredBody] = useState<{
    enabled: boolean;
    text: string;
    audios: File[];
  }>({
    enabled: true,
    text: '',
    audios: [],
  });

  /** Áudios REAIS do modo estruturado (hooks + body), na mesma ordem que o
   *  run() monta os jobs. O `audioParts` legacy nunca é populado pelo UI
   *  estruturado — então o gate do botão e a prévia do motor TÊM que olhar
   *  aqui, senão `audioParts.length === 0` trava o disparo pra sempre. */
  const structuredAudioFiles = useMemo<File[]>(() => {
    const hookFiles = structuredHooks
      .map((h) => h.audio)
      .filter((f): f is File => !!f);
    const bodyFiles = structuredBody.enabled ? structuredBody.audios : [];
    return [...hookFiles, ...bodyFiles];
  }, [structuredHooks, structuredBody]);

  // Calcula duracoes reais dos audios em paralelo (prévia do motor). Usa os
  // áudios estruturados (hooks+body) que o run() realmente dispara; cai pro
  // audioParts legacy só se não houver estruturados.
  useEffect(() => {
    let cancelled = false;
    const files = structuredAudioFiles.length > 0 ? structuredAudioFiles : audioParts;
    if (files.length === 0) {
      setAudioPartsSeconds([]);
      return;
    }
    Promise.all(files.map((f) => estimateSecondsFromAudio(f))).then((durs) => {
      if (!cancelled) setAudioPartsSeconds(durs);
    });
    return () => { cancelled = true; };
  }, [audioParts, structuredAudioFiles]);

  /**
   * Ordena uma lista de Files por nome detectando "parte1, parte2, ..." ou
   * "part1, p1" etc. Se não detectar número, mantém ordem original (estável).
   */
  function sortAudiosByPartName(files: File[]): File[] {
    const re = /(?:parte|part|p)\s*[-_]?\s*(\d+)/i;
    return [...files].sort((a, b) => {
      const ma = re.exec(a.name);
      const mb = re.exec(b.name);
      if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
      if (ma && !mb) return -1;
      if (!ma && mb) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** ZIPs finais do pipeline pos-producao (montado/decupado/camuflado) */
  const [pipelineZips, setPipelineZips] = useState<{
    takesUrl?: string;
    takesName?: string;
    montadoUrl?: string;
    montadoName?: string;
    camufladoUrl?: string;
    camufladoName?: string;
    diagnosticMsg?: string;
  }>({});

  /* --------------- Modo Dinamico (multi-avatar por parte) --------------- */
  const [dynamicMode, setDynamicMode] = useToolState<boolean>(
    'hgauto:dynamic',
    false,
  );

  /* --------------- Decupagem (tesoura) — corta silêncios no montado --------- */
  /** Default ON pra preservar o comportamento antigo (era hardcoded true). */
  const [decupagemEnabled, setDecupagemEnabled] = useToolState<boolean>(
    'hgauto:decupagem',
    true,
  );
  /** INTENSIDADE do corte (keepSilence em s) — MESMO parâmetro da ferramenta
   *  /decupagem. Menor = mais agressivo. Repassado FIEL ao pipeline. Default
   *  0.12 = comportamento histórico (não muda nada de quem não toca). */
  const DEFAULT_KEEP_SILENCE = 0.12;
  const [decupIntensity, setDecupIntensityRaw] = useToolState<number>(
    'hgauto:decupIntensity',
    DEFAULT_KEEP_SILENCE,
  );
  const setDecupIntensity = (sec: number) =>
    setDecupIntensityRaw(Math.min(0.5, Math.max(0.01, Math.round(sec * 100) / 100)));

  /* --------------- Modo Camuflagem (3a pasta com audio camuflado) --------- */
  const [camuflagemMode, setCamuflagemMode] = useToolState<boolean>(
    'hgauto:camuflagem',
    false,
  );
  const [camuflagemWhite, setCamuflagemWhite] = useState<File | null>(null);
  const [camuflagemVolume, setCamuflagemVolume] = useToolState<number>(
    'hgauto:camuflagemVol',
    30,
  );
  // Per-part avatar override (null = usa selectedAvatar global). Indexado
  // pela posicao da parte (text: ordem do split; audio: ordem do array).
  const [partAvatars, setPartAvatars] = useState<(AvatarOption | null)[]>([]);
  // Permutacao dos audios em modo dinamico (audioParts mantem ordem original
  // do upload; audioOrder vira a permutacao de indices). Default = identidade.
  const [audioOrder, setAudioOrder] = useState<number[]>([]);

  const [clonedVoices, setClonedVoices] = useToolState<ClonedVoice[]>(
    'hgauto:clonedVoices',
    [],
  );
  const [sessionTest, setSessionTest] = useState<SessionTest>({ state: 'idle' });

  const [parts, setParts] = useState<string[]>([]);
  // Quando vem do ClickUp Pilot com partes ja parseadas (HOOK 1, HOOK 2, BODY),
  // bypassa o auto-split. Reset via "Limpar override" ou troca de copy/mode.
  const [forcedParts, setForcedParts] = useState<{ label: string; text: string }[] | null>(null);
  const [results, setResults] = useState<PartResult[]>([]);
  /** Início do disparo direto (pra elapsed no card estilo ClickUp Pilot). */
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  /** Edição de 1 parte (modo copy) — re-gera só aquele take, igual ClickUp Pilot. */
  const [editPart, setEditPart] = useState<{ idx: number; label: string; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);
  /** Id estavel desse run no store compartilhado de batches (espelho
   *  pro lipsync-history/background/painel + Retomar via motor). */
  const runBatchIdRef = useRef<string | null>(null);

  // Auto-download (polling + ZIP)
  const [downloading, setDownloading] = useState(false);
  const [downloadStage, setDownloadStage] = useState<string | null>(null);
  const [downloadStatuses, setDownloadStatuses] = useState<Record<string, VideoStatus>>({});
  const downloadCancelRef = useRef<boolean>(false);

  const safeName = (adName.trim() || 'heygen').replace(/[^a-z0-9_-]/gi, '_');

  /* ===================== Biblioteca HeyGen (candidatos p/ match) ===================== */
  const [librarySnap, setLibrarySnap] = useState(() => getLibrarySnapshot());
  useEffect(() => {
    const unsub = subscribeLibrary(() => setLibrarySnap({ ...getLibrarySnapshot() }));
    if (librarySnap.groups.length === 0 && !librarySnap.loading) {
      reloadLibrary(false);
    }
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const avatarCandidates: AvatarCandidate[] = useMemo(() => {
    const flat: AvatarCandidate[] = [];
    for (const g of librarySnap.groups) {
      for (const l of g.looks) {
        flat.push({
          id: l.id,
          name: l.name,
          groupName: g.name,
          voiceName: (l as any).voiceName ?? null,
          voiceId: (l as any).voiceId ?? null,
          thumb: l.thumb ?? null,
        });
      }
    }
    return flat;
  }, [librarySnap.groups]);

  /** Lookup AvatarOption (com thumb/voiceId) por id — pra resolver o avatar
   *  sugerido em cada slot do preview de import. */
  const avatarById = useMemo(() => {
    const m = new Map<string, AvatarOption>();
    for (const g of librarySnap.groups) {
      for (const l of g.looks) {
        m.set(l.id, {
          id: l.id,
          name: l.name,
          thumb: l.thumb,
          videoPreview: l.videoPreview,
          type: l.type,
          version: l.version,
          groupId: l.groupId,
          groupName: g.name,
          voiceId: (l as any).voiceId ?? null,
        });
      }
    }
    return m;
  }, [librarySnap.groups]);

  /* ===================== Fila de disparos (multi-disparo) ===================== */
  type QueuePart = {
    label: string;
    text?: string;
    audio?: File;
    avatarId?: string | null;
    avatarName?: string | null;
    voiceId?: string | null;
  };
  type QueueItem = {
    id: string;
    adName: string;
    safeName: string;
    mode: Mode;
    parts: QueuePart[];
    motor: Motor;
    decupagem: boolean;
    /** Intensidade do corte (keepSilence em s) capturada quando o item entrou
     *  na fila. Repassada FIELMENTE ao pipeline (keepSilenceSec). Default 0.12. */
    decupIntensity: number;
    source: 'manual' | 'doc';
    /** Nome da voz (override) pra exibir no card da fila — null = voz padrao do avatar. */
    voiceName?: string | null;
    unmatched?: string[];
    status: 'pending' | 'running' | 'done' | 'failed';
    message?: string;
    /** Progresso 0..100 + fase atual (pra barra de carregamento). */
    progress?: number;
    phase?: 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
    /** Id do batch no store compartilhado (chave dos ZIPs no IndexedDB). */
    batchId?: string;
    /** videoIds disparados — permite RETOMAR sem re-disparar (re-poll+download). */
    videoIds?: string[];
    /** Resultado por parte (pra Debug). */
    partResults?: { label: string; videoId: string | null; error: string | null }[];
    /** Nomes dos ZIPs salvos no disco (download quando pronto). */
    zips?: { takes?: string; montado?: string; camo?: string };
    /** Preview por take (loading → vídeo jogável), igual Auto B-roll. */
    takePreviews?: LipsyncTake[];
  };
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const queueCancelRef = useRef(false);
  /** Debug aberto por item (UI). */
  const [queueDebugOpen, setQueueDebugOpen] = useState<Record<string, boolean>>({});

  /* ===================== Modal de importar copy do Docs ===================== */
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docTab, setDocTab] = useState<'link' | 'file'>('link');
  const [docLink, setDocLink] = useState('');
  const [docText, setDocText] = useState('');
  const [docFileName, setDocFileName] = useState<string | null>(null);
  const [docFetching, setDocFetching] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<DiscoveredDisparo[] | null>(null);
  const [docSelected, setDocSelected] = useState<Record<string, boolean>>({});
  /** Nomenclaturas de AD digitadas pelo user (1 campo por AD). Quando ao menos
   *  1 esta preenchida, busca SO esses ADs no doc (igual nome de task do
   *  ClickUp Pilot). Vazias → auto-descobre todos os ADs do doc. */
  const [docAdNames, setDocAdNames] = useState<string[]>(['']);
  /** Toggle 3D "pegar todos": quando ON, ignora/bloqueia as nomenclaturas e
   *  identifica TODOS os ADs do doc automaticamente. */
  const [docAutoAll, setDocAutoAll] = useState(false);
  /** Slots de avatar por AD (agrupados por role/speaker) — permite trocar o
   *  avatar e a voz de cada speaker do AD antes de enfileirar (igual pilot).
   *  Key = baseAdId. */
  type DocSlot = {
    role: string; // chave de agrupamento (lowercase; '' = sem role)
    roleLabel: string; // exibicao
    avatarId: string | null;
    avatarName: string | null;
    defaultVoiceId: string | null; // voz padrao do avatar casado
    voiceOverride: { id: string; name: string } | null; // voz custom escolhida
    // Material do briefing pra UI casar o roleSlot do ClickUp Pilot:
    username: string | null; // @handle do avatar no doc
    briefingFileId: string | null; // Drive file ID → thumb + Baixar
    youtubeUrl: string | null; // avatar por link de YouTube (clone de voz)
    youtubeThumb: string | null; // thumb do video do YouTube
    autoMatched: boolean; // true = avatar casou automatico (false = pendente)
  };
  const [docSlots, setDocSlots] = useState<Record<string, DocSlot[]>>({});
  /** Tela cheia de analise (igual ClickUp Pilot) — abre apos "Analisar copy".
   *  O modal pequeno (docModalOpen) e SO pra importar; o resultado vem aqui. */
  const [docAnalysisOpen, setDocAnalysisOpen] = useState(false);
  /** Preview do texto (editavel) aberto por slot. Key = `${baseAdId}:${slotIdx}`. */
  const [docPreviewOpen, setDocPreviewOpen] = useState<Record<string, boolean>>({});
  /** Feedback do botao "Copiar todos os bodies". */
  const [copiedAllDocBodies, setCopiedAllDocBodies] = useState(false);

  /* --------------- Extension detection --------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await detectExtension();
      if (!cancelled) {
        setExtStatus(s);
        setExtLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------- Handoff de outras tools (ClickUp Pilot) --------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('from') !== 'clickup-pilot') return;
    const raw = sessionStorage.getItem('darkolab:heygen-auto:handoff');
    if (!raw) return;
    try {
      const h = JSON.parse(raw) as {
        adName?: string;
        motor?: 'III' | 'IV' | 'V';
        mode?: 'copy' | 'audio';
        copy?: string;
        dynamic?: boolean;
        partAvatarIds?: (string | null)[];
        partLabels?: string[];
        partTexts?: string[];
        /** ClickUp Pilot pode enviar voiceId por parte (override). Se any
         *  parte tem voiceId !== null, usa override mode no Hey Auto. */
        partVoiceIds?: (string | null)[];
      };
      if (h.adName) setAdName(h.adName);
      if (h.motor) setMotor(h.motor);
      if (h.mode) setMode(h.mode);
      if (h.copy) setCopy(h.copy);
      if (h.dynamic) setDynamicMode(true);
      // Forca partes EXATAS do parser (HOOK 1, HOOK 2, BODY) em vez de
      // re-split. Mantem mapping consistente com partAvatars.
      if (h.partTexts && h.partTexts.length > 0) {
        setForcedParts(
          h.partTexts.map((text, i) => ({
            label: h.partLabels?.[i] || `parte${i + 1}`,
            text,
          })),
        );
      }
      // Pre-popula partAvatars depois que groups loadarem (precisa do snapshot)
      if (h.partAvatarIds && h.partAvatarIds.length > 0) {
        const snap = getLibrarySnapshot();
        const buildFromIds = () => {
          const flat: AvatarOption[] = [];
          for (const g of getLibrarySnapshot().groups) {
            for (const l of g.looks) {
              flat.push({
                id: l.id,
                name: l.name,
                thumb: l.thumb,
                videoPreview: l.videoPreview,
                type: l.type,
                version: l.version,
                groupId: l.groupId,
                groupName: l.groupName,
                voiceId: (l as any).voiceId ?? null,
              });
            }
          }
          const mapped = (h.partAvatarIds || []).map((id, i) => {
            if (!id) return null;
            const av = flat.find((a) => a.id === id) || null;
            // ClickUp Pilot pode enviar voiceId override por parte. Quando
            // presente, sobrescreve o voiceId padrao do avatar pra ESSA parte.
            const overrideVoice = h.partVoiceIds?.[i];
            if (av && overrideVoice) {
              return { ...av, voiceId: overrideVoice };
            }
            return av;
          });
          setPartAvatars(mapped);
          // Selecionar o PRIMEIRO avatar como global (pra fallback de partes
          // sem avatar especifico)
          const firstWithAvatar = mapped.find((a) => a !== null);
          if (firstWithAvatar) setSelectedAvatar(firstWithAvatar);
        };
        if (snap.groups.length > 0) buildFromIds();
        else {
          reloadLibrary(false).then(() => buildFromIds());
        }
      }
      // Limpa handoff pra nao re-aplicar em refresh
      sessionStorage.removeItem('darkolab:heygen-auto:handoff');
    } catch (e) {
      console.warn('[heygen-auto] handoff parse falhou:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* (avatar + voice search delegados aos componentes compartilhados) */

  /* --------------- Parts preview (sempre estruturado) --------------- */
  useEffect(() => {
    if (mode !== 'copy') {
      setParts([]);
      return;
    }
    // Forced parts (do ClickUp Pilot) sobrescreve inputs estruturados.
    // Mantido pra compat — o handoff popula partTexts ja splitados.
    if (forcedParts && forcedParts.length > 0) {
      setParts(forcedParts.map((p) => p.text));
      return;
    }
    // Estruturado: parts = [HOOK 1, HOOK 2, ..., BODY split 1, BODY split 2, ...]
    const arr: string[] = [];
    for (const h of structuredHooks) {
      if (h.text.trim()) arr.push(h.text);
    }
    if (structuredBody.enabled && structuredBody.text.trim()) {
      arr.push(...splitCopyIntoParts(structuredBody.text, { targetSec: 20, minSec: 10, maxSec: 35 }));
    }
    setParts(arr);
  }, [mode, forcedParts, structuredHooks, structuredBody]);

  /* --------------- Resize dos arrays per-part quando count muda --------------- */
  useEffect(() => {
    const n = mode === 'copy' ? parts.length : audioParts.length;
    setPartAvatars((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
    setAudioOrder((prev) => {
      if (mode !== 'audio') return [];
      // Se contagem mudou, reseta pra ordem identidade
      if (prev.length !== audioParts.length) {
        return audioParts.map((_, i) => i);
      }
      return prev;
    });
  }, [mode, parts.length, audioParts.length]);

  /* --------- Auto-poll pós-disparo: os cards de preview preenchem sozinhos
   *  (igual ClickUp Pilot — você vê cada parte ficar pronta) sem precisar
   *  clicar Baixar. Só lê status (GET leve), não baixa nada. Para sozinho
   *  quando todos completam/falham, ou quando o download assume o poll. */
  useEffect(() => {
    if (processing || downloading) return;
    const ids = results.filter((r) => r.videoId).map((r) => r.videoId!);
    if (ids.length === 0) return;
    const pending = ids.filter((id) => {
      const s = downloadStatuses[id]?.status;
      return s !== 'completed' && s !== 'failed';
    });
    if (pending.length === 0) return;
    let cancelled = false;
    pollVideosUntilReady(ids, {
      intervalMs: 8000,
      timeoutMs: 30 * 60 * 1000,
      isCancelled: () => cancelled,
      onStatus: (st) => {
        if (!cancelled) setDownloadStatuses((prev) => ({ ...prev, ...st }));
      },
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // downloadStatuses fora das deps de proposito: o poll se atualiza sozinho
    // via onStatus; incluir reiniciaria o poll a cada tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, processing, downloading]);

  function cancel() {
    cancelRef.current = true;
    setStage('Cancelando...');
  }

  function cancelDownload() {
    downloadCancelRef.current = true;
    setDownloadStage('Cancelando...');
  }

  async function downloadAllAsZip() {
    const ready = results.filter((r) => r.videoId);
    if (ready.length === 0) {
      setError('Nenhuma parte com videoId. Gere as partes primeiro.');
      return;
    }
    setError(null);
    setDownloading(true);
    downloadCancelRef.current = false;
    setDownloadStatuses({});
    setDownloadStage(`Aguardando renderizacao no HeyGen (${ready.length} partes)...`);
    const bId = runBatchIdRef.current;
    if (bId) upsertSharedBatch(bId, { phase: 'downloading', message: 'Renderizando + baixando no HeyGen...' });

    try {
      const ids = ready.map((r) => r.videoId!) ;
      const final = await pollVideosUntilReady(ids, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        isCancelled: () => downloadCancelRef.current,
        onStatus: (statuses) => {
          setDownloadStatuses(statuses);
          const done = Object.values(statuses).filter((s) => s.status === 'completed').length;
          const failed = Object.values(statuses).filter((s) => s.status === 'failed').length;
          setDownloadStage(
            `Renderizando: ${done}/${ids.length} prontos${failed > 0 ? `, ${failed} falhou` : ''}...`,
          );
        },
      });

      if (downloadCancelRef.current) return;

      // Baixa cada video + zipa. Sequencial pra nao saturar download (videos sao grandes).
      // Mantem refs aos blobs em memoria pra rodar camuflagem apos zipar.
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const partBlobs: Array<{ label: string; blob: Blob | null }> = [];
      for (let i = 0; i < ready.length; i++) {
        if (downloadCancelRef.current) return;
        const part = ready[i];
        const status = final[part.videoId!];
        setDownloadStage(`Baixando parte ${i + 1}/${ready.length} (${part.label})...`);
        if (status?.status !== 'completed' || !status.videoUrl) {
          zip.file(`${part.label}_FAILED.txt`, `Status: ${status?.status || 'unknown'}\nErro: ${status?.error || 'sem video_url'}`);
          partBlobs.push({ label: part.label, blob: null });
          continue;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(`${part.label}.mp4`, bytes);
          partBlobs.push({ label: part.label, blob: new Blob([bytes as BlobPart], { type: 'video/mp4' }) });
        } catch (e) {
          zip.file(`${part.label}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message || e));
          partBlobs.push({ label: part.label, blob: null });
        }
      }

      // === TAKES: salva no IDB (histórico/Retomar) SEM auto-download ===
      // O user NÃO quer baixar a pasta de takes — só o montado mp4. Mantemos os
      // takes no disco (histórico + segurança do Retomar), mas não disparamos o
      // download do browser deles.
      setDownloadStage('Salvando takes (histórico)...');
      const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const takesName = `${safeName}_takes.zip`;
      if (bId) {
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${bId}:takes`, takesBlob, takesName);
          upsertSharedBatch(bId, { zipFilename: takesName });
        } catch (e) { console.warn('[heygen-auto] save takes IDB:', e); }
      }

      // === MONTAGEM (+ camuflagem no MESMO pipeline) ===
      // Entrega = o montado mp4 (HOOK+BODY concatenado, nivelado e decupado).
      // Com camuflagem ON, o pipeline também gera item.camuflado (o MONTADO com
      // áudio camuflado) → baixamos "montado + camuflado", nunca a pasta de takes.
      if (!partBlobs.some((p) => p.blob)) {
        setError('Nenhum take baixado com sucesso — nada pra montar.');
        return;
      }

      // White pra camuflagem (extrai áudio se for vídeo). Sem white, camuflagem
      // fica OFF e baixa só o montado.
      const camuActive = camuflagemMode && !!camuflagemWhite;
      let whiteForPipe: Blob | null = null;
      if (camuActive && camuflagemWhite) {
        whiteForPipe = camuflagemWhite;
        if ((camuflagemWhite.type || '').startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(camuflagemWhite.name)) {
          try { whiteForPipe = await extractAudio(camuflagemWhite); } catch { whiteForPipe = camuflagemWhite; }
        }
      }

      setDownloadStage('Montando HOOK+BODY decupado (pipeline)...');
      const { runPostPipeline } = await import('@/lib/clickup-pilot-pipeline');
      const pipeRes = await runPostPipeline({
        baseAdId: safeName,
        parts: partBlobs,
        decupagem: decupagemEnabled,
        keepSilenceSec: decupIntensity,
        camuflagem: camuActive,
        whiteAudio: whiteForPipe,
        camuflagemVolume,
        onProgress: (p) => {
          setDownloadStage(`${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}`);
        },
      });

      // Montados finais: decupado, ou montado completo (decupagem off / sem corte).
      const montados = pipeRes.items
        .filter((it) => !it.errors?.assemble)
        .map((it) => ({ name: it.filename, blob: it.decupado || it.rawAssembled }))
        .filter((m) => m.blob && m.blob.size > 0);
      const camuflados = camuActive
        ? pipeRes.items
            .filter((it) => it.camuflado && it.camuflado.size > 0)
            .map((it) => ({ name: it.filename.replace(/\.mp4$/i, '') + '_camuflado.mp4', blob: it.camuflado! }))
        : [];

      if (montados.length === 0) {
        setError(`Montagem falhou: ${pipeRes.diagnostics.summary}`);
        setDownloadStage(null);
        if (bId) upsertSharedBatch(bId, { phase: 'failed', message: `Montagem falhou: ${pipeRes.diagnostics.summary}`, finishedAt: Date.now() });
        return;
      }

      const triggerDownload = (b: Blob, name: string) => {
        const u = URL.createObjectURL(b);
        const el = document.createElement('a');
        el.href = u;
        el.download = name;
        document.body.appendChild(el);
        el.click();
        document.body.removeChild(el);
        setTimeout(() => URL.revokeObjectURL(u), 8000);
      };

      // Salva no IDB (histórico) + registra o nome no batch compartilhado.
      const persist = async (
        key: 'montado' | 'camo',
        b: Blob,
        name: string,
        field: 'montadoZipName' | 'camufladoZipName',
      ) => {
        if (!bId) return;
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${bId}:${key}`, b, name);
          if (field === 'montadoZipName') upsertSharedBatch(bId, { montadoZipName: name });
          else upsertSharedBatch(bId, { camufladoZipName: name });
        } catch (e) { console.warn(`[heygen-auto] save ${key} IDB:`, e); }
      };

      // 1 montado → mp4 direto; vários hooks → 1 zip só com os montados (sem takes).
      let savedMsg = '';
      if (montados.length === 1) {
        triggerDownload(montados[0].blob, montados[0].name);
        await persist('montado', montados[0].blob, montados[0].name, 'montadoZipName');
        savedMsg = montados[0].name;
      } else {
        const zMont = new JSZip();
        for (const m of montados) zMont.file(m.name, m.blob);
        const zb = await zMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        const zn = `${safeName}_montado.zip`;
        triggerDownload(zb, zn);
        await persist('montado', zb, zn, 'montadoZipName');
        savedMsg = zn;
      }

      // Camuflado só sai quando a camuflagem está ligada (montado + camuflado).
      if (camuActive && camuflados.length > 0) {
        if (camuflados.length === 1) {
          triggerDownload(camuflados[0].blob, camuflados[0].name);
          await persist('camo', camuflados[0].blob, camuflados[0].name, 'camufladoZipName');
          savedMsg += ` + ${camuflados[0].name}`;
        } else {
          const zCamu = new JSZip();
          for (const c of camuflados) zCamu.file(c.name, c.blob);
          const zb = await zCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
          const zn = `${safeName}_camuflado.zip`;
          triggerDownload(zb, zn);
          await persist('camo', zb, zn, 'camufladoZipName');
          savedMsg += ` + ${zn}`;
        }
      } else if (camuActive && camuflados.length === 0) {
        savedMsg += ' (camuflagem falhou — veja console)';
      }

      setPipelineZips((prev) => ({
        ...prev,
        montadoName: montados.length === 1 ? montados[0].name : `${safeName}_montado.zip`,
        diagnosticMsg: pipeRes.diagnostics.summary,
      }));
      setDownloadStage(`✓ Baixado: ${savedMsg}`);
      setTimeout(() => setDownloadStage(null), 8000);
      if (bId) upsertSharedBatch(bId, { phase: 'done', message: `Pronto — ${savedMsg}`, finishedAt: Date.now() });
    } catch (e) {
      setError(`Falha no download: ${(e as Error)?.message || e}`);
      setDownloadStage(null);
      if (bId) upsertSharedBatch(bId, { phase: 'failed', message: `Falha no download: ${(e as Error)?.message || e}`, finishedAt: Date.now() });
    } finally {
      setDownloading(false);
      if (bId && downloadCancelRef.current) {
        upsertSharedBatch(bId, { phase: 'failed', message: 'Cancelado pelo user (download).', finishedAt: Date.now() });
      }
      downloadCancelRef.current = false;
    }
  }

  async function testSession() {
    setSessionTest({ state: 'testing' });
    const r = await testHeygenSession();
    setSessionTest({
      state: r.ok ? 'ok' : 'fail',
      detail: r.detail,
    });
  }

  async function run() {
    if (!extStatus.connected) {
      setError(
        'Extensão Hey Auto não detectada. Instale primeiro (instrucoes abaixo).',
      );
      return;
    }
    if (!selectedAvatar) {
      setError('Selecione um avatar primeiro.');
      return;
    }

    // Checa versao da extensao via ping no proxy. Se < REQUIRED, force reload.
    setStage('Checando versao da extensao...');
    const ping = await heygenApiFetch({
      url: 'https://api2.heygen.com/v1/pacific/account.get',
      method: 'GET',
    });
    const detected = ping.body?._extVersion as string | undefined;
    if (!detected) {
      setError(
        `Extensao com proxy desatualizado (sem _extVersion). RECARREGUE a extensao em chrome://extensions (botão reload no card Hey Auto) e de refresh na aba do HeyGen. Versao requerida: ${REQUIRED_EXT_VERSION}.`,
      );
      setStage(null);
      return;
    }
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(detected);
    const b = parse(REQUIRED_EXT_VERSION);
    let ok = true;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x > y) break;
      if (x < y) { ok = false; break; }
    }
    if (!ok) {
      setError(
        `Extensao desatualizada: detectada v${detected}, requer >= v${REQUIRED_EXT_VERSION}. RECARREGUE em chrome://extensions e de refresh na aba do HeyGen.`,
      );
      setStage(null);
      return;
    }
    setStage(null);

    type JobEntry = {
      label: string;
      copy?: string;
      audio?: File;
      avatarId?: string;
      voiceId?: string;
    };
    let jobs: JobEntry[] = [];
    // Labels coerentes (HOOK 1, HOOK 2, BODY 1, ...) pra que o pipeline
    // pos-prod (runPostPipeline) saiba quem e hook vs body
    function makeStructuredLabel(idx: number): string {
      // Se handoff do clickup-pilot, ja vem labelado em forcedParts
      if (forcedParts && forcedParts.length > 0 && forcedParts[idx]) {
        return forcedParts[idx].label;
      }
      const hookCount = structuredHooks.filter((h) => mode === 'copy' ? h.text.trim() : !!h.audio).length;
      if (idx < hookCount) return `HOOK ${idx + 1}`;
      const bodyIdx = idx - hookCount;
      const totalParts = parts.length;
      const bodyTotal = totalParts - hookCount;
      if (bodyTotal === 1) return 'BODY';
      return `BODY ${bodyIdx + 1}`;
    }
    if (mode === 'copy') {
      if (parts.length === 0) {
        setError('Preenche pelo menos 1 HOOK.');
        return;
      }
      // Voz default = a voz original do avatar (lookup automatico no
      // processJob). So passamos voiceId quando o user marcou "substituir".
      if (overrideVoice && !selectedVoice) {
        setError(
          'Voce marcou "substituir voz" mas nao escolheu uma voz. Escolhe uma ou desmarca.',
        );
        return;
      }
      jobs = parts.map((p, i) => {
        const partAvatar = dynamicMode ? partAvatars[i] : null;
        const effectiveAvatar = partAvatar || selectedAvatar;
        return {
          label: makeStructuredLabel(i),
          copy: p,
          // Modo dinamico: cada parte usa seu avatar (com voiceId predefinido)
          avatarId: dynamicMode ? effectiveAvatar?.id : undefined,
          voiceId:
            dynamicMode && !overrideVoice
              ? (effectiveAvatar?.voiceId || undefined)
              : undefined,
        };
      });
    } else {
      // Modo audio: cada hook = 1 audio; body = múltiplos audios em ordem
      const hookFiles = structuredHooks
        .map((h) => h.audio)
        .filter((f): f is File => !!f);
      const bodyFiles = structuredBody.enabled ? structuredBody.audios : [];
      if (hookFiles.length === 0 && bodyFiles.length === 0) {
        setError('Faça upload de pelo menos 1 áudio (hook ou body).');
        return;
      }

      jobs = [];
      // Hooks: 1 audio = 1 take "HOOK N" (igual ao comportamento original)
      hookFiles.forEach((file, i) => {
        jobs.push({
          label: `HOOK ${i + 1}`,
          audio: file,
          avatarId: dynamicMode ? selectedAvatar?.id : undefined,
        });
      });
      // Body: múltiplos audios em ordem; cada um vira "BODY · parte N"
      // (ou só "BODY" se for 1)
      bodyFiles.forEach((file, partIdx) => {
        const label =
          bodyFiles.length === 1 ? 'BODY' : `BODY · parte ${partIdx + 1}`;
        jobs.push({
          label,
          audio: file,
          avatarId: dynamicMode ? selectedAvatar?.id : undefined,
        });
      });
    }

    cancelRef.current = false;
    setError(null);
    setResults([]);
    setRunStartedAt(Date.now());
    setProcessing(true);

    // Espelho no store compartilhado (lipsync-history/background/painel)
    const batchId = `heygenauto:${safeName}:${Date.now()}`;
    runBatchIdRef.current = batchId;
    const mirrorParts = (collected: PartResult[]) =>
      jobs.map((j, i) => {
        const rr = collected.find((c) => c.index === i + 1);
        return {
          label: j.label,
          videoId: rr?.videoId ?? null,
          error: rr?.error ?? null,
          renamedTo: `${j.label}.mp4`,
        };
      });
    upsertSharedBatch(batchId, {
      taskName: safeName,
      baseAdId: safeName,
      phase: 'dispatching',
      parts: mirrorParts([]),
      startedAt: Date.now(),
      message: 'Disparando partes no HeyGen (heygen-auto)...',
    });

    try {
      // Motor por job: usa motorConfig se ativo, senao cai pro motor global legacy
      const motorsPerPart = resolveMotors(motorConfig, jobs.length, {
        slotIds: jobs.map((j) => j.label),
        seed: safeName,
      });
      console.log(`[heygen-auto] motor config (${motorConfig.kind}): ${motorsPerPart.join(', ')}`);
      const jobsWithMotor = jobs.map((j, i) => ({ ...j, motor: motorsPerPart[i] }));

      const collected: PartResult[] = [];
      const finalResults = await runHeyGenJobs(jobsWithMotor, {
        parallel: 3,
        mode,
        avatarId: selectedAvatar.id,
        voiceId:
          mode === 'copy' && overrideVoice && selectedVoice
            ? selectedVoice.id
            : (selectedAvatar.voiceId || undefined),
        motor: motorConfig.kind === 'global' ? motorConfig.motor : motor, // fallback per-job vence
        adNameSafe: safeName,
        isCancelled: () => cancelRef.current,
        onProgress: (msg) => setStage(msg),
        onResult: (r) => {
          collected.push(r);
          setResults([...collected].sort((a, b) => a.index - b.index));
          upsertSharedBatch(batchId, { parts: mirrorParts(collected) });
        },
      });
      setResults([...finalResults].sort((a, b) => a.index - b.index));
      setStage(null);
      const okCount = finalResults.filter((r) => r.videoId).length;
      upsertSharedBatch(batchId, {
        phase: okCount > 0 ? 'rendering' : 'failed',
        parts: mirrorParts(finalResults),
        message:
          okCount > 0
            ? `${okCount}/${finalResults.length} disparados — clique "Baixar tudo" pra renderizar/baixar, ou Retomar depois.`
            : 'Todos os disparos falharam (cota/limite HeyGen?). Use Retomar.',
        ...(okCount > 0 ? {} : { finishedAt: Date.now() }),
      });
    } catch (e) {
      setError((e as Error).message ?? 'Falha desconhecida.');
      setStage(null);
      upsertSharedBatch(batchId, {
        phase: 'failed',
        message: (e as Error).message ?? 'Falha desconhecida.',
        finishedAt: Date.now(),
      });
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  }

  /* --------- Editar/re-gerar 1 parte (modo copy), igual ClickUp Pilot --------- */
  function openEditPart(idx: number) {
    setEditPart({
      idx,
      label: results[idx]?.label || `parte${idx + 1}`,
      text: parts[idx] ?? '',
    });
    setEditError(null);
  }

  /** Re-dispara SÓ a parte editada no HeyGen (mantém o label/posição), troca o
   *  videoId no results e invalida o montado — o próximo Baixar re-monta com o
   *  take novo. Avatar/voz seguem os mesmos da parte (não muda continuidade). */
  async function regeneratePart(newText: string) {
    if (!editPart) return;
    const idx = editPart.idx;
    const av = (dynamicMode ? partAvatars[idx] : null) || selectedAvatar;
    if (!av) {
      setEditError('Selecione um avatar antes.');
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const motorsPerPart = resolveMotors(motorConfig, results.length, {
        slotIds: results.map((r) => r.label),
        seed: safeName,
      });
      const voiceId = overrideVoice && selectedVoice ? selectedVoice.id : av.voiceId || undefined;
      const res = await runHeyGenJobs(
        [{ label: editPart.label, copy: newText, avatarId: av.id, voiceId, motor: motorsPerPart[idx] || motor }],
        {
          parallel: 1,
          mode: 'copy',
          avatarId: av.id,
          voiceId,
          motor: motorConfig.kind === 'global' ? motorConfig.motor : motor,
          adNameSafe: safeName,
          isCancelled: () => false,
          onProgress: () => {},
          onResult: () => {},
        },
      );
      const r0 = res[0];
      if (!r0?.videoId) throw new Error(r0?.error || 'Falha ao re-gerar a parte no HeyGen.');
      const oldId = results[idx]?.videoId;
      setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, videoId: r0.videoId, error: null } : r)));
      if (oldId) {
        setDownloadStatuses((prev) => {
          const { [oldId]: _drop, ...rest } = prev;
          return rest;
        });
      }
      // Montado vira stale: força re-montagem no próximo Baixar.
      setPipelineZips((prev) => ({ ...prev, montadoName: undefined }));
      setEditPart(null);
    } catch (e) {
      setEditError((e as Error)?.message || 'Falha ao re-gerar.');
    } finally {
      setEditBusy(false);
    }
  }

  /* ===================== Importar copy do Docs (link/arquivo) ===================== */

  /**
   * Busca o Google Doc PELA EXTENSAO (mesma estrategia do ClickUp Pilot):
   * a extensao roda no navegador logado e consegue ler docs PRIVADOS que voce
   * tem acesso. Postamos HG_FETCH_DOC e esperamos HG_DOC_RESULT. Fallback
   * (server /api/docs/fetch) so le docs publicos. Requer extensao v4.0.15+.
   */
  function fetchDocViaExtensionOnce(
    url: string,
  ): Promise<{ ok: boolean; text?: string; error?: string; transient?: boolean; driveLinks?: DocLink[] }> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Sem window.' });
        return;
      }
      const requestId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // Timeout em DOIS estagios (extensao v4.16.2+ manda HG_DOC_ACK assim
      // que o background aceita o job): sem ACK em 30s → extensao morta →
      // erro transient; com ACK → background lendo (export+fallback ~45s
      // pior caso) → janela total 90s. Antes a page desistia em 30s
      // enquanto o doc ainda chegava.
      let acked = false;
      let done = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finish = (r: { ok: boolean; text?: string; error?: string; transient?: boolean; driveLinks?: DocLink[] }) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', handler);
        timers.forEach(clearTimeout);
        resolve(r);
      };
      const handler = (ev: MessageEvent) => {
        if (ev.data?.source !== 'darkolab-ext' || ev.data?.requestId !== requestId) return;
        if (ev.data?.type === 'HG_DOC_ACK') { acked = true; return; }
        if (ev.data?.type === 'HG_DOC_RESULT') {
          const error = ev.data.error ? String(ev.data.error) : undefined;
          // driveLinks = smart-chips de Drive/YouTube capturados pela extensao —
          // habilita thumb + Baixar + avatar por link (igual ClickUp Pilot).
          finish({
            ok: !!ev.data.ok,
            text: ev.data.text,
            error,
            driveLinks: Array.isArray(ev.data.driveLinks) ? (ev.data.driveLinks as DocLink[]) : undefined,
            transient: !ev.data.ok && !!error && !/permiss|nao existe|não existe|privado/i.test(error),
          });
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ source: 'darkolab', type: 'HG_FETCH_DOC', requestId, url }, '*');
      timers.push(setTimeout(() => {
        if (!acked) finish({ ok: false, transient: true, error: 'Extensao nao respondeu em 30s — recarregue esta pagina (F5). Se persistir, baixe a extensao atual em /api/extension/download e recarregue em chrome://extensions.' });
      }, 30000));
      timers.push(setTimeout(() => {
        finish({ ok: false, transient: true, error: 'Timeout 90s lendo o doc (Google lento ou doc gigante) — tente de novo.' });
      }, 90000));
    });
  }

  /** Doc fetch com retry automatico: ate 3 tentativas pra erro transient
   *  (timeout, glitch de rede, service worker dormindo). Erro definitivo
   *  (sem permissao / doc nao existe) falha direto sem retry. */
  async function fetchDocViaExtension(
    url: string,
  ): Promise<{ ok: boolean; text?: string; error?: string; driveLinks?: DocLink[] }> {
    let last: { ok: boolean; text?: string; error?: string; transient?: boolean; driveLinks?: DocLink[] } = { ok: false, error: 'sem tentativa' };
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = await fetchDocViaExtensionOnce(url);
      if (last.ok || !last.transient) return last;
      console.warn(`[doc-fetch] tentativa ${attempt}/3 falhou (${last.error}) — retry em 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    return last;
  }

  /** Extrai texto puro de um arquivo. Suporta .txt (texto direto) e .docx
   *  (descompacta word/document.xml via JSZip e extrai os runs <w:t>). */
  async function extractTextFromFile(file: File): Promise<string> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) {
      // Decodifica entidades XML: numericas (&#8220; aspas curvas do Docs,
      // &#x2014; etc) + nomeadas. &amp; por ULTIMO pra nao re-decodificar.
      const decodeXml = (s: string) =>
        s
          .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&');
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const xml = await zip.file('word/document.xml')?.async('string');
      if (!xml) throw new Error('Arquivo .docx invalido (sem word/document.xml).');
      const paras = xml.split(/<\/w:p>/).map((seg) => {
        // <w:tab/> vira tab; <w:br/> e <w:cr/> viram quebra DENTRO do paragrafo
        const withBreaks = seg
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n');
        const runs = [...withBreaks.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
        return runs.join('');
      });
      return decodeXml(paras.join('\n'));
    }
    // .txt / colado / outros formatos de texto
    return await file.text();
  }

  /** Agrupa as partes de um AD em slots de avatar (1 por role/speaker) e junta
   *  o material do briefing (thumb/Baixar/@username/pendente) de d.avatars —
   *  espelha o roleSlot do ClickUp Pilot. */
  function buildSlotsForDisparo(d: DiscoveredDisparo): DocSlot[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const p of d.parts) {
      const key = (p.role || '').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
    const avatars = d.avatars || [];
    // Acha o avatar do briefing que casa esse slot: por roleKey exato, depois
    // fuzzy (um contem o outro), depois single (1 avatar/1 slot), por fim por
    // avatarId ja casado.
    const findAvatar = (key: string, avatarId: string | null): DisparoAvatar | undefined => {
      if (key) {
        const exact = avatars.find((a) => a.roleKey === key);
        if (exact) return exact;
        const fuzzy = avatars.find(
          (a) => a.roleKey && (a.roleKey.includes(key) || key.includes(a.roleKey)),
        );
        if (fuzzy) return fuzzy;
      }
      if (order.length === 1 && avatars.length >= 1) return avatars[0];
      if (avatarId) {
        const byId = avatars.find((a) => a.matchedAvatarId === avatarId);
        if (byId) return byId;
      }
      return undefined;
    };
    return order.map((key, idx) => {
      const part = d.parts.find((p) => (p.role || '').toLowerCase() === key)!;
      const info = findAvatar(key, part.avatarId);
      return {
        role: key,
        roleLabel:
          info?.role || part.role || (order.length === 1 ? 'Avatar' : `Avatar ${idx + 1}`),
        avatarId: part.avatarId,
        avatarName: part.avatarName,
        defaultVoiceId: part.voiceId,
        voiceOverride: null,
        username: info?.username ?? null,
        briefingFileId: info?.briefingFileId ?? null,
        youtubeUrl: info?.youtubeUrl ?? null,
        youtubeThumb: info?.youtubeThumb ?? null,
        autoMatched: !!part.avatarId,
      };
    });
  }

  function updateDocSlot(baseAdId: string, slotIdx: number, patch: Partial<DocSlot>) {
    setDocSlots((prev) => ({
      ...prev,
      [baseAdId]: (prev[baseAdId] || []).map((s, i) => (i === slotIdx ? { ...s, ...patch } : s)),
    }));
  }

  /** Remove um slot de avatar inteiro (some do disparo). */
  function removeDocSlot(baseAdId: string, slotIdx: number) {
    setDocSlots((prev) => ({
      ...prev,
      [baseAdId]: (prev[baseAdId] || []).filter((_, i) => i !== slotIdx),
    }));
  }

  /** Edita o texto EXATO de uma parte (HOOK/BODY) antes do disparo — igual o
   *  textarea editavel do preview por avatar no ClickUp Pilot. */
  function updateDocPartText(baseAdId: string, partIdx: number, text: string) {
    setDocPreview((prev) =>
      prev
        ? prev.map((d) =>
            d.baseAdId === baseAdId
              ? { ...d, parts: d.parts.map((p, i) => (i === partIdx ? { ...p, text } : p)) }
              : d,
          )
        : prev,
    );
  }

  /** Exclui uma parte (nao vira take no HeyGen) — pra tirar lixo de producao. */
  function removeDocPart(baseAdId: string, partIdx: number) {
    setDocPreview((prev) =>
      prev
        ? prev.map((d) =>
            d.baseAdId === baseAdId
              ? { ...d, parts: d.parts.filter((_, i) => i !== partIdx) }
              : d,
          )
        : prev,
    );
  }

  /** Copia o BODY de todos os ADs selecionados, identificado por AD (igual o
   *  "Copiar todos os bodies" do ClickUp Pilot). */
  async function copyAllDocBodies() {
    if (!docPreview) return;
    const blocks: string[] = [];
    for (const d of docPreview) {
      if (!docSelected[d.baseAdId]) continue;
      const body = d.parts
        .filter((p) => /^BODY/i.test(p.label))
        .map((p) => p.text || '')
        .join(' ')
        .trim();
      if (body) blocks.push(`### ${d.baseAdId}\n${body}`);
    }
    if (blocks.length === 0) return;
    try {
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      setCopiedAllDocBodies(true);
      setTimeout(() => setCopiedAllDocBodies(false), 2000);
    } catch {}
  }

  /** Analisa o doc (busca o link OU usa o texto importado), roda a inteligencia
   *  do ClickUp Pilot e gera o preview de disparos. */
  async function parseDocAndPreview() {
    setDocError(null);
    setDocPreview(null);
    let text = docText;
    // Smart-chips (Drive/YouTube) capturados pela extensao — habilitam thumb +
    // Baixar + avatar por link, mesma capacidade do ClickUp Pilot.
    let docLinks: DocLink[] = [];
    if (docTab === 'link') {
      if (!docLink.trim()) {
        setDocError('Cole o link do Google Docs (compartilhado como "qualquer pessoa com o link").');
        return;
      }
      setDocFetching(true);
      try {
        // 1) Extensao primeiro — le docs PRIVADOS com a sessao logada do
        //    navegador (igual ClickUp Pilot).
        const extR = await fetchDocViaExtension(docLink.trim());
        if (extR.ok && extR.text) {
          text = extR.text;
          docLinks = extR.driveLinks || [];
          setDocText(text);
        } else {
          // 2) Fallback servidor (so docs publicos).
          const r = await fetch(`/api/docs/fetch?url=${encodeURIComponent(docLink.trim())}`);
          const j = await r.json();
          if (!j.ok) {
            setDocError(
              `${j.error || 'Falha ao buscar o doc.'}${
                extR.error ? ` · extensão: ${extR.error}` : ''
              }`,
            );
            return;
          }
          text = j.text || '';
          setDocText(text);
        }
      } catch (e) {
        setDocError(`Falha ao buscar: ${(e as Error)?.message}`);
        return;
      } finally {
        setDocFetching(false);
      }
    }
    if (!text.trim()) {
      setDocError(docTab === 'file' ? 'Importe um arquivo .txt ou .docx primeiro.' : 'Doc vazio.');
      return;
    }
    // Garante biblioteca carregada pra casar avatares. Se vazia, FORCA reload
    // (full fetch) — senao alguns avatares ficam sem candidato e caem em fallback.
    if (avatarCandidates.length === 0) {
      setDocFetching(true);
      try {
        await reloadLibrary(true);
      } catch {}
      setDocFetching(false);
    }
    const snapCandidates: AvatarCandidate[] =
      avatarCandidates.length > 0
        ? avatarCandidates
        : getLibrarySnapshot().groups.flatMap((g) =>
            g.looks.map((l) => ({
              id: l.id,
              name: l.name,
              groupName: g.name,
              voiceName: (l as any).voiceName ?? null,
              voiceId: (l as any).voiceId ?? null,
              thumb: l.thumb ?? null,
            })),
          );
    // Nomenclaturas digitadas pelo user → busca SO esses ADs (igual nome de
    // task do ClickUp Pilot). Nenhuma preenchida (ou toggle "pegar todos"
    // ligado) → auto-descobre TODOS os ADs do doc.
    const names = docAutoAll ? [] : docAdNames.map((s) => s.trim()).filter(Boolean);
    let disparos: DiscoveredDisparo[];
    if (names.length > 0) {
      const r = buildDisparosFromNomenclatures(text, names, snapCandidates, docLinks);
      if (r.disparos.length === 0) {
        setDocError(r.diagnostic);
        return;
      }
      // Achou alguns mas faltaram outros → mostra preview + avisa quais faltaram
      if (r.notFound.length > 0) {
        setDocError(`⚠ Não achei no doc: ${r.notFound.join(', ')}. Confere a nomenclatura.`);
      }
      disparos = r.disparos;
    } else {
      const res = buildDisparosFromDoc(text, snapCandidates, { links: docLinks });
      if (res.disparos.length === 0) {
        setDocError(res.diagnostic);
        return;
      }
      disparos = res.disparos;
    }
    setDocPreview(disparos);
    const sel: Record<string, boolean> = {};
    const slotsMap: Record<string, DocSlot[]> = {};
    for (const d of disparos) {
      sel[d.baseAdId] = true;
      slotsMap[d.baseAdId] = buildSlotsForDisparo(d);
    }
    setDocSelected(sel);
    setDocSlots(slotsMap);
    setDocPreviewOpen({});
    // Resultado vai pra TELA CHEIA (igual ClickUp Pilot); o modal de import some.
    setDocModalOpen(false);
    setDocAnalysisOpen(true);
  }

  /** Enfileira os disparos selecionados no preview do doc. */
  function enqueueSelectedDocDisparos() {
    if (!docPreview) return;
    const items: QueueItem[] = [];
    for (const d of docPreview) {
      if (!docSelected[d.baseAdId]) continue;
      // Aplica os slots editados (avatar/voz por speaker) nas partes do AD.
      const slots = docSlots[d.baseAdId] || [];
      const slotByRole = new Map(slots.map((s) => [s.role, s]));
      items.push({
        id: `doc:${d.baseAdId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
        adName: d.baseAdId,
        safeName: d.safeName,
        mode: 'copy',
        parts: d.parts.map((p) => {
          const slot = slotByRole.get((p.role || '').toLowerCase()) || slots[0];
          return {
            label: p.label,
            text: p.text,
            avatarId: slot?.avatarId ?? p.avatarId,
            avatarName: slot?.avatarName ?? p.avatarName,
            voiceId: slot?.voiceOverride?.id ?? slot?.defaultVoiceId ?? p.voiceId,
          };
        }),
        motor: motorConfig.kind === 'global' ? motorConfig.motor : motor,
        decupagem: decupagemEnabled,
        decupIntensity,
        source: 'doc',
        unmatched: d.unmatchedAvatars,
        status: 'pending',
      });
    }
    if (items.length === 0) {
      setDocError('Selecione pelo menos 1 AD pra adicionar à fila.');
      return;
    }
    setQueue((prev) => [...prev, ...items]);
    setDocModalOpen(false);
    setDocAnalysisOpen(false);
    setDocPreview(null);
    setDocPreviewOpen({});
    setDocText('');
    setDocLink('');
    setDocFileName(null);
    setDocAdNames(['']);
    setDocAutoAll(false);
    setDocSlots({});
  }

  /* ===================== Fila: adicionar config atual + processar ===================== */

  function labelForQueueIndex(idx: number, hookCount: number, totalParts: number): string {
    if (forcedParts && forcedParts[idx]) return forcedParts[idx].label;
    if (idx < hookCount) return `HOOK ${idx + 1}`;
    const bodyIdx = idx - hookCount;
    const bodyTotal = totalParts - hookCount;
    if (bodyTotal === 1) return 'BODY';
    return `BODY ${bodyIdx + 1}`;
  }

  /** Captura a configuracao atual (avatar + copy/audios + modos) como 1 item
   *  da fila, sem disparar agora. Permite empilhar varios ADs manualmente. */
  function addCurrentToQueue() {
    if (!selectedAvatar) {
      setError('Selecione um avatar antes de adicionar à fila.');
      return;
    }
    const qparts: QueuePart[] = [];
    if (mode === 'copy') {
      if (parts.length === 0) {
        setError('Preencha pelo menos 1 HOOK pra adicionar à fila.');
        return;
      }
      const hookCount =
        forcedParts && forcedParts.length > 0
          ? forcedParts.filter((p) => /^HOOK/i.test(p.label)).length
          : structuredHooks.filter((h) => h.text.trim()).length;
      const fixedVoice =
        overrideVoice && selectedVoice ? selectedVoice.id : selectedAvatar.voiceId || null;
      parts.forEach((text, i) => {
        const av = dynamicMode ? partAvatars[i] || selectedAvatar : selectedAvatar;
        qparts.push({
          label: labelForQueueIndex(i, hookCount, parts.length),
          text,
          avatarId: av?.id || selectedAvatar.id,
          avatarName: av?.name || selectedAvatar.name,
          voiceId: dynamicMode && !overrideVoice ? av?.voiceId || null : fixedVoice,
        });
      });
    } else {
      const hookFiles = structuredHooks.map((h) => h.audio).filter((f): f is File => !!f);
      const bodyFiles = structuredBody.enabled ? structuredBody.audios : [];
      if (hookFiles.length === 0 && bodyFiles.length === 0) {
        setError('Faça upload de pelo menos 1 áudio pra adicionar à fila.');
        return;
      }
      hookFiles.forEach((file, i) =>
        qparts.push({
          label: `HOOK ${i + 1}`,
          audio: file,
          avatarId: selectedAvatar.id,
          avatarName: selectedAvatar.name,
        }),
      );
      bodyFiles.forEach((file, i) =>
        qparts.push({
          label: bodyFiles.length === 1 ? 'BODY' : `BODY · parte ${i + 1}`,
          audio: file,
          avatarId: selectedAvatar.id,
          avatarName: selectedAvatar.name,
        }),
      );
    }
    setQueue((prev) => [
      ...prev,
      {
        id: `manual:${safeName}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
        adName: adName.trim() || safeName,
        safeName,
        mode,
        parts: qparts,
        motor: motorConfig.kind === 'global' ? motorConfig.motor : motor,
        decupagem: decupagemEnabled,
        decupIntensity,
        source: 'manual',
        voiceName: overrideVoice && selectedVoice ? selectedVoice.name : null,
        status: 'pending',
      },
    ]);
    setError(null);
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  function cancelQueue() {
    queueCancelRef.current = true;
  }

  /** Helper: baixa um blob como arquivo (auto-download). */
  function triggerDownload(blob: Blob, filename: string): string {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return url;
  }

  /**
   * Roda UM item da fila ponta-a-ponta: dispara as partes no HeyGen, espera
   * renderizar, baixa MP4s, zipa takes + montado (com/sem decupagem) +
   * camuflado (se ligado). Auto-contido — NAO toca no run()/downloadAllAsZip()
   * do fluxo manual. Reusa exatamente as mesmas libs.
   */
  async function runDisparoSpec(
    item: QueueItem,
    cbs: {
      onStage: (m: string) => void;
      onUpdate: (patch: Partial<QueueItem>) => void;
      isCancelled: () => boolean;
      /** Quando presente, NAO re-dispara: re-poll + re-download desses ids. */
      resumeVideoIds?: string[];
    },
  ): Promise<void> {
    const safe = item.safeName;
    const batchId = item.batchId || `heygenauto:${safe}:${Date.now()}`;
    const resuming = !!(cbs.resumeVideoIds && cbs.resumeVideoIds.length > 0);
    const stage = (m: string, progress?: number, phase?: QueueItem['phase']) => {
      cbs.onStage(m);
      cbs.onUpdate({ message: m, ...(progress != null ? { progress } : {}), ...(phase ? { phase } : {}) });
    };

    const fallbackAvatar =
      item.parts.find((p) => p.avatarId)?.avatarId || selectedAvatar?.id || '';
    const fallbackVoice =
      item.parts.find((p) => p.voiceId)?.voiceId || selectedAvatar?.voiceId || undefined;

    const jobs: RunnerJob[] = item.parts.map((p) => ({
      label: p.label,
      copy: item.mode === 'copy' ? p.text : undefined,
      audio: item.mode === 'audio' ? p.audio : undefined,
      avatarId: p.avatarId || undefined,
      voiceId: p.voiceId || undefined,
      motor: item.motor,
    }));

    const mirrorParts = (collected: RunnerResult[]) =>
      jobs.map((j, i) => {
        const rr = collected.find((c) => c.index === i + 1);
        return {
          label: j.label,
          videoId: rr?.videoId ?? null,
          error: rr?.error ?? null,
          renamedTo: `${j.label}.mp4`,
        };
      });

    cbs.onUpdate({ batchId });

    // ===== Fase 1: DISPATCH (pulada no resume) =====
    let ready: Array<{ label: string; videoId: string }>;
    if (resuming) {
      // Reconstroi a lista de takes prontos a partir dos partResults salvos.
      const pr = item.partResults || [];
      ready = pr.filter((p) => p.videoId).map((p) => ({ label: p.label, videoId: p.videoId! }));
      // Fallback: se nao temos labels, casa os ids com os labels dos jobs por ordem
      if (ready.length === 0) {
        ready = (cbs.resumeVideoIds || []).map((vid, i) => ({ label: jobs[i]?.label || `parte${i + 1}`, videoId: vid }));
      }
      stage(`Retomando ${ready.length} takes (sem re-disparar)...`, 40, 'rendering');
    } else {
      if (!fallbackAvatar && item.parts.some((p) => !p.avatarId)) {
        throw new Error('Sem avatar resolvido pra alguma parte (cria o avatar no HeyGen ou ajusta a copy).');
      }
      upsertSharedBatch(batchId, {
        taskName: safe,
        baseAdId: safe,
        phase: 'dispatching',
        parts: mirrorParts([]),
        startedAt: Date.now(),
        message: 'Disparando partes no HeyGen (fila)...',
      });
      stage('Disparando partes no HeyGen...', 5, 'dispatching');

      const collected: RunnerResult[] = [];
      const finalResults = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode: item.mode,
        avatarId: fallbackAvatar,
        voiceId: fallbackVoice,
        motor: item.motor,
        adNameSafe: safe,
        isCancelled: cbs.isCancelled,
        onProgress: (m) => cbs.onStage(m),
        onResult: (r) => {
          collected.push(r);
          upsertSharedBatch(batchId, { parts: mirrorParts(collected) });
          const pct = 5 + Math.round((30 * collected.length) / Math.max(1, jobs.length));
          cbs.onUpdate({ progress: pct, message: `Disparado ${collected.length}/${jobs.length}...` });
        },
      });

      // Salva partResults + videoIds no item (pra Retomar + Debug)
      const pr = mirrorParts(finalResults).map((p) => ({ label: p.label, videoId: p.videoId, error: p.error }));
      const okIds = finalResults.filter((r) => r.videoId).map((r) => r.videoId!);
      cbs.onUpdate({ partResults: pr, videoIds: okIds });

      ready = finalResults.filter((r) => r.videoId).map((r) => ({ label: r.label, videoId: r.videoId! }));
      if (ready.length === 0) {
        upsertSharedBatch(batchId, {
          phase: 'failed',
          parts: mirrorParts(finalResults),
          message: 'Todos os disparos falharam (cota/limite HeyGen?).',
          finishedAt: Date.now(),
        });
        throw new Error('Nenhuma parte foi disparada (cota/limite HeyGen?).');
      }
    }

    // ===== Fase 2: RENDER (poll) =====
    upsertSharedBatch(batchId, { phase: 'downloading', message: 'Renderizando + baixando no HeyGen...' });
    const ids = ready.map((r) => r.videoId);
    // Inicializa os previews por take (loading) — vão virando vídeo jogável.
    const buildPreviews = (statuses: Record<string, VideoStatus>): LipsyncTake[] =>
      ready.map((r) => {
        const s = statuses[r.videoId];
        return {
          label: r.label,
          status: s?.status || 'pending',
          videoUrl: s?.status === 'completed' ? s.videoUrl || null : null,
          error: s?.error || null,
        };
      });
    cbs.onUpdate({ takePreviews: buildPreviews({}) });
    stage(`Renderizando ${ids.length} partes no HeyGen...`, 40, 'rendering');
    const final = await pollVideosUntilReady(ids, {
      intervalMs: 8000,
      timeoutMs: 30 * 60 * 1000,
      isCancelled: cbs.isCancelled,
      onStatus: (statuses) => {
        const done = Object.values(statuses).filter((s) => s.status === 'completed').length;
        const failed = Object.values(statuses).filter((s) => s.status === 'failed').length;
        const pct = 40 + Math.round((35 * done) / Math.max(1, ids.length));
        stage(`Renderizando: ${done}/${ids.length} prontos${failed > 0 ? `, ${failed} falhou` : ''}...`, pct);
        cbs.onUpdate({ takePreviews: buildPreviews(statuses) });
      },
    });
    if (cbs.isCancelled()) throw new Error('Cancelado pelo usuário.');
    // Finaliza previews com as URLs prontas (mantém jogável após o download).
    cbs.onUpdate({ takePreviews: buildPreviews(final) });

    const JSZip = (await import('jszip')).default;
    const { saveZip } = await import('@/lib/zip-store');

    // ===== Fase 3: DOWNLOAD takes =====
    cbs.onUpdate({ phase: 'downloading' });
    const zip = new JSZip();
    const partBlobs: Array<{ label: string; blob: Blob | null }> = [];
    for (let i = 0; i < ready.length; i++) {
      if (cbs.isCancelled()) throw new Error('Cancelado pelo usuário.');
      const part = ready[i];
      const status = final[part.videoId];
      stage(`Baixando parte ${i + 1}/${ready.length} (${part.label})...`, 75 + Math.round((15 * (i + 1)) / ready.length));
      if (status?.status !== 'completed' || !status.videoUrl) {
        zip.file(`${part.label}_FAILED.txt`, `Status: ${status?.status || 'unknown'}\nErro: ${status?.error || 'sem video_url'}`);
        partBlobs.push({ label: part.label, blob: null });
        continue;
      }
      try {
        const bytes = await downloadVideoBytes(status.videoUrl);
        zip.file(`${part.label}.mp4`, bytes);
        partBlobs.push({ label: part.label, blob: new Blob([bytes as BlobPart], { type: 'video/mp4' }) });
      } catch (e) {
        zip.file(`${part.label}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message || e));
        partBlobs.push({ label: part.label, blob: null });
      }
    }
    stage('Zipando takes...', 90, 'post');
    const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    const takesName = `${safe}_takes.zip`;
    try {
      await saveZip(`batch:${batchId}:takes`, takesBlob, takesName);
      upsertSharedBatch(batchId, { zipFilename: takesName });
    } catch {}
    cbs.onUpdate({ zips: { ...(item.zips || {}), takes: takesName } });
    const takesUrl = triggerDownload(takesBlob, takesName);
    setTimeout(() => URL.revokeObjectURL(takesUrl), 5000);

    // ===== Fase 4: MONTADO (HOOK+BODY, com/sem decupagem) =====
    if (partBlobs.some((p) => p.blob)) {
      stage(`Montando HOOK+BODY${item.decupagem ? ' + decupagem' : ''}...`, 92, 'post');
      try {
        const { runPostPipeline } = await import('@/lib/clickup-pilot-pipeline');
        const pipeRes = await runPostPipeline({
          baseAdId: safe,
          parts: partBlobs,
          decupagem: item.decupagem,
          keepSilenceSec: item.decupIntensity ?? DEFAULT_KEEP_SILENCE,
          camuflagem: false,
          onProgress: (p) => stage(`${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}`, 92 + Math.round((5 * p.doneCount) / Math.max(1, p.totalCount))),
        });
        const zipMont = new JSZip();
        for (const it of pipeRes.items) {
          if (it.decupado) {
            zipMont.file(it.filename, it.decupado);
          } else if (it.rawAssembled && it.rawAssembled.size > 0 && !it.errors?.assemble) {
            zipMont.file(it.filename.replace('.mp4', item.decupagem ? '_sem_decupagem.mp4' : '.mp4'), it.rawAssembled);
            if (item.decupagem) {
              zipMont.file(`${it.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, it.errors?.decupagem || 'erro desconhecido');
            }
          } else {
            zipMont.file(`${it.filename.replace('.mp4', '')}_ERRO.txt`, `Assemble: ${it.errors?.assemble || 'OK'}\nDecupagem: ${it.errors?.decupagem || 'OK'}`);
          }
        }
        const blobMont = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        const montName = `${safe}_montado_${item.decupagem ? 'decupado' : 'sem_decupagem'}.zip`;
        try {
          await saveZip(`batch:${batchId}:montado`, blobMont, montName);
          upsertSharedBatch(batchId, { montadoZipName: montName });
        } catch {}
        cbs.onUpdate({ zips: { ...(item.zips || {}), takes: takesName, montado: montName } });
        const montUrl = triggerDownload(blobMont, montName);
        setTimeout(() => URL.revokeObjectURL(montUrl), 5000);
      } catch (e) {
        console.error('[hgauto fila pipeline] falhou:', e);
      }
    }

    // ===== Fase 5: CAMUFLADO (opcional) =====
    if (camuflagemMode && camuflagemWhite) {
      stage('Aplicando camuflagem em cada take...', 98, 'post');
      try {
        let whiteBlob: Blob = camuflagemWhite;
        if ((camuflagemWhite.type || '').startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(camuflagemWhite.name)) {
          whiteBlob = await extractAudio(camuflagemWhite);
        }
        const zipCamu = new JSZip();
        for (let i = 0; i < partBlobs.length; i++) {
          const p = partBlobs[i];
          if (!p.blob) continue;
          stage(`Camuflando ${i + 1}/${partBlobs.length} (${p.label})...`, 98);
          try {
            const blackAudio = await extractAudio(p.blob);
            const camuWav = await camuflar({ black: blackAudio, white: whiteBlob, volumePercent: camuflagemVolume });
            const camuVid = await muxAudioIntoVideo(p.blob, camuWav);
            zipCamu.file(`${p.label}_camuflado.mp4`, camuVid);
          } catch (e) {
            zipCamu.file(`${p.label}_CAMUFLAGEM_ERROR.txt`, String((e as Error)?.message || e));
          }
        }
        const blobCamu = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        const camuName = `${safe}_camuflado.zip`;
        try {
          await saveZip(`batch:${batchId}:camo`, blobCamu, camuName);
          upsertSharedBatch(batchId, { camufladoZipName: camuName });
        } catch {}
        cbs.onUpdate({ zips: { ...(item.zips || {}), takes: takesName, camo: camuName } });
        const camuUrl = triggerDownload(blobCamu, camuName);
        setTimeout(() => URL.revokeObjectURL(camuUrl), 5000);
      } catch (e) {
        console.warn('[hgauto fila camuflagem] falhou:', e);
      }
    }

    upsertSharedBatch(batchId, { phase: 'done', message: 'Pronto — ZIPs no disco (lipsync-history).', finishedAt: Date.now() });
    cbs.onUpdate({ progress: 100, phase: 'done' });
  }

  /** Baixa um ZIP salvo no IndexedDB (key batch:<batchId>:<kind>). */
  async function downloadQueueZip(batchId: string, kind: 'takes' | 'montado' | 'camo') {
    try {
      const { loadZip } = await import('@/lib/zip-store');
      const z = await loadZip(`batch:${batchId}:${kind}`);
      if (!z) {
        setError('ZIP não está mais no disco (pode ter sido limpo). Retome o item pra regerar.');
        return;
      }
      const a = document.createElement('a');
      a.href = z.blobUrl;
      a.download = z.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(z.blobUrl), 10000);
    } catch (e) {
      setError(`Falha ao baixar do disco: ${(e as Error)?.message}`);
    }
  }

  /** Retoma UM item (re-poll + re-download dos videoIds, sem re-disparar se já
   *  disparou). Roda fora da fila sequencial — pode rodar avulso. */
  async function resumeQueueItem(id: string) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    if (!extStatus.connected) {
      setError('Extensão Hey Auto não detectada.');
      return;
    }
    queueCancelRef.current = false;
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'running', message: 'Retomando...' } : q)));
    const patch = (p: Partial<QueueItem>) => setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...p } : q)));
    try {
      await runDisparoSpec(item, {
        onStage: () => {},
        onUpdate: patch,
        isCancelled: () => queueCancelRef.current,
        resumeVideoIds: item.videoIds && item.videoIds.length > 0 ? item.videoIds : undefined,
      });
      patch({ status: 'done', message: '✓ ZIPs baixados' });
    } catch (e) {
      const canceled = queueCancelRef.current;
      patch({
        status: canceled ? 'pending' : 'failed',
        phase: canceled ? undefined : 'failed',
        message: canceled ? 'Pausado — retome quando quiser.' : (e as Error)?.message || 'Falha.',
      });
    }
  }

  /** Processa a fila inteira em sequencia (1 disparo por vez). */
  async function processQueue() {
    if (!extStatus.connected) {
      setError('Extensão Hey Auto não detectada. Instale primeiro.');
      return;
    }
    const snapshot = queue.filter((q) => q.status !== 'done');
    if (snapshot.length === 0) return;
    setError(null);
    setQueueRunning(true);
    queueCancelRef.current = false;
    for (const item of snapshot) {
      if (queueCancelRef.current) break;
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'running', message: 'Iniciando...', progress: 0, phase: 'dispatching' } : q)));
      try {
        await runDisparoSpec(item, {
          onStage: () => {},
          onUpdate: (patch) => setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, ...patch } : q))),
          isCancelled: () => queueCancelRef.current,
        });
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'done', message: '✓ ZIPs baixados', progress: 100, phase: 'done' } : q)));
      } catch (e) {
        // Cancelamento intencional NAO e falha — volta o item pra 'pending'
        // pra poder reprocessar depois.
        const canceled = queueCancelRef.current;
        const msg = canceled
          ? 'Cancelado — reprocessar quando quiser.'
          : (e as Error)?.message || 'Falha desconhecida.';
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: canceled ? 'pending' : 'failed', message: msg } : q,
          ),
        );
        if (canceled) break;
      }
    }
    setQueueRunning(false);
    queueCancelRef.current = false;
  }

  return (
    <>
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 md:px-8 md:pt-8">
        <ToolHeroVideo
          src="/cards/hey-auto.mp4"
          poster="/cards/hey-auto.jpg"
          eyebrow="HeyGen em série"
          title="Hey Auto"
          subtitle="Avatar fala tudo. Você não abre o HeyGen."
          glow="rgba(34,211,238,0.5)"
        />
        <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-7">
          {/* Status da extensao */}
          {!extLoading ? (
            extStatus.connected ? (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
                  </span>
                  <span className="text-lime">
                    Extensão Hey Auto v1.0
                  </span>
                  {sessionTest.state === 'ok' ? (
                    <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                      ✓ {sessionTest.detail}
                    </span>
                  ) : sessionTest.state === 'fail' ? (
                    <span className="mono ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase text-red-300">
                      ✗ {sessionTest.detail}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={testSession}
                  disabled={sessionTest.state === 'testing'}
                  className="rounded-md border border-line-strong bg-bg-soft px-3 py-1 text-[11px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime disabled:opacity-50"
                >
                  {sessionTest.state === 'testing'
                    ? 'Testando...'
                    : 'Testar conexao HeyGen'}
                </button>
              </div>
            ) : (
              <div className="mb-5 rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-300">⚠</span>
                  <div className="flex-1 text-xs text-yellow-300">
                    <strong className="text-yellow-300">
                      Extensão Hey Auto não instalada
                    </strong>
                    . Voce precisa dela pra gerar avatares (a automacao usa sua
                    conta HeyGen logada, sem consumir API).
                    <div className="mt-3">
                      <a
                        href="/api/extension/download"
                        download
                        className="btn-lime inline-flex items-center gap-2 !px-4 !py-2 text-[12px]"
                      >
                        ⬇ Baixar extensao (.zip)
                      </a>
                    </div>
                    <details className="mt-3" open>
                      <summary className="cursor-pointer font-semibold text-yellow-300 hover:text-yellow-200">
                        Como instalar (passo a passo)
                      </summary>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-yellow-300">
                        <li>
                          Clica no botao{' '}
                          <strong>&quot;Baixar extensao (.zip)&quot;</strong> acima
                        </li>
                        <li>
                          Descompacta o .zip numa pasta no seu computador
                        </li>
                        <li>
                          Abre <code className="mono">chrome://extensions</code>
                        </li>
                        <li>
                          Liga &quot;Modo de desenvolvedor&quot; (canto superior direito)
                        </li>
                        <li>
                          Clica &quot;Carregar sem compactacao&quot; e seleciona a pasta
                        </li>
                        <li>
                          Faz login no HeyGen normalmente em outra aba
                        </li>
                        <li>
                          Volta aqui e atualize a pagina (F5) — a extensao deve
                          aparecer como conectada
                        </li>
                      </ol>
                    </details>
                  </div>
                </div>
              </div>
            )
          ) : null}

          <MissingKeyBanner services={['heygen']} />

          <div className="mt-6 flex flex-col gap-6">
            {/* Identidade */}
            <section>
              <h2 className="label-field !mb-3">Identidade</h2>
              <input
                type="text"
                value={adName}
                onChange={(e) => setAdName(e.target.value)}
                placeholder="Nome do AD (vai virar prefixo dos arquivos)"
                className="input-field"
                disabled={processing}
              />
            </section>

            {/* Motor — picker avancado (global/percent/individual + previa creditos) */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Motor do avatar (com previsibilidade de créditos)</h2>
              <MotorConfigPicker
                config={motorConfig}
                setConfig={setMotorConfig}
                takeCount={mode === 'audio' ? structuredAudioFiles.length : parts.length}
                slotIds={mode === 'audio'
                  ? structuredAudioFiles.map((_, i) => `HOOK${i + 1}`)
                  : parts.map((_, i) => `PART${i + 1}`)
                }
                takeSeconds={mode === 'copy'
                  ? parts.map((text) => estimateSecondsFromText(text))
                  : audioPartsSeconds
                }
              />
            </section>

            {/* Avatar — biblioteca real da conta HeyGen via extensao */}
            <section className="border-t border-line pt-6">
              <HeyGenAvatarPicker
                query={avatarQuery}
                setQuery={setAvatarQuery}
                selected={selectedAvatar}
                setSelected={setSelectedAvatar}
                disabled={processing}
                label="Avatar (sua biblioteca HeyGen)"
              />
              <p className="mt-2 text-[11px] text-text-muted">
                Lista 100% espelhada da sua conta HeyGen. O motor selecionado
                acima ({motor}) sera usado na hora de gerar — escolha o avatar
                aqui livremente.
              </p>
            </section>

            {mode === 'copy' ? (
              <section className="border-t border-line pt-6">
                <HeyGenVoicePicker
                  override={overrideVoice}
                  setOverride={setOverrideVoice}
                  query={voiceQuery}
                  setQuery={setVoiceQuery}
                  selected={selectedVoice}
                  setSelected={setSelectedVoice}
                  clonedVoices={clonedVoices}
                  setClonedVoices={setClonedVoices}
                  disabled={processing}
                />
              </section>
            ) : (
              <section className="border-t border-line pt-6">
                <div className="rounded-[12px] border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
                  ℹ Modo audio: a voz vem do proprio audio enviado (lipsync).
                  Voice picker desativado.
                </div>
              </section>
            )}

            {/* Modo: copy ou audio */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Modo de input</h2>
              <div className="flex gap-2">
                {(
                  [
                    { id: 'copy' as const, label: 'Cole a copy (texto)' },
                    {
                      id: 'audio' as const,
                      label: 'Upload de audios (parte1, parte2...)',
                    },
                  ]
                ).map((m) => {
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      disabled={processing}
                      className={
                        'flex-1 rounded-[12px] px-4 py-2.5 text-sm transition-all duration-200 active:scale-[0.98] ' +
                        (active
                          ? 'bg-lime font-semibold text-black'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-3">
                  <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted">
                    Hooks ({structuredHooks.length}/10) — cada um vira 1 take final
                  </div>
                  {structuredHooks.map((h, hi) => (
                    <div key={hi} className="rounded-[10px] border border-lime/30 bg-lime/5 p-3">
                      <div className="label-tech flex items-center justify-between mb-2 text-[10px] uppercase tracking-widest text-lime">
                        <span>HOOK {hi + 1}</span>
                        {structuredHooks.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setStructuredHooks((prev) => prev.filter((_, i) => i !== hi))}
                            disabled={processing}
                            className="rounded-full px-2 py-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-300"
                            title="Remover este hook"
                          >
                            × remover
                          </button>
                        ) : null}
                      </div>
                      {mode === 'copy' ? (
                        <div className="dark-island overflow-hidden rounded-[12px] border border-line bg-black/60 transition-colors focus-within:border-fuchsia-400/50">
                          <textarea
                            value={h.text}
                            onChange={(e) =>
                              setStructuredHooks((prev) =>
                                prev.map((p, i) => (i === hi ? { ...p, text: e.target.value } : p)),
                              )
                            }
                            placeholder={`Texto do HOOK ${hi + 1} (uma frase tipica de chamariz, ~15-25s)`}
                            rows={3}
                            className="block w-full resize-y bg-transparent px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-white placeholder:text-text-dim focus:outline-none disabled:opacity-50"
                            disabled={processing}
                          />
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              setStructuredHooks((prev) =>
                                prev.map((p, i) =>
                                  i === hi ? { ...p, audio: f } : p,
                                ),
                              );
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                            disabled={processing}
                          />
                          {h.audio ? (
                            <div className="text-[11px] text-text-muted">
                              📎 {h.audio.name} (
                              {(h.audio.size / (1024 * 1024)).toFixed(2)}MB)
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {structuredHooks.length < 10 ? (
                    <button
                      type="button"
                      onClick={() => setStructuredHooks((prev) => [...prev, { text: '', audio: null }])}
                      disabled={processing}
                      className="label-tech rounded-[10px] border border-dashed border-line-strong bg-bg/30 py-2 px-3 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime/40 hover:bg-lime/5 hover:text-lime transition disabled:opacity-50"
                    >
                      + adicionar hook ({structuredHooks.length}/10)
                    </button>
                  ) : (
                    <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted text-center py-2">
                      Limite de 10 hooks atingido
                    </div>
                  )}

                  {/* Body opcional */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="hgauto-body-enabled"
                      checked={structuredBody.enabled}
                      onChange={(e) => setStructuredBody((p) => ({ ...p, enabled: e.target.checked }))}
                      disabled={processing}
                      className="h-4 w-4 cursor-pointer accent-fuchsia-400"
                    />
                    <label htmlFor="hgauto-body-enabled" className="label-tech cursor-pointer text-[10px] uppercase tracking-widest text-fuchsia-200">
                      Incluir BODY (texto/audio que vai depois de cada hook no video montado)
                    </label>
                  </div>
                  {structuredBody.enabled ? (
                    <div className="rounded-[10px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
                      <div className="label-tech mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">BODY</div>
                      {mode === 'copy' ? (
                        <div className="dark-island overflow-hidden rounded-[12px] border border-line bg-black/60 transition-colors focus-within:border-fuchsia-400/50">
                          <textarea
                            value={structuredBody.text}
                            onChange={(e) => setStructuredBody((p) => ({ ...p, text: e.target.value }))}
                            placeholder="Texto do BODY completo. Sera splitado em takes de ~20s sem cortar frase."
                            rows={6}
                            className="block w-full resize-y bg-transparent px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-white placeholder:text-text-dim focus:outline-none disabled:opacity-50"
                            disabled={processing}
                          />
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          <input
                            type="file"
                            accept="audio/*"
                            multiple
                            onChange={(e) => {
                              const added = Array.from(e.target.files ?? []);
                              if (added.length === 0) return;
                              setStructuredBody((p) => ({
                                ...p,
                                audios: sortAudiosByPartName([
                                  ...p.audios,
                                  ...added,
                                ]),
                              }));
                              e.target.value = '';
                            }}
                            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-fuchsia-500 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                            disabled={processing}
                          />
                          {structuredBody.audios.length > 0 ? (
                            <div className="grid gap-1.5 rounded-[10px] border border-line bg-bg/40 p-2">
                              <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                                {structuredBody.audios.length} áudio
                                {structuredBody.audios.length === 1 ? '' : 's'} ·
                                ordem de execução
                              </div>
                              {structuredBody.audios.map((file, ai) => (
                                <div
                                  key={ai + '-' + file.name}
                                  className="flex items-center gap-2 rounded-md border border-line-strong bg-bg/60 px-2 py-1.5 text-[11px]"
                                >
                                  <span className="mono w-6 shrink-0 text-center text-fuchsia-300">
                                    {ai + 1}
                                  </span>
                                  <span className="flex-1 truncate text-text">
                                    {file.name}
                                  </span>
                                  <span className="mono shrink-0 text-text-muted">
                                    {(file.size / (1024 * 1024)).toFixed(2)}MB
                                  </span>
                                  <div className="flex shrink-0 gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => {
                                          if (ai === 0) return p;
                                          const next = [...p.audios];
                                          [next[ai - 1], next[ai]] = [
                                            next[ai],
                                            next[ai - 1],
                                          ];
                                          return { ...p, audios: next };
                                        })
                                      }
                                      disabled={ai === 0 || processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra cima"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => {
                                          if (ai === p.audios.length - 1)
                                            return p;
                                          const next = [...p.audios];
                                          [next[ai], next[ai + 1]] = [
                                            next[ai + 1],
                                            next[ai],
                                          ];
                                          return { ...p, audios: next };
                                        })
                                      }
                                      disabled={
                                        ai === structuredBody.audios.length - 1 ||
                                        processing
                                      }
                                      className="rounded p-0.5 text-text-muted transition hover:bg-bg hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                                      title="Mover pra baixo"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setStructuredBody((p) => ({
                                          ...p,
                                          audios: p.audios.filter(
                                            (_, k) => k !== ai,
                                          ),
                                        }))
                                      }
                                      disabled={processing}
                                      className="rounded p-0.5 text-text-muted transition hover:bg-red-500/15 hover:text-red-300"
                                      title="Remover"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {structuredBody.audios.length > 1 ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">
                                  💡 Dica: nomeie como{' '}
                                  <span className="text-fuchsia-300">
                                    parte1.mp3
                                  </span>
                                  ,{' '}
                                  <span className="text-fuchsia-300">
                                    parte2.mp3
                                  </span>{' '}
                                  pra ordenação automática.
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}

                </div>
                {forcedParts && forcedParts.length > 0 ? (
                  <div className="mt-3 flex items-center justify-between rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-[11px]">
                    <span className="text-fuchsia-200">
                      ⚙ Partes vindas do <strong>ClickUp Pilot</strong> ({forcedParts.map(p => p.label).join(', ')}) — sobrescreveram os inputs estruturados
                    </span>
                    <button
                      type="button"
                      onClick={() => setForcedParts(null)}
                      className="mono shrink-0 rounded border border-fuchsia-500/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-fuchsia-200 hover:border-red-500/60 hover:text-red-300"
                      disabled={processing}
                    >
                      Limpar override
                    </button>
                  </div>
                ) : null}
            </section>

            {/* Modo Camuflagem — gera 2a ZIP com cada take camuflado no audio */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Modos extra</h2>
              <div className="mb-3 flex flex-wrap gap-3">
                <Toggle3D
                  on={decupagemEnabled}
                  onChange={setDecupagemEnabled}
                  label={decupagemEnabled ? 'Decupagem ON' : 'Decupagem OFF'}
                  hint="Corta silêncios/respiros no vídeo montado HOOK+BODY"
                  variant="cyan"
                  icon={<span className="text-base">✂️</span>}
                />
              </div>
              {/* INTENSIDADE do corte — mesmo parâmetro da ferramenta /decupagem.
                  O valor é aplicado FIEL no corte. Capturado por item ao entrar
                  na fila (cada disparo carrega a intensidade que estava setada). */}
              {decupagemEnabled ? (
                <div className="mb-3 rounded-[12px] border border-cyan-400/30 bg-cyan-400/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label-tech text-[10px] uppercase tracking-[0.16em] text-cyan-200">
                      Intensidade do corte — silêncio mantido nas bordas da fala
                    </span>
                    <span className="mono text-[12.5px] font-bold text-cyan-200">
                      {decupIntensity.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={decupIntensity}
                    onChange={(e) => setDecupIntensity(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className="mt-1 flex justify-between text-[9.5px] text-text-muted">
                    <span>0.01s · corte agressivo</span>
                    <span>fala respira · 0.50s</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {[
                      { v: 0.05, l: 'Agressivo' },
                      { v: 0.12, l: 'Padrão' },
                      { v: 0.2, l: 'Suave' },
                    ].map((preset) => {
                      const on = Math.abs(decupIntensity - preset.v) < 0.005;
                      return (
                        <button
                          key={preset.v}
                          type="button"
                          onClick={() => setDecupIntensity(preset.v)}
                          className={
                            'mono rounded-full border px-2.5 py-1 text-[10px] font-bold transition ' +
                            (on
                              ? 'border-cyan-400/60 bg-cyan-400/20 text-cyan-100'
                              : 'border-line bg-bg-soft/50 text-text-muted hover:border-cyan-400/40 hover:text-cyan-200')
                          }
                        >
                          {preset.l} · {preset.v.toFixed(2)}s
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2.5 text-[10px] leading-snug text-text-muted">
                    O valor é aplicado <span className="text-cyan-200">fielmente</span> no corte. Se você põe 0.05, o corte usa 0.05.
                  </p>
                </div>
              ) : null}
              <Toggle3D
                on={camuflagemMode}
                onChange={setCamuflagemMode}
                label="Camuflagem"
                hint="Gera 2a pasta ZIP com cada take + audio camuflado"
                variant="fuchsia"
                icon={<span className="text-base">🎭</span>}
              />
              {camuflagemMode ? (
                <div className="mt-3 rounded-[12px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
                  <div className="label-tech mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                    Audio WHITE pra camuflagem (audio OU video — extrai audio se video)
                  </div>
                  <div className="grid items-center gap-2 sm:grid-cols-[1fr_140px]">
                    <input
                      type="file"
                      accept="audio/*,video/*"
                      onChange={(e) => setCamuflagemWhite(e.target.files?.[0] || null)}
                      className="input-field text-xs"
                      disabled={processing || downloading}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={camuflagemVolume}
                        onChange={(e) => setCamuflagemVolume(Number(e.target.value))}
                        className="flex-1 accent-fuchsia-400"
                        disabled={processing || downloading}
                      />
                      <span className="mono w-10 text-right text-[11px] text-fuchsia-200">{camuflagemVolume}%</span>
                    </div>
                  </div>
                  {camuflagemWhite ? (
                    <div className="mt-2 text-[11px] text-fuchsia-200">
                      ✓ {camuflagemWhite.name} ({(camuflagemWhite.size / (1024 * 1024)).toFixed(1)}MB)
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-text-muted">
                      ⚠ Sem WHITE: a camuflagem nao roda. Selecione um arquivo.
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {/* Hey Auto Dynamic — multi-avatar por parte */}
            <section className="border-t border-line pt-6">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={dynamicMode}
                  onChange={(e) => setDynamicMode(e.target.checked)}
                  disabled={processing}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-lime"
                />
                <div>
                  <div className="text-sm font-semibold text-white">
                    Hey Auto Dynamic{' '}
                    <span className="label-tech ml-2 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-fuchsia-300">
                      multi-avatar
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    Cada parte (texto OU audio) usa um avatar diferente. Voz de
                    cada parte = a voz predefinida daquele avatar (a menos que
                    voce marque{' '}
                    <span className="text-lime/80">substituir voz</span> pra
                    forcar uma voz fixa em todas).
                  </div>
                </div>
              </label>

              {dynamicMode && mode === 'copy' && parts.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted">
                    Avatar por parte ({parts.length} take
                    {parts.length === 1 ? '' : 's'})
                  </div>
                  {parts.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-[10px] border border-line bg-bg-soft/30 p-2"
                    >
                      <span className="mono mt-1 shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                        #{i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[11px] text-text-muted">
                          {p.slice(0, 140)}
                          {p.length > 140 ? '…' : ''}
                        </div>
                        <div className="mt-2 max-w-[320px]">
                          <CompactAvatarPicker
                            selected={partAvatars[i] ?? null}
                            setSelected={(a) => {
                              setPartAvatars((prev) => {
                                const next = [...prev];
                                next[i] = a;
                                return next;
                              });
                            }}
                            fallback={selectedAvatar}
                            disabled={processing}
                            label={`Avatar pra parte ${i + 1}`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {dynamicMode && mode === 'audio' && audioParts.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted">
                    Audios — ordem + avatar por parte ({audioParts.length}{' '}
                    arquivo{audioParts.length === 1 ? '' : 's'})
                  </div>
                  {audioOrder.map((origIdx, pos) => {
                    const file = audioParts[origIdx];
                    if (!file) return null;
                    const moveSwap = (delta: number) => {
                      const target = pos + delta;
                      if (target < 0 || target >= audioOrder.length) return;
                      setAudioOrder((prev) => {
                        const next = [...prev];
                        [next[pos], next[target]] = [next[target], next[pos]];
                        return next;
                      });
                    };
                    return (
                      <div
                        key={`${origIdx}-${file.name}`}
                        className="flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft/30 p-2"
                      >
                        <span className="mono shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                          #{pos + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] text-text-muted">
                            {file.name}
                          </div>
                          <div className="mt-2 max-w-[320px]">
                            <CompactAvatarPicker
                              selected={partAvatars[origIdx] ?? null}
                              setSelected={(a) => {
                                setPartAvatars((prev) => {
                                  const next = [...prev];
                                  next[origIdx] = a;
                                  return next;
                                });
                              }}
                              fallback={selectedAvatar}
                              disabled={processing}
                              label={`Avatar pra parte ${pos + 1}`}
                            />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveSwap(-1)}
                            disabled={pos === 0 || processing}
                            className="mono rounded border border-line-strong px-2 py-0.5 text-[10px] text-text-muted hover:border-lime hover:text-lime disabled:opacity-30"
                            title="Subir"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSwap(1)}
                            disabled={pos === audioOrder.length - 1 || processing}
                            className="mono rounded border border-line-strong px-2 py-0.5 text-[10px] text-text-muted hover:border-lime hover:text-lime disabled:opacity-30"
                            title="Descer"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {dynamicMode &&
              ((mode === 'copy' && parts.length === 0) ||
                (mode === 'audio' && audioParts.length === 0)) ? (
                <div className="mt-4 rounded-[10px] border border-line bg-bg-soft/30 px-3 py-2 text-[11px] text-text-muted">
                  {mode === 'copy'
                    ? 'Cole uma copy primeiro pra atribuir avatares por parte.'
                    : 'Faca upload dos audios primeiro pra atribuir avatares por parte.'}
                </div>
              ) : null}
            </section>

            {/* Fila de disparos + importar copy do Docs */}
            <section className="border-t border-line pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="label-field !mb-1">Fila de disparos</h2>
                  <p className="text-[11px] text-text-muted">
                    Importe sua copy de um Google Docs (link ou arquivo) e dispare
                    todos os lipsyncs no HeyGen de uma vez — ele identifica HOOK /
                    BODY / avatar sozinho.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <DocImport3DButton
                    onClick={() => {
                      setDocError(null);
                      setDocModalOpen(true);
                    }}
                    disabled={queueRunning}
                    pulse={queue.length === 0}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={addCurrentToQueue}
                  disabled={queueRunning || processing || !selectedAvatar}
                  className="rounded-[10px] border border-line-strong px-3 py-2 text-xs text-text-muted transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                  title="Captura o avatar + copy/áudios atuais como um disparo na fila"
                >
                  + Adicionar config atual à fila
                </button>
                {queue.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    disabled={queueRunning}
                    className="rounded-[10px] border border-line-strong px-3 py-2 text-xs text-text-muted transition hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
                  >
                    Limpar fila
                  </button>
                ) : null}
              </div>

              {queue.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  {queue.map((item) => {
                    const tone =
                      item.status === 'done'
                        ? 'border-lime/40 bg-lime/5'
                        : item.status === 'running'
                          ? 'border-cyan-400/50 bg-cyan-400/5'
                          : item.status === 'failed'
                            ? 'border-red-500/40 bg-red-500/5'
                            : 'border-line bg-bg-soft/30';
                    const sym =
                      item.status === 'done' ? '✓' : item.status === 'running' ? '◷' : item.status === 'failed' ? '✗' : '•';
                    const missingAvatar = item.parts.some((p) => !p.avatarId);
                    // Material visual do card (igual analise do ClickUp Pilot):
                    // thumb do avatar (resolvido por id na library), nome do avatar,
                    // voz e a 1a linha do hook.
                    const headPart = item.parts[0];
                    const headAv = headPart?.avatarId ? avatarById.get(headPart.avatarId) : null;
                    const headThumb = headAv?.thumb || null;
                    const avatarLabel = headAv?.groupName || headPart?.avatarName || headAv?.name || '—';
                    const lookLabel = headPart?.avatarName || headAv?.name || null;
                    const hookText = (item.parts.find((p) => /^HOOK/i.test(p.label))?.text || '').trim();
                    const voiceLabel = item.voiceName || null;
                    return (
                      <div key={item.id} className={'rounded-[12px] border px-3 py-2.5 ' + tone}>
                        <div className="flex items-start gap-3">
                          {/* Thumbnail do avatar */}
                          <div className="relative h-[60px] w-[46px] shrink-0 overflow-hidden rounded-[8px] border border-line-strong bg-bg">
                            {headThumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={headThumb}
                                alt={avatarLabel}
                                className="absolute inset-0 h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[18px] text-text-muted">
                                🧑
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="mono text-sm text-white">
                                {sym} {item.adName}
                              </span>
                              <span className="mono rounded-full border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted">
                                {item.source === 'doc' ? 'docs' : 'manual'} · {item.mode} · motor {item.motor}
                              </span>
                              {item.decupagem ? (
                                <span className="label-tech rounded-full bg-cyan-400/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-300">
                                  ✂️ decupa · {(item.decupIntensity ?? DEFAULT_KEEP_SILENCE).toFixed(2)}s
                                </span>
                              ) : (
                                <span className="label-tech rounded-full bg-bg px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted">
                                  sem decupa
                                </span>
                              )}
                            </div>
                            {/* Avatar + voz */}
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                              <span>
                                🧑 <span className="text-white">{avatarLabel}</span>
                                {lookLabel && lookLabel !== avatarLabel ? (
                                  <span className="text-text-muted"> · {lookLabel}</span>
                                ) : null}
                              </span>
                              <span>
                                🎙️{' '}
                                <span className={voiceLabel ? 'text-white' : 'text-text-muted'}>
                                  {voiceLabel || 'voz do avatar'}
                                </span>
                              </span>
                            </div>
                            {/* Preview do hook */}
                            {hookText ? (
                              <div className="mt-1 line-clamp-2 text-[11px] italic text-text-muted">
                                “{hookText}”
                              </div>
                            ) : null}
                            <div className="mono mt-1 text-[10px] uppercase tracking-wide text-text-muted/70">
                              {item.parts.length} parte{item.parts.length === 1 ? '' : 's'}:{' '}
                              {item.parts.map((p) => p.label).join(', ')}
                            </div>
                            {missingAvatar ? (
                              <div className="mt-1 text-[11px] text-yellow-300">
                                ⚠ alguma parte sem avatar casado{item.unmatched?.length ? ` (${item.unmatched.join(', ')})` : ''} — vai usar o avatar selecionado como fallback.
                              </div>
                            ) : null}
                            {item.message ? (
                              <div className={'mono mt-1 text-[10px] uppercase tracking-widest ' + (item.status === 'failed' ? 'text-red-300' : item.status === 'done' ? 'text-lime' : 'text-cyan-300')}>
                                {item.message}
                              </div>
                            ) : null}
                          </div>
                          {item.status !== 'running' ? (
                            <button
                              type="button"
                              onClick={() => removeFromQueue(item.id)}
                              className="shrink-0 rounded p-1 text-text-muted transition hover:bg-red-500/15 hover:text-red-300"
                              title="Remover da fila"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>

                        {/* Barra de progresso (igual ClickUp Pilot) */}
                        {item.status === 'running' || (item.progress != null && item.progress > 0 && item.progress < 100) ? (
                          <div className="mt-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                              <div
                                className={
                                  'h-full rounded-full transition-all duration-500 ' +
                                  (item.status === 'failed' ? 'bg-red-400' : 'bg-gradient-to-r from-cyan-400 to-lime')
                                }
                                style={{ width: `${Math.max(3, item.progress ?? 0)}%` }}
                              />
                            </div>
                            <div className="mono mt-0.5 text-right text-[9px] text-text-muted">
                              {item.phase ? `${item.phase} · ` : ''}{item.progress ?? 0}%
                            </div>
                          </div>
                        ) : null}

                        {/* Controles: Pausar / Retomar / Debug + downloads */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {item.status === 'running' ? (
                            <button
                              type="button"
                              onClick={cancelQueue}
                              className="label-tech rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1 text-[10px] tracking-widest text-yellow-300 transition hover:bg-yellow-500/20"
                            >
                              ⏸ Pausar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => resumeQueueItem(item.id)}
                              disabled={queueRunning || !extStatus.connected}
                              className="label-tech rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1 text-[10px] tracking-widest text-cyan-300 transition hover:bg-cyan-400/20 disabled:opacity-40"
                              title={item.videoIds?.length ? 'Retoma sem re-disparar (re-renderiza + baixa os mesmos vídeos)' : 'Roda esse AD agora'}
                            >
                              🔄 {item.videoIds?.length ? 'Retomar' : 'Rodar'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setQueueDebugOpen((p) => ({ ...p, [item.id]: !p[item.id] }))}
                            className="label-tech rounded-md border border-line-strong px-2.5 py-1 text-[10px] tracking-widest text-text-muted transition hover:border-fuchsia-400 hover:text-fuchsia-300"
                          >
                            🐞 Debug
                          </button>

                          {/* Downloads quando pronto (ZIPs no disco) */}
                          {item.zips?.montado ? (
                            <button
                              type="button"
                              onClick={() => item.batchId && downloadQueueZip(item.batchId, 'montado')}
                              className="label-tech rounded-md border border-lime/50 bg-lime/10 px-2.5 py-1 text-[10px] tracking-widest text-lime transition hover:bg-lime/20"
                              title={item.zips.montado}
                            >
                              ⬇ Montado
                            </button>
                          ) : null}
                          {item.zips?.takes ? (
                            <button
                              type="button"
                              onClick={() => item.batchId && downloadQueueZip(item.batchId, 'takes')}
                              className="label-tech rounded-md border border-line-strong px-2.5 py-1 text-[10px] tracking-widest text-text-muted transition hover:border-lime hover:text-lime"
                              title={item.zips.takes}
                            >
                              ⬇ Takes
                            </button>
                          ) : null}
                          {item.zips?.camo ? (
                            <button
                              type="button"
                              onClick={() => item.batchId && downloadQueueZip(item.batchId, 'camo')}
                              className="label-tech rounded-md border border-fuchsia-500/40 px-2.5 py-1 text-[10px] tracking-widest text-fuchsia-300 transition hover:bg-fuchsia-500/10"
                              title={item.zips.camo}
                            >
                              ⬇ Camuflado
                            </button>
                          ) : null}
                        </div>

                        {/* Painel de Debug */}
                        {queueDebugOpen[item.id] ? (
                          <div className="mt-2 rounded-md border border-fuchsia-500/30 bg-bg/60 p-2">
                            <div className="mono text-[9px] uppercase tracking-widest text-fuchsia-200">
                              Debug · batch {item.batchId || '(não iniciado)'}
                            </div>
                            <ul className="mt-1 grid gap-0.5">
                              {(item.partResults && item.partResults.length > 0
                                ? item.partResults
                                : item.parts.map((p) => ({ label: p.label, videoId: null, error: null }))
                              ).map((pr, i) => (
                                <li key={i} className="mono flex items-center justify-between gap-2 text-[10px]">
                                  <span className="text-text">{pr.label}</span>
                                  {pr.error ? (
                                    <span className="text-red-300">✗ {pr.error.slice(0, 60)}</span>
                                  ) : pr.videoId ? (
                                    <span className="text-lime">✓ {pr.videoId.slice(0, 14)}…</span>
                                  ) : (
                                    <span className="text-text-muted">— pendente</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <div className="mono mt-1 text-[9px] text-text-muted">
                              avatares: {Array.from(new Set(item.parts.map((p) => p.avatarName || p.avatarId || '—'))).join(', ')}
                            </div>
                          </div>
                        ) : null}

                        {/* Preview dos takes (loading → vídeo jogável), igual Auto B-roll */}
                        {item.takePreviews && item.takePreviews.length > 0 ? (
                          <div className="mt-3">
                            <div className="label-tech mb-2 text-[9px] uppercase tracking-widest text-text-muted">
                              Preview dos takes ({item.takePreviews.filter((t) => t.status === 'completed').length}/{item.takePreviews.length} prontos)
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                              {item.takePreviews.map((t, ti) => (
                                <LipsyncPreviewCard
                                  key={ti}
                                  take={t}
                                  position={ti + 1}
                                  total={item.takePreviews!.length}
                                  percent={item.progress ?? 0}
                                  fileBase={item.safeName}
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="mt-1 flex flex-wrap gap-3">
                    {queueRunning ? (
                      <CancelButton onClick={cancelQueue} label="Parar fila (após o disparo atual)" />
                    ) : (
                      <button
                        type="button"
                        onClick={processQueue}
                        disabled={!extStatus.connected || queue.filter((q) => q.status !== 'done').length === 0}
                        className="btn-primary"
                      >
                        ▶ Processar fila ({queue.filter((q) => q.status !== 'done').length})
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-[12px] border border-dashed border-line bg-bg-soft/20 px-4 py-6 text-center text-[12px] text-text-muted">
                  Fila vazia. Clique no botão acima pra importar uma copy do Docs, ou use
                  &ldquo;Adicionar config atual à fila&rdquo;.
                </div>
              )}
            </section>

            {/* Action */}
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              {processing ? (
                <CancelButton onClick={cancel} label="Cancelar" />
              ) : (
                <button
                  onClick={run}
                  className="btn-primary"
                  disabled={
                    !extStatus.connected ||
                    !selectedAvatar ||
                    (mode === 'copy' && parts.length === 0) ||
                    (mode === 'audio' && structuredAudioFiles.length === 0)
                  }
                >
                  Gerar todas as partes via HeyGen
                </button>
              )}
              {/* Download e cancelar-download agora vivem no card (BatchJobCard3D):
               *  botão ⬇ = baixar montado (+ camuflado); ⏸ Pausar = cancela.
               *  Aqui fica só o atalho pro HeyGen Projects. */}
              {results.length > 0 && !processing ? (
                <a
                  href="https://app.heygen.com/projects"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[12px] border border-line-strong px-4 py-2.5 text-sm text-text-muted transition hover:border-lime hover:text-lime"
                >
                  Abrir HeyGen Projects
                </a>
              ) : null}
            </div>

            {error ? (
              <div className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            {stage ? (
              <div className="scan-line rounded-[12px] border border-lime/40 bg-bg-soft/40 px-4 py-3 text-xs text-lime">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
                  </span>
                  <span className="mono uppercase tracking-widest">{stage}</span>
                </div>
              </div>
            ) : null}

            {/* Status do download em andamento */}
            {downloadStage ? (
              <div className="scan-line rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-xs text-fuchsia-200">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-400" />
                  </span>
                  <span className="mono uppercase tracking-widest">{downloadStage}</span>
                </div>
                {/* Status por take agora vive dentro do card (BatchJobCard3D) —
                 *  expanda o card pra ver cada parte. */}
              </div>
            ) : null}

            {/* Resultados — MESMO card do ClickUp Pilot (BatchJobCard3D): fase
             *  pill, barra de carregamento animada, Retomar/Pausar/Debug/Remover
             *  + Download. As filas/estados do Hey Auto e do ClickUp Pilot
             *  seguem SEPARADOS — só o componente visual é compartilhado. O
             *  botão de Docs NÃO aparece (dispensa manual não tem doc). */}
            {results.length > 0 || processing ? (() => {
              const dispatchedCount = results.filter((r) => r.videoId).length;
              const renderedCount = Object.values(downloadStatuses).filter((s) => s.status === 'completed').length;
              const montadoDone = !!pipelineZips.montadoName && !downloading;
              const isRunning = processing || downloading;
              let phase: BatchJob3DPhase;
              if (processing) phase = 'dispatching';
              else if (downloading) {
                const s = (downloadStage || '').toLowerCase();
                if (/montando|montagem|pipeline|decup|assembl/.test(s)) phase = 'post';
                else if (/baixando|zipando|salvando/.test(s)) phase = 'downloading';
                else phase = 'rendering';
              } else if (error && dispatchedCount === 0) phase = 'failed';
              else if (montadoDone) phase = 'done';
              else phase = 'rendering'; // disparado → HeyGen renderizando; clique Baixar
              const total = results.length;
              // Previews por take (loading → vídeo jogável), igual ClickUp Pilot.
              const previewIdxs: number[] = [];
              const previews: LipsyncTake[] = results.map((r, idx) => {
                previewIdxs.push(idx);
                const st = r.videoId ? downloadStatuses[r.videoId] : undefined;
                const status: LipsyncTake['status'] = r.error
                  ? 'failed'
                  : !r.videoId
                    ? 'pending'
                    : (st?.status || 'processing');
                return {
                  label: r.label,
                  status,
                  videoUrl: st?.videoUrl ?? null,
                  error: r.error ?? st?.error ?? null,
                };
              });
              const pct = total > 0 ? Math.round((100 * renderedCount) / total) : 0;
              return (
                <ul className="fade-in-up mt-2 grid gap-2">
                  <BatchJobCard3D
                    taskId={runBatchIdRef.current || safeName}
                    taskName={adName.trim() || safeName}
                    phase={phase}
                    partsTotal={total}
                    partsDispatched={dispatchedCount}
                    partsRendered={renderedCount}
                    message={downloadStage || error || undefined}
                    elapsedMs={runStartedAt ? Date.now() - runStartedAt : 0}
                    allOk={total > 0 && dispatchedCount === total}
                    isPartialDone={phase === 'done' && dispatchedCount < total}
                    onRetomar={() => void downloadAllAsZip()}
                    onPausar={() => { if (processing) cancel(); else if (downloading) cancelDownload(); }}
                    onDebug={() => void run()}
                    onRemove={() => { setResults([]); setError(null); setDownloadStage(null); setDownloadStatuses({}); setRunStartedAt(null); }}
                    onDownload={dispatchedCount > 0 ? (() => void downloadAllAsZip()) : undefined}
                    isRunning={isRunning}
                    isQueued={false}
                  >
                    <div>
                      <div className="label-tech mb-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                        Takes ({renderedCount}/{total} prontos)
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {previews.map((t, ti) => (
                          <LipsyncPreviewCard
                            key={ti}
                            take={t}
                            position={ti + 1}
                            total={previews.length}
                            percent={pct}
                            fileBase={safeName}
                            isRegenerating={editBusy && editPart?.idx === previewIdxs[ti]}
                            onEdit={
                              mode === 'copy' && t.status === 'completed'
                                ? () => openEditPart(previewIdxs[ti])
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </BatchJobCard3D>
                </ul>
              );
            })() : null}
          </div>
        </div>
      </div>

      {/* ===================== Modal: editar/re-gerar 1 parte ===================== */}
      {editPart ? (
        <EditPartModal
          input={{
            label: editPart.label,
            text: editPart.text,
            avatarName:
              ((dynamicMode ? partAvatars[editPart.idx] : null) || selectedAvatar)?.name || undefined,
          }}
          onClose={() => {
            if (!editBusy) setEditPart(null);
          }}
          onRegenerate={(t) => void regeneratePart(t)}
          busy={editBusy}
          errorMsg={editError}
        />
      ) : null}

      {/* ===================== Modal: importar copy do Google Docs ===================== */}
      {docModalOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm md:p-8"
          onClick={() => setDocModalOpen(false)}
        >
          <div
            className="mt-6 w-full max-w-[920px] rounded-[20px] border border-cyan-400/30 bg-bg-soft/95 p-5 shadow-[0_0_60px_-12px_rgba(34,211,238,0.5)] md:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Importar copy do Google Docs</h3>
                <p className="mt-1 text-[12px] text-text-muted">
                  Lê com a mesma inteligência do ClickUp Pilot: identifica AD, HOOK 1/2/…,
                  BODY e casa o avatar de cada parte. Cada AD vira um disparo na fila.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDocModalOpen(false)}
                className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-sm text-text-muted hover:border-red-500/60 hover:text-red-300"
              >
                ×
              </button>
            </div>

            {/* Tabs */}
            <div className="mb-4 flex gap-2">
              {(
                [
                  { id: 'link' as const, label: '🔗 Link do Docs' },
                  { id: 'file' as const, label: '📄 Importar arquivo (.txt / .docx)' },
                ]
              ).map((t) => {
                const active = docTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setDocTab(t.id);
                      setDocError(null);
                      setDocPreview(null);
                    }}
                    className={
                      'flex-1 rounded-[12px] px-4 py-2.5 text-sm transition-all active:scale-[0.98] ' +
                      (active
                        ? 'bg-cyan-400 font-semibold text-black'
                        : 'border border-line-strong text-text-muted hover:border-cyan-400 hover:text-white')
                    }
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {docTab === 'link' ? (
              <div className="grid gap-2">
                <input
                  type="url"
                  value={docLink}
                  onChange={(e) => setDocLink(e.target.value)}
                  placeholder="https://docs.google.com/document/d/.../edit"
                  className="input-field"
                  disabled={docFetching}
                />
                <p className="text-[11px] text-text-muted">
                  Lê docs <span className="text-cyan-300">privados</span> pela extensão (usa a
                  conta logada no navegador). Sem extensão, o doc precisa estar como
                  &ldquo;Qualquer pessoa com o link pode visualizar&rdquo;.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <input
                  type="file"
                  accept=".txt,.docx,text/plain"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setDocError(null);
                    setDocPreview(null);
                    setDocFileName(f.name);
                    try {
                      const txt = await extractTextFromFile(f);
                      setDocText(txt);
                    } catch (err) {
                      setDocError(`Falha ao ler arquivo: ${(err as Error)?.message}`);
                      setDocText('');
                    }
                  }}
                  className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-cyan-400 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                  disabled={docFetching}
                />
                {docFileName ? (
                  <p className="text-[11px] text-cyan-300">
                    📎 {docFileName} {docText ? `(${docText.length} chars lidos)` : ''}
                  </p>
                ) : (
                  <p className="text-[11px] text-text-muted">
                    Exporte do Google Docs como .txt ou .docx (Arquivo → Fazer download).
                  </p>
                )}
              </div>
            )}

            {/* Nomenclaturas dos ADs (1 campo por AD) — igual nome de task do
                ClickUp Pilot. Bloqueado quando o toggle "pegar todos" esta ON.
                O toggle 3D (sem texto, animado ao ligar) fica no header. */}
            <div
              className="mt-5 rounded-[12px] border border-line bg-bg/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="label-tech text-[10px] uppercase tracking-widest text-cyan-300">
                  Nomenclaturas dos ADs (opcional)
                </span>
                <Toggle3DIcon
                  on={docAutoAll}
                  onChange={setDocAutoAll}
                  ariaLabel="Pegar TODOS os ADs do doc (bloqueia as nomenclaturas)"
                  variant="fuchsia"
                  disabled={docFetching}
                  icon={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  }
                />
              </div>
              <div
                className={
                  'transition-opacity ' + (docAutoAll ? 'pointer-events-none opacity-40' : '')
                }
              >
              <div className="grid gap-2">
                {docAdNames.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="mono w-5 shrink-0 text-center text-[11px] text-text-muted">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) =>
                        setDocAdNames((prev) => prev.map((n, k) => (k === i ? e.target.value : n)))
                      }
                      placeholder="Ex: AD139GL - VFPB04"
                      className="input-field flex-1 font-mono text-sm"
                      disabled={docFetching || docAutoAll}
                    />
                    {docAdNames.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setDocAdNames((prev) => prev.filter((_, k) => k !== i))}
                        disabled={docFetching || docAutoAll}
                        className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-text-muted transition hover:border-red-500/60 hover:text-red-300"
                        title="Remover este AD"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDocAdNames((prev) => [...prev, ''])}
                disabled={docFetching || docAutoAll || docAdNames.length >= 30}
                className="label-tech mt-2 rounded-[10px] border border-dashed border-cyan-400/40 bg-cyan-400/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-cyan-300 transition hover:bg-cyan-400/10 disabled:opacity-40"
              >
                + adicionar AD
              </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={parseDocAndPreview}
                disabled={docFetching || (docTab === 'link' ? !docLink.trim() : !docText.trim())}
                className="btn-primary"
              >
                {docFetching ? 'Lendo…' : '🧠 Analisar copy'}
              </button>
            </div>

            {docError ? (
              <div className="mt-3 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {docError}
              </div>
            ) : null}

            {/* O resultado da análise NÃO renderiza mais aqui no modal —
                abre em TELA CHEIA (docAnalysisOpen), com o mesmo layout do
                ClickUp Pilot. Este modal é SÓ pra importar. */}
          </div>
        </div>
      ) : null}

      {/* ═══════════════ TELA CHEIA DE ANÁLISE (igual ClickUp Pilot) ═══════════════
          O modal acima é só pra importar; o RESULTADO da análise abre aqui em
          tela cheia, com o mesmo layout/capacidade do ClickUp Pilot: cada AD
          vira um card com avatares (thumb + Baixar + @username + pendente),
          troca de avatar/voz, preview do texto editável por avatar, e os CTAs
          "Copiar todos os bodies" + "Adicionar à fila". */}
      {docAnalysisOpen && docPreview && docPreview.length > 0 ? (
        <div className="fixed inset-0 z-[130] flex flex-col bg-black/85 backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-cyan-400/20 bg-bg-soft/95 px-5 py-4 md:px-8">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white md:text-xl">Análise da copy</h2>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {docPreview.length} AD(s) detectado(s) — escolha quais enfileirar, troque o avatar/voz
                de cada speaker e revise o texto. Mesma inteligência do ClickUp Pilot.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDocAnalysisOpen(false);
                  setDocModalOpen(true);
                }}
                className="mono rounded-[10px] border border-line-strong px-3 py-2 text-[11px] uppercase tracking-widest text-text-muted transition hover:border-cyan-400/60 hover:text-white"
              >
                ← Voltar pra importação
              </button>
              <button
                type="button"
                onClick={() => setDocAnalysisOpen(false)}
                className="rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-text-muted transition hover:border-red-500/60 hover:text-red-300"
                title="Fechar (mantém a análise — reabra pra continuar)"
              >
                ×
              </button>
            </div>
          </div>

          {docError ? (
            <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2.5 text-xs text-red-300 md:px-8">
              {docError}
            </div>
          ) : null}

          {/* Toolbar: marcar/desmarcar todos */}
          <div className="flex items-center gap-2 border-b border-line/60 bg-bg/40 px-5 py-2 md:px-8">
            <button
              type="button"
              onClick={() =>
                setDocSelected(Object.fromEntries(docPreview.map((d) => [d.baseAdId, true])))
              }
              className="mono rounded-md border border-lime/40 bg-lime/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-lime transition hover:bg-lime/20"
            >
              ✓ marcar todos
            </button>
            <button
              type="button"
              onClick={() =>
                setDocSelected(Object.fromEntries(docPreview.map((d) => [d.baseAdId, false])))
              }
              className="mono rounded-md border border-line-strong px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-red-500/50 hover:text-red-300"
            >
              limpar
            </button>
            <span className="mono ml-auto text-[10px] uppercase tracking-widest text-text-muted">
              {Object.values(docSelected).filter(Boolean).length}/{docPreview.length} selecionado(s)
            </span>
          </div>

          {/* Lista de ADs */}
          <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
            <ul className="mx-auto grid max-w-[1100px] gap-4">
              {docPreview.map((d) => {
                const checked = !!docSelected[d.baseAdId];
                const hooks = d.parts.filter((p) => /^HOOK/i.test(p.label));
                const bodyParts = d.parts.filter((p) => /^BODY/i.test(p.label));
                const slots = docSlots[d.baseAdId] || [];
                return (
                  <li
                    key={d.baseAdId}
                    className={
                      'rounded-[16px] border p-4 transition ' +
                      (checked
                        ? 'border-cyan-400/40 bg-cyan-400/[0.04]'
                        : 'border-line bg-bg-soft/40')
                    }
                  >
                    {/* Header do AD */}
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex min-w-0 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDocSelected((prev) => ({ ...prev, [d.baseAdId]: e.target.checked }))
                          }
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-cyan-400"
                        />
                        <div className="min-w-0">
                          <h3
                            className="mono text-[16px] font-bold text-white"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            {d.baseAdId}
                          </h3>
                          <div className="mono mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                            <span>
                              {d.parts.length} takes ({hooks.length} hook{hooks.length === 1 ? '' : 's'} +{' '}
                              {bodyParts.length} body split{bodyParts.length === 1 ? '' : 's'}) — Avatar III
                            </span>
                            {d.fromDarkoBriefing ? null : (
                              <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 uppercase tracking-widest text-yellow-300">
                                copy genérica
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    </div>

                    {/* Avatares */}
                    {slots.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        <div className="label-tech text-[9.5px] tracking-[0.18em] text-text-muted">
                          Avatares ({slots.length}) — selecione cada um e a voz
                        </div>
                        {slots.map((slot, sIdx) => {
                          const selectedOpt: AvatarOption | null = slot.avatarId
                            ? avatarById.get(slot.avatarId) ??
                              ({
                                id: slot.avatarId,
                                name: slot.avatarName || slot.avatarId,
                                thumb: null,
                                videoPreview: null,
                                type: 'avatar',
                                version: 'III',
                                voiceId: slot.defaultVoiceId,
                              } as AvatarOption)
                            : null;
                          const effVoiceId = slot.voiceOverride?.id || slot.defaultVoiceId || null;
                          const noVoice = !!slot.avatarId && !effVoiceId;
                          const effectiveVoiceLabel = slot.voiceOverride?.name
                            ? slot.voiceOverride.name
                            : slot.defaultVoiceId
                              ? 'voz padrão do avatar'
                              : noVoice
                                ? 'sem voz'
                                : '?';
                          // Partes que esse avatar vai falar — single avatar fala tudo.
                          const partsForRole =
                            slots.length === 1
                              ? d.parts.map((p, i) => ({ p, i }))
                              : d.parts
                                  .map((p, i) => ({ p, i }))
                                  .filter(({ p }) => (p.role || '').toLowerCase() === slot.role);
                          const briefingThumbUrl = slot.briefingFileId
                            ? `https://drive.google.com/thumbnail?id=${slot.briefingFileId}&sz=w200`
                            : slot.youtubeThumb || null;
                          const previewKey = `${d.baseAdId}:${sIdx}`;
                          return (
                            <div
                              key={sIdx}
                              className="hover-lift rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_14px_-6px_rgba(0,0,0,0.4)]"
                            >
                              {/* Cabeçalho do slot */}
                              <div className="mono flex flex-wrap items-center gap-2 text-[10px]">
                                <span className="rounded-full border border-lime/40 bg-lime/18 px-2 py-[3px] font-bold uppercase tracking-widest text-lime">
                                  {slot.roleLabel}
                                </span>
                                <span className="text-white/70">
                                  {slot.youtubeUrl
                                    ? 'ref. YouTube'
                                    : slot.username
                                      ? `@${slot.username}`
                                      : 'sem @handle'}
                                </span>
                                <span className="text-text-muted">
                                  · {partsForRole.length} parte{partsForRole.length === 1 ? '' : 's'}
                                </span>
                                {!slot.avatarId ? (
                                  <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/15 px-2 py-[2px] text-[9px] font-bold uppercase tracking-widest text-red-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                                    Pendente
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDocPreviewOpen((prev) => ({ ...prev, [previewKey]: !prev[previewKey] }))
                                  }
                                  className="ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 shadow-[0_2px_0_rgba(0,0,0,0.4),0_0_8px_rgba(34,211,238,0.3)] transition hover:bg-cyan-500/25 active:translate-y-[1px]"
                                  title="Preview do texto que esse avatar vai falar (editável — corrige leak de indicativo)"
                                >
                                  👁
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeDocSlot(d.baseAdId, sIdx)}
                                  className="rounded-full px-1.5 py-0.5 text-text-muted transition hover:bg-red-500/10 hover:text-red-300"
                                  title="Remover este slot"
                                >
                                  ×
                                </button>
                              </div>

                              {/* Preview editável do texto */}
                              {docPreviewOpen[previewKey] ? (
                                <div className="mt-2 rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-3">
                                  <div className="mono mb-2 text-[9px] uppercase tracking-widest text-cyan-200">
                                    preview do texto pro HeyGen ({slot.roleLabel}) — editável
                                  </div>
                                  {partsForRole.length === 0 ? (
                                    <div className="rounded-[8px] border border-yellow-500/40 bg-yellow-500/5 p-2 text-[11px] text-yellow-200">
                                      ⚠ Nenhuma parte foi atribuída a este avatar.
                                    </div>
                                  ) : (
                                    <div className="grid gap-2">
                                      {partsForRole.map(({ p, i }) => (
                                        <div key={i} className="rounded-[8px] border border-line bg-bg/60 p-2">
                                          <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest">
                                            <span className="shrink-0 font-bold text-cyan-300">{p.label}</span>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                              <span className="text-text-muted">
                                                {p.text.length}c · {p.text.split(/\s+/).filter(Boolean).length}p
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => removeDocPart(d.baseAdId, i)}
                                                title="Excluir esse trecho — não vira take no HeyGen"
                                                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10 text-red-300 transition hover:border-red-400/70 hover:bg-red-500/25"
                                              >
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                                  <path d="m6 6 12 12M18 6 6 18" />
                                                </svg>
                                              </button>
                                            </div>
                                          </div>
                                          <textarea
                                            value={p.text}
                                            onChange={(e) => updateDocPartText(d.baseAdId, i, e.target.value)}
                                            className="mono w-full resize-y rounded border border-line-strong bg-bg/40 px-2 py-1.5 text-[12px] text-text focus:border-cyan-500/60 focus:outline-none"
                                            rows={Math.max(3, Math.min(12, p.text.split('\n').length + 1))}
                                            spellCheck={false}
                                            placeholder="(vazio — esse part não vai gerar nada)"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted">
                                    é o texto EXATO que vai pro avatar — o que você editar aqui é o que dispara.
                                  </div>
                                </div>
                              ) : null}

                              {/* Briefing: thumb + Baixar */}
                              <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                <div className="relative shrink-0">
                                  {briefingThumbUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={briefingThumbUrl}
                                      alt={slot.username || slot.roleLabel}
                                      className="h-20 w-20 rounded-[12px] object-cover shadow-[0_4px_14px_rgba(0,0,0,0.35)] ring-2 ring-white/10"
                                      referrerPolicy="no-referrer"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="flex h-20 w-20 items-center justify-center rounded-[12px] border border-white/12 bg-white/[0.05] text-white/40">
                                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="8" r="4" />
                                        <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="mono text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/85">
                                    Briefing
                                  </div>
                                  <div
                                    className="mt-0.5 truncate text-[13px] font-semibold text-white"
                                    style={{ fontFamily: 'var(--font-tech)' }}
                                  >
                                    {slot.youtubeUrl
                                      ? `${slot.roleLabel} · YouTube`
                                      : slot.username
                                        ? `@${slot.username}.mp4`
                                        : slot.roleLabel}
                                  </div>
                                  {slot.briefingFileId ? (
                                    <a
                                      href={`https://drive.google.com/uc?export=download&id=${slot.briefingFileId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-lime/45 bg-lime/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-lime transition hover:border-lime/65 hover:bg-lime/22"
                                      title="Baixar o arquivo do copywriter no Drive"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                      </svg>
                                      Baixar
                                    </a>
                                  ) : slot.youtubeUrl ? (
                                    <a
                                      href={slot.youtubeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-500/45 bg-red-500/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-red-300 transition hover:border-red-500/65 hover:bg-red-500/22"
                                      title="Abrir o vídeo do YouTube (referência pra clonar a voz)"
                                    >
                                      ▶ YouTube
                                    </a>
                                  ) : (
                                    <span className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] px-2 py-1 text-[9.5px] uppercase tracking-widest text-text-muted">
                                      sem link
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Seletores: Avatar + Voz */}
                              <div className="mt-2.5 grid gap-2">
                                <div>
                                  <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="8" r="4" />
                                      <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                                    </svg>
                                    Avatar HeyGen
                                  </div>
                                  <div className="max-w-[420px]">
                                    <CompactAvatarPicker
                                      selected={selectedOpt}
                                      setSelected={(a) =>
                                        updateDocSlot(d.baseAdId, sIdx, {
                                          avatarId: a?.id || null,
                                          avatarName: a?.name || null,
                                          defaultVoiceId: (a as any)?.voiceId ?? null,
                                          voiceOverride: null,
                                        })
                                      }
                                      label={`Avatar pra ${slot.roleLabel}`}
                                    />
                                  </div>
                                </div>
                                {slot.avatarId ? (
                                  <div>
                                    <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                                      </svg>
                                      Voz
                                      <span
                                        className={`ml-auto normal-case tracking-normal ${slot.voiceOverride ? 'text-lime' : noVoice ? 'text-red-300' : 'text-text-muted/70'}`}
                                      >
                                        {effectiveVoiceLabel}
                                      </span>
                                      {noVoice && !slot.voiceOverride ? (
                                        <span className="rounded-full border border-red-400/50 bg-red-500/15 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-widest text-red-300">
                                          ⚠ escolha
                                        </span>
                                      ) : null}
                                    </div>
                                    <CompactVoiceSelector
                                      selected={slot.voiceOverride}
                                      setSelected={(v) => updateDocSlot(d.baseAdId, sIdx, { voiceOverride: v })}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[10px] border border-yellow-500/40 bg-yellow-500/5 p-3 text-[11px] text-text-muted">
                        <span className="mono text-[9px] uppercase tracking-widest text-yellow-200">
                          ⚠ Nenhum avatar identificado
                        </span>
                        <div className="mt-1">O parser não achou linha &ldquo;Avatar:&rdquo; com @username no doc.</div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* CTA bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-lime/40 bg-bg/95 px-5 py-3 shadow-[0_-4px_30px_-10px_rgba(200,232,124,0.4)] md:px-8">
            <span className="mono text-[11px] text-text-muted">
              <span className="text-lime">
                ✓ {Object.values(docSelected).filter(Boolean).length} selecionado(s)
              </span>{' '}
              · {docPreview.reduce((n, d) => n + (docSelected[d.baseAdId] ? d.parts.length : 0), 0)} take(s)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyAllDocBodies}
                className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-[11px] uppercase tracking-widest text-fuchsia-200 transition hover:bg-fuchsia-500/20"
                title="Copia o body de TODAS as tasks selecionadas, identificado por AD."
              >
                {copiedAllDocBodies ? '✓ bodies copiados' : '⧉ Copiar todos os bodies'}
              </button>
              <button
                type="button"
                onClick={enqueueSelectedDocDisparos}
                disabled={Object.values(docSelected).filter(Boolean).length === 0}
                className="btn-primary disabled:opacity-40"
                title="Adiciona os ADs selecionados na fila de disparos do HeyGen"
              >
                + Adicionar {Object.values(docSelected).filter(Boolean).length} à fila
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
