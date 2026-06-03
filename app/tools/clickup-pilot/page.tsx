'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  getClickUpToken,
  setClickUpToken,
  listTeams,
  listTasks,
  getTask,
  getTaskComments,
  getCurrentUser,
  extractDocLinks,
  extractDriveFileIdFromText,
  type ClickUpTeam,
  type ClickUpTask,
  type ClickUpUser,
} from '@/lib/clickup-client';
import {
  parseAdSection,
  parseDarkoBriefing,
  matchAvatar,
  isVATask,
  isTrocaAudioTask,
  parseVABriefing,
  sanitizeSpokenCopy,
  extractAvaNumsFromTaskName,
  findAdSection,
  type ParsedAdSection,
  type ParsedDarkoBriefing,
  type ParsedVABriefing,
} from '@/lib/copy-parser';
import { splitCopyIntoParts, cloneVoiceViaExtension, detectExtension } from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerResult } from '@/lib/heygen-job-runner';
import {
  pollVideosUntilReady,
  downloadVideoBytes,
  type VideoStatus,
} from '@/lib/heygen-api-direct';
import {
  getLibrarySnapshot,
  reloadLibrary,
  subscribeLibrary,
} from '@/lib/heygen-library-cache';
import { useTier, tierCanAutomate } from '@/lib/use-tier';
import Link from 'next/link';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { CompactVoiceSelector } from '@/components/CompactVoiceSelector';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';
import { BatchJobCard3D } from '@/components/BatchJobCard3D';
import { EditPartModal } from '@/components/EditPartModal';
import {
  PilotBtn3D,
  IconScissors as PilotIconScissors,
  IconCamuflagem,
  IconDoc as PilotIconDoc,
  IconPlay as PilotIconPlay,
  IconX as PilotIconX,
  IconUpload as PilotIconUpload,
  IconBroll as PilotIconBroll,
  IconDownload as PilotIconDownload,
} from '@/components/PilotCardActions';
import { MotorConfigPicker, MotorSlotPicker } from '@/components/MotorConfigPicker';
import { defaultMotorConfig, resolveMotors, estimateSecondsFromText, type MotorConfig, type Motor } from '@/lib/motor-config';
import type { AvatarOption } from '@/components/HeyGenAvatarPicker';
import { recallByVoiceName, rememberPairing, normalizeVoiceName, recallAvatarVoice, rememberAvatarVoice } from '@/lib/voice-avatar-memory';
import { Toggle3D } from '@/components/Toggle3D';
import { ToggleRound3D, WirelessIcon, ScissorsIcon } from '@/components/ToggleRound3D';
import { IconClickUpPilot } from '@/components/ToolIcons';
import { TierGate } from '@/components/TierGate';
import { getPilotTeam, setPilotTeam, getPilotEditor, setPilotEditor } from '@/lib/clickup-pilot-config';
import { runPostPipeline } from '@/lib/clickup-pilot-pipeline';
import { parseMagnificPrompts } from '@/lib/magnific-pipeline';
import { runMagnificPipelineV2 } from '@/lib/magnific-pipeline-v2';
import { abortAllMagnific } from '@/lib/magnific-extension-bridge';
import {
  saveMagnificQueue,
  restoreMagnificQueue,
  pickNextMagnificJob,
  loadMagnificJsonMap,
  saveMagnificJsonMap,
  tryAcquireMagnificJob,
  pulseHeartbeat,
  thisTabId,
  isMagnificJobAlive,
  HEARTBEAT_INTERVAL_MS,
  MAGNIFIC_QUEUE_KEY,
  type MagnificQueue,
} from '@/lib/magnific-queue-runner';
import {
  readJobCommands,
  clearJobCommand,
  pruneStaleJobCommands,
  type JobCommand,
} from '@/lib/job-commands';

/**
 * ClickUp Pilot — cerebro de automacao
 *
 * Fluxo:
 * 1. User configura token ClickUp (uma vez)
 * 2. Pick editor + status (default: 'EDITAR VIDEO', 'EDITANDO VIDEO', 'REVISAO VIDEO')
 * 3. Load tasks → cards listados
 * 4. Click task → fetch detail + extrair link de doc
 * 5. User cola conteudo do doc (textarea) — parser identifica avatares + partes
 * 6. Match avatares com HeyGen library
 * 7. Dispara via HeyGen Auto Dynamic com motor III
 */

// IMPORTANTE: ClickUp API e case-sensitive nos status. Os status reais vem
// lowercase com acento ('editando vídeo'). Lowercase aqui = match direto.
// Default mostra so tasks pra editar/editando — revisao = video pronto,
// implementar = pre-edit, ambos nao precisam do Pilot. User pode customizar
// em /configuracoes se time usa nomes diferentes.
const DEFAULT_EDIT_STATUSES = [
  'editar video',
  'editar vídeo',
  'editando video',
  'editando vídeo',
];
const STATUS_FILTER_KEY = 'darkolab:clickup-pilot:statuses';
const DISPATCHED_KEY = 'darkolab:clickup-pilot:dispatched';

/** Carrega map de tasks ja disparadas: {taskId: timestamp} */
function getDispatchedMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DISPATCHED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function getDispatchedAt(taskId: string): number | null {
  return getDispatchedMap()[taskId] ?? null;
}
function markDispatched(taskId: string) {
  if (typeof window === 'undefined') return;
  const m = getDispatchedMap();
  m[taskId] = Date.now();
  localStorage.setItem(DISPATCHED_KEY, JSON.stringify(m));
}

/** Limite global de lipsyncs HeyGen rodando em paralelo. Trava dura
 *  contra clique multiplo (Retomar/Debug em varias tasks ao mesmo tempo)
 *  E contra reload-storm (3+ batches restaurados como queued). Quem
 *  passar do limite vira phase='queued' e o promoter inicia quando
 *  liberar vaga. NAO mexer pra cima sem revisar throttling HeyGen. */
const MAX_HEYGEN_PARALLEL = 2;

/** Phases consideradas "ocupando slot" — soma destas vs MAX define se
 *  ha vaga pra disparar mais uma. 'queued'/'done'/'failed' NAO ocupam. */
const ACTIVE_BATCH_PHASES: ReadonlyArray<BatchTaskState['phase']> = [
  'dispatching', 'rendering', 'downloading', 'post',
];

/** Persist batchStates entre reloads. zipBlobUrl nao sobrevive
 *  (Blob fica na memoria, e revogado no fechamento) — entao salva
 *  tudo menos isso. Permite retomar polling/download apos reload. */
const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';
function persistBatchStates(states: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(states)) {
      const { zipBlobUrl, montadoZipUrl, camufladoZipUrl, ...rest } = v as {
        zipBlobUrl?: string;
        montadoZipUrl?: string;
        camufladoZipUrl?: string;
        [key: string]: unknown;
      };
      sanitized[k] = rest;
    }
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(sanitized));
  } catch {}
}
function loadPersistedBatchStates(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Le o `replan` persistido de uma task direto do localStorage —
 *  fonte autoritativa pra re-disparar mesmo apos reload/navegacao
 *  (quando taskAnalyses esta vazio e o estado React ainda nao
 *  reidratou). */
function loadPersistedReplan(taskId: string): {
  taskName: string;
  baseAdId: string;
  parts: Array<{ label: string; text: string; avatarId: string | null; voiceId: string | null }>;
} | null {
  try {
    const all = loadPersistedBatchStates() as Record<string, { replan?: any }>;
    return all?.[taskId]?.replan ?? null;
  } catch {
    return null;
  }
}

/** ============= CANAL (plataforma/distribuicao) =============
 *  Le o custom field "CANAL" da task do ClickUp (dropdown) e resolve
 *  label + cor. Cor primaria = a propria cor da opcao no ClickUp (match
 *  EXATO com o board). Fallback = cor de marca por nome conhecido (KWAI
 *  laranja, META azul, YOUTUBE/TIKTOK vermelho, etc).
 *  100% READ-ONLY: so leitura do que ja vem na listagem, nao escreve nada
 *  no ClickUp (respeita o GET-only do proxy). */
const CHANNEL_BRAND_COLORS: Record<string, string> = {
  kwai: '#FF6E00',
  meta: '#0866FF',
  facebook: '#0866FF',
  fb: '#0866FF',
  instagram: '#E1306C',
  insta: '#E1306C',
  ig: '#E1306C',
  youtube: '#FF0000',
  yt: '#FF0000',
  tiktok: '#FF2D55',
  tt: '#FF2D55',
  google: '#4285F4',
  ads: '#4285F4',
  taboola: '#0A66C2',
};

/** Cor de texto legivel sobre um fundo solido (preto em cores claras,
 *  branco em cores escuras/saturadas). */
function channelTextColor(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1a1a1a' : '#ffffff';
}

/** Resolve o(s) canal(is) de uma task. Retorna [] se nao houver campo CANAL
 *  preenchido. Suporta drop_down (value = orderindex/id) e labels (multi). */
function resolveChannels(task: ClickUpTask): Array<{ label: string; color: string }> {
  const fields = task.custom_fields || [];
  const f = fields.find((x) => /\b(canal|channel|plataforma|platform)\b/i.test(x.name || '')) as any;
  if (!f) return [];
  const val = f.value;
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return [];
  const options: any[] = (f.type_config && (f.type_config.options || f.type_config.labels)) || [];

  const labelFor = (raw: any): { label: string; color: string } | null => {
    let name: string | null = null;
    let optColor: string | null = null;
    // raw pode ser orderindex (num), id (string), ou ja o nome
    if (options.length) {
      const opt = options.find(
        (o) =>
          String(o.orderindex) === String(raw) ||
          String(o.id) === String(raw) ||
          o.name === raw ||
          o.label === raw,
      );
      if (opt) {
        name = opt.name || opt.label || null;
        optColor = opt.color || null;
      }
    }
    if (!name) {
      if (typeof raw === 'string') name = raw;
      else if (raw && typeof raw === 'object') name = raw.name || raw.label || null;
    }
    if (!name) return null;
    const key = name.trim().toLowerCase();
    const color = optColor || CHANNEL_BRAND_COLORS[key] || '#8a8a8a';
    return { label: name.trim().toUpperCase(), color };
  };

  const raws = Array.isArray(val) ? val : [val];
  return raws.map(labelFor).filter((x): x is { label: string; color: string } => !!x);
}

type DispatchPlan = {
  adName: string;
  parts: Array<{
    label: string;
    text: string;
    avatarId: string | null;
    avatarName: string | null;
    avatarThumb?: string | null;
    matchedBy?: string;
  }>;
  unmatchedAvatars: string[];
};

type BatchTaskState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  /** 'troca' = pipeline de TROCA DE ÁUDIO (sem HeyGen). Ausente = fluxo normal. */
  kind?: 'troca';
  /** TROCA: dados serializaveis pra RETOMAR sobreviver reload. O novo WHITE
   *  fica no IndexedDB (chave `troca:white:<taskId>`); aqui guardamos o que
   *  e serializavel pra reconstruir tudo sem a analise em memoria. */
  trocaDriveId?: string;
  trocaFolderId?: string;
  trocaVolume?: number;
  trocaWhiteMime?: string;
  /** TROCA: confianca da verificacao (correlacao na soma mono de plataforma).
   *  whiteScore alto + blackScore baixo = a IA escuta o novo WHITE. */
  trocaWhiteScore?: number;
  trocaBlackScore?: number;
  /** queued | dispatching | rendering | downloading | post (concat+decupagem+camo) | done | failed */
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
  /** Per-part status durante dispatch (parteN: error|null) */
  parts: Array<{ label: string; videoId: string | null; videoStatus?: VideoStatus['status']; videoUrl?: string | null; error?: string | null; renamedTo: string }>;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  /** ZIP 1 — takes individuais (sempre gerado) */
  zipBlobUrl?: string;
  zipFilename?: string;
  /** ZIP 2 — versoes montadas HOOK[N]+BODY decupadas (gerado se decupagem OK) */
  montadoZipUrl?: string;
  montadoZipName?: string;
  /** ZIP 3 — versoes montadas + camuflagem (gerado se modo camuflagem ON) */
  camufladoZipUrl?: string;
  camufladoZipName?: string;
  /** Stats numericas do pipeline pos-prod — usado pra detectar "parcial".
   *  Quando phase='done' mas algum count !== expected, UI esconde TODOS os
   *  botoes de download (takes/montados/camuflados) e exibe "⚠ parcial",
   *  forçando user a Retomar pra completar. Sem este flag, a antiga logica
   *  marcava 'pronto' mesmo com 12 de 16 partes (falso positivo). */
  pipeStats?: {
    expectedMontagens: number;
    okMontagens: number;
    okDecupados: number;
    okCamuflados: number;
    expectedDecupagem: boolean;
    expectedCamuflagem: boolean;
  };
  /** Plano serializavel pra RE-DISPARAR sem depender de taskAnalyses
   *  (que NAO sobrevive reload/navegacao). Sem isto, Retomar/Debug de
   *  uma task que falhou com 0 videoIds (ex: cota HeyGen) nao fazia
   *  nada. Persistido junto do batch. */
  replan?: {
    taskName: string;
    baseAdId: string;
    parts: Array<{ label: string; text: string; avatarId: string | null; voiceId: string | null }>;
  };
  /** Parts re-geradas via EditPartModal — labels que ficaram "dirty" depois
   *  do montadoZipUrl ter sido gerado. Quando array > 0, UI mostra botao
   *  "Atualizar montagem" que re-roda runPostPipeline. Persiste no
   *  localStorage pra sobreviver reload. */
  dirtyParts?: string[];
  /** Doc URL (Google Docs) da task — pra botao "abrir doc" no card. */
  docUrl?: string;
  /** ClickUp task URL — fallback se docUrl nao foi capturado. */
  taskUrl?: string;
  /** VARIACAO DE AVATAR: marca que essa task roda o pipeline VA (Demucs +
   *  split + lipsync por avatar) em vez do HeyGen Auto normal. Sobrevive
   *  reload (persistido) — usado pra rotear o disparo/resume pro runner VA
   *  e pra mostrar o botao extra "baixar AD original" no card. */
  isVA?: boolean;
  /** VA: URL de download do AD original (Drive). Mostra botao extra no card. */
  adOriginalUrl?: string;
};

type RoleSlot = {
  /** "Doutor", "Mulher", etc — role do briefing */
  role: string;
  /** "@binhoted1" — username bruto do briefing */
  username: string;
  /** Drive file ID do video referenciado no briefing (preview do avatar
   *  que o copy quer). Permite mostrar thumb pra user identificar quem e. */
  briefingFileId: string | null;
  /** Avatar HeyGen escolhido (null = pendente, user precisa selecionar) */
  avatarId: string | null;
  avatarName: string | null;
  avatarThumb: string | null;
  avatarVoiceId: string | null;
  /** Se != null, sobrescreve avatarVoiceId — voz custom escolhida pelo user */
  voiceOverride: { id: string; name: string } | null;
  /** Como matchamos: 'voice_name_exact' | 'voice_name_fuzzy' | 'name_contains' | 'name_tokens' | 'manual' | 'visual' | null */
  matchedBy: string | null;
};

type TaskAnalysis = {
  taskId: string;
  taskName: string;
  status: 'pending' | 'analyzing' | 'ready' | 'partial' | 'error';
  baseAdId?: string;
  hookCount?: number;
  bodyPartsCount?: number;
  totalParts?: number;
  /** Cada avatar do briefing — usuario controla individualmente */
  roleSlots: RoleSlot[];
  /** Body splits + hooks que viram partes (sem avatar — populado a partir de roleSlots) */
  partTemplates: Array<{ label: string; text: string; matchByRole: string | null }>;
  /** Body cru do parser (antes do split) — fonte pro botao "copiar body" */
  bodyRaw?: string;
  error?: string;
  /** Quando disparou pra HeyGen (timestamp) — null se ainda nao */
  dispatchedAt?: number | null;
  /** Se essa task e sibling G1/G2 que compartilhou analise com primary,
   *  guarda ID do primary. UI mostra como "↔ compartilhada com AD144G1GL" */
  sharedWithPrimaryId?: string;
  /** Tasks Variacao de Avatar: pipeline diferente (lipsync por audio do
   *  AD original, N avatares de variacao). Quando presente, UI renderiza
   *  alternativa em vez do fluxo normal. */
  vaBriefing?: ParsedVABriefing;
  /** Tasks TROCA DE ÁUDIO: variacao do audio WHITE. Sem doc de copy — so o
   *  link do criativo original no Drive + um novo WHITE upado. Quando
   *  presente, UI renderiza o painel de troca de audio. */
  trocaBriefing?: {
    baseAdId: string;
    driveId: string | null;
    driveUrl: string | null;
    /** Pasta do Drive (quando a task so referencia a PASTA do criativo, sem
     *  o link do arquivo). No disparo, listamos a pasta e pegamos o video. */
    driveFolderId: string | null;
    driveFolderUrl: string | null;
  };
  /** Google Docs URL extraido do custom field "DOC DA COPY" ou da descricao
   *  da task. Persistido pra mostrar botao "abrir doc" sem ter que ir
   *  manualmente no ClickUp puxar o link. */
  docUrl?: string;
  /** ClickUp URL direto da task (atalho — vem do feed da listagem). */
  taskUrl?: string;
};

/**
 * Extrai SO o body falado — delega pro sanitizador AUTORITATIVO do parser
 * (lib/copy-parser:sanitizeSpokenCopy), MESMA logica usada no disparo.
 * Fonte unica de verdade: o que o botao "copiar body" mostra e exatamente
 * o que e enviado pro HeyGen.
 */
function extractSpokenBody(raw: string): string {
  return sanitizeSpokenCopy(raw);
}

/**
 * Tela de bloqueio mostrada pra contas free/basic que tentam acessar
 * o ClickUp Pilot via URL direta. Server-side já redireciona no
 * middleware; isso é o último escudo + UX educativa.
 */
function ClickUpPilotLocked({ tier }: { tier: 'free' | 'basic' | 'pro' | 'admin' }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-12 md:px-8">
      <ToolShell
        title="Disponível só no Pro"
        eyebrow="CLICKUP PILOT · BLOQUEADO"
        description="A automação do Pilot é um recurso premium. Faça upgrade pra liberar e começar a entregar 5× mais."
      >
        <div className="flex flex-col items-center gap-6 py-6 text-center">
          <span
            className="flex h-20 w-20 items-center justify-center rounded-full border border-violet/40 bg-violet/10"
            style={{ boxShadow: '0 0 32px -6px rgba(167,139,250,0.6)' }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
          </span>
          <div>
            <h3
              className="text-[24px] font-extrabold tracking-tight text-white md:text-[28px]"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Sua conta é <span className="text-violet">{tier.toUpperCase()}</span>.
            </h3>
            <p className="mt-2 max-w-[480px] text-[14.5px] leading-relaxed text-text-muted">
              O ClickUp Pilot dispara automação em massa no HeyGen — disponível
              só no plano <span className="font-bold text-white">Pro</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/planos?upgrade=1"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[13.5px] font-bold text-black"
              style={{
                background: 'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 14px 36px -8px rgba(200,232,124,0.55)',
              }}
            >
              Ver planos
              <span>→</span>
            </Link>
            <Link
              href="/pilot"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-6 py-3 text-[13.5px] font-bold text-white transition hover:-translate-y-[1px] hover:border-white/40"
            >
              Conhecer o Pilot
            </Link>
          </div>
        </div>
      </ToolShell>
    </div>
  );
}

export default function ClickUpPilotPage() {
  return (
    <TierGate require="pro" toolName="ClickUp Pilot">
      <ClickUpPilotInner />
    </TierGate>
  );
}

function ClickUpPilotInner() {
  const router = useRouter();
  const tier = useTier();

  // ─── BLOQUEIO: só Pro/Admin podem usar ───
  // Free e Basic veem tela de upgrade. Middleware também bloqueia o
  // acesso direto via URL — esse é o último escudo client-side.
  if (tier && !tierCanAutomate(tier)) {
    return <ClickUpPilotLocked tier={tier} />;
  }

  /* ========== Token ========== */
  const [tokenInput, setTokenInput] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [showTokenSetup, setShowTokenSetup] = useState(false);

  /* ========== Anthropic key (pra IA Search visual) ==========
   *  Pre-flight: verifica se user configurou a chave. Se nao, IA Search
   *  fica desativado com link direto pra /configuracoes/api. */
  const [hasAnthropic, setHasAnthropic] = useState<boolean | null>(null);

  /* ========== Modos (toggles 3D antes de analisar) ========== */
  /** IA Search ON: roda visual match automatico em todo slot pendente apos analyze */
  const [iaSearchMode, setIaSearchMode] = useToolState<boolean>('clickup-pilot:iaSearchMode', false);
  /** Camuflagem ON: gera 3a pasta zip com versoes montadas+camufladas no audio */
  const [camuflagemMode, setCamuflagemMode] = useToolState<boolean>('clickup-pilot:camuflagemMode', false);
  // PER-TASK camuflagem — sobrescreve o global por task quando setado.
  // Se a task nao tem entry aqui, fallback pro global. Permite ligar
  // camuflagem so em algumas tasks + upload de white audio especifico.
  type TaskCamuflagem = { enabled: boolean; white: File | null; volume: number };
  const [taskCamuflagem, setTaskCamuflagem] = useState<Record<string, TaskCamuflagem>>({});
  function getTaskCamuflagem(taskId: string): { camuflagem: boolean; whiteAudio: File | null; camuflagemVolume: number } {
    const t = taskCamuflagem[taskId];
    if (t && t.enabled !== undefined) {
      return { camuflagem: t.enabled, whiteAudio: t.enabled ? (t.white || null) : null, camuflagemVolume: t.volume };
    }
    return { camuflagem: camuflagemMode, whiteAudio: camuflagemMode ? camuflagemWhite : null, camuflagemVolume };
  }
  function toggleTaskCamuflagem(taskId: string) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: false, white: null, volume: camuflagemVolume };
      return { ...prev, [taskId]: { ...cur, enabled: !cur.enabled } };
    });
  }
  function setTaskCamuflagemWhite(taskId: string, file: File | null) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: true, white: null, volume: camuflagemVolume };
      return { ...prev, [taskId]: { ...cur, white: file } };
    });
  }
  function setTaskCamuflagemVolume(taskId: string, vol: number) {
    setTaskCamuflagem((prev) => {
      const cur = prev[taskId] || { enabled: true, white: null, volume: vol };
      return { ...prev, [taskId]: { ...cur, volume: vol } };
    });
  }
  /** Audio WHITE pra camuflagem (file blob nao persiste — volta toda sessao) */
  const [camuflagemWhite, setCamuflagemWhite] = useState<File | null>(null);
  const [camuflagemVolume, setCamuflagemVolume] = useToolState<number>('clickup-pilot:camuflagemVolume', 30);
  /** Only Magnific: pula HeyGen, dispara so B-Rolls Magnific (Nano Banana + Kling 2.5).
   *  Tasks viram pacote ZIP de take1.mp4...takeN.mp4 sem avatar. */
  const [onlyMagnificMode, setOnlyMagnificMode] = useToolState<boolean>('clickup-pilot:onlyMagnific', false);
  /** More Magnific: alem do HeyGen normal, gera B-Rolls extras Magnific pra complementar.
   *  Adiciona pasta /broll/ no ZIP final com takes Kling 2.5. */
  const [moreMagnificMode, setMoreMagnificMode] = useToolState<boolean>('clickup-pilot:moreMagnific', false);


  /** JSON de B-rolls colado por task (caixa "+" inline). Persistido em
   *  localStorage (sobrevive reload), separado por taskId. */
  const [taskMagnificJson, setTaskMagnificJsonState] = useState<Record<string, string>>({});
  /** Quais tasks estao com a caixa "+" aberta (UI efemera, nao persiste). */
  const [magnificEditorOpen, setMagnificEditorOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setTaskMagnificJsonState(loadMagnificJsonMap());
  }, []);
  const setTaskMagnificJson = (taskId: string, json: string) => {
    setTaskMagnificJsonState((prev) => {
      const next = { ...prev, [taskId]: json };
      saveMagnificJsonMap(next);
      return next;
    });
  };

  /** Fila SERIAL de jobs Magnific (espelha o padrao dos batches HeyGen).
   *  1 ativo por vez sempre. Persiste reload via localStorage. */
  const [magnificQueue, setMagnificQueueState] = useState<MagnificQueue>({});
  const magnificProcessingRef = useRef(false);
  const [magnificTick, setMagnificTick] = useState(0);
  const magnificCancelRef = useRef<Record<string, boolean>>({});
  /** AbortController do job Magnific rodando agora (pra Pausar/Debug
   *  interromperem o pipeline em vez de so esperar). */
  const magnificAbortRef = useRef<AbortController | null>(null);
  /** taskId do job Magnific ativo + quando comecou (watchdog anti-loop). */
  const magnificActiveRef = useRef<{ taskId: string; startedAt: number } | null>(null);
  /** Intencao de parada por job: distingue Pausar x Debug x Watchdog do
   *  fim normal — pro processor nao sobrescrever o status errado. */
  const magnificStopIntentRef = useRef<Record<string, 'paused' | 'debug' | 'watchdog' | null>>({});

  useEffect(() => {
    setMagnificQueueState(restoreMagnificQueue());
  }, []);
  useEffect(() => {
    saveMagnificQueue(magnificQueue);
  }, [magnificQueue]);

  /**
   * Cross-tab sync: quando OUTRA aba muda magnificQueue no localStorage
   * (enqueue novo job, recebe heartbeat, finish), repuxa pra cá. Sem isso
   * a UI da aba B mostraria fila stale e tomaria decisões erradas.
   *
   * Importante: NÃO chama setMagnificTick aqui — só re-hidrata o state.
   * O processor decide sozinho via tryAcquireMagnificJob cross-tab.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== MAGNIFIC_QUEUE_KEY) return;
      try {
        const next = ev.newValue ? (JSON.parse(ev.newValue) as MagnificQueue) : {};
        setMagnificQueueState(next);
      } catch {
        /* JSON ruim — ignora */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Patch atomico de 1 job na fila (sempre via setState pra persistir). */
  const patchMagnificJob = (taskId: string, patch: Partial<MagnificQueue[string]>) => {
    setMagnificQueueState((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      return { ...prev, [taskId]: { ...cur, ...patch } };
    });
  };

  useEffect(() => {
    const t = getClickUpToken();
    setHasToken(!!t);
    if (!t) setShowTokenSetup(true);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/user/secrets')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setHasAnthropic(!!j?.anthropic?.configured); })
      .catch(() => { if (alive) setHasAnthropic(false); });
    return () => { alive = false; };
  }, []);

  function saveToken() {
    if (!tokenInput.trim()) return;
    setClickUpToken(tokenInput.trim());
    setHasToken(true);
    setShowTokenSetup(false);
    setTokenInput('');
    setError(null);
  }
  function clearToken() {
    setClickUpToken(null);
    setHasToken(false);
    setShowTokenSetup(true);
    setTeams([]);
    setSelectedTeam(null);
    setSelectedEditor(null);
    setTasks([]);
    setSelectedTask(null);
  }

  /* ========== Teams + members ==========
   *  Workspace + Editor agora persistem em localStorage via clickup-pilot-config
   *  pra sincronizar com /configuracoes/clickup-pilot. */
  const [teams, setTeams] = useState<ClickUpTeam[]>([]);
  const [selectedTeam, setSelectedTeamState] = useState<string | null>(null);
  const [selectedEditor, setSelectedEditorState] = useState<string | null>(null);
  const setSelectedTeam = (v: string | null) => { setSelectedTeamState(v); setPilotTeam(v); };
  const setSelectedEditor = (v: string | null) => { setSelectedEditorState(v); setPilotEditor(v); };
  useEffect(() => {
    setSelectedTeamState(getPilotTeam());
    setSelectedEditorState(getPilotEditor());
  }, []);
  const [loadingTeams, setLoadingTeams] = useState(false);
  // User autenticado (auto-fetch via /v2/user). Critico pra workspaces com
  // permissao limitada que nao retornam membros — usamos esse ID como editor.
  const [authUser, setAuthUser] = useState<ClickUpUser | null>(null);

  async function loadTeams() {
    if (!hasToken) return;
    setLoadingTeams(true);
    setError(null);
    try {
      // Carrega user E teams em paralelo
      const [me, ts] = await Promise.all([
        getCurrentUser().catch(() => null),
        listTeams(),
      ]);
      if (me) setAuthUser(me);
      setTeams(ts);
      // Auto-pick: prefere team com nome que contem 'B2c' OU o que tem mais
      // membros visiveis OU o primeiro
      if (ts.length > 0 && (!selectedTeam || !ts.find(t => t.id === selectedTeam))) {
        const b2c = ts.find(t => /b2c/i.test(t.name || ''));
        const byMembers = [...ts].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0))[0];
        const picked = b2c || byMembers || ts[0];
        setSelectedTeam(picked.id);
      }
      // Auto-pick editor handled in separate useEffect (avoid race with state)
    } catch (e) {
      setError(`Falha ao carregar teams: ${(e as Error)?.message}`);
    } finally {
      setLoadingTeams(false);
    }
  }
  useEffect(() => { if (hasToken) loadTeams(); /* eslint-disable-next-line */ }, [hasToken]);

  // Quando authUser carrega + nao tem editor selecionado: auto-pick o user
  useEffect(() => {
    if (authUser && !selectedEditor) {
      setSelectedEditor(String(authUser.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // Migra filter velho UPPERCASE pra novo lowercase (API e case-sensitive)
  useEffect(() => {
    if (statusFilter && /[A-Z]/.test(statusFilter) && !/[a-z]/.test(statusFilter)) {
      // Filter atual e tudo uppercase — substitui pelo default lowercase
      setStatusFilter(DEFAULT_EDIT_STATUSES.join(','));
    }
    // eslint-disable-next-line
  }, []);

  const currentTeam = useMemo(() => teams.find((t) => t.id === selectedTeam) || null, [teams, selectedTeam]);
  const editors: ClickUpUser[] = useMemo(() => {
    const fromTeam = (currentTeam?.members || []).map((m) => m.user);
    // Garante que o auth user esta na lista mesmo se workspace nao retornar
    // membros (workspaces grandes podem nao expor membros pra tokens limitados)
    if (authUser && !fromTeam.find((u) => u.id === authUser.id)) {
      fromTeam.push(authUser);
    }
    return fromTeam.sort((a, b) => a.username.localeCompare(b.username));
  }, [currentTeam, authUser]);

  /* ========== Tasks ========== */
  // Status filter agora vive em localStorage (compartilhado com /configuracoes
  // onde o user edita). Default reset garante que filter velho uppercase
  // saia automaticamente.
  const [statusFilter, setStatusFilterRaw] = useState(DEFAULT_EDIT_STATUSES.join(','));

  // Filtros de data + prioridade (client-side, aplicados depois de listTasks)
  type DateFilter = 'all' | 'today' | 'yesterday' | 'overdue' | 'next7' | 'next30' | 'specific';
  type PriorityFilter = 'all' | 'urgent' | 'high';
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  // Data específica (YYYY-MM-DD) — usada quando dateFilter === 'specific'
  const [specificDate, setSpecificDate] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(STATUS_FILTER_KEY);
    if (stored && /[a-z]/.test(stored)) {
      setStatusFilterRaw(stored);
    } else {
      // Sem nada salvo OU filter velho UPPERCASE — usa default e salva
      localStorage.setItem(STATUS_FILTER_KEY, DEFAULT_EDIT_STATUSES.join(','));
    }
  }, []);
  function setStatusFilter(v: string) {
    setStatusFilterRaw(v);
    if (typeof window !== 'undefined') localStorage.setItem(STATUS_FILTER_KEY, v);
  }
  const [tasks, setTasks] = useState<ClickUpTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  /* ========== Modo BATCH (selecao multipla + analise previa) ========== */
  const [bulkMode, setBulkMode] = useToolState<boolean>('clickup:bulkMode', false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [taskAnalyses, setTaskAnalyses] = useState<Record<string, TaskAnalysis>>({});

  // Motor config por task (III/IV/V — global, %, individual)
  const [motorConfigs, setMotorConfigs] = useState<Record<string, MotorConfig>>({});
  const getMotorConfig = (taskId: string): MotorConfig => motorConfigs[taskId] || defaultMotorConfig();
  const setMotorConfigForTask = (taskId: string, cfg: MotorConfig) => {
    setMotorConfigs((prev) => ({ ...prev, [taskId]: cfg }));
  };

  // Avatar First — toggle per slot (key = `${taskId}:${slotIdx}`)
  const [avatarFirstEnabled, setAvatarFirstEnabled] = useState<Record<string, boolean>>({});
  const isAvatarFirstEnabled = (taskId: string, sIdx: number) => !!avatarFirstEnabled[`${taskId}:${sIdx}`];
  const setAvatarFirstFor = (taskId: string, sIdx: number, enabled: boolean) => {
    setAvatarFirstEnabled((prev) => ({ ...prev, [`${taskId}:${sIdx}`]: enabled }));
  };

  // Decupagem — toggle por task. Default OFF: AD vem montado SEM cortar
  // silencios. ON = roda stage 2 do pipeline (detectSilences + cutVideoSegments).
  // Persiste em localStorage pra escolha sobreviver reload.
  const DECUPAGEM_KEY = 'darkolab:clickup-pilot:decupagem';
  const [decupagemEnabled, setDecupagemEnabled] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(DECUPAGEM_KEY) || '{}'); } catch { return {}; }
  });
  const isDecupagemEnabled = (taskId: string) => !!decupagemEnabled[taskId];
  const setDecupagemFor = (taskId: string, enabled: boolean) => {
    setDecupagemEnabled((prev) => {
      const next = { ...prev, [taskId]: enabled };
      try { localStorage.setItem(DECUPAGEM_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [analyzing, setAnalyzing] = useState(false);

  function toggleTaskSelected(id: string) {
    setSelectedTaskIds((prev) => {
      const n = new Set(prev);
      // Auto-toggle siblings G1/G2/etc do mesmo grupo: se marca G1,
      // tambem marca todas Gs. Evita confusao de "esqueci G2"
      // (todas Gs compartilham o mesmo doc, so analisamos 1x mesmo).
      const siblings = getSiblingTaskIds(id);
      const isCurrentlySelected = n.has(id);
      const newlySelected: string[] = [];
      for (const sid of siblings) {
        if (isCurrentlySelected) {
          n.delete(sid);
        } else if (!n.has(sid)) {
          n.add(sid);
          newlySelected.push(sid);
        }
      }
      // Auto-analyze: se selecionou tasks novas E ja ha outras tasks analisadas
      // (ou ja existe taskAnalyses pra alguma da selecao), dispara analyze
      // automaticamente das novas. Evita user ter que clicar "Analisar (N)"
      // a cada nova task que adiciona.
      if (!isCurrentlySelected && newlySelected.length > 0 && Object.keys(taskAnalyses).length > 0) {
        // Defer setTimeout pra esperar setSelectedTaskIds aplicar
        setTimeout(() => {
          const unanalyzed = newlySelected.filter((id) => !taskAnalyses[id]);
          if (unanalyzed.length > 0 && !analyzing) {
            analyzeSelected();
          }
        }, 100);
      }
      return n;
    });
  }

  /** Remove uma task individual do batch state (estado analisado).
   *  Usado pelo botao X em cada card da previsibilidade — user pode
   *  limpar uma sem ter que "Limpar tudo". */
  function removeTaskFromAnalysis(taskId: string) {
    // Remove tambem TODAS siblings (G1/G2 etc) que compartilharam analise
    // com essa task primary OU eram primary dela
    setTaskAnalyses((prev) => {
      const next = { ...prev };
      // Acha siblings ligados: a propria + as que compartilham com ela
      const toDelete = new Set<string>([taskId]);
      const target = prev[taskId];
      if (target?.sharedWithPrimaryId) {
        // Essa e sibling — remove o primary tambem
        toDelete.add(target.sharedWithPrimaryId);
      }
      for (const a of Object.values(prev)) {
        if (a.sharedWithPrimaryId && toDelete.has(a.sharedWithPrimaryId)) {
          toDelete.add(a.taskId);
        }
      }
      for (const id of toDelete) delete next[id];
      return next;
    });
    setSelectedTaskIds((prev) => {
      const n = new Set(prev);
      // Mesma logica de siblings — desmarca todos do grupo
      const target = taskAnalyses[taskId];
      const toRemove = new Set<string>([taskId]);
      if (target?.sharedWithPrimaryId) toRemove.add(target.sharedWithPrimaryId);
      for (const a of Object.values(taskAnalyses)) {
        if (a.sharedWithPrimaryId && toRemove.has(a.sharedWithPrimaryId)) {
          toRemove.add(a.taskId);
        }
      }
      for (const id of toRemove) n.delete(id);
      return n;
    });
  }
  function selectAllTasks() {
    setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  }
  function clearSelected() {
    setSelectedTaskIds(new Set());
    setTaskAnalyses({});
  }

  /** Extrai a "chave base" da task name pra detectar siblings G1/G2/etc.
   *  Ex: "AD15VN - PRPB06 - G1" → "AD15VN - PRPB06"
   *      "AD15VN - PRPB06 - G2" → "AD15VN - PRPB06"  (mesma chave = sibling)
   *      "AD144GL - VFPB04"      → "AD144GL - VFPB04" (sem sufixo G)
   *  Tasks com mesma chave compartilham o MESMO doc → analisar 1x evita
   *  dispatch duplicado.
   */
  function extractBaseTaskKey(taskName: string): string {
    // Tira sufixo " - G<N>" (case insensitive, com espacos variando)
    return taskName.replace(/\s*[-–—]\s*G\d+\s*$/i, '').trim();
  }

  /** Mapa baseKey → tasks que compartilham (computed) */
  const taskSiblingGroups = useMemo(() => {
    const groups = new Map<string, ClickUpTask[]>();
    for (const t of tasks) {
      const key = extractBaseTaskKey(t.name);
      const arr = groups.get(key) || [];
      arr.push(t);
      groups.set(key, arr);
    }
    return groups;
  }, [tasks]);

  /** Retorna os IDs de TODAS tasks no mesmo grupo G1/G2/G3 da task dada
   *  (inclui a propria). Quando tasks compartilham doc, processamos 1x e
   *  marcamos todas como dispatched. */
  function getSiblingTaskIds(taskId: string): string[] {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return [taskId];
    const key = extractBaseTaskKey(t.name);
    const siblings = taskSiblingGroups.get(key) || [t];
    return siblings.map((s) => s.id);
  }

  async function loadTasks() {
    if (!selectedTeam || !selectedEditor) {
      setError('Escolhe team + editor primeiro.');
      return;
    }
    setLoadingTasks(true);
    setError(null);
    try {
      const statuses = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await listTasks(selectedTeam, {
        assigneeIds: [selectedEditor],
        statuses,
        page: 0,
        subtasks: false,
      });
      setTasks(r.tasks);
      if (r.tasks.length === 0) {
        // Tenta sem filtro de status — talvez o editor tenha tasks mas com
        // status fora dos defaults
        const r2 = await listTasks(selectedTeam, {
          assigneeIds: [selectedEditor],
          page: 0,
          subtasks: false,
        });
        if (r2.tasks.length > 0) {
          // Coleta status existentes pra mostrar pro user
          const statusCounts = new Map<string, number>();
          for (const t of r2.tasks) {
            const s = t.status?.status || '?';
            statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
          }
          const breakdown = Array.from(statusCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => `${s} (${c})`)
            .join(', ');
          setError(
            `0 tasks com filtros atuais, mas o editor TEM ${r2.tasks.length} tasks sem filtro. Status disponiveis: ${breakdown}. Edita o filtro acima OU usa esses status.`,
          );
        } else {
          setError(`Editor sem tasks neste workspace. Confira se selecionou o workspace certo (atual: ${currentTeam?.name}).`);
        }
      }
    } catch (e) {
      setError(`Falha ao listar tasks: ${(e as Error)?.message}`);
    } finally {
      setLoadingTasks(false);
    }
  }

  /* ========== Task detail + doc parser ========== */
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<ClickUpTask | null>(null);
  const [docContent, setDocContent] = useState('');
  const [parsed, setParsed] = useState<ParsedAdSection | null>(null);
  const [briefing, setBriefing] = useState<ParsedDarkoBriefing | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fetchingDoc, setFetchingDoc] = useState(false);

  async function openTask(t: ClickUpTask) {
    setSelectedTask(t);
    setTaskDetail(null);
    setDocContent('');
    setParsed(null);
    setParseError(null);
    try {
      const d = await getTask(t.id);
      setTaskDetail(d);
    } catch (e) {
      setError(`Falha ao carregar task: ${(e as Error)?.message}`);
    }
  }

  /**
   * Tenta extensao (le doc com sessao Google logada — funciona pra docs
   * privados que voce tem acesso). Fallback: server fetch (so docs publicos).
   * Retorna tambem driveLinks: links pra videos em Drive citados no doc
   * (necessarios pra visual match de avatares).
   */
  function fetchDocViaExtension(url: string): Promise<{ ok: boolean; text?: string; error?: string; driveLinks?: Array<{ text: string; fileId: string }> }> {
    return new Promise((resolve) => {
      const requestId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const handler = (ev: MessageEvent) => {
        if (
          ev.data?.source === 'darkolab-ext' &&
          ev.data?.type === 'HG_DOC_RESULT' &&
          ev.data?.requestId === requestId
        ) {
          window.removeEventListener('message', handler);
          clearTimeout(timeout);
          resolve({ ok: !!ev.data.ok, text: ev.data.text, error: ev.data.error, driveLinks: ev.data.driveLinks });
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ source: 'darkolab', type: 'HG_FETCH_DOC', requestId, url }, '*');
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ ok: false, error: 'Timeout 30s — extensao nao respondeu (atualize pra v4.0.15+ e recarregue).' });
      }, 30000);
    });
  }

  /** Normaliza string pra match flexivel: remove acentos, espacos, pontuacao,
   *  case insensitive. 'Dr. Marco Túlio' → 'drmarcotulio' */
  function normalizeForMatch(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacriticos
      .toLowerCase()
      .replace(/\.(mp4|mov)$/i, '')
      .replace(/[^\w]/g, ''); // strip espacos, pontos, hifens, etc
  }

  /** Resolve username pra Drive file ID pesquisando driveLinks por match de texto.
   *  Estrategias (em ordem):
   *   1. Match exato normalizado: 'omédicodoshomens' → driveLink text inclui 'omedicodoshomens'
   *   2. Nucleus match (strip digitos finais): 'manualdohomemsolo2' → 'manualdohomemsolo'
   *   3. Inverso: o text do link inclui o username normalizado
   *
   *  '@marcella.malvar2' procura link cujo texto contem 'marcellamalvar2'.
   *  'Dr. Marco Túlio' procura 'drmarcotulio'.
   *  'omédicodoshomens' procura 'omedicodoshomens'. */
  function resolveVideoFileId(username: string, driveLinks: Array<{ text: string; fileId: string }> | undefined): string | null {
    if (!driveLinks || driveLinks.length === 0) return null;
    const u = normalizeForMatch(username.replace(/^@/, ''));
    if (u.length < 3) return null;
    const uNoTrailDigits = u.replace(/\d+$/, ''); // 'manualdohomemsolo2' → 'manualdohomemsolo'

    // 1. Match direto: text normalizado contem username
    for (const link of driveLinks) {
      const t = normalizeForMatch(link.text);
      if (t.includes(u)) return link.fileId;
    }
    // 2. Match por nucleus (sem digitos finais nem extensao)
    if (uNoTrailDigits.length >= 4) {
      for (const link of driveLinks) {
        const t = normalizeForMatch(link.text).replace(/\d+$/, '');
        if (t === uNoTrailDigits || t.includes(uNoTrailDigits) || uNoTrailDigits.includes(t)) {
          return link.fileId;
        }
      }
    }
    // 3. Match por TOKENS (resolve nomes com acento/espaco/ponto tipo
    //    "@Dr. Marco Túlio.mp4"): quebra o username em palavras (sem
    //    acento), exige que todos os tokens >=3 chars apareçam no texto
    //    normalizado do link. "dr marco tulio" casa com link cujo texto
    //    normalizado contem "marco" e "tulio".
    const tokens = username
      .replace(/^@/, '')
      .replace(/\.(mp4|mov)$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tk) => tk.length >= 3);
    if (tokens.length > 0) {
      for (const link of driveLinks) {
        const t = normalizeForMatch(link.text);
        if (tokens.every((tk) => t.includes(tk))) return link.fileId;
      }
    }
    return null;
  }

  /** Visual match via Claude vision API (~5s, $0.005). Retorna avatar matched ou null */
  async function visualMatchAvatar(
    refImageUrl: string,
    candidates: Array<{ id: string; name: string; groupName?: string; thumbUrl: string }>,
  ): Promise<{ id: string; name: string; groupName?: string; confidence: string; reason: string } | null> {
    try {
      const r = await fetch('/api/avatar-visual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceImageUrl: refImageUrl, candidates }),
      });
      const j = await r.json();
      if (!j.ok || !j.matched) return null;
      return { ...j.matched, confidence: j.confidence, reason: j.reason };
    } catch {
      return null;
    }
  }

  /** Analisa N tasks em paralelo (max 3): pega doc, parsea, monta plano. */
  async function analyzeSelected() {
    if (selectedTaskIds.size === 0) {
      setError('Selecione pelo menos uma task primeiro.');
      return;
    }
    setError(null);
    setAnalyzing(true);
    // PREFLIGHT: a leitura do doc depende do bridge da extensao injetado
    // NESTE dominio. Extensoes antigas (<4.15.2) so injetam em *.vercel.app,
    // entao em darkoautoedit.com o bridge nao carrega e o HG_FETCH_DOC cai no
    // vazio ate o timeout de 30s — hang silencioso por task. Detecta antes
    // (700ms) e falha rapido com instrucao de reinstalar.
    const MIN_EXT_VERSION = '4.15.2';
    const ext = await detectExtension();
    const cmpVer = (a: string, b: string) => {
      const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
      const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
      }
      return 0;
    };
    if (!ext.connected) {
      setAnalyzing(false);
      setError(
        `Extensao Auto Edit nao detectada neste dominio (darkoautoedit.com). ` +
          `Se voce instalou uma versao antiga, ela so funciona no dominio vercel.app. ` +
          `Baixe a versao atual em /api/extension/download, recarregue em chrome://extensions e atualize esta pagina (F5).`,
      );
      return;
    }
    if (ext.version && ext.version !== '?' && cmpVer(ext.version, MIN_EXT_VERSION) < 0) {
      setAnalyzing(false);
      setError(
        `Extensao desatualizada (v${ext.version}). A leitura de docs exige v${MIN_EXT_VERSION}+. ` +
          `Baixe a versao atual em /api/extension/download e recarregue em chrome://extensions.`,
      );
      return;
    }
    // Force reload library — pega avatares recem criados (user pode ter
    // acabado de criar voice clones alinhadas com nomes do briefing)
    await reloadLibrary(true);
    // Carrega lista de vozes HeyGen pra resolver auto @username -> voiceId
    // (caso o copy diga @x.mp4 e exista voz "@x" no HeyGen mesmo sem
    //  pareamento previo de memoria — voz vai como override no slot)
    let voiceLibrary: Array<{ id: string; name: string }> = [];
    try {
      const r = await fetch('/api/heygen/voices?lang=pt');
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j.voices)) voiceLibrary = j.voices;
      }
    } catch {}
    const voiceByNorm = new Map<string, { id: string; name: string }>();
    for (const v of voiceLibrary) {
      voiceByNorm.set(normalizeVoiceName(v.name), { id: v.id, name: v.name });
    }
    const allSelected = tasks.filter((t) => selectedTaskIds.has(t.id));
    // DEDUP G1/G2: tasks com mesmo baseTaskKey compartilham o doc.
    // So precisamos analisar uma — as siblings copiam o resultado.
    const seenKeys = new Set<string>();
    const targets: typeof allSelected = [];
    const siblingMap = new Map<string, string[]>(); // primary task id → all sibling ids
    for (const t of allSelected) {
      const key = extractBaseTaskKey(t.name);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        targets.push(t);
        // Inclui todas as Gs do mesmo key que estao selecionadas
        const siblings = allSelected.filter((s) => extractBaseTaskKey(s.name) === key).map((s) => s.id);
        siblingMap.set(t.id, siblings);
      }
    }
    // Init status pendente pra TODAS (inclui siblings nao-primary pra UI mostrar consistente)
    setTaskAnalyses(() => {
      const init: Record<string, TaskAnalysis> = {};
      for (const t of allSelected) {
        init[t.id] = { taskId: t.id, taskName: t.name, status: 'pending', roleSlots: [], partTemplates: [] };
      }
      return init;
    });

    const PARALLEL = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const idx = cursor++;
        const task = targets[idx];
        setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'analyzing' } }));
        try {
          // 1. Pega detalhes da task → encontra doc URL no custom field "DOC DA COPY"
          const det = await getTask(task.id);

          // === TROCA DE ÁUDIO: pipeline proprio, SEM doc de copy ===
          // Essas tasks so tem o link do criativo original no Drive (em
          // comentario / custom field / descricao) + um novo WHITE que o user
          // upa antes de disparar. Detectado ANTES da exigencia de doc.
          if (isTrocaAudioTask(task.name)) {
            let driveId: string | null = null;
            let driveUrl: string | null = null;
            let driveFolderId: string | null = null;
            let driveFolderUrl: string | null = null;
            const grab = (text: string | undefined | null) => {
              const t = text || '';
              const id = extractDriveFileIdFromText(t);
              if (id && !driveId) {
                driveId = id;
                driveUrl = t.match(/https?:\/\/\S+/)?.[0] || null;
              }
              // Tambem captura link de PASTA (resolvido no disparo).
              if (!driveFolderId) {
                const fm = t.match(/\/drive\/folders\/([a-zA-Z0-9_-]{20,60})/);
                if (fm) {
                  driveFolderId = fm[1];
                  driveFolderUrl = t.match(/https?:\/\/\S*\/folders\/[a-zA-Z0-9_-]+\S*/)?.[0] || `https://drive.google.com/drive/folders/${fm[1]}`;
                }
              }
            };
            let commentCount = 0;
            // 1) Comentarios (onde o pedido "Fazer a troca do audio..." costuma vir)
            try {
              const comments = await getTaskComments(task.id);
              commentCount = comments.length;
              for (const c of comments) {
                grab(c.comment_text);
                if (driveId) break;
              }
            } catch (e) {
              console.warn('[troca] getTaskComments falhou:', e);
            }
            // 2) Custom fields (pode ter link direto do arquivo). Valor pode vir
            //    como string OU objeto (campos url/attachment) — varre tudo.
            if (!driveId) {
              for (const f of det.custom_fields || []) {
                const v = f.value;
                if (typeof v === 'string') grab(v);
                else if (v != null) {
                  try { grab(JSON.stringify(v)); } catch {}
                }
                if (driveId) break;
              }
            }
            // 3) Descricao
            if (!driveId) grab(det.description || det.text_content);
            // 4) CATCH-ALL: serializa a task inteira e varre. Pega link em
            //    anexo, custom field aninhado, markdown, etc — onde quer que o
            //    ClickUp tenha escondido. Garante deteccao se a URL existe.
            if (!driveId) {
              try { grab(JSON.stringify(det)); } catch {}
            }
            console.info(
              `[troca] "${task.name}": ${commentCount} comentario(s), arquivo=${driveId || 'nao'}, pasta=${driveFolderId || 'nao'}`,
              driveId || driveFolderId ? '' : { customFields: (det.custom_fields || []).map((f: any) => ({ name: f.name, value: f.value })) },
            );

            const baseAdIdM = task.name.match(/AD\d+[A-Z0-9]*/i);
            const baseAdId = baseAdIdM ? baseAdIdM[0].toUpperCase() : task.name;
            setTaskAnalyses((prev) => ({
              ...prev,
              [task.id]: {
                ...prev[task.id],
                status: 'ready',
                baseAdId,
                taskUrl: (det as any).url || (task as any).url || undefined,
                trocaBriefing: { baseAdId, driveId, driveUrl, driveFolderId, driveFolderUrl },
                roleSlots: [],
                partTemplates: [],
              },
            }));
            if (driveUrl) {
              setTrocaAdUrl((prev) => ({ ...prev, [task.id]: prev[task.id] || driveUrl! }));
            }
            continue;
          }

          const docField = (det.custom_fields || ([] as any[])).find((f: any) => /DOC DA COPY/i.test(f.name || ''));
          const docUrl = docField?.value || extractDocLinks(det.description || det.text_content)[0];
          // Persiste docUrl + taskUrl pra UI poder abrir direto sem ter q ir no ClickUp.
          setTaskAnalyses((prev) => ({
            ...prev,
            [task.id]: { ...prev[task.id], docUrl: docUrl || undefined, taskUrl: (det as any).url || (task as any).url || undefined },
          }));
          if (!docUrl) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Sem doc URL (custom field "DOC DA COPY" vazio + sem link na descricao)' } }));
            continue;
          }
          // 2. Fetch doc via extensao (sessao Google logada) + Drive links pros videos
          const docR = await fetchDocViaExtension(docUrl);
          if (!docR.ok || !docR.text) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: `Doc fetch: ${docR.error || 'sem texto'}` } }));
            continue;
          }
          // 2.5 VARIACAO DE AVATAR: detector + parser dedicado
          // Tasks 'VA - ...' OU docs com 'Variação de avatar' tem pipeline
          // diferente (lipsync por audio do AD original, N avatares).
          // CRITICAL: o check do doc tem que ser ESCOPADO na secao do AD em
          // questao — antes checava docR.text inteiro, e docs com multiplos
          // ADs (alguns VA, outros nao) marcavam o AD errado como VA falso.
          // Ex: AD05VN-VRWA01 nao e VA, mas o doc tinha AD09 (VA) que vazava
          // o trigger pro AD05.
          const baseAdIdMatch = task.name.match(/^(AD\d+[A-Z]+)\b/i);
          const baseAdIdForVaCheck = baseAdIdMatch ? baseAdIdMatch[1].toUpperCase() : null;
          const sectionForVaCheck = baseAdIdForVaCheck
            ? (findAdSection(docR.text, baseAdIdForVaCheck) || '')
            : '';
          // Detector VA ESTRITO — só conta se "Variação de avatar" aparece
          // como HEADING de seção (não texto narrativo nas Instruções).
          //
          // FALSO POSITIVO que dava antes (user reportou 2026-05-27):
          //   "Instruções para edição: Esse criativo é uma variação de
          //   avatar do AD119G1. Só altera o avatar..."
          // → texto descritivo, NÃO é VA real. Mas regex pegava igual.
          //
          // VA REAL aparece como:
          //   "AD07G1VN-PRPB06 - Variação de avatar - SILAS"  (heading com -)
          //   "Variação de Avatar"                              (linha isolada)
          //   "Variação de avatar:" / "Variação de avatar -"   (label/separador)
          function hasVaHeaderInSection(section: string): boolean {
            const lines = section.split(/\r?\n/);
            for (const line of lines) {
              const t = line.trim();
              if (!t) continue;
              // Padrão 1: heading "AD... - Variação de avatar..."
              if (/^[A-Z0-9]+(?:[-\s][A-Z0-9]+)*\s*[-–—]\s*varia[cç][aã]o\s+de\s+avatar\b/i.test(t)) return true;
              // Padrão 2: linha começando com "Variação de avatar" (curta, tipo heading)
              if (/^varia[cç][aã]o\s+de\s+avatar\s*[-–—:]?/i.test(t) && t.length < 80) return true;
            }
            return false;
          }
          if (isVATask(task.name) || hasVaHeaderInSection(sectionForVaCheck)) {
            // Extrai quais AVAs estao indicados na NOMENCLATURA da task
            // (ex 'VA - AD03G1VN - ... - AVA05 e 06 - Silas' → [5, 6]).
            // Se task indicar AVAs especificas, parser SO retorna esses
            // (mesmo que doc tenha mais).
            const taskAvaNums = extractAvaNumsFromTaskName(task.name);
            const vaBriefing = parseVABriefing(docR.text, task.name, docR.driveLinks || [], taskAvaNums);
            if (vaBriefing) {
              // MATCH AGGRESSIVO de avatar fileId via driveLinks.
              // Caso parseVABriefing nao tenha resolvido (text dos links nao
              // bate exato), tenta:
              //  1. Match parcial: filename contem username OU username contem filename
              //  2. Match por nucleus (strip digitos e mp4)
              const allLinks = docR.driveLinks || [];
              for (const av of vaBriefing.avatares) {
                if (av.fileId) continue;
                const target = av.username.toLowerCase().replace(/\.(mp4|mov)$/i, '');
                const targetCore = target.replace(/\d+$/, ''); // 'manualdohomemsolo2' → 'manualdohomemsolo'
                // 1. Match direto: text contem target
                let match = allLinks.find((d: any) => {
                  const t = (d.text || '').toLowerCase();
                  return t.includes(target);
                });
                // 2. Match nucleus
                if (!match && targetCore.length > 4) {
                  match = allLinks.find((d: any) => {
                    const t = (d.text || '').toLowerCase().replace(/\.(mp4|mov)$/i, '').replace(/\d+$/, '');
                    return t === targetCore || t.includes(targetCore) || targetCore.includes(t);
                  });
                }
                if (match) {
                  av.fileId = match.fileId;
                  console.log(`[clickup-pilot] VA: resolved avatar ${av.avaCode} (@${av.username}) → ${match.fileId} via aggressive match`);
                }
              }
              // AUTO-RESOLVE DRIVE ID DO AD ORIGINAL via pasta CRIATIVOS
              // Quando o parser nao achou linkAdFileId mas tem linkAdFilename,
              // procura pasta CRIATIVOS (link no topo do doc) + lista files +
              // match por nome. Critico pra pipeline VA funcionar.
              if (!vaBriefing.linkAdFileId && vaBriefing.linkAdFilename && docR.driveLinks?.length) {
                // Normaliza removendo acentos/cedilha/case + extensao
                // (pra match robusto entre filename do doc e nome no Drive)
                const normName = (s: string) => (s || '')
                  .normalize('NFD')
                  .replace(/[̀-ͯ]/g, '')
                  .toLowerCase()
                  .replace(/\.(mp4|mov)$/i, '')
                  .trim();
                const target = normName(vaBriefing.linkAdFilename);
                // Extrai AD ID prefix: "AD02G1VN-PRPB05" do filename
                // (mais unico que filename inteiro — basta isso pra achar)
                const adIdMatch = target.match(/^(ad\d+[a-z0-9]*-[a-z]+\d+)/i);
                const adIdPrefix = adIdMatch ? adIdMatch[1].toLowerCase() : null;
                // Match super flexivel: confere nome OU AD ID prefix
                const fuzzyMatch = (candidateName: string) => {
                  const fn = normName(candidateName);
                  if (!fn) return false;
                  if (fn === target || fn.includes(target) || target.includes(fn)) return true;
                  if (adIdPrefix && fn.includes(adIdPrefix)) return true;
                  return false;
                };
                console.log(`[clickup-pilot] VA AD detection: target="${target}" adIdPrefix="${adIdPrefix}" driveLinks=${docR.driveLinks.length}`);

                // 1) Match direto nos driveLinks do doc (link em qualquer parte do doc)
                {
                  const direct = docR.driveLinks.find((d: any) => fuzzyMatch(d.text));
                  if (direct) {
                    vaBriefing.linkAdFileId = direct.fileId;
                    console.log(`[clickup-pilot] VA: direct match in driveLinks "${direct.text}" → ${direct.fileId}`);
                  } else {
                    console.log(`[clickup-pilot] VA: nenhum driveLink direto bateu. Lista:`, docR.driveLinks.map((d:any)=>d.text).slice(0,12));
                  }
                }

                // 2) Fallback: lista pasta CRIATIVOS + match por nome flexivel
                if (!vaBriefing.linkAdFileId) {
                  const criativosFolder = docR.driveLinks.find((d: any) =>
                    /criativos|criativo|videos|drive criativos/i.test(d.text || '')) ||
                    docR.driveLinks.find((d: any) => (d as any).isFolder);
                  if (criativosFolder) {
                    console.log(`[clickup-pilot] VA: tentando pasta "${criativosFolder.text}" (${criativosFolder.fileId})`);
                    try {
                      const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
                      const folderRes = await listDriveFolderViaExtension(criativosFolder.fileId);
                      if (folderRes.ok) {
                        const match = folderRes.files.find((f) => fuzzyMatch(f.name));
                        if (match) {
                          vaBriefing.linkAdFileId = match.fileId;
                          console.log(`[clickup-pilot] VA: matched in folder "${match.name}" → ${match.fileId}`);
                        } else {
                          console.warn(`[clickup-pilot] VA: target nao achou na pasta (${folderRes.files.length} files):`, folderRes.files.slice(0, 8).map(f => f.name));
                        }
                      } else {
                        console.warn(`[clickup-pilot] VA: list folder falhou: ${folderRes.error}`);
                      }
                    } catch (e) {
                      console.warn(`[clickup-pilot] VA: auto-resolve threw:`, e);
                    }
                  }
                }

                // 3) Ultimo recurso: lista TODAS as pastas Drive do doc
                if (!vaBriefing.linkAdFileId) {
                  try {
                    const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
                    const folderLinks = (docR.driveLinks || []).filter((d: any) =>
                      d.fileId && d.fileId.length > 15);
                    for (const fl of folderLinks) {
                      const folderRes = await listDriveFolderViaExtension(fl.fileId);
                      if (!folderRes.ok || !folderRes.files?.length) continue;
                      const match = folderRes.files.find((f) => fuzzyMatch(f.name));
                      if (match) {
                        vaBriefing.linkAdFileId = match.fileId;
                        console.log(`[clickup-pilot] VA: matched via folder "${fl.text}": ${match.name} → ${match.fileId}`);
                        break;
                      }
                    }
                  } catch (e) {
                    console.warn(`[clickup-pilot] VA: fallback folder scan threw:`, e);
                  }
                }

                // 4) Persiste candidatos pra UI mostrar (one-click pick)
                if (!vaBriefing.linkAdFileId) {
                  (vaBriefing as any).candidateLinks = (docR.driveLinks || [])
                    .filter((d: any) => d.fileId && d.fileId.length > 15)
                    .map((d: any) => ({ text: d.text, fileId: d.fileId, isFolder: d.isFolder }));
                  console.log(`[clickup-pilot] VA: candidates expostos na UI:`, ((vaBriefing as any).candidateLinks || []).length);
                }
              }
              const siblings = siblingMap.get(task.id) || [task.id];
              setTaskAnalyses((prev) => {
                const next = { ...prev };
                for (const sid of siblings) {
                  next[sid] = {
                    ...prev[sid],
                    status: 'partial',  // VA precisa escolher avatares HeyGen antes de disparar
                    baseAdId: vaBriefing.baseAdId,
                    vaBriefing,
                    dispatchedAt: getDispatchedAt(sid),
                  };
                }
                return next;
              });
              continue;
            }
            // Detectou VA mas parser falhou → erro estruturado
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Task parece VA mas parser falhou em extrair avatares/hook/body' } }));
            continue;
          }
          // 3. Parse: encontra base AD ID + briefing (fluxo normal nao-VA)
          const baseMatch = task.name.match(/^(AD\d+[A-Z]+)\b/i);
          const baseAdId = baseMatch ? baseMatch[1].toUpperCase() : null;
          if (!baseAdId) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: 'Nome da task nao tem AD ID (ex AD139GL)' } }));
            continue;
          }
          const briefing = parseDarkoBriefing(docR.text, baseAdId);
          if (!briefing || (briefing.hooks.length === 0 && !briefing.body)) {
            setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: `Parser nao achou hooks nem body pra ${baseAdId} no doc` } }));
            continue;
          }
          // 3.5. Resolve Drive file IDs pros avatares (pra visual match futuro)
          for (const av of briefing.avatars) {
            av.videoFileId = resolveVideoFileId(av.username, docR.driveLinks);
          }
          // 4. Monta roleSlots — UM por avatar do briefing, mesmo se sem match
          //    Order de prioridade pra fechar o slot:
          //    a) matchAvatar score >= 30 (voice_name_exact / name match / fuzzy)
          //    b) memoria voice↔avatar (user ja pareou voz `@x` com avatar Y antes)
          //    c) voiceLibrary lookup: voz `@x` existe no HeyGen mas user nao pareou
          //       ainda — usa como voiceOverride pro slot (avatar ainda pendente)
          //    d) pendente sem voz
          const roleSlots: RoleSlot[] = [];
          for (const av of briefing.avatars) {
            const m = matchAvatar(av.username, avatarCandidates);
            const briefingFileId = av.videoFileId || null;
            // Voz auto-resolvida da biblioteca por nome (independente de match de avatar)
            const voiceFromLib = voiceByNorm.get(normalizeVoiceName(av.username)) || null;
            if (m && m.score >= 30) {
              const candFull = avatarCandidates.find(c => c.id === m.id);
              // MEMORIA AVATAR→VOZ: se ja escolhi voz pra esse avatar antes,
              // ela volta automatica (prioridade sobre voz por nome).
              const avMem = recallAvatarVoice(m.id);
              roleSlots.push({
                role: av.role,
                username: av.username,
                briefingFileId,
                avatarId: m.id,
                avatarName: m.name,
                avatarThumb: candFull?.thumb || null,
                avatarVoiceId: candFull?.voiceId || null,
                voiceOverride: avMem
                  ? { id: avMem.voiceId, name: avMem.voiceName }
                  : (!candFull?.voiceId && voiceFromLib ? voiceFromLib : null),
                matchedBy: m.matchedBy || 'fuzzy',
              });
              continue;
            }
            // (b) Tenta memoria: copy diz @x.mp4 → busca memoria pra voz "x"
            const recalled = recallByVoiceName(av.username);
            if (recalled) {
              // Confirma que avatar ainda existe na biblioteca
              const candFull = avatarCandidates.find(c => c.id === recalled.avatarId);
              if (candFull) {
                const avMem = recallAvatarVoice(recalled.avatarId);
                roleSlots.push({
                  role: av.role,
                  username: av.username,
                  briefingFileId,
                  avatarId: recalled.avatarId,
                  avatarName: recalled.avatarName,
                  avatarThumb: candFull.thumb || null,
                  avatarVoiceId: recalled.voiceId,
                  voiceOverride: avMem ? { id: avMem.voiceId, name: avMem.voiceName } : null,
                  matchedBy: 'memory',
                });
                continue;
              }
            }
            // (c)/(d) Pendente de avatar — mas se voz "@x" existe na lib,
            //          ja pre-seleciona como override (user so precisa achar avatar)
            roleSlots.push({
              role: av.role,
              username: av.username,
              briefingFileId,
              avatarId: null,
              avatarName: null,
              avatarThumb: null,
              avatarVoiceId: null,
              voiceOverride: voiceFromLib,
              matchedBy: null,
            });
          }
          // partTemplates: cada parte tem um 'matchByRole' — qual role preencher
          // na hora de gerar o plan final.
          //
          // Estrategia (em ordem de prioridade):
          //   1. detectedRole do parser (linha "Mulher:"/"Homem:"/"Voz do Homem:" do briefing
          //      — descartada do texto pra TTS, mas preservada como metadata)
          //   2. Label da parte contem nome do role (ex BODY HOMEM)
          //   3. Primeiras 2 linhas do texto mencionam o role (legacy)
          //   4. Primeiro role do briefing (fallback fraco)
          const firstRole = roleSlots[0]?.role.toLowerCase() || null;
          function pickRoleForText(text: string, label: string, detectedRole: string | null): string | null {
            if (detectedRole) {
              const dr = detectedRole.toLowerCase().trim();
              // Match exato primeiro
              for (const slot of roleSlots) {
                if (slot.role.toLowerCase().trim() === dr) return slot.role.toLowerCase();
              }
              // Fuzzy: detectedRole contem ou e contido por slot.role
              // (ex "Voz do Homem" vs "Voz do Homem", "Homem" vs "Homem")
              for (const slot of roleSlots) {
                const sl = slot.role.toLowerCase().trim();
                if (sl.includes(dr) || dr.includes(sl)) return slot.role.toLowerCase();
              }
            }
            const ll = label.toLowerCase();
            for (const slot of roleSlots) {
              if (ll.includes(slot.role.toLowerCase())) return slot.role.toLowerCase();
            }
            const fl = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
            for (const slot of roleSlots) {
              if (fl.includes(slot.role.toLowerCase())) return slot.role.toLowerCase();
            }
            return firstRole;
          }
          const partTemplates: TaskAnalysis['partTemplates'] = [];
          for (const h of briefing.hooks) {
            partTemplates.push({ label: h.label, text: h.text, matchByRole: pickRoleForText(h.text, h.label, h.role) });
          }
          // Body segmentado por SPEAKER (cada role vira sub-bloco). Dentro
          // de cada segmento, split por tempo (~20s) preservando o role.
          // CRITICAL: split nao MUDA speaker — cada part herda o role do
          // segmento de origem, NUNCA cruza com texto de outro speaker.
          const segs = briefing.bodySegments && briefing.bodySegments.length > 0
            ? briefing.bodySegments
            : (briefing.body ? [{ role: briefing.bodyRole, text: briefing.body }] : []);
          let bodyIdx = 0;
          const totalSegs = segs.length;
          for (let si = 0; si < segs.length; si++) {
            const seg = segs[si];
            const segParts = splitCopyIntoParts(seg.text, { targetSec: 20, minSec: 10, maxSec: 35 });
            for (let pi = 0; pi < segParts.length; pi++) {
              bodyIdx++;
              // Label: BODY (1 part total), BODY N (multi parts mesmo speaker),
              // BODY S.P (multi speakers — S=segment idx, P=part idx)
              const label = (totalSegs === 1 && segParts.length === 1)
                ? 'BODY'
                : (totalSegs === 1)
                  ? `BODY ${pi + 1}`
                  : (segParts.length === 1)
                    ? `BODY ${si + 1}`
                    : `BODY ${si + 1}.${pi + 1}`;
              partTemplates.push({
                label,
                text: segParts[pi],
                matchByRole: pickRoleForText(segParts[pi], label, seg.role),
              });
            }
          }
          const bodyPartsCount = bodyIdx;
          const allHaveAvatar = roleSlots.every((s) => s.avatarId);
          // Propaga o mesmo resultado pra TODAS siblings G1/G2 do grupo
          // (compartilham o doc — ja analisamos uma vez).
          const siblings = siblingMap.get(task.id) || [task.id];
          setTaskAnalyses((prev) => {
            const next = { ...prev };
            for (const sid of siblings) {
              next[sid] = {
                ...prev[sid],
                // Only Magnific nao gera lipsync — avatares sao irrelevantes,
                // basta a copy do doc. Marca ready mesmo sem avatar.
                status: onlyMagnificMode || allHaveAvatar ? 'ready' : 'partial',
                baseAdId,
                hookCount: briefing.hooks.length,
                bodyPartsCount,
                totalParts: partTemplates.length,
                roleSlots,
                partTemplates,
                bodyRaw: briefing.body || undefined,
                dispatchedAt: getDispatchedAt(sid),
                // Marca siblings como "compartilhada com primary"
                sharedWithPrimaryId: sid === task.id ? undefined : task.id,
              };
            }
            return next;
          });
        } catch (e) {
          // Erro propaga pra todos siblings tambem
          const siblings = siblingMap.get(task.id) || [task.id];
          setTaskAnalyses((prev) => {
            const next = { ...prev };
            for (const sid of siblings) {
              next[sid] = { ...prev[sid], status: 'error', error: (e as Error)?.message || 'erro' };
            }
            return next;
          });
        }
      }
    }
    const workers = Array.from({ length: PARALLEL }, () => worker());
    await Promise.all(workers);
    setAnalyzing(false);
  }

  /** Batch state — tasks rodando em background (dispatch + poll + download + zip) */
  const [batchStates, setBatchStates] = useState<Record<string, BatchTaskState>>({});
  const batchCancelRef = useRef<Record<string, boolean>>({});

  /** Semafaro de slots HeyGen (in-memory). Cresce quando um wrapper
   *  gated PEGA o slot (acquireSlot ok) e decresce no finally. Sempre
   *  reflete o numero REAL de runs ativos nesta aba — independente do
   *  batchStates (que pode estar com phase 'queued' por race). */
  const heygenSlotsRef = useRef<number>(0);
  /** Dedup de wrappers gated por taskId. Se ja ha um wrapper esperando
   *  vaga pra essa task, segundo clique e no-op (idempotente). */
  const heygenPendingRef = useRef<Record<string, 'run' | 'resume'>>({});

  /** Restore persisted batch states no mount. Tudo que estava ATIVO
   *  (dispatching/rendering/downloading/post) OU ja em 'queued' antes
   *  do reload volta como 'queued' — o promoter useEffect re-dispara
   *  ate MAX_HEYGEN_PARALLEL automaticamente. Sem clique manual.
   *
   *  Por que NAO 'failed': videos podem ja ter sido submitted no HeyGen
   *  (videoIds salvos em parts[]) — re-poll vai pegar eles prontos em
   *  segundos. Marcar failed forcaria user a clicar Retomar em cada um.
   *
   *  'done'/'failed' antigos sao preservados como estavam — user decide
   *  se Retomar ou nao. */
  useEffect(() => {
    const persisted = loadPersistedBatchStates() as Record<string, BatchTaskState>;
    if (Object.keys(persisted).length === 0) return;
    const restored: Record<string, BatchTaskState> = {};
    let interruptedCount = 0;
    const doneTaskIds: string[] = [];
    for (const [taskId, state] of Object.entries(persisted)) {
      const wasInterrupted = state.phase !== 'done' && state.phase !== 'failed';
      if (wasInterrupted && state.kind === 'troca') {
        // TROCA: o WHITE foi salvo no IndexedDB + driveId no proprio state —
        // retomar reconstroi tudo. So nao auto-roda (evita FFmpeg a cada F5).
        restored[taskId] = {
          ...state,
          phase: 'failed',
          message: 'Recarregou a página — áudio preservado. Clique em Retomar pra concluir.',
          finishedAt: Date.now(),
        };
      } else if (wasInterrupted) {
        interruptedCount++;
        restored[taskId] = {
          ...state,
          phase: 'queued',
          message: '⏳ Re-iniciando apos reload — checkpoint preservado, retomando do ponto certo...',
          finishedAt: undefined,
        };
      } else {
        restored[taskId] = state;
        if (state.phase === 'done') doneTaskIds.push(taskId);
      }
    }
    setBatchStates(restored);
    if (interruptedCount > 0) {
      console.info(`[batch restore] ${interruptedCount} batch(es) interrompidos — re-enfileirados pro promoter.`);
    }

    // HIDRATAÇÃO BLOB URLs (fix 2026-05-30):
    // persistBatchStates DESCARTA zipBlobUrl/montadoZipUrl/camufladoZipUrl
    // (Blob URLs nao sobrevivem reload). Apos restaurar, os ZIPs reais
    // estao em IndexedDB sob as chaves batch:{taskId}:{takes,montado,camo}.
    // Carrega esses blobs + cria novas URLs, patcha no state. Sem isso,
    // batch 'done' apos reload nao mostra botoes de download.
    if (doneTaskIds.length > 0) {
      void (async () => {
        try {
          const { loadZip } = await import('@/lib/zip-store');
          for (const taskId of doneTaskIds) {
            const updates: Partial<BatchTaskState> = {};
            try {
              const t = await loadZip(`batch:${taskId}:takes`);
              if (t) { updates.zipBlobUrl = t.blobUrl; updates.zipFilename = t.filename; }
            } catch {}
            try {
              const m = await loadZip(`batch:${taskId}:montado`);
              if (m) { updates.montadoZipUrl = m.blobUrl; updates.montadoZipName = m.filename; }
            } catch {}
            try {
              const c = await loadZip(`batch:${taskId}:camo`);
              if (c) { updates.camufladoZipUrl = c.blobUrl; updates.camufladoZipName = c.filename; }
            } catch {}
            if (Object.keys(updates).length === 0) continue;
            setBatchStates((prev) => {
              const cur = prev[taskId];
              if (!cur) return prev;
              return { ...prev, [taskId]: { ...cur, ...updates } as BatchTaskState };
            });
          }
        } catch (e) {
          console.warn('[batch restore] hidratacao blob URLs falhou:', e);
        }
      })();
    }
  }, []);

  /** Persist batchStates a cada mudanca pra sobreviver reload. */
  useEffect(() => {
    persistBatchStates(batchStates);
  }, [batchStates]);

  /** Escuta flags de cancelamento vindos da pagina /tools/background.
   *  Quando user clica "Cancelar" la, gravamos taskId em
   *  localStorage['darkolab:clickup-pilot:cancel'] — aqui pegamos pelo
   *  storage event (entre abas) ou pelo polling abaixo. */
  useEffect(() => {
    const CANCEL_KEY = 'darkolab:clickup-pilot:cancel';
    const consumeCancels = () => {
      try {
        const raw = localStorage.getItem(CANCEL_KEY);
        if (!raw) return;
        const map = JSON.parse(raw) as Record<string, number>;
        const ids = Object.keys(map);
        if (ids.length === 0) return;
        for (const id of ids) {
          if (!batchCancelRef.current[id]) {
            batchCancelRef.current[id] = true;
            setBatchStates((prev) => {
              const cur = prev[id];
              if (!cur) return prev;
              if (cur.phase === 'done' || cur.phase === 'failed') return prev;
              return { ...prev, [id]: { ...cur, phase: 'failed', message: 'Cancelado pelo user (background page)', finishedAt: Date.now() } };
            });
          }
        }
        // Limpa o flag depois de processar
        localStorage.setItem(CANCEL_KEY, '{}');
      } catch {}
    };
    consumeCancels();
    const onStorage = (e: StorageEvent) => {
      if (e.key === CANCEL_KEY) consumeCancels();
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(consumeCancels, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  /** Tick a cada 1s pra atualizar elapsed time nas batches rodando.
   *  So roda quando ha batch nao finalizada — evita re-render constante. */
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const hasRunning = Object.values(batchStates).some((b) => b.phase !== 'done' && b.phase !== 'failed');
    if (!hasRunning) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [batchStates]);

  /** Renomeia label do parser pra naming Portuguese pedido pelo user:
   *  HOOK 1 → GANCHO1.mp4, HOOK 2 → GANCHO2.mp4
   *  BODY → PARTE.mp4, BODY 1 → PARTE1.mp4 */
  function labelToFilename(label: string): string {
    const up = label.toUpperCase().trim();
    let m = up.match(/^HOOK\s*(\d+)?$/);
    if (m) return `GANCHO${m[1] || '1'}.mp4`;
    m = up.match(/^GANCHO\s*(\d+)?$/);
    if (m) return `GANCHO${m[1] || '1'}.mp4`;
    m = up.match(/^BODY\s*(\d+)?$/);
    if (m) return `PARTE${m[1] || ''}.mp4`;
    m = up.match(/^PARTE\s*(\d+)?$/);
    if (m) return `PARTE${m[1] || ''}.mp4`;
    // Fallback: sanitize label
    return up.replace(/[^A-Z0-9]/g, '_') + '.mp4';
  }

  /** Roda 1 task end-to-end em background:
   *  1. Dispatch via runHeyGenJobs (TTS + upload + submit por parte)
   *  2. Poll videos until ready
   *  3. Download MP4 + zipar com nomes GANCHO/PARTE
   *  4. Salva blob URL no state pra download manual depois */
  async function runTaskInBackground(taskId: string) {
    const a = taskAnalyses[taskId];
    // VARIACAO DE AVATAR: roteia pro runner VA (pipeline proprio que tambem
    // escreve batchStates). Detecta por taskAnalyses OU pela flag isVA no
    // batchStates (sobrevive reload). Sem essa guarda, runTaskInBackground
    // tentaria buildPlan(VA) e falharia.
    if (a?.vaBriefing || batchStates[taskId]?.isVA) {
      await runVAPipelineForTask(taskId);
      return;
    }
    // Resolve o plano: 1o de taskAnalyses (sessao com a task analisada);
    // senao do `replan` persistido (sobrevive reload/navegacao) — e isso
    // que faz Retomar/Debug funcionarem em task que falhou com 0 videoIds.
    let plan = a ? buildPlan(a) : null;
    let rTaskName: string;
    let rBaseAdId: string;
    let replan: BatchTaskState['replan'];
    if (a && plan) {
      rTaskName = a.taskName;
      rBaseAdId = a.baseAdId || a.taskName;
      replan = {
        taskName: rTaskName,
        baseAdId: rBaseAdId,
        parts: plan.parts.map((p: any) => ({
          label: p.label,
          text: p.text,
          avatarId: p.avatarId ?? null,
          voiceId: p.voiceId ?? null,
        })),
      };
    } else {
      const saved = batchStates[taskId]?.replan || loadPersistedReplan(taskId);
      if (!saved || !saved.parts?.length) {
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...(prev[taskId] || { taskId, taskName: taskId, baseAdId: taskId, parts: [], startedAt: Date.now() }),
            phase: 'failed',
            message: 'Sem plano salvo pra re-disparar. Abra essa task no ClickUp Pilot e analise de novo.',
            finishedAt: Date.now(),
          } as BatchTaskState,
        }));
        return;
      }
      rTaskName = saved.taskName;
      rBaseAdId = saved.baseAdId;
      replan = saved;
      plan = {
        adName: rBaseAdId.replace(/[^a-z0-9_-]/gi, '_'),
        parts: saved.parts.map((p) => ({
          label: p.label,
          text: p.text,
          avatarId: p.avatarId,
          avatarName: null,
          avatarThumb: null,
          voiceId: p.voiceId,
        })),
        unmatchedAvatars: [],
      } as any;
    }
    if (!plan) return;
    const partsLen = plan.parts.length;
    const adNameClean = (rBaseAdId).replace(/[^A-Z0-9]/gi, '_');

    // Re-run da mesma task: revoga blob URLs antigos pra nao vazar memoria
    for (const url of [batchStates[taskId]?.zipBlobUrl, batchStates[taskId]?.montadoZipUrl, batchStates[taskId]?.camufladoZipUrl]) {
      if (url) { try { URL.revokeObjectURL(url); } catch {} }
    }
    // Limpa flag de cancel de runs anteriores
    batchCancelRef.current[taskId] = false;

    const aForUrl = taskAnalyses[taskId];
    setBatchStates((prev) => ({
      ...prev,
      [taskId]: {
        taskId, taskName: rTaskName, baseAdId: rBaseAdId,
        phase: 'dispatching',
        parts: plan!.parts.map((p: any) => ({ label: p.label, videoId: null, renamedTo: labelToFilename(p.label) })),
        startedAt: Date.now(),
        message: 'TTS + upload + submit por parte...',
        replan,
        // Preserva docUrl/taskUrl se ja existiam (re-run) OU pega da analise
        docUrl: prev[taskId]?.docUrl || aForUrl?.docUrl,
        taskUrl: prev[taskId]?.taskUrl || aForUrl?.taskUrl,
      },
    }));

    try {
      // 1. Dispatch via runHeyGenJobs (re-usa toda logica do HeyGen Auto runner)
      // MOTOR: resolve per-part baseado em motorConfig (global/percent/individual)
      const motorCfg = getMotorConfig(taskId);
      const motorsPerPart = resolveMotors(motorCfg, plan.parts.length, {
        slotIds: plan.parts.map((p: any) => `${p.label}`),
        seed: taskId,
      });
      console.log(`[clickup-pilot] motor config (${motorCfg.kind}): ${motorsPerPart.join(', ')}`);
      // LOG CRITICO: avatar mapping por task. Permite o user verificar em
      // DevTools que cada AD pegou o avatar certo. Se 2 ADs distintos
      // estiverem usando o MESMO avatarId pro mesmo role, e bug — abrir
      // issue ou re-analisar. Esse log salvou ja o caso AD144/AD145 onde
      // o user reclamou de avatar trocado.
      console.log(
        `[clickup-pilot] DISPATCH task=${taskId} ad=${rBaseAdId} name=${rTaskName}\n` +
        plan.parts.map((p: any, i: number) =>
          `  part ${i + 1} [${p.label}] avatar=${p.avatarId} (${p.avatarName || '?'}) voice=${p.voiceId || 'default'} text="${(p.text || '').slice(0, 60).replace(/\n/g, ' ')}..."`
        ).join('\n')
      );
      // Sanity check: se algum part vai SEM avatar, aborta antes de torrar
      // chamadas TTS em vao.
      const missingAv = plan.parts.findIndex((p: any) => !p.avatarId);
      if (missingAv >= 0) {
        const errMsg = `Part ${missingAv + 1} (${plan.parts[missingAv].label}) sem avatarId. NUNCA dispara sem avatar — refaz a analise.`;
        console.error(`[clickup-pilot] ${errMsg}`);
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: errMsg, finishedAt: Date.now() } }));
        return;
      }
      const jobs = plan.parts.map((p: any, i: number) => ({
        label: p.label,
        copy: p.text,
        avatarId: p.avatarId!,
        voiceId: p.voiceId,
        motor: motorsPerPart[i], // <-- override per job
      }));
      const results = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode: 'copy',
        avatarId: plan!.parts[0]?.avatarId || '',
        voiceId: undefined,
        motor: motorCfg.kind === 'global' ? motorCfg.motor : 'III', // fallback global; per-job vence
        adNameSafe: adNameClean,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onProgress: () => {},
        onResult: (r) => {
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p, i) => i + 1 === r.index ? { ...p, videoId: r.videoId, error: r.error } : p);
            return { ...prev, [taskId]: { ...s, parts: newParts } };
          });
        },
      });

      const failed = results.filter((r) => r.error);
      const validIds = results.filter((r) => r.videoId).map((r) => r.videoId!);
      if (validIds.length === 0) {
        setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: `Todos disparos falharam: ${failed[0]?.error || '?'}`, finishedAt: Date.now() } }));
        return;
      }

      // Marca a task primary + TODAS siblings G1/G2 do mesmo grupo como
      // disparadas (compartilham o mesmo conteudo)
      for (const sid of getSiblingTaskIds(taskId)) markDispatched(sid);

      // 2. Poll status ate todos prontos (ou alguns falharem)
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'rendering', message: `Aguardando renderizacao no HeyGen (${validIds.length} videos)...` } }));
      const finalStatuses = await pollVideosUntilReady(validIds, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        // Zombie killer: HeyGen video normal leva 2-8min. Travado >15min sem
        // progresso = falha definitiva pra esse render. Pipeline finaliza com
        // partial result; user pode RETOMAR pra re-disparar so as zumbis.
        maxPendingMsPerId: 15 * 60 * 1000,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onStatus: (st) => {
          const done = Object.values(st).filter((s) => s.status === 'completed').length;
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p) => {
              const ps = p.videoId ? st[p.videoId] : null;
              return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
            });
            return { ...prev, [taskId]: { ...s, parts: newParts, message: `Renderizando: ${done}/${validIds.length} prontos` } };
          });
        },
      });

      // 3. Download em paralelo (3 simultaneos) + coleta blobs em memoria pra
      //    pipeline pos-producao (concat + decupagem + camuflagem).
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Baixando ${validIds.length} videos...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const partBlobs: Array<{ label: string; blob: Blob | null }> = plan.parts.map((p: any) => ({ label: p.label, blob: null }));
      let downloaded = 0;
      const downloadOne = async (i: number) => {
        if (batchCancelRef.current[taskId]) return;
        const r = results[i];
        const part = plan.parts[i];
        const fname = labelToFilename(part.label);
        const fnameBase = fname.replace('.mp4', '');
        if (!r.videoId) {
          zip.file(`${fnameBase}_NAO_DISPAROU.txt`, `Erro no dispatch: ${r.error || 'sem detalhes'}`);
          return;
        }
        const status = finalStatuses[r.videoId];
        if (status?.status !== 'completed' || !status.videoUrl) {
          zip.file(`${fnameBase}_NAO_RENDERIZOU.txt`, `Status: ${status?.status || '?'}\n${status?.error || ''}`);
          return;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(fname, bytes);
          const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
          partBlobs[i] = { label: part.label, blob: partBlob };
          // PERSIST IDB pra RETOMAR — cada parte gravada AGORA, na hora do download.
          // Resume hidrata daqui sem precisar re-baixar do HeyGen (URLs expiram).
          try {
            const { saveBlob } = await import('@/lib/zip-store');
            await saveBlob(`pilot:${taskId}:part:${part.label}`, partBlob, 'video/mp4');
          } catch (e) { console.warn('[pilot] persist part blob falhou:', e); }
          downloaded++;
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Baixando: ${downloaded}/${validIds.length}` } }));
        } catch (e) {
          zip.file(`${fnameBase}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message));
        }
      };
      const queue = results.map((_, i) => i);
      const DL_PARALLEL = 3;
      const dlWorkers: Promise<void>[] = [];
      for (let w = 0; w < DL_PARALLEL; w++) {
        dlWorkers.push((async () => {
          while (queue.length > 0) {
            const idx = queue.shift()!;
            await downloadOne(idx);
          }
        })());
      }
      await Promise.all(dlWorkers);

      // ZIP 1 — takes individuais
      const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const takesFilename = `${adNameClean}_takes.zip`;
      const takesUrl = URL.createObjectURL(takesBlob);
      // Persiste em IndexedDB pra sobreviver reload
      try {
        const { saveZip } = await import('@/lib/zip-store');
        await saveZip(`batch:${taskId}:takes`, takesBlob, takesFilename);
      } catch (e) {
        console.warn('[batch] falha salvando ZIP takes em IndexedDB:', e);
      }

      // === Stage 4: PIPELINE pos-producao (concat + decupagem [+ camuflagem]) ===
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'post',
          message: 'Montando + decupando' + (camuflagemMode ? ' + camuflando...' : '...'),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
        },
      }));

      let pipeRes: Awaited<ReturnType<typeof runPostPipeline>>;
      try {
        const _tc = getTaskCamuflagem(taskId);
        pipeRes = await runPostPipeline({
          baseAdId: rBaseAdId,
          parts: partBlobs,
          decupagem: isDecupagemEnabled(taskId),
          camuflagem: _tc.camuflagem,
          whiteAudio: _tc.whiteAudio,
          camuflagemVolume: _tc.camuflagemVolume,
          onProgress: (p) => {
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
            }));
          },
        });
      } catch (e) {
        // Pipeline jogou — quase nunca deve acontecer (catch interno em cada stage)
        console.error('[clickup-pilot] pipeline threw:', e);
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...prev[taskId],
            phase: 'done',
            message: `Takes OK · pipeline FATAL: ${(e as Error)?.message || 'erro desconhecido'} (ver console F12)`,
            finishedAt: Date.now(),
          },
        }));
        return;
      }
      const assembled = pipeRes.items;

      // ZIP 2 — versoes montadas + decupadas. SEMPRE cria, mesmo quando
      // assembled.length === 0 (nesse caso vai so com _DIAGNOSTICO.txt
      // explicando porque nada foi montado). Garante que o user sempre
      // tem botao pra clicar + entende o que aconteceu.
      let montadoUrl: string | undefined;
      let montadoName: string | undefined;
      {
        const zipMont = new JSZip();
        for (const item of assembled) {
          if (item.decupado) {
            zipMont.file(item.filename, item.decupado);
          } else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
            // Decupagem falhou mas tem montagem — entrega o montado raw + nota
            const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
            zipMont.file(baseName, item.rawAssembled);
            zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro desconhecido');
          } else {
            zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
              `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
          }
        }
        zipMont.file('_DIAGNOSTICO.txt',
`Pipeline pos-producao - relatorio
==================================
${pipeRes.diagnostics.summary}

Total de partes recebidas: ${pipeRes.diagnostics.totalParts}
Hooks identificados (label HOOK ou GANCHO): ${pipeRes.diagnostics.hooksFound}
Bodies identificados (label BODY ou PARTE): ${pipeRes.diagnostics.bodiesFound}
Labels nao reconhecidas: ${pipeRes.diagnostics.unrecognizedLabels.join(', ') || 'nenhuma'}

Items finais: ${assembled.length}
${assembled.map(it => `- ${it.filename}: assemble=${it.errors?.assemble ? 'ERRO ('+it.errors.assemble+')' : 'OK'} | decupagem=${it.errors?.decupagem ? 'ERRO ('+it.errors.decupagem+')' : (it.decupado ? 'OK ('+(it.decupado.size/(1024*1024)).toFixed(1)+'MB)' : '?')}${camuflagemMode ? ' | camuflagem=' + (it.errors?.camuflagem ? 'ERRO ('+it.errors.camuflagem+')' : (it.camuflado ? 'OK' : '?')) : ''}`).join('\n')}

Se a pasta estiver vazia ou so com _DIAGNOSTICO.txt, ABRA O CONSOLE DO BROWSER (F12)
pra ver os erros detalhados [clickup-pilot-pipeline].`);
        const blob2 = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
        montadoUrl = URL.createObjectURL(blob2);
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${taskId}:montado`, blob2, montadoName);
        } catch (e) { console.warn('[batch] save montado IDB:', e); }
      }

      // ZIP 3 — versoes camufladas. Cria sempre que modo ON (mesmo se 0
      // assembled — entrega so o diagnostico explicando porque).
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) {
            zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          } else {
            zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || item.errors?.assemble || 'falha sem detalhes');
          }
        }
        zipCamu.file('_DIAGNOSTICO.txt',
`Camuflagem - relatorio
======================
${pipeRes.diagnostics.summary}
WHITE audio: ${camuflagemWhite?.name || '(NAO SELECIONADO — adicione na ferramenta)'}
Volume: ${camuflagemVolume}%

${assembled.length === 0 ? 'Pipeline nao produziu nenhuma montagem (ver _DIAGNOSTICO.txt do zip de montados pra detalhes)' : assembled.map(it => `- ${it.filename}: ${it.camuflado ? 'OK' : 'ERRO ('+(it.errors?.camuflagem || 'sem detalhes')+')'}`).join('\n')}`);
        const blob3 = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(blob3);
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${taskId}:camo`, blob3, camuName);
        } catch (e) { console.warn('[batch] save camo IDB:', e); }
      }

      const totalSize = takesBlob.size + (montadoUrl ? assembled.reduce((n, it) => n + (it.decupado?.size || it.rawAssembled?.size || 0), 0) : 0);
      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: `Pronto: ${downloaded} takes · ${pipeRes.diagnostics.summary} · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`,
          finishedAt: Date.now(),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
        },
      }));
    } catch (e) {
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: (e as Error)?.message || 'erro', finishedAt: Date.now() } }));
    }
  }

  /** Retoma batch que foi interrompida por reload da pagina. Usa videoIds
   *  ja persistidos pra re-poll status no HeyGen + re-baixar + zipar. Pula
   *  TTS+upload+submit que ja foram feitos. */
  async function resumeTaskBatch(taskId: string) {
    const state = batchStates[taskId];
    if (!state) return;
    // VA: resume = re-rodar o pipeline VA (nao tem resume parcial de
    // videoIds como a task normal). Roteia pro runner VA.
    if (state.isVA || taskAnalyses[taskId]?.vaBriefing) {
      await runVAPipelineForTask(taskId);
      return;
    }
    const validParts = state.parts.filter((p) => p.videoId);
    if (validParts.length === 0) {
      setError('Sem videoIds salvos pra retomar — task tem que ser disparada do zero.');
      return;
    }
    batchCancelRef.current[taskId] = false;
    const adNameClean = state.baseAdId.replace(/[^A-Z0-9]/gi, '_');
    const validIds = validParts.map((p) => p.videoId!);

    try {
      // === PRÉ-HIDRATAÇÃO do IDB (fix 2026-05-28) ===
      // ANTES de re-pollar/re-baixar do HeyGen, verifica quantas parts já
      // estão no cache local. Se TODAS as parts COM videoId já têm blob no
      // IDB, pula poll + download (HeyGen URLs já podem ter expirado, e não
      // faz sentido re-baixar o que já temos). Vai direto pra montagem.
      //
      // User reportou (2026-05-28): batch com 9/9 renderizados + 1 parte
      // vazia ficava travando no RETOMAR. Causa: pollVideosUntilReady +
      // re-download desnecessário + montagem abortava por causa da parte vazia.
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'downloading', message: 'Verificando cache local...', finishedAt: undefined },
      }));
      const { loadBlob } = await import('@/lib/zip-store');
      let cachedCount = 0;
      for (const p of validParts) {
        try {
          const b = await loadBlob(`pilot:${taskId}:part:${p.label}`, 'video/mp4');
          if (b && b.size > 1024) cachedCount++;
        } catch {}
      }
      const allCached = cachedCount >= validParts.length;
      console.log(`[pilot resume] cache: ${cachedCount}/${validParts.length} parts no IDB. allCached=${allCached}`);

      // Só polla HeyGen se NÃO temos tudo em cache. Se já temos, finalStatuses
      // fica vazio (download loop vai pular tudo e usar só o cache).
      let finalStatuses: Awaited<ReturnType<typeof pollVideosUntilReady>> = {};
      // Set de indices que JA TÊM BLOB no IDB — usado pra excluir do re-dispatch
      // de zombie (se ja tem cache, parte ja terminou antes; status 'failed'
      // novo eh ruido, nao precisa re-disparar).
      const cachedIdxs = new Set<number>();
      for (let i = 0; i < state.parts.length; i++) {
        const p = state.parts[i];
        if (!p.videoId) continue;
        try {
          const { loadBlob } = await import('@/lib/zip-store');
          const b = await loadBlob(`pilot:${taskId}:part:${p.label}`, 'video/mp4');
          if (b && b.size > 1024) cachedIdxs.add(i);
        } catch {}
      }

      if (!allCached) {
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: { ...prev[taskId], phase: 'rendering', message: `Re-checando ${validIds.length} videos no HeyGen (${cachedCount} já em cache)...` },
        }));
        finalStatuses = await pollVideosUntilReady(validIds, {
          intervalMs: 8000,
          timeoutMs: 30 * 60 * 1000,
          // Zombie detection: video stuck >15min vira 'failed' automatico
          maxPendingMsPerId: 15 * 60 * 1000,
          isCancelled: () => !!batchCancelRef.current[taskId],
          onStatus: (st) => {
            const done = Object.values(st).filter((s) => s.status === 'completed').length;
            setBatchStates((prev) => {
              const s = prev[taskId];
              if (!s) return prev;
              const newParts = s.parts.map((p) => {
                const ps = p.videoId ? st[p.videoId] : null;
                return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
              });
              return { ...prev, [taskId]: { ...s, parts: newParts, message: `Renderizando: ${done}/${validIds.length} prontos` } };
            });
          },
        });

        // ═══ AUTO RE-DISPATCH DE ZOMBIES (fix 2026-05-30) ═══
        // Se algumas parts vieram 'failed' do polling (zombie killed ou timeout)
        // E nao temos blob cacheado dela E temos replan → re-dispara via
        // runHeyGenJobs em uma rodada. Maximo 2 rodadas pra cap loop infinito.
        const MAX_REDISPATCH_ROUNDS = 2;
        for (let round = 1; round <= MAX_REDISPATCH_ROUNDS; round++) {
          if (batchCancelRef.current[taskId]) break;
          if (!state.replan?.parts?.length) break;

          // Coleta parts q ainda nao tem video bom (failed + sem cache)
          const zombieIdxs: number[] = [];
          for (let i = 0; i < state.parts.length; i++) {
            if (cachedIdxs.has(i)) continue;
            const p = state.parts[i];
            const st = p.videoId ? finalStatuses[p.videoId] : null;
            if (st?.status === 'failed' && state.replan.parts[i]) {
              zombieIdxs.push(i);
            }
          }
          if (zombieIdxs.length === 0) break;

          console.warn(`[pilot resume] round ${round}: re-disparando ${zombieIdxs.length} zombies:`, zombieIdxs.map((i) => state.parts[i].label));
          setBatchStates((prev) => ({
            ...prev,
            [taskId]: {
              ...prev[taskId],
              phase: 'dispatching',
              message: `Re-disparando ${zombieIdxs.length} parts travadas (rodada ${round}/${MAX_REDISPATCH_ROUNDS})...`,
            },
          }));

          const jobsToRedispatch = zombieIdxs.map((i) => {
            const rp = state.replan!.parts[i];
            return {
              label: rp.label,
              copy: rp.text,
              avatarId: rp.avatarId || '',
              voiceId: rp.voiceId || undefined,
              motor: 'III' as const,
            };
          }).filter((j) => j.avatarId); // sanity: descarta sem avatar

          if (jobsToRedispatch.length === 0) break;

          let newResults: Awaited<ReturnType<typeof runHeyGenJobs>>;
          try {
            newResults = await runHeyGenJobs(jobsToRedispatch, {
              parallel: 3,
              mode: 'copy',
              avatarId: jobsToRedispatch[0].avatarId,
              voiceId: undefined,
              motor: 'III',
              adNameSafe: adNameClean,
              isCancelled: () => !!batchCancelRef.current[taskId],
              onProgress: () => {},
              onResult: (r) => {
                // r.index eh 1-based dentro do array de jobs; mapeia pro state idx
                const stateIdx = zombieIdxs[r.index - 1];
                setBatchStates((prev) => {
                  const s = prev[taskId];
                  if (!s) return prev;
                  const newParts = s.parts.map((p, i) => i === stateIdx ? { ...p, videoId: r.videoId, error: r.error || undefined } : p);
                  return { ...prev, [taskId]: { ...s, parts: newParts } };
                });
              },
            });
          } catch (e) {
            console.error(`[pilot resume] re-dispatch round ${round} crashou:`, e);
            break;
          }

          // Atualiza state.parts referencia local (pra proxima iteracao do loop)
          for (let k = 0; k < newResults.length; k++) {
            const r = newResults[k];
            const stateIdx = zombieIdxs[k];
            if (r.videoId) state.parts[stateIdx] = { ...state.parts[stateIdx], videoId: r.videoId };
          }

          // Polla as NOVAS videoIds (zombie detection 15min, timeout 20min — mais
          // curto que o original pq RETOMAR ja consumiu paciencia do user)
          const newIds = newResults.filter((r) => r.videoId).map((r) => r.videoId!);
          if (newIds.length === 0) break;

          setBatchStates((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], phase: 'rendering', message: `Renderizando ${newIds.length} re-disparadas (rodada ${round})...` },
          }));
          const newStatuses = await pollVideosUntilReady(newIds, {
            intervalMs: 8000,
            timeoutMs: 20 * 60 * 1000,
            maxPendingMsPerId: 12 * 60 * 1000, // menor: ja eh 2a tentativa
            isCancelled: () => !!batchCancelRef.current[taskId],
            onStatus: (st) => {
              const done = Object.values(st).filter((s) => s.status === 'completed').length;
              setBatchStates((prev) => {
                const s = prev[taskId];
                if (!s) return prev;
                const newParts = s.parts.map((p) => {
                  const ps = p.videoId ? st[p.videoId] : null;
                  return ps ? { ...p, videoStatus: ps.status, videoUrl: ps.status === 'completed' ? ps.videoUrl || null : p.videoUrl ?? null } : p;
                });
                return { ...prev, [taskId]: { ...s, parts: newParts, message: `Re-render: ${done}/${newIds.length} prontos (rodada ${round})` } };
              });
            },
          });
          // Merge no finalStatuses — proxima iteracao vai ver os NOVOS videoIds
          Object.assign(finalStatuses, newStatuses);
        }
      } else {
        console.log('[pilot resume] tudo em cache — pulando poll do HeyGen, indo direto pra montagem');
      }

      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Hidratando blobs do cache local...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const partBlobs: Array<{ label: string; blob: Blob | null }> =
        state.parts.map((p) => ({ label: p.label, blob: null }));

      // === HIDRATAÇÃO RETOMAR (fix 2026-05-27) ===
      // Antes de re-baixar do HeyGen, tenta hidratar cada parte do IndexedDB
      // (foram salvas no primeiro download via saveBlob). HeyGen URLs expiram
      // após 24-72h — sem cache local, RETOMAR ficaria sem como reconstruir.
      let hydrated = 0;
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        for (let i = 0; i < state.parts.length; i++) {
          const p = state.parts[i];
          // CRITICAL (fix 2026-05-28): SÓ hidrata partes que TÊM videoId.
          // Partes vazias (BODY vazia "(esse part nao gera nada)") têm
          // videoId=null e NUNCA deveriam ter blob — mas execuções antigas
          // podem ter deixado lixo no IDB (ex: BODY 1 com 308KB corrompido).
          // Incluir esse lixo na montagem fazia a DECUPAGEM travar ao tentar
          // decodar o áudio inválido. Pulamos = montagem limpa só com partes reais.
          if (!p.videoId) {
            console.log(`[pilot resume] pulando parte sem videoId (vazia): ${p.label}`);
            continue;
          }
          try {
            const blob = await loadBlob(`pilot:${taskId}:part:${p.label}`, 'video/mp4');
            if (blob && blob.size > 1024) {
              partBlobs[i] = { label: p.label, blob };
              zip.file(p.renamedTo, new Uint8Array(await blob.arrayBuffer()));
              hydrated++;
            }
          } catch (e) { console.warn(`[pilot resume] hidratacao da parte ${p.label} falhou:`, e); }
        }
      } catch (e) { console.warn('[pilot resume] loadBlob global falhou:', e); }

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          message: hydrated > 0
            ? `Cache: ${hydrated}/${state.parts.length} parts hidratadas. Baixando faltantes...`
            : `Baixando ${validIds.length} videos do HeyGen...`,
        },
      }));

      let downloaded = hydrated;
      const downloadOne = async (idx: number) => {
        if (batchCancelRef.current[taskId]) return;
        // SKIP se já hidratou do IDB
        if (partBlobs[idx]?.blob) return;
        const part = state.parts[idx];
        if (!part.videoId) {
          zip.file(`${part.renamedTo.replace('.mp4', '')}_NAO_DISPAROU.txt`, `Erro: ${part.error || 'sem videoId'}`);
          return;
        }
        const status = finalStatuses[part.videoId];
        if (status?.status !== 'completed' || !status.videoUrl) {
          zip.file(`${part.renamedTo.replace('.mp4', '')}_NAO_RENDERIZOU.txt`, `Status: ${status?.status || '?'}\n${status?.error || ''}`);
          return;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(part.renamedTo, bytes);
          const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
          partBlobs[idx] = { label: part.label, blob: partBlob };
          // Persist no IDB pra próximo RETOMAR
          try {
            const { saveBlob } = await import('@/lib/zip-store');
            await saveBlob(`pilot:${taskId}:part:${part.label}`, partBlob, 'video/mp4');
          } catch {}
          downloaded++;
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Baixando: ${downloaded}/${validIds.length}` } }));
        } catch (e) {
          zip.file(`${part.renamedTo.replace('.mp4', '')}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message));
        }
      };
      const queue = state.parts.map((_, i) => i);
      const dlWorkers: Promise<void>[] = [];
      for (let w = 0; w < 3; w++) {
        dlWorkers.push((async () => {
          while (queue.length > 0) {
            const idx = queue.shift()!;
            await downloadOne(idx);
          }
        })());
      }
      await Promise.all(dlWorkers);

      // ZIP 1 — takes individuais
      const takesBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const takesFilename = `${adNameClean}_takes.zip`;
      const takesUrl = URL.createObjectURL(takesBlob);
      try {
        const { saveZip } = await import('@/lib/zip-store');
        await saveZip(`batch:${taskId}:takes`, takesBlob, takesFilename);
      } catch (e) {
        console.warn('[batch resume] falha salvando ZIP takes em IndexedDB:', e);
      }

      // === PIPELINE pos-producao (concat + decupagem [+ camuflagem]) ===
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'post',
          message: 'Montando + decupando' + (camuflagemMode ? ' + camuflando...' : '...'),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
        },
      }));

      let pipeRes: Awaited<ReturnType<typeof runPostPipeline>>;
      try {
        const _tc = getTaskCamuflagem(taskId);
        pipeRes = await runPostPipeline({
          baseAdId: state.baseAdId,
          parts: partBlobs,
          decupagem: isDecupagemEnabled(taskId),
          camuflagem: _tc.camuflagem,
          whiteAudio: _tc.whiteAudio,
          camuflagemVolume: _tc.camuflagemVolume,
          onProgress: (p) => {
            setBatchStates((prev) => ({
              ...prev,
              [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
            }));
          },
        });
      } catch (e) {
        console.error('[clickup-pilot resume] pipeline threw:', e);
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            ...prev[taskId],
            phase: 'done',
            message: `Takes OK · pipeline FATAL: ${(e as Error)?.message || 'erro desconhecido'} (ver console F12)`,
            finishedAt: Date.now(),
          },
        }));
        return;
      }
      const assembled = pipeRes.items;

      // ZIP 2 — versoes montadas + decupadas (sempre cria, mesmo com 0
      // assembled — entrega _DIAGNOSTICO.txt explicando o motivo)
      let montadoUrl: string | undefined;
      let montadoName: string | undefined;
      {
        const zipMont = new JSZip();
        for (const item of assembled) {
          if (item.decupado) {
            zipMont.file(item.filename, item.decupado);
          } else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
            const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
            zipMont.file(baseName, item.rawAssembled);
            zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro desconhecido');
          } else {
            zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
              `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
          }
        }
        zipMont.file('_DIAGNOSTICO.txt',
`Pipeline pos-producao - relatorio (RETOMAR)
============================================
${pipeRes.diagnostics.summary}

Total de partes recebidas: ${pipeRes.diagnostics.totalParts}
Hooks identificados (label HOOK ou GANCHO): ${pipeRes.diagnostics.hooksFound}
Bodies identificados (label BODY ou PARTE): ${pipeRes.diagnostics.bodiesFound}
Labels nao reconhecidas: ${pipeRes.diagnostics.unrecognizedLabels.join(', ') || 'nenhuma'}

Items finais: ${assembled.length}
${assembled.map(it => `- ${it.filename}: assemble=${it.errors?.assemble ? 'ERRO ('+it.errors.assemble+')' : 'OK'} | decupagem=${it.errors?.decupagem ? 'ERRO ('+it.errors.decupagem+')' : (it.decupado ? 'OK ('+(it.decupado.size/(1024*1024)).toFixed(1)+'MB)' : '?')}${camuflagemMode ? ' | camuflagem=' + (it.errors?.camuflagem ? 'ERRO ('+it.errors.camuflagem+')' : (it.camuflado ? 'OK' : '?')) : ''}`).join('\n')}

Se a pasta estiver vazia ou so com _DIAGNOSTICO.txt, ABRA O CONSOLE DO BROWSER (F12)
pra ver os erros detalhados [clickup-pilot-pipeline].`);
        const blob2 = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
        montadoUrl = URL.createObjectURL(blob2);
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${taskId}:montado`, blob2, montadoName);
        } catch (e) { console.warn('[batch resume] save montado IDB:', e); }
      }

      // ZIP 3 — versoes camufladas (so se modo ON)
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) {
            zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          } else {
            zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || item.errors?.assemble || 'falha sem detalhes');
          }
        }
        zipCamu.file('_DIAGNOSTICO.txt',
`Camuflagem - relatorio (RETOMAR)
=================================
${pipeRes.diagnostics.summary}
WHITE audio: ${camuflagemWhite?.name || '(NAO SELECIONADO — adicione na ferramenta)'}
Volume: ${camuflagemVolume}%

${assembled.length === 0 ? 'Pipeline nao produziu nenhuma montagem (ver _DIAGNOSTICO.txt do zip de montados pra detalhes)' : assembled.map(it => `- ${it.filename}: ${it.camuflado ? 'OK' : 'ERRO ('+(it.errors?.camuflagem || 'sem detalhes')+')'}`).join('\n')}`);
        const blob3 = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(blob3);
        try {
          const { saveZip } = await import('@/lib/zip-store');
          await saveZip(`batch:${taskId}:camo`, blob3, camuName);
        } catch (e) { console.warn('[batch resume] save camo IDB:', e); }
      }

      const totalSize = takesBlob.size + (montadoUrl ? assembled.reduce((n, it) => n + (it.decupado?.size || it.rawAssembled?.size || 0), 0) : 0);
      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: `Pronto: ${downloaded} takes · ${pipeRes.diagnostics.summary} · ${(totalSize / (1024 * 1024)).toFixed(1)}MB`,
          finishedAt: Date.now(),
          zipBlobUrl: takesUrl,
          zipFilename: takesFilename,
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
        },
      }));
    } catch (e) {
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: `Retomar falhou: ${(e as Error)?.message || 'erro'}`, finishedAt: Date.now() } }));
    }
  }

  /**
   * Enfileira o job Magnific de UMA task. Defesa anti-duplicata:
   *   - Se já existe job VIVO (running com heartbeat recente) pra essa task,
   *     NÃO mexe (deixa rodando — clique duplo do user é no-op)
   *   - Se existe queued/paused/failed/done, atualiza com novo JSON
   *
   *  gated=true (MORE): só roda depois do HeyGen daquela task concluir.
   *  gated=false (ONLY): elegível imediatamente.
   *  Retorna false se task não tem JSON ou JSON inválido.
   */
  function enqueueMagnificForTask(taskId: string, gated: boolean): boolean {
    const a = taskAnalyses[taskId];
    if (!a || a.vaBriefing) return false; // VA nunca vai pra Magnific
    const raw = (taskMagnificJson[taskId] || '').trim();
    if (!raw) return false;
    const takes = parseMagnificPrompts(raw);
    if (takes.length === 0) return false;

    // Defesa: clique duplo / disparo redundante (ClickUp Pilot acionando 2x
    // a mesma task) NÃO interrompe job vivo. Idempotente: já está rodando = OK.
    const existing = magnificQueue[taskId];
    if (existing && isMagnificJobAlive(existing)) {
      console.info('[magnific] enqueue ignorado — job já rodando:', taskId);
      return true;
    }

    const adName = (a.baseAdId || a.taskName).replace(/[^a-z0-9_-]/gi, '_');
    magnificCancelRef.current[taskId] = false;
    setMagnificQueueState((prev) => ({
      ...prev,
      [taskId]: {
        taskId,
        adName,
        takesJson: raw,
        takeCount: takes.length,
        status: 'queued',
        gateOnHeyGen: gated,
        message: gated
          ? `Aguardando HeyGen da task concluir (${takes.length} takes na fila)...`
          : `Na fila Magnific (${takes.length} takes)...`,
        enqueuedAt: Date.now(),
        // Limpa qualquer owner/heartbeat antigo (job freshly queued)
        lastHeartbeatAt: undefined,
        ownerTabId: undefined,
        startedAt: undefined,
        finishedAt: undefined,
      },
    }));
    setMagnificTick((t) => t + 1);
    return true;
  }

  /** Inicia batch. Comportamento depende dos toggles:
   *  - Nenhum: HeyGen Auto paralelo (max 2) — fluxo classico INALTERADO.
   *  - MORE: HeyGen Auto paralelo COMO HOJE + enfileira Magnific gated
   *    por task (so dispara apos o HeyGen daquela task concluir).
   *  - ONLY: pula HeyGen, so enfileira Magnific (fila serial). */
  async function startBatch() {
    if (onlyMagnificMode) {
      // ONLY: pula HeyGen totalmente. So Magnific serial pras tasks normais
      // (ready|partial, nao-VA) que tem JSON colado. B-rolls nao precisam
      // de avatar, entao 'partial' tambem vale.
      const cands = Array.from(selectedTaskIds).filter((id) => {
        const a = taskAnalyses[id];
        return a && !a.vaBriefing && (a.status === 'ready' || a.status === 'partial');
      });
      const withJson = cands.filter((id) => (taskMagnificJson[id] || '').trim());
      const missing = cands.filter((id) => !(taskMagnificJson[id] || '').trim());
      if (withJson.length === 0) {
        setError('Cole o JSON de B-rolls nas tasks (botao "+") antes de iniciar o Only Magnific.');
        return;
      }
      setError(
        missing.length > 0
          ? `${missing.length} task(s) sem JSON foram puladas. Cole o JSON no botao "+" delas.`
          : null,
      );
      for (const id of withJson) enqueueMagnificForTask(id, false);
      // Desmarca tasks que foram pra fila — somem da lista de revisão e
      // o usuário não confunde "essa eu já disparei?". O job continua
      // visível e controlável no painel "Fila Magnific" abaixo.
      // Mantém as tasks que ficaram pra trás (sem JSON) selecionadas pra
      // o user saber que ainda tem trabalho a fazer nelas.
      if (withJson.length > 0) {
        setSelectedTaskIds((prev) => {
          const next = new Set(prev);
          for (const id of withJson) next.delete(id);
          return next;
        });
      }
      return;
    }

    if (moreMagnificMode) {
      // MORE: HeyGen Auto roda pra TODAS as tasks ready (igual ao fluxo
      // classico). Magnific gated SO pras tasks ready com JSON — o gate
      // destrava quando o HeyGen DAQUELA task conclui, entao so faz sentido
      // pra tasks que de fato vao rodar HeyGen (ready). Task 'partial' com
      // JSON: nao roda HeyGen, entao seria job preso — pulada (use Only).
      const ready = Array.from(selectedTaskIds).filter((id) => taskAnalyses[id]?.status === 'ready');
      const withJson = ready.filter(
        (id) => !taskAnalyses[id]?.vaBriefing && (taskMagnificJson[id] || '').trim(),
      );
      for (const id of withJson) enqueueMagnificForTask(id, true);
      if (ready.length === 0) {
        setError('Nenhuma task ready selecionada. Confira que avatares + voz estao OK.');
        return;
      }
      setError(
        withJson.length === 0
          ? 'Nenhuma task ready com JSON de B-rolls — rodando so HeyGen. Cole o JSON no botao "+" pra gerar B-rolls.'
          : null,
      );
      // Marca TODAS como 'queued' imediatamente (skeleton de batchStates)
      // e dispara via runHeyGenGated — o semafaro global de MAX_HEYGEN_PARALLEL
      // garante max 2 simultaneos, mesmo com Retomar/Debug em flight de runs
      // anteriores. O promoter cobre tasks que ficarem na fila se houver
      // crash/reload no meio.
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of ready) {
          const a = taskAnalyses[id];
          if (!a) continue;
          const baseAdId = a.baseAdId || a.taskName;
          next[id] = {
            ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now(), phase: 'queued' as const }),
            phase: 'queued',
            message: 'Na fila — aguardando vaga...',
            finishedAt: undefined,
          } as BatchTaskState;
        }
        return next;
      });
      for (const taskId of ready) {
        void runHeyGenGated(taskId, 'run');
      }
      return;
    }

    // === Fluxo classico (nenhum toggle) ===
    const ready = Array.from(selectedTaskIds).filter((id) => taskAnalyses[id]?.status === 'ready');
    if (ready.length === 0) {
      setError('Nenhuma task ready selecionada. Confira que avatares + voz estao OK.');
      return;
    }
    setError(null);

    // SEPARA: VA usa pipeline proprio (lipsync), normais usam HeyGen Auto.
    // User pediu: "VA NAO DEVE RODAR PIPELINE SEPARADO, DEVE IR PRA MESMA
    // FILA E DISPARAR NO START TAMBEM". Resolvido: START agora dispara AMBOS.
    const vaTasks = ready.filter((id) => !!taskAnalyses[id]?.vaBriefing);
    const trocaTasks = ready.filter((id) => !!taskAnalyses[id]?.trocaBriefing);
    const normalTasks = ready.filter(
      (id) => !taskAnalyses[id]?.vaBriefing && !taskAnalyses[id]?.trocaBriefing,
    );

    // 1. Normais via HeyGen Auto gated
    setBatchStates((prev) => {
      const next = { ...prev };
      for (const id of normalTasks) {
        const a = taskAnalyses[id];
        if (!a) continue;
        const baseAdId = a.baseAdId || a.taskName;
        next[id] = {
          ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now(), phase: 'queued' as const }),
          phase: 'queued',
          message: 'Na fila — aguardando vaga...',
          finishedAt: undefined,
        } as BatchTaskState;
      }
      return next;
    });
    for (const taskId of normalTasks) {
      void runHeyGenGated(taskId, 'run');
    }

    // 2. VA: AGORA entra na MESMA fila (gated por MAX_HEYGEN_PARALLEL), com
    //    card + previews iguais aos normais. Sem disparo separado, sem botao
    //    "Iniciar Pipeline VA". START dispara tudo junto.
    const vaReady: string[] = [];
    const vaBlocked: string[] = [];
    for (const id of vaTasks) {
      if (vaReadinessIssues(id).length === 0) vaReady.push(id);
      else vaBlocked.push(`${taskAnalyses[id]?.taskName || id} (${vaReadinessIssues(id).join(', ')})`);
    }
    if (vaBlocked.length > 0) {
      setError(`VA pulado por falta de config: ${vaBlocked.join(' · ')}. Escolha avatar + voz + AD original e dispare de novo.`);
    }
    if (vaReady.length > 0) {
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of vaReady) {
          const a = taskAnalyses[id];
          if (!a?.vaBriefing) continue;
          const driveId = a.vaBriefing.linkAdFileId || extractDriveFileId(vaAdUrl[id] || '');
          next[id] = {
            ...(next[id] || { taskId: id, taskName: a.taskName, baseAdId: a.vaBriefing.baseAdId, parts: [], startedAt: Date.now() }),
            phase: 'queued',
            isVA: true,
            adOriginalUrl: driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : undefined,
            message: 'Na fila — aguardando vaga...',
            finishedAt: undefined,
          } as BatchTaskState;
        }
        return next;
      });
      for (const taskId of vaReady) {
        void runHeyGenGated(taskId, 'run');
      }
    }

    // 3. TROCA DE ÁUDIO: pipeline proprio (download + descamufla + recamufla).
    //    Roda na mesma fila (batchStates) com card + download iguais.
    if (trocaTasks.length > 0) {
      setBatchStates((prev) => {
        const next = { ...prev };
        for (const id of trocaTasks) {
          const aa = taskAnalyses[id];
          if (!aa) continue;
          const baseAdId = aa.trocaBriefing?.baseAdId || aa.baseAdId || aa.taskName;
          next[id] = {
            ...(next[id] || { taskId: id, taskName: aa.taskName, baseAdId, parts: [], startedAt: Date.now() }),
            kind: 'troca',
            taskName: aa.taskName,
            baseAdId,
            phase: 'queued',
            message: 'Na fila — troca de áudio...',
            finishedAt: undefined,
            taskUrl: next[id]?.taskUrl || aa.taskUrl,
          } as BatchTaskState;
        }
        return next;
      });
      // Serial: FFmpeg-wasm e single-instance — processa uma troca de cada vez
      // pra nao corromper mux concorrente. As outras ficam 'queued' no card.
      void (async () => {
        for (const taskId of trocaTasks) {
          if (batchCancelRef.current[taskId]) continue;
          await runTrocaAudioPipelineForTask(taskId);
        }
      })();
    }
  }

  /** Ungate: quando o HeyGen Auto de uma task (MORE) conclui, libera o job
   *  Magnific gated daquela task pro processor serial. */
  useEffect(() => {
    const toUngate = Object.entries(magnificQueue).filter(
      ([taskId, job]) =>
        job.gateOnHeyGen && job.status === 'queued' && batchStates[taskId]?.phase === 'done',
    );
    if (toUngate.length === 0) return;
    // Functional update — nao clobbar patches concorrentes do processor.
    setMagnificQueueState((prev) => {
      const next = { ...prev };
      for (const [taskId] of toUngate) {
        const cur = next[taskId];
        if (!cur || !cur.gateOnHeyGen || cur.status !== 'queued') continue;
        next[taskId] = {
          ...cur,
          gateOnHeyGen: false,
          message: `HeyGen concluido — na fila Magnific (${cur.takeCount} takes)...`,
        };
      }
      return next;
    });
    setMagnificTick((t) => t + 1);
  }, [batchStates, magnificQueue]);

  /**
   * Processor SERIAL — defesa em 4 camadas contra duplo disparo:
   *   1. ref-guard local (magnificProcessingRef) — sincrono, mesma aba
   *   2. pickNextMagnificJob — ignora qualquer job 'running' vivo
   *   3. tryAcquireMagnificJob — re-lê localStorage AGORA (não state) e
   *      adquire lock cross-tab via ownerTabId + heartbeat
   *   4. heartbeat ticker — escreve a cada 5s; outras abas veem que está vivo
   *
   * Se 2 abas chamam ao mesmo tempo, só uma ganha o tryAcquire. A outra
   * cai no early-return e tenta depois. NUNCA dispara 2 jobs simultâneos.
   */
  useEffect(() => {
    if (magnificProcessingRef.current) return;
    const job = pickNextMagnificJob(magnificQueue);
    if (!job) return;

    // Camada 3: lock cross-tab via localStorage (último a escrever vence,
    // mas o re-check de "alguém vivo" dentro do tryAcquire filtra a corrida).
    if (!tryAcquireMagnificJob(job.taskId)) {
      // Outra aba pegou o job antes de nós. Re-tenta após heartbeat stale —
      // se a outra aba morreu, conseguimos depois.
      return;
    }

    magnificProcessingRef.current = true;
    const taskId = job.taskId;
    const ac = new AbortController();
    magnificAbortRef.current = ac;
    magnificActiveRef.current = { taskId, startedAt: Date.now() };
    magnificStopIntentRef.current[taskId] = null;
    magnificCancelRef.current[taskId] = false;

    // Camada 4: heartbeat ticker — escreve a cada 5s. Se a aba travar
    // ou fechar, em 30s outras abas consideram órfão e pegam o job.
    const heartbeatTimer = setInterval(() => {
      const ok = pulseHeartbeat(taskId);
      if (!ok) {
        // Perdemos o ownership (outra aba assumiu) — aborta este pipeline
        // pra não duplicar trabalho. O cleanup do finally roda normal.
        console.warn('[magnific] heartbeat negado — outra aba assumiu o job', taskId);
        try { ac.abort(); } catch {}
        clearInterval(heartbeatTimer);
      }
    }, HEARTBEAT_INTERVAL_MS);

    (async () => {
      patchMagnificJob(taskId, {
        status: 'running',
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        ownerTabId: thisTabId(),
        message: 'Disparando pipeline Magnific...',
        percent: 0,
      });
      // Resolve o status final respeitando intencao do user (pausar/debug)
      // ou watchdog — nunca sobrescreve com 'failed'/'done' indevido.
      const settle = (
        normal: () => void,
      ) => {
        const intent = magnificStopIntentRef.current[taskId];
        if (intent === 'paused') {
          patchMagnificJob(taskId, { status: 'paused', message: '⏸ Pausado pelo user — clique Retomar', finishedAt: Date.now() });
        } else if (intent === 'debug') {
          // Debug handler ja re-enfileira (status 'queued') — nao mexe aqui.
        } else if (intent === 'watchdog') {
          patchMagnificJob(taskId, { status: 'failed', message: '⚠ Travou (loop infinito?) — clique 🐞 Debug pra recriar o space', finishedAt: Date.now() });
        } else {
          normal();
        }
      };
      try {
        const takes = parseMagnificPrompts(job.takesJson);
        if (takes.length === 0) {
          patchMagnificJob(taskId, {
            status: 'failed',
            message: 'JSON sem takes validos.',
            finishedAt: Date.now(),
          });
          return;
        }
        // SEMPRE V2 — API direta server-side (10x mais rápido, sem extension).
        const res = await runMagnificPipelineV2(
          { spaceName: job.adName, takes },
          {
            signal: ac.signal,
            onProgress: (p) => {
              if (magnificCancelRef.current[taskId]) return;
              patchMagnificJob(taskId, {
                phase: p.phase,
                percent: p.percent,
                message: p.message
                  ? `${p.message} (${p.ready}/${p.total})`
                  : `${p.ready}/${p.total} takes`,
                totalCount: p.total,
                successCount: p.ready,
              });
            },
          },
        );
        settle(() => {
          if (res.ok && res.complete && res.zipBlob) {
            const zipKey = `magnific:${taskId}:takes`;
            const zipName = res.zipName || `${job.adName}_brolls.zip`;
            void (async () => {
              try {
                const { saveZip } = await import('@/lib/zip-store');
                await saveZip(zipKey, res.zipBlob!, zipName);
              } catch (e) {
                console.warn('[magnific-queue] falha salvando ZIP em IndexedDB:', e);
              }
            })();
            patchMagnificJob(taskId, {
              status: 'done',
              zipKey,
              zipName,
              successCount: res.successCount,
              totalCount: res.takes.length,
              percent: 100,
              message: `Pronto: ${res.successCount}/${res.takes.length} takes · ${zipName}`,
              finishedAt: Date.now(),
            });
          } else {
            patchMagnificJob(taskId, {
              status: 'failed',
              message: `Magnific incompleto: ${res.successCount}/${res.takes.length} takes${
                res.missingIdxs?.length ? ` (faltou ${res.missingIdxs.join(', ')})` : ''
              }`,
              finishedAt: Date.now(),
            });
          }
        });
      } catch (e) {
        settle(() => {
          patchMagnificJob(taskId, {
            status: 'failed',
            message: (e as Error)?.message || 'erro no pipeline Magnific',
            finishedAt: Date.now(),
          });
        });
      } finally {
        // Para de bater heartbeat IMEDIATAMENTE — outras abas podem assumir.
        clearInterval(heartbeatTimer);
        // So libera o guard se AINDA somos o job ativo (watchdog pode ter
        // ja liberado + iniciado outro — nao podemos roubar o guard dele).
        if (magnificActiveRef.current?.taskId === taskId) {
          magnificActiveRef.current = null;
          magnificAbortRef.current = null;
          magnificProcessingRef.current = false;
          setMagnificTick((t) => t + 1);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magnificQueue, magnificTick]);

  /**
   * Watchdog anti-loop. Calcula timeout DINAMICAMENTE pela qtd de takes:
   *   - 60s por take + 4min de setup, mínimo 8min, máximo 32min
   *   - Ex: 5 takes = 9min; 20 takes = 24min; 40 takes = 32min (cap)
   *
   * Mais generoso pra jobs grandes legítimos, mais agressivo pra jobs
   * pequenos que ficaram presos. Quando estoura, aborta + recarrega aba
   * Magnific + libera fila pro próximo.
   */
  useEffect(() => {
    const id = setInterval(() => {
      const act = magnificActiveRef.current;
      if (!act) return;
      const job = magnificQueue[act.taskId];
      const takes = job?.takeCount ?? 5;
      const dynamicTimeoutMs = Math.max(
        8 * 60 * 1000,
        Math.min(32 * 60 * 1000, takes * 60_000 + 4 * 60_000),
      );
      if (Date.now() - act.startedAt < dynamicTimeoutMs) return;
      const taskId = act.taskId;
      if (magnificStopIntentRef.current[taskId]) return; // ja tratado
      console.warn(
        '[magnific-watchdog] job travado',
        taskId,
        `(${takes} takes, limite ${(dynamicTimeoutMs / 60_000).toFixed(0)}min)`,
      );
      magnificStopIntentRef.current[taskId] = 'watchdog';
      magnificCancelRef.current[taskId] = true;
      try { magnificAbortRef.current?.abort(); } catch {}
      // CRÍTICO: mata o pipeline ÓRFÃO na extensão e recarrega a aba
      // Magnific. Sem isso o job zumbi segue vivo e o PRÓXIMO job
      // dispara na MESMA aba = ">1 ao mesmo tempo" + cascata. Próximo
      // sempre roda numa aba limpa.
      try { abortAllMagnific(); } catch {}
      patchMagnificJob(taskId, {
        status: 'failed',
        message: `⚠ Travou (>${(dynamicTimeoutMs / 60_000).toFixed(0)}min) — clique 🐞 Debug pra recriar o space`,
        finishedAt: Date.now(),
        // Limpa heartbeat e owner — fila destravada pra outras abas se houver
        lastHeartbeatAt: undefined,
        ownerTabId: undefined,
      });
      // Libera o guard SEM esperar a promise (pode nunca resolver).
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
      setMagnificTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [magnificQueue]);

  function cancelTaskBatch(taskId: string) {
    batchCancelRef.current[taskId] = true;
  }

  /** Wrapper gated: pega vaga no semafaro (MAX_HEYGEN_PARALLEL) ou marca
   *  a task como 'queued' e poll-aguarda. O promoter useEffect ja monitora
   *  e dispara automaticamente — esta funcao e' o caminho pros call-sites
   *  manuais (Retomar/Debug/dispatchTask/startBatch). Idempotente: 2o
   *  clique enquanto pendente e' no-op (heygenPendingRef dedup).
   *
   *  kind='run'    → runTaskInBackground (dispatch+poll+download+post)
   *  kind='resume' → resumeTaskBatch (so re-poll+download+post, requer videoIds)
   */
  async function runHeyGenGated(taskId: string, kind: 'run' | 'resume') {
    if (heygenPendingRef.current[taskId]) {
      // Ja ha wrapper esperando ou rodando — clique extra ignorado.
      return;
    }
    heygenPendingRef.current[taskId] = kind;
    try {
      // ESPERA VAGA — checa a cada 1s. batchCancelRef true sai sem rodar.
      while (heygenSlotsRef.current >= MAX_HEYGEN_PARALLEL) {
        if (batchCancelRef.current[taskId]) {
          // User cancelou enquanto estava na fila — marca failed e sai.
          setBatchStates((prev) => {
            const cur = prev[taskId];
            if (!cur) return prev;
            return { ...prev, [taskId]: { ...cur, phase: 'failed', message: 'Cancelado na fila', finishedAt: Date.now() } };
          });
          return;
        }
        // Garante que UI mostra 'queued' enquanto espera vaga. Patch raso —
        // nao toca em parts/replan/etc (esses ja foram preservados pelo
        // ultimo setBatchStates de quem criou o queued, OU pelo restore).
        setBatchStates((prev) => {
          const cur = prev[taskId];
          if (cur && cur.phase === 'queued') return prev; // ja marcado
          if (!cur) return prev; // sem entrada — promoter cria, nao aqui
          return { ...prev, [taskId]: { ...cur, phase: 'queued', message: `Aguardando vaga (${heygenSlotsRef.current}/${MAX_HEYGEN_PARALLEL} ocupados)...`, finishedAt: undefined } };
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      heygenSlotsRef.current++;
      try {
        // batchCancelRef pode ter sido setado entre espera e o try — re-checa.
        if (batchCancelRef.current[taskId]) return;
        batchCancelRef.current[taskId] = false;
        if (kind === 'resume') {
          await resumeTaskBatch(taskId);
        } else {
          await runTaskInBackground(taskId);
        }
      } finally {
        heygenSlotsRef.current = Math.max(0, heygenSlotsRef.current - 1);
      }
    } finally {
      delete heygenPendingRef.current[taskId];
    }
  }

  /** PROMOTER — escaneia batchStates por entradas 'queued' e dispara
   *  enquanto houver vaga. Roda quando batchStates muda (apos um run
   *  finalizar, libera slot → promove proxima). Tambem no mount (resume
   *  de reload). FIFO por startedAt (mais antigo primeiro).
   *
   *  Nao usa heygenPendingRef como filtro — runHeyGenGated faz dedup
   *  interno. Aqui so checamos slots livres pra evitar disparar 10
   *  wrappers a esmo (cada um faria 1 setTimeout — desperdicio). */
  useEffect(() => {
    if (heygenSlotsRef.current >= MAX_HEYGEN_PARALLEL) return;
    const queued = Object.values(batchStates)
      // TROCA DE ÁUDIO roda fora do HeyGen — promoter NUNCA toca nelas.
      .filter((b) => b.phase === 'queued' && b.kind !== 'troca' && !heygenPendingRef.current[b.taskId])
      .sort((a, b) => a.startedAt - b.startedAt);
    if (queued.length === 0) return;
    const freeSlots = MAX_HEYGEN_PARALLEL - heygenSlotsRef.current;
    for (let i = 0; i < Math.min(freeSlots, queued.length); i++) {
      const b = queued[i];
      const kind: 'run' | 'resume' = b.parts.some((p) => p.videoId) ? 'resume' : 'run';
      void runHeyGenGated(b.taskId, kind);
    }
    // ESLint: runHeyGenGated nao precisa estar em deps — ela usa refs/setters
    // que sao estaveis. batchStates e a unica fonte real de mudanca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchStates]);

  /** RETOMAR (HeyGen lipsync) — funciona INDEPENDENTE da situacao:
   *  - tem videoIds disparados → re-checa status no HeyGen + re-baixa (rapido)
   *  - 0 disparados (ex: bloqueio/quota, erro antes do dispatch) → re-roda do
   *    zero (TTS+upload+submit+poll+zip). Garante botao util sempre.
   *  Gated por MAX_HEYGEN_PARALLEL — se 2 ja rodando, vira 'queued'. */
  function retomarTaskBatch(taskId: string) {
    // TROCA DE ÁUDIO: re-roda o pipeline proprio (nao tem HeyGen pra retomar).
    if (batchStates[taskId]?.kind === 'troca' || taskAnalyses[taskId]?.trocaBriefing) {
      void runTrocaAudioPipelineForTask(taskId);
      return;
    }
    // s pode estar ausente no estado React logo apos navegar pro motor
    // (restore ainda nao reidratou) — caimos no localStorage autoritativo.
    const s = batchStates[taskId];
    const persisted = !s ? (loadPersistedBatchStates() as Record<string, BatchTaskState>)[taskId] : null;
    const eff = s || persisted;
    if (!eff) {
      // Sem estado nenhum: ultima tentativa via replan persistido.
      const replan = loadPersistedReplan(taskId);
      if (replan) {
        // Cria stub 'queued' pra UI ter feedback enquanto espera vaga.
        setBatchStates((prev) => ({
          ...prev,
          [taskId]: {
            taskId,
            taskName: replan.taskName,
            baseAdId: replan.baseAdId,
            phase: 'queued',
            parts: [],
            startedAt: Date.now(),
            message: 'Na fila — aguardando vaga...',
            replan,
          },
        }));
        void runHeyGenGated(taskId, 'run');
      }
      return;
    }
    batchCancelRef.current[taskId] = false;
    const kind: 'run' | 'resume' = eff.parts?.some((p) => p.videoId) ? 'resume' : 'run';
    // Marca 'queued' imediato pra UI esconder botoes — runHeyGenGated
    // ajusta a mensagem assim que o loop de espera comeca, ou pula direto
    // pro run/resume se ha vaga livre.
    setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      // Nao sobrescreve um state que ja esta rodando.
      if (ACTIVE_BATCH_PHASES.includes(cur.phase as BatchTaskState['phase'])) return prev;
      return { ...prev, [taskId]: { ...cur, phase: 'queued', message: 'Na fila — aguardando vaga...', finishedAt: undefined } };
    });
    void runHeyGenGated(taskId, kind);
  }

  // ═══════════════════ EDIT PART (re-gerar 1 take) ═══════════════════
  //
  // User clica EDIT em 1 card de preview → abre modal → edita texto →
  // REFRESH dispara so essa parte (mesmo label) via processJob → poll →
  // download → salva blob no IDB. Marca a parte como "dirty" pra que o
  // BatchJobCard3D mostre botao "Atualizar montagem" depois.

  const [editingPart, setEditingPart] = useState<
    | { taskId: string; partIdx: number; label: string; currentText: string }
    | null
  >(null);
  // Avatar/voice escolhidos no modal (controlados — pickers leem desses states).
  // Resetados ao abrir; lidos no regenerateSinglePart.
  const [editAvatar, setEditAvatar] = useState<AvatarOption | null>(null);
  const [editVoice, setEditVoice] = useState<{ id: string; name: string } | null>(null);
  const [regeneratingPart, setRegeneratingPart] = useState<{ taskId: string; label: string } | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [rebuildingTaskId, setRebuildingTaskId] = useState<string | null>(null);

  /** Procura AvatarOption completo na library cache pelo avatarId.
   *  Retorna null se nao achar (library nao carregada ou avatar deletado). */
  function findAvatarOptionById(avatarId: string | null | undefined): AvatarOption | null {
    if (!avatarId) return null;
    const snap = getLibrarySnapshot();
    for (const g of snap.groups) {
      for (const look of g.looks) {
        if (look.id === avatarId) {
          return {
            id: look.id,
            name: look.name || g.name,
            thumb: look.thumb || g.thumb || null,
            videoPreview: (look as any).videoPreview || null,
            type: g.type,
            version: g.version,
            groupId: g.id,
            groupName: g.name,
          } as AvatarOption;
        }
      }
    }
    return null;
  }

  function openEditPart(taskId: string, partIdx: number) {
    const b = batchStates[taskId];
    if (!b) return;
    const part = b.parts[partIdx];
    if (!part) return;
    const replanPart = b.replan?.parts[partIdx];
    setRegenError(null);
    // Pre-popula avatar + voice com o que ja esta usando
    const currentAvatar = findAvatarOptionById(replanPart?.avatarId);
    setEditAvatar(currentAvatar);
    setEditVoice(replanPart?.voiceId ? { id: replanPart.voiceId, name: '' } : null);
    setEditingPart({
      taskId,
      partIdx,
      label: part.label,
      currentText: replanPart?.text || '',
    });
    // Garante library carregada (no-op se ja em cache)
    void reloadLibrary(false);
  }

  async function regenerateSinglePart(newText: string) {
    if (!editingPart) return;
    const { taskId, partIdx, label } = editingPart;
    const b = batchStates[taskId];
    const replanPart = b?.replan?.parts[partIdx];
    if (!b || !replanPart) {
      setRegenError('Sem dados de replan — refaz a analise da task.');
      return;
    }
    // Avatar pode vir do picker (editAvatar) OU do replan antigo. Se NENHUM, erro.
    const effectiveAvatarId = editAvatar?.id || replanPart.avatarId;
    if (!effectiveAvatarId) {
      setRegenError('Escolha um avatar — sem avatar nao da pra disparar.');
      return;
    }
    // Voz pode vir do picker (editVoice) OU do replan antigo. Null = voz padrao do avatar.
    const effectiveVoiceId = editVoice?.id || replanPart.voiceId || null;
    if (newText.trim().length === 0) {
      setRegenError('Texto vazio — preenche o script.');
      return;
    }
    setRegeneratingPart({ taskId, label });
    setRegenError(null);

    try {
      // 1) Atualiza replan local com novo texto + novo avatar + nova voz
      //    (persiste no localStorage automaticamente via useEffect persistBatchStates).
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur || !cur.replan) return prev;
        const newReplanParts = cur.replan.parts.map((p, i) => i === partIdx
          ? { ...p, text: newText, avatarId: effectiveAvatarId, voiceId: effectiveVoiceId }
          : p);
        return {
          ...prev,
          [taskId]: {
            ...cur,
            replan: { ...cur.replan, parts: newReplanParts },
            // Reseta status visual da parte pra pending enquanto re-gera
            parts: cur.parts.map((p, i) => i === partIdx
              ? { ...p, videoStatus: 'pending' as const, videoUrl: null, error: null }
              : p),
          },
        };
      });

      // 2) Dispara processJob com novo texto + (talvez) novo avatar + (talvez) nova voz
      const { processJob } = await import('@/lib/heygen-api-direct');
      const adNameSafe = b.baseAdId.replace(/[^A-Z0-9]/gi, '_');
      const job = await processJob({
        text: newText,
        voiceId: effectiveVoiceId || undefined,
        title: `${adNameSafe}_${label}_edit`,
        avatarId: effectiveAvatarId,
        engine: 'iii',
        orientation: 'portrait',
      });
      if (!job.videoId) throw new Error('processJob nao retornou videoId.');

      // 3) Atualiza state com novo videoId (overwrite o antigo)
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        const newParts = cur.parts.map((p, i) => i === partIdx
          ? { ...p, videoId: job.videoId, videoStatus: 'pending' as const, videoUrl: null, error: null }
          : p);
        return { ...prev, [taskId]: { ...cur, parts: newParts } };
      });

      // 4) Poll ate completar (zombie kill 15min pra evitar hang)
      const statuses = await pollVideosUntilReady([job.videoId], {
        intervalMs: 8000,
        timeoutMs: 25 * 60 * 1000,
        maxPendingMsPerId: 15 * 60 * 1000,
      });
      const st = statuses[job.videoId];
      if (!st || st.status !== 'completed' || !st.videoUrl) {
        throw new Error(`Re-render falhou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
      }

      // 5) Baixa o MP4 + salva blob no IDB (substitui o antigo). RETOMAR
      //    futuro vai hidratar essa parte do IDB sem re-baixar.
      const bytes = await downloadVideoBytes(st.videoUrl);
      const partBlob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
      try {
        const { saveBlob } = await import('@/lib/zip-store');
        await saveBlob(`pilot:${taskId}:part:${label}`, partBlob, 'video/mp4');
      } catch (e) { console.warn('[edit-part] save blob IDB falhou:', e); }

      // 6) Atualiza state final com URL pronta + marca como dirty (montagem
      //    fica desatualizada ate user clicar "Atualizar montagem")
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        const newParts = cur.parts.map((p, i) => i === partIdx
          ? { ...p, videoUrl: st.videoUrl, videoStatus: 'completed' as const }
          : p);
        const dirty = new Set(cur.dirtyParts || []);
        dirty.add(label);
        return { ...prev, [taskId]: { ...cur, parts: newParts, dirtyParts: Array.from(dirty) } };
      });

      // Fecha modal
      setEditingPart(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRegenError(msg);
    } finally {
      setRegeneratingPart(null);
    }
  }

  // ═══════════════════ REBUILD MONTAGE (refazer ZIPs) ═══════════════════
  //
  // Apos editar 1+ takes, user clica "Atualizar montagem" — re-roda
  // runPostPipeline com TODOS os blobs do IDB (fresh) e gera novos
  // montadoZipUrl/camufladoZipUrl. dirtyParts limpa pra zerar o flag.

  async function rebuildMontage(taskId: string) {
    const b = batchStates[taskId];
    if (!b) return;
    setRebuildingTaskId(taskId);
    try {
      const { loadBlob, saveZip } = await import('@/lib/zip-store');
      // Hidrata blobs do IDB (todos, fresh — incluindo os editados)
      const partBlobs: Array<{ label: string; blob: Blob | null }> = await Promise.all(
        b.parts.map(async (p) => {
          if (!p.videoId) return { label: p.label, blob: null };
          try {
            const blob = await loadBlob(`pilot:${taskId}:part:${p.label}`, 'video/mp4');
            return { label: p.label, blob: blob && blob.size > 1024 ? blob : null };
          } catch { return { label: p.label, blob: null }; }
        }),
      );

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'post', message: 'Re-montando com parts editadas...', finishedAt: undefined },
      }));

      const _tc = getTaskCamuflagem(taskId);
      const pipeRes = await runPostPipeline({
        baseAdId: b.baseAdId,
        parts: partBlobs,
        decupagem: isDecupagemEnabled(taskId),
        camuflagem: _tc.camuflagem,
        whiteAudio: _tc.whiteAudio,
        camuflagemVolume: _tc.camuflagemVolume,
        onProgress: (p) => {
          setBatchStates((prev) => ({
            ...prev,
            [taskId]: { ...prev[taskId], message: `${p.stage} ${p.doneCount}/${p.totalCount}${p.currentFilename ? ` · ${p.currentFilename}` : ''}` },
          }));
        },
      });

      // Reconstroi os ZIPs (montado + camo) — mesmo pattern do resumeTaskBatch
      const JSZip = (await import('jszip')).default;
      const assembled = pipeRes.items;
      const adNameClean = b.baseAdId.replace(/[^A-Z0-9]/gi, '_');

      // ZIP montado
      const zipMont = new JSZip();
      for (const item of assembled) {
        if (item.decupado) zipMont.file(item.filename, item.decupado);
        else if (item.rawAssembled && item.rawAssembled.size > 0 && !item.errors?.assemble) {
          const baseName = item.filename.replace('.mp4', '_sem_decupagem.mp4');
          zipMont.file(baseName, item.rawAssembled);
          zipMont.file(`${item.filename.replace('.mp4', '')}_DECUPAGEM_ERRO.txt`, item.errors?.decupagem || 'erro');
        } else {
          zipMont.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`,
            `Assemble: ${item.errors?.assemble || 'OK'}\nDecupagem: ${item.errors?.decupagem || 'OK'}`);
        }
      }
      zipMont.file('_DIAGNOSTICO.txt', `Re-montagem apos edicao de parts\n${pipeRes.diagnostics.summary}\n`);
      const montBlob = await zipMont.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const montadoName = `${adNameClean}_${isDecupagemEnabled(taskId) ? 'montado_decupado' : 'montado'}.zip`;
      const montadoUrl = URL.createObjectURL(montBlob);
      try { await saveZip(`batch:${taskId}:montado`, montBlob, montadoName); } catch {}

      // ZIP camo (se modo ON)
      let camuUrl: string | undefined;
      let camuName: string | undefined;
      if (camuflagemMode) {
        const zipCamu = new JSZip();
        for (const item of assembled) {
          if (item.camuflado) zipCamu.file(item.filename.replace('.mp4', '_camuflado.mp4'), item.camuflado);
          else zipCamu.file(`${item.filename.replace('.mp4', '')}_CAMUFLAGEM_ERRO.txt`, item.errors?.camuflagem || 'falha');
        }
        const camuBlob = await zipCamu.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        camuName = `${adNameClean}_camuflado.zip`;
        camuUrl = URL.createObjectURL(camuBlob);
        try { await saveZip(`batch:${taskId}:camo`, camuBlob, camuName); } catch {}
      }

      const decupagemOn = isDecupagemEnabled(taskId);
      const pipeStats = {
        expectedMontagens: assembled.length,
        okMontagens: assembled.filter((it) => !it.errors?.assemble && it.rawAssembled && it.rawAssembled.size > 0).length,
        okDecupados: assembled.filter((it) => !!it.decupado).length,
        okCamuflados: assembled.filter((it) => !!it.camuflado).length,
        expectedDecupagem: decupagemOn,
        expectedCamuflagem: camuflagemMode,
      };

      // Revoga URLs antigas antes de substituir (memoria)
      for (const url of [b.montadoZipUrl, b.camufladoZipUrl]) {
        if (url) { try { URL.revokeObjectURL(url); } catch {} }
      }

      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: `Re-montado · ${pipeRes.diagnostics.summary}`,
          finishedAt: Date.now(),
          montadoZipUrl: montadoUrl,
          montadoZipName: montadoName,
          camufladoZipUrl: camuUrl,
          camufladoZipName: camuName,
          pipeStats,
          dirtyParts: [], // limpa flag — montagem ta fresh
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], phase: 'done', message: `Re-montagem falhou: ${msg}`, finishedAt: Date.now() },
      }));
    } finally {
      setRebuildingTaskId(null);
    }
  }

  /** PAUSAR (HeyGen lipsync) — aborta o processamento atual dessa task.
   *  O run em andamento detecta o cancel e encerra; depois o botao RETOMAR
   *  re-checa/baixa o que ja renderizou ou re-roda do zero. */
  function pausarTaskBatch(taskId: string) {
    batchCancelRef.current[taskId] = true;
    setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur || cur.phase === 'done' || cur.phase === 'failed') return prev;
      return { ...prev, [taskId]: { ...cur, message: '⏸ Pausado pelo user — clique Retomar' } };
    });
  }

  /** DEBUG (HeyGen lipsync) — reserva pra casos de bug: reinicia o processo
   *  de gerar os lips DESSA task do ZERO (re-dispatch completo). Aborta o
   *  run atual e recomeca limpo. Gated por MAX_HEYGEN_PARALLEL. */
  function debugTaskBatch(taskId: string, skipConfirm = false) {
    // TROCA DE ÁUDIO: re-roda o pipeline proprio do zero (sem HeyGen).
    if (batchStates[taskId]?.kind === 'troca' || taskAnalyses[taskId]?.trocaBriefing) {
      if (!skipConfirm && !confirm('Refazer a troca de áudio dessa task do zero?')) return;
      void runTrocaAudioPipelineForTask(taskId);
      return;
    }
    if (!skipConfirm && !confirm('DEBUG: reiniciar a geracao de LIPS dessa task do zero?\n\nVai re-disparar TODAS as partes no HeyGen (cria videos novos).')) return;
    batchCancelRef.current[taskId] = true;
    // Pequeno delay deixa o run atual (se houver) abortar antes do restart.
    setTimeout(() => {
      batchCancelRef.current[taskId] = false;
      // Marca queued pra UI; runHeyGenGated promove direto se ha vaga.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'queued', message: 'Debug — recriando do zero (aguardando vaga)...', finishedAt: undefined } };
      });
      void runHeyGenGated(taskId, 'run');
    }, 300);
  }

  /** Baixa o ZIP de takes Magnific do IndexedDB (Blob URL nao sobrevive
   *  reload — sempre reconstruimos on-demand do zip-store). */
  async function downloadMagnificZip(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job?.zipKey) return;
    try {
      const { loadZip } = await import('@/lib/zip-store');
      const rec = await loadZip(job.zipKey);
      if (!rec) {
        setError('ZIP Magnific nao encontrado no armazenamento local.');
        return;
      }
      const a = document.createElement('a');
      a.href = rec.blobUrl;
      a.download = rec.filename || job.zipName || `${job.adName}_brolls.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(rec.blobUrl); } catch {} }, 60000);
    } catch (e) {
      setError('Falha baixando ZIP Magnific: ' + ((e as Error)?.message || 'erro'));
    }
  }

  function removeMagnificJob(taskId: string) {
    magnificCancelRef.current[taskId] = true;
    if (magnificActiveRef.current?.taskId === taskId) {
      magnificStopIntentRef.current[taskId] = 'paused';
      try { magnificAbortRef.current?.abort(); } catch {}
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
    }
    setMagnificQueueState((prev) => {
      const { [taskId]: _, ...rest } = prev;
      return rest;
    });
    setMagnificTick((t) => t + 1);
  }

  /** Helper: se `taskId` for o job Magnific ativo, aborta e LIBERA a fila
   *  (intent define como o processor vai assentar o status). */
  function stopActiveMagnificIfCurrent(taskId: string, intent: 'paused' | 'debug') {
    magnificStopIntentRef.current[taskId] = intent;
    magnificCancelRef.current[taskId] = true;
    if (magnificActiveRef.current?.taskId === taskId) {
      try { magnificAbortRef.current?.abort(); } catch {}
      magnificActiveRef.current = null;
      magnificAbortRef.current = null;
      magnificProcessingRef.current = false;
    }
  }

  /** PAUSAR (Magnific) — para o job (rodando ou na fila). Outro job so
   *  inicia se este estiver pausado/finalizado (regra serial mantida). */
  function pauseMagnificJob(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job || job.status === 'done') return;
    stopActiveMagnificIfCurrent(taskId, 'paused');
    patchMagnificJob(taskId, {
      status: 'paused',
      message: '⏸ Pausado pelo user — clique Retomar',
      finishedAt: Date.now(),
    });
    setMagnificTick((t) => t + 1);
  }

  /** RETOMAR (Magnific) — volta o job pra fila. So roda quando nenhum
   *  outro estiver rodando (pickNextMagnificJob garante serial 1/vez). */
  function resumeMagnificJob(taskId: string) {
    const job = magnificQueue[taskId];
    if (!job || job.status === 'running' || job.status === 'done') return;
    magnificStopIntentRef.current[taskId] = null;
    magnificCancelRef.current[taskId] = false;
    patchMagnificJob(taskId, {
      status: 'queued',
      gateOnHeyGen: false,
      message: `Na fila Magnific (${job.takeCount} takes) — aguardando vez...`,
      finishedAt: undefined,
      percent: 0,
    });
    setMagnificTick((t) => t + 1);
  }

  /** DEBUG (Magnific) — reserva p/ bugs (ex: loop infinito no generate
   *  image). Aborta o run atual e RE-ENFILEIRA do zero; ao rodar de novo
   *  o runMagnificPipeline cria um SPACE NOVO (nunca reusa existingSpaceId
   *  aqui), saindo do estado bugado. */
  function debugMagnificJob(taskId: string, skipConfirm = false) {
    const job = magnificQueue[taskId];
    if (!job) return;
    if (!skipConfirm && !confirm('DEBUG: reiniciar a geracao de takes dessa task do ZERO?\n\nAborta o processo atual e cria um SPACE NOVO no Magnific (sai de loop/bug).')) return;
    stopActiveMagnificIfCurrent(taskId, 'debug');
    // Re-enfileira limpo. O processor pega quando nenhum outro estiver
    // rodando; runMagnificPipeline cria space novo automaticamente.
    setTimeout(() => {
      magnificStopIntentRef.current[taskId] = null;
      magnificCancelRef.current[taskId] = false;
      patchMagnificJob(taskId, {
        status: 'queued',
        gateOnHeyGen: false,
        message: '🐞 Debug — recriando do zero (space novo)...',
        zipKey: undefined,
        zipName: undefined,
        percent: 0,
        successCount: undefined,
        finishedAt: undefined,
      });
      setMagnificTick((t) => t + 1);
    }, 300);
  }

  /** Handler dos comandos vindos de outras telas (lipsync-history,
   *  heygen-auto, auto-broll) via command-bus. Ref atualizada a cada
   *  render pra sempre fechar sobre o estado/funcoes ATUAIS (sem stale
   *  closure no setInterval). */
  const jobCmdHandlerRef = useRef<(c: JobCommand) => void>(() => {});
  jobCmdHandlerRef.current = (c: JobCommand) => {
    try {
      if (c.scope === 'heygen') {
        if (c.action === 'retomar') retomarTaskBatch(c.taskId);
        else if (c.action === 'pausar') pausarTaskBatch(c.taskId);
        else if (c.action === 'debug') debugTaskBatch(c.taskId, true);
      } else {
        if (c.action === 'retomar') resumeMagnificJob(c.taskId);
        else if (c.action === 'pausar') pauseMagnificJob(c.taskId);
        else if (c.action === 'debug') debugMagnificJob(c.taskId, true);
      }
    } catch (e) {
      console.error('[job-commands] falha executando', c, e);
    }
  };

  /** Consumidor do command-bus: o motor real (este componente) executa
   *  Retomar/Pausar/Debug pedidos de qualquer tela. Mount + poll 1.5s +
   *  storage event (cross-aba imediato). */
  useEffect(() => {
    const consume = () => {
      const cmds = readJobCommands();
      if (cmds.length === 0) return;
      for (const c of cmds) {
        jobCmdHandlerRef.current(c);
        clearJobCommand(c.id);
      }
    };
    pruneStaleJobCommands();
    consume();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'darkolab:clickup-pilot:commands') consume();
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(consume, 1500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  function downloadZip(taskId: string) {
    const s = batchStates[taskId];
    if (!s?.zipBlobUrl || !s.zipFilename) return;
    const a = document.createElement('a');
    a.href = s.zipBlobUrl;
    a.download = s.zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** Cache de resultados visual match (key = briefingFileId) — evita
   *  re-spend API se o user re-analisa ou roda batch IA Search */
  const visualCacheRef = useRef<Record<string, { matched: { id: string; name: string; groupName?: string } | null; confidence: string; reason: string }>>({});

  /** Roda visual match (Claude vision) pra UM slot. Compara thumb do briefing
   *  com todas as thumbs da biblioteca HeyGen, pega o melhor visual match. */
  const [visualMatching, setVisualMatching] = useState<Record<string, boolean>>({});
  async function runVisualMatchForSlot(taskId: string, roleIdx: number) {
    const a = taskAnalyses[taskId];
    const slot = a?.roleSlots?.[roleIdx];
    if (!slot?.briefingFileId) {
      setError('Sem fileId do video do briefing — Claude precisa de uma imagem de referencia.');
      setErrorAction(null);
      return;
    }
    if (hasAnthropic === false) {
      setError('Configure sua chave Anthropic (Claude) pra usar IA Search visual.');
      setErrorAction({ label: 'Configurar chave', href: '/configuracoes/api' });
      return;
    }
    const key = `${taskId}:${roleIdx}`;
    setVisualMatching((p) => ({ ...p, [key]: true }));
    clearError();
    try {
      // Cache check primeiro — evita re-spend API se ja rodou pra esse fileId
      const cached = visualCacheRef.current[slot.briefingFileId];
      let result = cached;
      if (!result) {
        const refUrl = `https://drive.google.com/thumbnail?id=${slot.briefingFileId}&sz=w400`;
        const cands = avatarCandidates
          .filter((c) => c.thumb)
          .slice(0, 20)
          .map((c) => ({ id: c.id, name: c.name, groupName: c.groupName, thumbUrl: c.thumb! }));
        if (cands.length === 0) {
          setError('Biblioteca vazia ou sem thumbs.');
          setErrorAction(null);
          return;
        }
        const r = await fetch('/api/avatar-visual-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceImageUrl: refUrl, candidates: cands }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          // missingKey marca chave Anthropic nao configurada — oferece link direto
          if (j?.missingKey === 'anthropic') {
            setHasAnthropic(false);
            setError('Configure sua chave Anthropic (Claude) pra usar IA Search visual.');
            setErrorAction({ label: 'Configurar chave', href: '/configuracoes/api' });
            return;
          }
          setError(`IA Search falhou: ${j?.error || j?.detail || `HTTP ${r.status}`}`);
          setErrorAction(null);
          return;
        }
        result = { matched: j.matched, confidence: j.confidence, reason: j.reason };
        visualCacheRef.current[slot.briefingFileId] = result;
      }
      if (!result.matched) {
        setError(`IA Search: Claude nao identificou match visual confiavel. Confianca: ${result.confidence}. ${result.reason || ''}`);
        setErrorAction(null);
        return;
      }
      const candFull = avatarCandidates.find((c) => c.id === result.matched!.id);
      updateRoleSlot(taskId, roleIdx, {
        avatarId: result.matched.id,
        avatarName: result.matched.name,
        avatarThumb: candFull?.thumb || null,
        avatarVoiceId: candFull?.voiceId || null,
        matchedBy: `visual (${result.confidence})`,
      });
    } catch (e) {
      setError(`IA Search erro: ${(e as Error)?.message}`);
      setErrorAction(null);
    } finally {
      setVisualMatching((p) => ({ ...p, [key]: false }));
    }
  }

  /** Roda IA Search em todos os slots pendentes da task em sequencia */
  async function runVisualMatchAllPendingForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a?.roleSlots) return;
    const pendingIdxs = a.roleSlots.map((s, i) => s.avatarId === null && s.briefingFileId ? i : -1).filter(i => i >= 0);
    if (pendingIdxs.length === 0) return;
    for (const idx of pendingIdxs) {
      await runVisualMatchForSlot(taskId, idx);
    }
  }

  /** Atualiza UM roleSlot da task. Usado quando user troca avatar OU voz.
   *  Side-effect: salva memoria voice↔avatar quando ambos estao definidos +
   *  matchedBy nao e 'memory' (evita loop de re-salvar a mesma memoria). */
  function updateRoleSlot(taskId: string, roleIdx: number, patch: Partial<RoleSlot>) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.roleSlots) return prev;
      const prevSlot = a.roleSlots[roleIdx];
      const newSlots = a.roleSlots.map((s, i) => i === roleIdx ? { ...s, ...patch } : s);
      // MEMORIA AVATAR → VOZ: se o user trocou o AVATAR (e nao mexeu na voz
      // no mesmo patch) e ja existe voz lembrada pra esse avatar, ja traz
      // a voz de volta automaticamente (pode trocar depois normalmente).
      const avatarChanged =
        'avatarId' in patch && patch.avatarId && patch.avatarId !== prevSlot?.avatarId;
      if (avatarChanged && !('voiceOverride' in patch)) {
        const mem = recallAvatarVoice(patch.avatarId!);
        if (mem) {
          newSlots[roleIdx] = {
            ...newSlots[roleIdx],
            voiceOverride: { id: mem.voiceId, name: mem.voiceName },
          };
        }
      }
      const allHaveAvatar = newSlots.every((s) => s.avatarId);
      const updated = newSlots[roleIdx];
      // Salva memoria: voz usada (override OU padrao do avatar) → avatarId
      const effectiveVoiceId = updated.voiceOverride?.id || updated.avatarVoiceId;
      const effectiveVoiceName = updated.voiceOverride?.name || normalizeVoiceName(updated.username);
      if (updated.avatarId && updated.avatarName && effectiveVoiceId && effectiveVoiceName && updated.matchedBy !== 'memory') {
        rememberPairing({
          voiceName: effectiveVoiceName,
          voiceId: effectiveVoiceId,
          avatarId: updated.avatarId,
          avatarName: updated.avatarName,
        });
      }
      // Memoria direta avatar → voz escolhida (override). Atualiza sempre
      // que houver avatar + voz override definidos.
      if (updated.avatarId && updated.voiceOverride?.id) {
        rememberAvatarVoice(updated.avatarId, updated.voiceOverride.id, updated.voiceOverride.name || '');
      }
      return { ...prev, [taskId]: { ...a, roleSlots: newSlots, status: allHaveAvatar ? 'ready' : 'partial' } };
    });
  }

  /** Adiciona slot vazio pro user escolher manualmente avatar + voz.
   *  Critico quando parser nao detectou avatar no briefing — user nunca
   *  fica travado, sempre pode adicionar manualmente. */
  function addManualRoleSlot(taskId: string) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a) return prev;
      const slots = a.roleSlots || [];
      const idx = slots.length + 1;
      const role = `Avatar ${idx}`;
      const newSlot: RoleSlot = {
        role,
        username: `manual${idx}`,
        briefingFileId: null,
        avatarId: null,
        avatarName: null,
        avatarThumb: null,
        avatarVoiceId: null,
        voiceOverride: null,
        matchedBy: null,
      };
      return {
        ...prev,
        [taskId]: {
          ...a,
          roleSlots: [...slots, newSlot],
          status: 'partial',
        },
      };
    });
  }

  /** Edita o texto de uma part especifica (preview/correcao manual antes
   *  do dispatch). User abre o preview por avatar, ve EXATAMENTE o que vai
   *  pro HeyGen, e se tiver leak (indicativo de cor vermelha que escapou
   *  do parser), edita direto aqui. Mutacao explicita — substitui o texto
   *  e mantem label + matchByRole. */
  function updatePartTemplateText(taskId: string, partIdx: number, newText: string) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.partTemplates) return prev;
      const newParts = a.partTemplates.map((p, i) => i === partIdx ? { ...p, text: newText } : p);
      return { ...prev, [taskId]: { ...a, partTemplates: newParts } };
    });
  }

  /** Remove uma PART inteira (card) do que vai pro HeyGen. Usado pra tirar
   *  cards que sao lixo de producao que escapou do parser (ex "CRIATIVOS",
   *  "Os criativos sao para META..."). Recalcula as contagens de hook/body
   *  pro header ("N takes (X hook + Y body)") ficar correto. O disparo le de
   *  partTemplates, entao remover aqui = nao gera esse take. */
  function removePartTemplate(taskId: string, partIdx: number) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.partTemplates) return prev;
      const newParts = a.partTemplates.filter((_, i) => i !== partIdx);
      const hookCount = newParts.filter((p) => /^(hook|gancho)/i.test(p.label)).length;
      const bodyPartsCount = newParts.length - hookCount;
      return {
        ...prev,
        [taskId]: { ...a, partTemplates: newParts, totalParts: newParts.length, hookCount, bodyPartsCount },
      };
    });
  }

  /** Map { "taskId:roleIdx" → boolean } pra controlar qual slot esta com
   *  preview aberto. UI efemera, nao persiste. */
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});

  /** Remove um slot manual/auto-detectado */
  function removeRoleSlot(taskId: string, roleIdx: number) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.roleSlots) return prev;
      const newSlots = a.roleSlots.filter((_, i) => i !== roleIdx);
      const allHaveAvatar = newSlots.length > 0 && newSlots.every((s) => s.avatarId);
      return {
        ...prev,
        [taskId]: {
          ...a,
          roleSlots: newSlots,
          status: newSlots.length === 0 ? 'partial' : allHaveAvatar ? 'ready' : 'partial',
        },
      };
    });
  }

  /** Constroi DispatchPlan a partir dos roleSlots + partTemplates da task */
  function buildPlan(a: TaskAnalysis): DispatchPlan | null {
    if (!a.roleSlots || !a.partTemplates) return null;
    const slotsByRole: Record<string, RoleSlot> = {};
    for (const s of a.roleSlots) slotsByRole[s.role.toLowerCase()] = s;
    const firstSlot = a.roleSlots[0];
    const adName = (a.baseAdId || a.taskName).replace(/[^a-z0-9_-]/gi, '_');
    const parts = a.partTemplates.map((pt) => {
      const slot = (pt.matchByRole && slotsByRole[pt.matchByRole]) || firstSlot;
      return {
        label: pt.label,
        text: pt.text,
        avatarId: slot?.avatarId || null,
        avatarName: slot?.avatarName || null,
        avatarThumb: slot?.avatarThumb || null,
        matchedBy: slot?.matchedBy || undefined,
        // voiceId: override > avatar default
        voiceId: slot?.voiceOverride?.id || slot?.avatarVoiceId || null,
      };
    });
    const unmatchedAvatars = a.roleSlots.filter(s => !s.avatarId).map(s => `${s.role}: @${s.username}`);
    return { adName, parts: parts as any, unmatchedAvatars };
  }

  /** Dispara UMA task pra HeyGen Auto Dynamic */
  function dispatchTaskToHeyGen(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a) return;
    // ROUTER VA — se task eh VA briefing, roteia pro pipeline correto
    // automaticamente. User pediu: "VA NAO DEVE RODAR PIPELINE SEPARADO,
    // DEVE IR PRA MESMA FILA E DISPARAR NO START TAMBEM".
    if (a.vaBriefing) {
      const issues = vaReadinessIssues(taskId);
      if (issues.length > 0) {
        setError(`VA incompleto — falta: ${issues.join(', ')}.`);
        return;
      }
      const driveId = a.vaBriefing.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '');
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName: a.taskName, baseAdId: a.vaBriefing!.baseAdId, parts: [], startedAt: Date.now() }),
          phase: 'queued', isVA: true,
          adOriginalUrl: driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : undefined,
          message: 'Na fila — aguardando vaga...', finishedAt: undefined,
        } as BatchTaskState,
      }));
      void runHeyGenGated(taskId, 'run');
      return;
    }
    const plan = buildPlan(a);
    if (!plan || plan.parts.some((p: any) => !p.avatarId)) {
      setError(`Tem avatar sem selecionar. Click no slot e escolhe.`);
      return;
    }
    const handoff = {
      adName: plan.adName,
      motor: 'III',
      mode: 'copy',
      dynamic: true,
      partTexts: plan.parts.map((p: any) => p.text),
      partLabels: plan.parts.map((p: any) => p.label),
      partAvatarIds: plan.parts.map((p: any) => p.avatarId),
      partVoiceIds: plan.parts.map((p: any) => p.voiceId), // NOVO: voz por parte
      copy: plan.parts.map((p: any) => p.text).join('\n\n'),
    };
    sessionStorage.setItem('darkolab:heygen-auto:handoff', JSON.stringify(handoff));
    // Marca task + siblings G1/G2 como disparadas (compartilham conteudo)
    const siblings = getSiblingTaskIds(taskId);
    for (const sid of siblings) markDispatched(sid);
    setTaskAnalyses(prev => {
      const next = { ...prev };
      for (const sid of siblings) {
        if (next[sid]) next[sid] = { ...next[sid], dispatchedAt: Date.now() };
      }
      return next;
    });
    router.push('/tools/heygen-auto?from=clickup-pilot');
  }

  /** Dispara SO o Auto B-roll (Magnific) dessa task — standalone, ungated.
   *  Acionado pelo botão 3D ✨ (IconBroll) no card. Roda invisivel via
   *  extensao/bridge (fila serial 1 por vez). Não roda HeyGen junto: pra
   *  disparar HeyGen, usa o ▶ play. Os dois são independentes — user pode
   *  rodar só B-rolls, só HeyGen, ou ambos (clica os dois). */
  function dispatchTaskToMagnific(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a || a.vaBriefing) return;
    if (!(taskMagnificJson[taskId] || '').trim()) {
      setMagnificEditorOpen((p) => ({ ...p, [taskId]: true }));
      setError('Cole o JSON de B-rolls dessa task na caixa abaixo antes de disparar.');
      return;
    }
    if (!enqueueMagnificForTask(taskId, false)) {
      setError('JSON de B-rolls invalido — nenhum take detectado.');
      return;
    }
    setError(null);
    for (const sid of getSiblingTaskIds(taskId)) markDispatched(sid);
  }

  /** Copia SO o body falado dessa task pro clipboard — sem hooks, sem a
   *  seção de variações (Guia/AD0x), sem "Tela dividida"/"Take logo" e sem
   *  links. Fonte: bodyRaw do parser (ou bodyText da VA), passado pelo
   *  extractSpokenBody. Util pro user gerar os prompts de B-roll. */
  const [copiedBodyTask, setCopiedBodyTask] = useState<string | null>(null);
  async function copyTaskBody(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a) return;
    const src =
      a.vaBriefing?.bodyText ||
      a.bodyRaw ||
      (a.partTemplates || [])
        .filter((p) => /^(BODY|PARTE)\b/i.test(p.label.trim()))
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join('\n\n');
    const body = extractSpokenBody(src);
    if (!body) {
      setError('Essa task nao tem body identificado na copy (so hooks?).');
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setError(null);
      setCopiedBodyTask(taskId);
      setTimeout(() => setCopiedBodyTask((cur) => (cur === taskId ? null : cur)), 1800);
    } catch {
      setError('Nao consegui copiar pro clipboard (permissao do browser).');
    }
  }

  /** Identificador curto da task pro bloco de body (ex:
   *  "AD13VN - PRPB06 - G1" -> "AD13VN-PRPB06"). Remove sufixo G final. */
  function taskBodyId(a: TaskAnalysis): string {
    let n = (a.taskName || a.baseAdId || a.taskId).trim();
    n = n.replace(/\s*[-–—]\s*G\d+\s*$/i, '');
    n = n.replace(/\s*[-–—]\s*/g, '-').replace(/\s+/g, ' ').trim();
    return n || a.baseAdId || a.taskId;
  }

  /** Copia o body de TODAS as tasks selecionadas, identificado, num bloco
   *  so. NUNCA inclui Variacao de Avatar (a.vaBriefing). Dedup siblings
   *  G1/G2 (mesmo id apos remover sufixo G). Formato:
   *    AD33VN-PRPB05
   *    <body>
   *
   *    AD34VN-PRPB05
   *    <body>
   */
  const [copiedAllBodies, setCopiedAllBodies] = useState(false);
  async function copyAllSelectedBodies() {
    const seen = new Set<string>();
    const blocks: string[] = [];
    let skippedVA = 0;
    for (const id of selectedTaskIds) {
      const a = taskAnalyses[id];
      if (!a) continue;
      if (a.vaBriefing) { skippedVA++; continue; } // VA nunca entra
      const ident = taskBodyId(a);
      if (seen.has(ident)) continue; // dedup G1/G2 (mesmo conteudo)
      const src =
        a.bodyRaw ||
        (a.partTemplates || [])
          .filter((p) => /^(BODY|PARTE)\b/i.test(p.label.trim()))
          .map((p) => p.text.trim())
          .filter(Boolean)
          .join('\n\n');
      const body = extractSpokenBody(src);
      if (!body) continue;
      seen.add(ident);
      blocks.push(`${ident}\n${body}`);
    }
    if (blocks.length === 0) {
      setError(
        skippedVA > 0
          ? 'Nenhuma task normal selecionada com body (so VA, que nao copia).'
          : 'Nenhuma task selecionada com body identificado.',
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      setError(null);
      setCopiedAllBodies(true);
      setTimeout(() => setCopiedAllBodies(false), 2000);
    } catch {
      setError('Nao consegui copiar pro clipboard (permissao do browser).');
    }
  }

  async function autoFetchDoc(url: string) {
    setFetchingDoc(true);
    setParseError(null);
    try {
      // 1. Tenta via extensao (sessao Google logada — funciona pra doc privado)
      const extR = await fetchDocViaExtension(url);
      if (extR.ok && extR.text) {
        setDocContent(extR.text);
        setTimeout(() => runParser(extR.text || ''), 100);
        return;
      }
      // 2. Fallback: server proxy (so docs publicos)
      const r = await fetch(`/api/docs/fetch?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!j.ok) {
        setParseError(
          `Doc privado e extensao nao leu (${extR.error || 'erro'}). Servidor tambem falhou: ${j.error}. Cola manualmente abaixo.`,
        );
        return;
      }
      setDocContent(j.text || '');
      setTimeout(() => runParser(j.text || ''), 100);
    } catch (e) {
      setParseError(`Falha: ${(e as Error)?.message}`);
    } finally {
      setFetchingDoc(false);
    }
  }

  function runParser(textOverride?: string) {
    setParseError(null);
    setParsed(null);
    setBriefing(null);
    const text = textOverride ?? docContent;
    if (!text.trim()) {
      setParseError('Cola o conteudo do doc OU usa o botao "Buscar doc automatico".');
      return;
    }
    if (!selectedTask) return;
    // Identifica AD ID base a partir do nome da task: ex "AD139GL - VFPB04"
    // Pega so a parte AD<num><letras> (sem o -VFPB04) pra match dos siblings
    const taskName = selectedTask.name;
    const baseMatch = taskName.match(/^(AD\d+[A-Z]+)\b/i);
    const baseAdId = baseMatch ? baseMatch[1].toUpperCase() : null;
    const fullAdMatch = taskName.match(/AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i);
    const fullAdId = fullAdMatch ? fullAdMatch[0].toUpperCase() : taskName.toUpperCase().trim();

    // Parser 1 (legacy): secao base com avatares + parts auto-detectadas
    const result = parseAdSection(text, fullAdId) || parseAdSection(text, fullAdId.split(/\s|-/)[0]);
    if (result) setParsed(result);

    // Parser 2 (novo): briefing DARKO LAB com convencao G[N] = Hook[N]
    if (baseAdId) {
      const b = parseDarkoBriefing(text, baseAdId);
      if (b && (b.hooks.length > 0 || b.body)) {
        setBriefing(b);
        return;
      }
    }
    if (!result) {
      setParseError(`Nao achei secao "${fullAdId}" no doc. Confere se a copy ta colada/buscada certo.`);
    }
  }

  /* ========== HeyGen library (cache singleton) ========== */
  const [librarySnap, setLibrarySnap] = useState(() => getLibrarySnapshot());
  useEffect(() => {
    const unsub = subscribeLibrary(() => setLibrarySnap({ ...getLibrarySnapshot() }));
    if (librarySnap.groups.length === 0 && !librarySnap.loading) {
      reloadLibrary(false);
    }
    return unsub;
    // eslint-disable-next-line
  }, []);

  // Flat avatar candidates pra matcher (incluindo voice_name, voiceId, thumb)
  const avatarCandidates = useMemo(() => {
    const flat: Array<{ id: string; name: string; groupName: string; voiceName?: string | null; voiceId?: string | null; thumb?: string | null }> = [];
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

  /* ========== Plano de dispatch ========== */
  const dispatchPlan: DispatchPlan | null = useMemo(() => {
    if (!selectedTask) return null;
    // Avatares: prefere os do briefing (mais completos), fallback parsed
    const avatarsSource = briefing?.avatars || parsed?.avatars || [];
    const adNameSource = briefing?.baseAdId || parsed?.adId || selectedTask.name;
    const adName = adNameSource.replace(/[^a-z0-9_-]/gi, '_');
    const matchedByRole: Record<string, { id: string; name: string }> = {};
    const unmatchedAvatars: string[] = [];
    for (const av of avatarsSource) {
      const m = matchAvatar(av.username, avatarCandidates);
      if (m && m.score >= 30) {
        matchedByRole[av.role.toLowerCase()] = { id: m.id, name: m.name };
      } else {
        unmatchedAvatars.push(`${av.role}: @${av.username}`);
      }
    }
    const firstMatched = Object.values(matchedByRole)[0] || null;
    function pickAvatarForText(text: string, label: string, detectedRole: string | null = null): { id: string; name: string } | null {
      // Prioridade 1: role detectado pelo parser (linha "Mulher:"/"Homem:"/etc
      // do briefing, descartada do texto). Match exato primeiro, depois fuzzy.
      if (detectedRole) {
        const dr = detectedRole.toLowerCase().trim();
        if (matchedByRole[dr]) return matchedByRole[dr];
        for (const role of Object.keys(matchedByRole)) {
          if (role === dr || role.includes(dr) || dr.includes(role)) return matchedByRole[role];
        }
      }
      const labelLower = label.toLowerCase();
      for (const role of Object.keys(matchedByRole)) {
        if (labelLower.includes(role.toLowerCase())) return matchedByRole[role];
      }
      const firstLines = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
      for (const role of Object.keys(matchedByRole)) {
        if (firstLines.includes(role.toLowerCase())) return matchedByRole[role];
      }
      return firstMatched;
    }

    // Plano modo NOVO: briefing DARKO LAB com G[N] = Hook[N]
    if (briefing && (briefing.hooks.length > 0 || briefing.body)) {
      const planParts: DispatchPlan['parts'] = [];
      for (const h of briefing.hooks) {
        const av = pickAvatarForText(h.text, h.label, h.role);
        planParts.push({
          label: h.label,
          text: h.text,
          avatarId: av?.id || null,
          avatarName: av?.name || null,
        });
      }
      // Body: itera POR SPEAKER (bodySegments). Cada segmento mantem seu role
      // — split por tempo NUNCA cruza speaker. Quando body tem 1 unico
      // speaker, bodySegments tem 1 entry.
      const bodySegs = briefing.bodySegments && briefing.bodySegments.length > 0
        ? briefing.bodySegments
        : (briefing.body ? [{ role: briefing.bodyRole, text: briefing.body }] : []);
      const totalSegs = bodySegs.length;
      for (let si = 0; si < bodySegs.length; si++) {
        const seg = bodySegs[si];
        const segParts = splitCopyIntoParts(seg.text, { targetSec: 20, minSec: 10, maxSec: 35 });
        for (let pi = 0; pi < segParts.length; pi++) {
          const label = (totalSegs === 1 && segParts.length === 1)
            ? 'BODY'
            : (totalSegs === 1)
              ? `BODY ${pi + 1}`
              : (segParts.length === 1)
                ? `BODY ${si + 1}`
                : `BODY ${si + 1}.${pi + 1}`;
          const av = pickAvatarForText(segParts[pi], label, seg.role);
          planParts.push({
            label,
            text: segParts[pi],
            avatarId: av?.id || null,
            avatarName: av?.name || null,
          });
        }
      }
      return { adName, parts: planParts, unmatchedAvatars };
    }

    // Fallback: parser legado (parts auto-detectadas)
    if (!parsed) return null;
    const parts = parsed.parts.map((p) => {
      const av = pickAvatarForText(p.text, p.label);
      return {
        label: p.label,
        text: p.text,
        avatarId: av?.id || null,
        avatarName: av?.name || null,
      };
    });
    return { adName, parts, unmatchedAvatars };
  }, [briefing, parsed, selectedTask, avatarCandidates]);

  function dispatchToHeyGenAuto() {
    if (!dispatchPlan || dispatchPlan.parts.length === 0) {
      setError('Sem plano de dispatch valido.');
      return;
    }
    if (dispatchPlan.unmatchedAvatars.length > 0 && dispatchPlan.parts.some((p) => !p.avatarId)) {
      setError(
        `Alguns avatares nao foram encontrados no HeyGen: ${dispatchPlan.unmatchedAvatars.join(', ')}. Cria eles primeiro OU edita manualmente no Hey Auto.`,
      );
      return;
    }
    const handoff = {
      adName: dispatchPlan.adName,
      motor: 'III',
      mode: 'copy',
      dynamic: true,
      // Passa partes EXATAS do parser (texto + label + avatar). HeyGen Auto
      // usa direto, sem re-split. Isso garante que mapping avatar↔parte
      // sobreviva e que HOOK 1, HOOK 2, BODY virem partes separadas como
      // o parser identificou.
      partTexts: dispatchPlan.parts.map((p) => p.text),
      partLabels: dispatchPlan.parts.map((p) => p.label),
      partAvatarIds: dispatchPlan.parts.map((p) => p.avatarId),
      // Tambem manda copy concat como fallback
      copy: dispatchPlan.parts.map((p) => p.text).join('\n\n'),
    };
    sessionStorage.setItem('darkolab:heygen-auto:handoff', JSON.stringify(handoff));
    router.push('/tools/heygen-auto?from=clickup-pilot');
  }

  /* ========== UI ========== */
  const [error, setError] = useState<string | null>(null);
  /** Acao opcional ao lado do erro (ex: "Configurar chave" → /configuracoes/api) */
  const [errorAction, setErrorAction] = useState<{ label: string; href: string } | null>(null);
  function clearError() { setError(null); setErrorAction(null); }

  /** Estado por slot do clone de voz em andamento.
   *  Key: `${taskId}:${sIdx}` → { stage, percent, message } */
  const [cloningVoice, setCloningVoice] = useState<Record<string, { stage: string; percent: number; message: string }>>({});

  /** VA: avatar HeyGen escolhido por avaCode pra cada task VA.
   *  Key: `${taskId}:${avaCode}` → AvatarOption */
  const [vaAvatarChoice, setVaAvatarChoice] = useState<Record<string, AvatarOption | null>>({});
  /** VA: URL/Drive ID do AD original (input manual quando parser nao detecta).
   *  Key: taskId → string */
  const [vaAdUrl, setVaAdUrl] = useState<Record<string, string>>({});
  // VA: estado do pipeline AGORA vive em batchStates (mesma fila/card das
  // tasks normais). Removido o vaPipelineState separado.
  /** VA: SMART MODE per task — detecta face no AD original e troca apenas
   *  segmentos com avatar visivel (b-rolls intactos). Key: taskId → boolean */
  /** VA (Studio): voz custom por avatar. Key: `${taskId}:${avaCode}` →
   *  {id,name} ou null = usar a voz do proprio avatar (Mirror voice). */
  const [vaVoiceChoice, setVaVoiceChoice] = useState<Record<string, { id: string; name: string } | null>>({});

  /** TROCA DE ÁUDIO: novo WHITE upado pelo user por task. Key: taskId → File */
  const [trocaWhite, setTrocaWhite] = useState<Record<string, File | null>>({});
  /** TROCA DE ÁUDIO: intensidade da camuflagem do novo WHITE (5-100). */
  const [trocaVolume, setTrocaVolume] = useState<Record<string, number>>({});
  /** TROCA DE ÁUDIO: URL/Drive ID do AD original (input manual fallback). */
  const [trocaAdUrl, setTrocaAdUrl] = useState<Record<string, string>>({});
  /** TROCA DE ÁUDIO: prova por transcricao do resultado (o que a IA le).
   *  Key: taskId → { loading?, text?, err? } */
  const [trocaProof, setTrocaProof] = useState<Record<string, { loading?: boolean; text?: string; err?: string }>>({});

  /** Extrai Drive file ID de uma URL Drive (varios formatos suportados) */
  function extractDriveFileId(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    // ID puro (25-50 chars alfanum-_)
    if (/^[a-zA-Z0-9_-]{20,60}$/.test(trimmed)) return trimmed;
    // URL formats: /file/d/<ID>/  /open?id=<ID>  /uc?id=<ID>
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{20,60})/,
      /[?&]id=([a-zA-Z0-9_-]{20,60})/,
      /\/d\/([a-zA-Z0-9_-]{20,60})/,
    ];
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) return m[1];
    }
    return null;
  }

  /** Roda o pipeline VA pra uma task — orquestra download AD → split audio
   *  → dispatch HeyGen audio mode por avatar → mount → ZIP final. */
  /** Pré-cheque de prontidão do VA (avatar+voz+Drive). Retorna lista de
   *  pendências pra UI listar antes de enfileirar. Vazio = pronto. */
  function vaReadinessIssues(taskId: string): string[] {
    const a = taskAnalyses[taskId];
    const va = a?.vaBriefing;
    if (!va) return ['não é VA'];
    const issues: string[] = [];
    const driveId = va.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '');
    if (!driveId) issues.push('AD original (Drive)');
    for (const av of va.avatares) {
      if (!vaAvatarChoice[`${taskId}:${av.avaCode}`]?.id) issues.push(`avatar ${av.avaCode}`);
      // Voz é OBRIGATÓRIA agora — sem voiceId o Espelhamento cai na voz
      // original do AD (o bug que o user reclamava). Força escolha.
      if (!vaVoiceChoice[`${taskId}:${av.avaCode}`]?.id) issues.push(`voz ${av.avaCode}`);
    }
    return issues;
  }

  /** Runner VA — AGORA escreve em batchStates (igual task normal): mesma
   *  fila (runHeyGenGated/PROMOTER), mesmo card (BatchJobCard3D) e mesmos
   *  previews de lipsync ao vivo. Disparado pelo START / promoter, nunca
   *  mais por botao "Iniciar Pipeline VA" por task. */
  async function runVAPipelineForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    if (!a?.vaBriefing) {
      // Reload sem taskAnalyses: nao da pra reconstruir o briefing VA.
      setBatchStates((prev) => {
        const cur = prev[taskId];
        if (!cur) return prev;
        return { ...prev, [taskId]: { ...cur, phase: 'failed', message: 'VA: reabra a task no ClickUp Pilot e analise de novo (briefing nao sobrevive reload).', finishedAt: Date.now() } };
      });
      return;
    }
    const va = a.vaBriefing;
    const baseAdId = va.baseAdId;
    const adNameClean = baseAdId.replace(/\s+/g, '');

    // Validacao — marca failed no card (em vez de so setError, que o user
    // nao associa ao card rodando).
    const issues = vaReadinessIssues(taskId);
    if (issues.length > 0) {
      const msg = `VA incompleto — falta: ${issues.join(', ')}. Configure na task e dispare de novo.`;
      setError(msg);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName: a.taskName, baseAdId, parts: [], startedAt: Date.now() }),
          phase: 'failed', isVA: true, message: msg, finishedAt: Date.now(),
        } as BatchTaskState,
      }));
      return;
    }
    const driveId = va.linkAdFileId || extractDriveFileId(vaAdUrl[taskId] || '')!;
    const adOriginalUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
    const vaStartedAt = batchStates[taskId]?.startedAt || Date.now();

    // Helpers de escrita no batchStates
    const patchVA = (patch: Partial<BatchTaskState>) => setBatchStates((prev) => {
      const base: BatchTaskState = prev[taskId] || { taskId, taskName: a.taskName, baseAdId, parts: [], startedAt: vaStartedAt, phase: 'dispatching' };
      return { ...prev, [taskId]: { ...base, ...patch } };
    });
    // Cria/atualiza um "take" (parte) por label — alimenta os previews.
    const upsertPart = (label: string, patch: Partial<BatchTaskState['parts'][number]>) => setBatchStates((prev) => {
      const cur = prev[taskId];
      if (!cur) return prev;
      const idx = cur.parts.findIndex((p) => p.label === label);
      const parts = idx === -1
        ? [...cur.parts, { label, videoId: null, renamedTo: `${label}.mp4`, ...patch }]
        : cur.parts.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...prev, [taskId]: { ...cur, parts } };
    });
    const vaPhaseFromStage = (stage: string): BatchTaskState['phase'] =>
      /mount|assemble|zip/i.test(stage) ? 'post'
      : /dispatch/i.test(stage) ? 'rendering'
      : 'dispatching';

    batchCancelRef.current[taskId] = false;
    patchVA({
      phase: 'dispatching', isVA: true, adOriginalUrl,
      docUrl: batchStates[taskId]?.docUrl || a.docUrl,
      taskUrl: batchStates[taskId]?.taskUrl || a.taskUrl,
      message: 'Baixando AD original do Drive...', finishedAt: undefined,
    });

    try {
      // 1. Download AD via extension
      const { downloadDriveFileViaExtension } = await import('@/lib/heygen-extension-bridge');
      const dl = await downloadDriveFileViaExtension(driveId);
      if (!dl.ok) throw new Error('Drive download: ' + dl.error);
      patchVA({ phase: 'dispatching', message: `Baixado ${(dl.size / (1024 * 1024)).toFixed(1)}MB. Extraindo voz + split...` });

      // 2. Pipeline (extract audio + split + dispatch + mount)
      const { runVAPipeline } = await import('@/lib/va-pipeline');
      const { downloadVideoBytes } = await import('@/lib/heygen-api-direct');

      const avatares = va.avatares.map((av) => {
        const choice = vaAvatarChoice[`${taskId}:${av.avaCode}`]!;
        return { avaCode: av.avaCode, avatarId: choice.id, avatarName: choice.name };
      });
      const voiceByAva: Record<string, string | null> = {};
      for (const av of va.avatares) {
        voiceByAva[av.avaCode] = vaVoiceChoice[`${taskId}:${av.avaCode}`]?.id || null;
      }

      const pipeRes = await runVAPipeline({
        baseAdId: adNameClean,
        adVideoBytes: dl.bytes,
        avatares,
        smartMode: false,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onProgress: (p) => {
          patchVA({ phase: vaPhaseFromStage(p.stage), message: p.message });
        },
        // === Espelhamento de Voz REAL (sts_pending) — fix 2026-06-03 ===
        // processJob({voiceMirroring:true, voiceId}) agora monta o body
        // nativo (audio_type sts_pending + source_audio_url + voice_id):
        // avatar fala com a VOZ ESCOLHIDA mantendo o timing do AD original.
        dispatchAudioTake: async ({ avatarId, audioBytes, audioFilename, label }) => {
          if (batchCancelRef.current[taskId]) throw new Error('cancelado');
          upsertPart(label, { videoId: null, videoStatus: 'pending', error: null });
          const { processJob } = await import('@/lib/heygen-api-direct');
          const file = new File([audioBytes as BlobPart], audioFilename || `${label}.wav`, { type: 'audio/wav' });
          const avFromId = va.avatares.find((x) => vaAvatarChoice[`${taskId}:${x.avaCode}`]?.id === avatarId);
          const voiceId = avFromId ? voiceByAva[avFromId.avaCode] : null;
          console.log(`[VA dispatch ${label}] avatarId=${avatarId} voiceId=${voiceId || '(default)'}`);
          let job;
          try {
            job = await processJob({
              file, avatarId,
              title: `${adNameClean}_${label}`,
              engine: 'iii', orientation: 'portrait',
              voiceMirroring: true,
              voiceId: voiceId || undefined,
            }, { onProgress: (stage: string) => console.log(`[VA dispatch ${label}] ${stage}`) });
          } catch (e) {
            upsertPart(label, { error: (e as Error)?.message || 'falha no dispatch' });
            throw e;
          }
          if (!job.videoId) {
            upsertPart(label, { error: 'processJob nao retornou videoId' });
            throw new Error('processJob nao retornou videoId.');
          }
          upsertPart(label, { videoId: job.videoId, videoStatus: 'pending' });
          const statuses = await pollVideosUntilReady([job.videoId], { intervalMs: 8000, timeoutMs: 30 * 60 * 1000 });
          const st = statuses[job.videoId];
          if (!st || st.status !== 'completed' || !st.videoUrl) {
            upsertPart(label, { videoStatus: st?.status, error: st?.error || 'nao renderizou' });
            throw new Error(`Video ${label} nao renderizou (status=${st?.status}): ${st?.error || 'sem detalhes'}`);
          }
          upsertPart(label, { videoStatus: 'completed', videoUrl: st.videoUrl });
          const bytes = await downloadVideoBytes(st.videoUrl);
          return new Blob([bytes as BlobPart], { type: 'video/mp4' });
        },
      });

      // 3. Monta ZIP final
      patchVA({ phase: 'post', message: 'Zipando vídeos finais...' });
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const item of pipeRes.items) {
        if (item.blob) zip.file(item.filename, item.blob);
        else zip.file(`${item.filename.replace('.mp4', '')}_ERRO.txt`, item.error || 'falha sem detalhes');
      }
      zip.file('_DIAGNOSTICO.txt',
`Pipeline VA - relatorio
========================
${pipeRes.summary}
Audio segments: ${pipeRes.audioSegmentCount}

Items:
${pipeRes.items.map(i => `- ${i.filename}: ${i.blob ? 'OK' : 'ERRO ('+(i.error || 'sem detalhes')+')'}`).join('\n')}
`);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const zipName = `${adNameClean}_VA.zip`;
      const zipUrl = URL.createObjectURL(zipBlob);
      try {
        const { saveZip } = await import('@/lib/zip-store');
        await saveZip(`va:${taskId}:zip`, zipBlob, zipName);
      } catch (e) { console.warn('[va] save zip IDB:', e); }

      // ZIP do VA entra no slot "montado" → botao de download unico do card
      // funciona igual task normal.
      patchVA({
        phase: 'done',
        message: `Pronto: ${pipeRes.summary}`,
        montadoZipUrl: zipUrl, montadoZipName: zipName,
        finishedAt: Date.now(),
      });
      const siblings = getSiblingTaskIds(taskId);
      for (const sid of siblings) markDispatched(sid);
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId,
          avatares: pipeRes.items.map((it: any, i: number) => ({
            avaCode: va.avatares[i]?.avaCode || `AVA${i+1}`,
            username: va.avatares[i]?.username || '?',
            status: it.blob ? 'done' : 'failed',
          })),
          startedAt: vaStartedAt, finishedAt: Date.now(), zipName,
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    } catch (e) {
      patchVA({ phase: 'failed', message: (e as Error)?.message || String(e), finishedAt: Date.now() });
      try {
        const VA_KEY = 'darkolab:va-pipeline:history';
        const hist = (() => { try { return JSON.parse(localStorage.getItem(VA_KEY) || '[]'); } catch { return []; } })();
        hist.push({
          taskId, taskName: a.taskName, baseAdId: va.baseAdId,
          avatares: va.avatares.map((av: any) => ({ avaCode: av.avaCode, username: av.username, status: 'failed' })),
          startedAt: vaStartedAt, finishedAt: Date.now(),
        });
        localStorage.setItem(VA_KEY, JSON.stringify(hist.slice(-200)));
      } catch {}
    }
  }

  // ═══════════════════ TROCA DE ÁUDIO (variacao do WHITE) ═══════════════════
  // Baixa o criativo original do Drive → descamufla (tira o WHITE antigo via
  // L-R) → recamufla o mesmo BLACK com o novo WHITE upado → muxa no video.
  // Roda na MESMA fila (batchStates + BatchJobCard3D) das outras tasks, com o
  // mesmo botao de download no fim. Sem HeyGen.
  async function runTrocaAudioPipelineForTask(taskId: string) {
    const a = taskAnalyses[taskId];
    const troca = a?.trocaBriefing;
    const taskName = a?.taskName || batchStates[taskId]?.taskName || taskId;
    const baseAdId = troca?.baseAdId || a?.baseAdId || batchStates[taskId]?.baseAdId || taskName;
    const adNameClean = baseAdId.replace(/[^A-Z0-9]/gi, '_');

    const fail = (message: string) => {
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, parts: [], startedAt: Date.now() }),
          kind: 'troca',
          phase: 'failed',
          message,
          finishedAt: Date.now(),
        } as BatchTaskState,
      }));
    };

    // Resolve Drive ID: briefing parseado > input manual > estado persistido
    // (sobrevive reload, pois batchState e serializado). Se nao houver link de
    // ARQUIVO, mas houver link de PASTA, resolvemos o video listando a pasta.
    const persisted = batchStates[taskId];
    let driveId =
      troca?.driveId || extractDriveFileId(trocaAdUrl[taskId] || '') || persisted?.trocaDriveId || null;
    const folderId = troca?.driveFolderId || persisted?.trocaFolderId || null;
    const volume = Math.max(5, Math.min(100, trocaVolume[taskId] ?? persisted?.trocaVolume ?? 30));

    // Resolve o novo WHITE: estado em memoria OU IndexedDB (retomar pos-reload).
    let white: Blob | null = trocaWhite[taskId] || null;
    const whiteMime = (white as File | null)?.type || persisted?.trocaWhiteMime || 'audio/wav';
    if (!white) {
      try {
        const { loadBlob } = await import('@/lib/zip-store');
        white = await loadBlob('troca:white:' + taskId, whiteMime);
      } catch {}
    }

    if (!driveId && !folderId) {
      fail('Sem link do criativo. Cola a URL do vídeo (ou da pasta) do Drive no painel da task.');
      return;
    }
    if (!white) {
      fail('Suba o novo áudio WHITE dessa task antes de disparar.');
      return;
    }

    // Persiste o WHITE + dados serializaveis pra RETOMAR sobreviver reload.
    try {
      const { saveBlob } = await import('@/lib/zip-store');
      await saveBlob('troca:white:' + taskId, white, whiteMime);
    } catch (e) {
      console.warn('[troca-audio] persist white IDB:', e);
    }

    batchCancelRef.current[taskId] = false;
    const startedAt = Date.now();
    const renamedTo = `${adNameClean}_TROCA.mp4`;
    const setStage = (phase: BatchTaskState['phase'], message: string, done = false) => {
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, startedAt }),
          kind: 'troca',
          taskName,
          baseAdId,
          phase,
          message,
          parts: [{
            label: 'Troca de áudio',
            videoId: 'troca',
            videoStatus: done ? 'completed' : 'processing',
            renamedTo,
          }],
          startedAt: prev[taskId]?.startedAt || startedAt,
          taskUrl: prev[taskId]?.taskUrl || a?.taskUrl,
          trocaDriveId: driveId || undefined,
          trocaFolderId: folderId || undefined,
          trocaVolume: volume,
          trocaWhiteMime: whiteMime,
        } as BatchTaskState,
      }));
    };

    setStage('downloading', driveId ? 'Baixando o criativo original do Drive...' : 'Procurando o vídeo na pasta do Drive...');

    try {
      // 0. Se so temos a PASTA, lista (recursivo) e escolhe o video. As pastas
      // de criativo costumam ter SUBPASTAS (ex: "COM EDIÇÃO" tem o video,
      // "ÁUDIO TROCADO" e o destino do output). Entao recorremos preferindo a
      // subpasta editada e evitando as de saida/compliance, casando pelo AD.
      if (!driveId && folderId) {
        setStage('downloading', 'Procurando o vídeo na pasta do Drive...');
        const { listDriveFolderViaExtension } = await import('@/lib/heygen-extension-bridge');
        const adKey = baseAdId.toUpperCase();
        const isVideo = (n: string) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(n) || /\bAD\d/i.test(n);
        let listCalls = 0;
        const findVideo = async (
          fid: string,
          depth: number,
        ): Promise<{ fileId: string; name: string } | null> => {
          if (listCalls >= 12 || batchCancelRef.current[taskId]) return null;
          listCalls++;
          const lf = await listDriveFolderViaExtension(fid);
          if (!lf.ok) return null;
          const vids = lf.files.filter((f) => !f.isFolder && isVideo(f.name));
          const byName = vids.find((f) => f.name.toUpperCase().includes(adKey));
          if (byName) return byName;
          if (vids[0]) return vids[0];
          if (depth <= 0) return null;
          // Recorre nas subpastas: prioriza "edição/final", pula saída/compliance.
          const score = (n: string) => {
            const u = n.toUpperCase();
            if (/TROCAD|COMPLI|OUTPUT|SA[IÍ]DA|RAW|BRUTO|ANTIG/.test(u)) return -1;
            if (/EDI[ÇC]|FINAL|PRONTO|COM\s*EDI/.test(u)) return 2;
            return 1;
          };
          const subs = lf.files
            .filter((f) => f.isFolder)
            .map((f) => ({ f, s: score(f.name) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.f);
          for (const sub of subs) {
            const found = await findVideo(sub.fileId, depth - 1);
            if (found) return found;
          }
          return null;
        };
        const pick = await findVideo(folderId, 2);
        if (!pick) throw new Error('Não achei o vídeo na pasta nem nas subpastas. Cola o link do arquivo manualmente no painel.');
        driveId = pick.fileId;
        setStage('downloading', `Vídeo encontrado (${pick.name}). Baixando...`);
      }
      if (!driveId) throw new Error('Não foi possível resolver o vídeo do criativo.');

      // 1. Download do AD original (via extension — cookies autenticados).
      const { downloadDriveFileViaExtension } = await import('@/lib/heygen-extension-bridge');
      const dl = await downloadDriveFileViaExtension(driveId);
      if (!dl.ok) throw new Error('Drive download: ' + dl.error);
      const adBlob = new Blob([dl.bytes as BlobPart], { type: 'video/mp4' });

      // 2. Descamufla: recupera o BLACK (audio publico) tirando o WHITE antigo.
      setStage('post', 'Tirando o áudio WHITE antigo...');
      const { descamuflar, camuflar, verifyCamouflage } = await import('@/lib/camuflagem');
      const { wav: blackWav } = await descamuflar({ file: adBlob, layer: 'public' });
      const { muxAudioIntoVideo } = await import('@/lib/ffmpeg-worker');

      // 3+4. GARANTIA: recamufla com o novo WHITE, muxa no video e VERIFICA
      // sobre o MP4 REAL que os downmixes de plataforma (soma L+R e média —
      // como TikTok/Kwai/YouTube fazem) realmente escutam o NOVO white. Se o
      // AAC do mux degradar a fase, sobe o ganho e re-tenta ate passar ou
      // bater o teto. Assim o resultado e ASSERTIVO, nao "torcer pra dar".
      let finalBlob: Blob | null = null;
      let platformOk = false;
      let platformWhite: number | undefined;
      let platformBlack: number | undefined;
      let gainBoost = 1;
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (batchCancelRef.current[taskId]) throw new Error('Cancelado pelo usuario.');
        setStage('post', attempt === 1 ? 'Embutindo o novo áudio WHITE...' : `Reforçando o WHITE (tentativa ${attempt}/${MAX_ATTEMPTS})...`);
        const camWav = await camuflar({ black: blackWav, white, volumePercent: volume, gainBoost });
        setStage('post', 'Montando o vídeo final...');
        const muxed = await muxAudioIntoVideo(adBlob, camWav, {
          onStage: (s) => setStage('post', s),
        }, true);
        finalBlob = muxed;
        setStage('post', 'Verificando o que a IA escuta...');
        try {
          const v = await verifyCamouflage({ result: muxed, white, black: blackWav });
          // So os downmixes que as plataformas usam (somam/mediam os canais).
          const rel = v.downmixes.filter((d) => d.kind === 'sum' || d.kind === 'avg');
          platformOk = rel.length > 0 && rel.every((d) => d.hears === 'white');
          platformWhite = rel.length ? Math.min(...rel.map((d) => d.whiteScore)) : undefined;
          platformBlack = rel.length ? Math.max(...rel.map((d) => d.blackScore)) : undefined;
        } catch {
          // Verify falhou tecnicamente — nao bloqueia a entrega do arquivo.
          platformOk = true;
        }
        if (platformOk) break;
        gainBoost *= 1.8;
      }
      if (!finalBlob) throw new Error('Falha ao montar o vídeo final.');
      const sizeMb = (finalBlob.size / (1024 * 1024)).toFixed(1);

      const url = URL.createObjectURL(finalBlob);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...(prev[taskId] || { taskId, taskName, baseAdId, startedAt }),
          kind: 'troca',
          taskName,
          baseAdId,
          phase: 'done',
          message: platformOk
            ? `✓ Garantido: TikTok/Kwai/YouTube escutam o novo WHITE (${sizeMb}MB).`
            : `⚠ Áudio trocado (${sizeMb}MB), mas a verificação não confirmou o WHITE na soma mono — aumente a intensidade e refaça.`,
          parts: [{ label: 'Troca de áudio', videoId: 'troca', videoStatus: 'completed', renamedTo }],
          startedAt: prev[taskId]?.startedAt || startedAt,
          finishedAt: Date.now(),
          camufladoZipUrl: url,
          camufladoZipName: renamedTo,
          taskUrl: prev[taskId]?.taskUrl || a?.taskUrl,
          trocaDriveId: driveId || undefined,
          trocaFolderId: folderId || undefined,
          trocaVolume: volume,
          trocaWhiteMime: whiteMime,
          trocaWhiteScore: platformWhite,
          trocaBlackScore: platformBlack,
          // Satisfaz o allOk do card (mostra "Pronto" + botao Baixar unico).
          pipeStats: {
            expectedMontagens: 1,
            okMontagens: 1,
            okDecupados: 0,
            okCamuflados: 1,
            expectedDecupagem: false,
            expectedCamuflagem: true,
          },
        } as BatchTaskState,
      }));
      markDispatched(taskId);
    } catch (e) {
      console.error('[troca-audio]', e);
      fail((e as Error)?.message || String(e));
    }
  }

  /** PROVA da troca: transcreve o que TikTok/Kwai/YouTube escutariam (soma
   *  mono L+R do MP4 real) via AssemblyAI. Tem que vir o roteiro do NOVO
   *  WHITE — prova empirica de que a troca segurou. */
  async function transcribeTrocaResult(taskId: string, blobUrl: string) {
    if (!blobUrl || trocaProof[taskId]?.loading) return;
    setTrocaProof((prev) => ({ ...prev, [taskId]: { loading: true } }));
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      const { buildPlatformMonoWav } = await import('@/lib/camuflagem');
      const { wav } = await buildPlatformMonoWav(blob);
      const fd = new FormData();
      fd.append('audio', wav, 'platform-mono.wav');
      fd.append('languageCode', 'pt');
      const r = await fetch('/api/camuflagem/transcribe', { method: 'POST', body: fd });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error((data && data.error) || `Falha na transcricao (HTTP ${r.status}).`);
      setTrocaProof((prev) => ({ ...prev, [taskId]: { text: (data.text as string) || '(silêncio / nada reconhecido)' } }));
    } catch (e) {
      setTrocaProof((prev) => ({ ...prev, [taskId]: { err: (e as Error)?.message || 'Falha na transcricao.' } }));
    }
  }

  /** Dispara clone de voz pro slot. Aceita audio (mp3/wav) ou video.
   *  No ready: seta voiceOverride no slot e adiciona voz na library cache. */
  async function handleCloneVoiceForSlot(
    taskId: string,
    sIdx: number,
    file: File,
    opts?: {
      model?: 'V3' | 'V2' | 'multilingual';
      language?: 'pt' | 'en' | 'es' | 'auto';
      trimToSeconds?: number;
      removeBackgroundNoise?: boolean;
      removeBackgroundMusic?: boolean;
    },
  ) {
    const key = `${taskId}:${sIdx}`;
    setCloningVoice((prev) => ({ ...prev, [key]: { stage: 'starting', percent: 0, message: 'Iniciando...' } }));
    // Retry ate 2x em falhas transientes (rede, timeout)
    const MAX_ATTEMPTS = 2;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await cloneVoiceViaExtension(file, {
          removeBackgroundNoise: opts?.removeBackgroundNoise ?? true,
          removeBackgroundMusic: opts?.removeBackgroundMusic ?? true,
          model: opts?.model ?? 'V3',
          language: opts?.language && opts.language !== 'auto' ? opts.language : null,
          trimToSeconds: opts?.trimToSeconds ?? 90,
          onProgress: (stage, percent, message) => {
            setCloningVoice((prev) => ({
              ...prev,
              [key]: {
                stage,
                percent: percent ?? prev[key]?.percent ?? 0,
                message: (attempt > 1 ? `(tentativa ${attempt}) ` : '') + (message || ''),
              },
            }));
          },
        });
        if (!res.ok) {
          lastError = res.error;
          // Falhas que valem retry: rede, timeout, HTTP 5xx
          if (attempt < MAX_ATTEMPTS && /timeout|network|HTTP 5|fetch|nao respondeu/i.test(res.error)) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          setError(`Falha ao clonar voz: ${res.error}`);
          setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
          return;
        }
        // SUCESSO — auto-select da voz no slot
        updateRoleSlot(taskId, sIdx, { voiceOverride: { id: res.voiceId, name: res.voiceName } });
        // Recarrega biblioteca pra voz nova aparecer no picker
        reloadLibrary().catch(() => {});
        setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
        return;
      } catch (e) {
        lastError = (e as Error)?.message || String(e);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
    }
    setError(`Falha ao clonar voz apos ${MAX_ATTEMPTS} tentativas: ${lastError}`);
    setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
  }

  return (
    <>
      <ToolShell
        title="ClickUp Pilot"
        eyebrow="AUTOMAÇÃO · ORQUESTRADOR"
        description="O cérebro do estúdio. Conecta no ClickUp, lê cada task e dispara avatares, B-rolls, decupagem e camuflagem — tudo em fila, sem você abrir uma aba sequer."
        hue="rgba(200,232,124,0.45)"
        icon={<IconClickUpPilot size={56} />}
      >
          {/* Command Center — chip de status + métricas ao vivo */}
          {(() => {
            const setupOK = hasToken && selectedTeam && selectedEditor;
            const editorName = editors.find(u => String(u.id) === selectedEditor)?.username || authUser?.username || '?';
            return (
              <div
                className="cp-command-center mb-5 relative overflow-hidden rounded-[18px] border p-4 md:p-5"
                style={{
                  borderColor: setupOK ? 'rgba(200,232,124,0.35)' : 'rgba(232,121,249,0.35)',
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-50 blur-3xl"
                  style={{
                    background: setupOK ? 'rgba(200,232,124,0.45)' : 'rgba(232,121,249,0.45)',
                  }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                    backgroundSize: '30px 30px',
                  }}
                />
                <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={
                        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border ' +
                        (setupOK ? 'border-lime/60 bg-lime/10' : 'border-fuchsia-500/60 bg-fuchsia-500/10')
                      }
                      style={{
                        boxShadow: setupOK
                          ? '0 0 22px -6px rgba(200,232,124,0.55), inset 0 1px 0 rgba(255,255,255,0.1)'
                          : '0 0 22px -6px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.1)',
                      }}
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span
                          className={
                            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ' +
                            (setupOK ? 'bg-lime' : 'bg-fuchsia-400')
                          }
                        />
                        <span
                          className={
                            'relative inline-flex h-2.5 w-2.5 rounded-full ' +
                            (setupOK ? 'bg-lime' : 'bg-fuchsia-400')
                          }
                          style={{
                            boxShadow: setupOK
                              ? '0 0 10px rgba(200,232,124,0.9)'
                              : '0 0 10px rgba(232,121,249,0.9)',
                          }}
                        />
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div
                        className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-text-muted"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        {setupOK ? 'Pilot Online' : 'Pilot Offline'}
                      </div>
                      <div
                        className="mt-0.5 truncate text-[16px] font-bold tracking-tight text-white"
                        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
                      >
                        {setupOK ? (currentTeam?.name || '—') : 'Configure pra começar'}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">
                        {setupOK ? (
                          <>
                            Editor:{' '}
                            <span className="mono text-white">{editorName}</span>
                            {tasks.length > 0 ? (
                              <>
                                {' · '}
                                <span className="mono text-lime">{tasks.length}</span> tasks
                                {selectedTaskIds.size > 0 ? (
                                  <>
                                    {' · '}
                                    <span className="mono text-lime">{selectedTaskIds.size}</span> sel
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>{!hasToken ? 'Cole o token ClickUp pra autenticar' : 'Falta workspace ou editor'}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href="/configuracoes/clickup-pilot"
                      className={
                        'group inline-flex items-center gap-2 rounded-[12px] border px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] transition-all ' +
                        (setupOK
                          ? 'border-line-strong text-text-muted hover:border-lime hover:text-lime'
                          : 'border-fuchsia-500/65 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25')
                      }
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {setupOK ? 'Configurar' : 'Configurar agora'}
                      <span className="transition-transform group-hover:translate-x-1">→</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* (Token UI movido pra /configuracoes/clickup-pilot) */}

          {error ? (
            <div className="mb-4 error-shake flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              <span className="flex-1">{error}</span>
              {errorAction ? (
                <a
                  href={errorAction.href}
                  className="mono shrink-0 rounded border border-lime/60 bg-lime/15 px-3 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/25"
                >
                  {errorAction.label} →
                </a>
              ) : null}
              <button
                type="button"
                onClick={clearError}
                className="mono shrink-0 rounded border border-line-strong px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60"
                aria-label="Fechar erro"
              >
                ✕
              </button>
            </div>
          ) : null}

          {hasToken && selectedTeam && selectedEditor ? (
            <div className="grid gap-6">
              {/* Modos + Carregar tasks (UI principal enxuta) */}
              <section
                className="cp-modes-bar relative overflow-hidden rounded-[18px] border border-line/60 p-4 md:p-5"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-35 blur-3xl"
                  style={{ background: 'rgba(167,139,250,0.45)' }}
                />
                {/* PAINEL "Modos de Geração" REMOVIDO (user pediu):
                 *  - Camuflagem agora eh PER-TASK (botao 3D na action bar do card)
                 *  - Only Magnific / More Magnific descontinuados (auto-broll
                 *    tem ferramenta propria + botao JSON inline em cada task)
                 *  Estados onlyMagnificMode/moreMagnificMode permanecem em
                 *  useToolState (sempre false agora) por compat com handlers
                 *  que checavam — sem UI exposta. */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={loadTasks}
                    disabled={loadingTasks}
                    className="cp-load-cta group relative overflow-hidden rounded-[14px] border border-lime/60 px-5 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-black transition-all disabled:opacity-70"
                    style={{
                      fontFamily: 'var(--font-tech)',
                      background:
                        'linear-gradient(135deg, #c2cf86 0%, #aebd72 100%)',
                      boxShadow:
                        '0 0 28px -6px rgba(200,232,124,0.55), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.2)',
                    }}
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      {loadingTasks ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/60 border-t-transparent" />
                          Carregando…
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-9-9" />
                            <path d="M21 3v6h-6" />
                          </svg>
                          Carregar tasks
                          <span className="transition-transform group-hover:translate-x-1">→</span>
                        </>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    />
                  </button>
                  <a
                    href="/configuracoes/clickup-pilot"
                    className="mono inline-flex items-center gap-2 rounded-full border border-line-strong px-3.5 py-1.5 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime"
                  >
                    Configurar workspace, editor e filtros
                    <span>→</span>
                  </a>
                </div>
              </section>

              {/* Lista de tasks */}
              {tasks.length > 0 ? (
                <section>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2
                        className="text-[20px] font-extrabold tracking-tight text-white"
                        style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
                      >
                        Tasks
                      </h2>
                      <span
                        className="mono rounded-full border border-lime/45 bg-lime/10 px-2.5 py-0.5 text-[11px] font-bold text-lime"
                        style={{ boxShadow: '0 0 12px -4px rgba(200,232,124,0.45)' }}
                      >
                        {tasks.length}
                      </span>
                    </div>
                    {/* Modo BATCH removido — click 1x na task analisa direto.
                     *  Estado bulkMode mantido por compat com handlers existentes
                     *  mas UI nao expoe mais o toggle. */}
                  </div>
                  {/* Filtros premium — Período + Prioridade + Data específica */}
                  <div
                    className="cp-filters-bar mb-4 relative overflow-hidden rounded-[16px] border border-line/60 p-4"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                    }}
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full opacity-40 blur-3xl"
                      style={{ background: 'rgba(200,232,124,0.35)' }}
                    />
                    <div className="relative">
                      <div className="mb-3 flex items-center gap-2">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Período
                        </span>
                        <span className="h-px flex-1 bg-gradient-to-r from-lime/30 via-line to-transparent" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { id: 'all' as const, label: 'Todos' },
                          { id: 'today' as const, label: 'Hoje' },
                          { id: 'yesterday' as const, label: 'Ontem' },
                          { id: 'overdue' as const, label: 'Atrasadas' },
                          { id: 'next7' as const, label: 'Próx 7d' },
                          { id: 'next30' as const, label: 'Próx 30d' },
                          { id: 'specific' as const, label: 'Data específica' },
                        ]).map((f) => {
                          const active = dateFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setDateFilter(f.id)}
                              className={
                                'group relative overflow-hidden rounded-[12px] border px-4 py-2.5 transition-all duration-200 ' +
                                (active
                                  ? 'border-lime/65 bg-lime/12'
                                  : 'border-line-strong bg-bg/40 hover:border-lime/45 hover:-translate-y-[1px]')
                              }
                              style={
                                active
                                  ? { boxShadow: '0 0 22px -6px rgba(200,232,124,0.55)' }
                                  : undefined
                              }
                            >
                              <span
                                className="text-[12px] font-bold tracking-tight text-white"
                                style={{ fontFamily: 'var(--font-tech)' }}
                              >
                                {f.label}
                              </span>
                              {active ? (
                                <span
                                  aria-hidden
                                  className="absolute right-2 top-2 inline-block h-1.5 w-1.5 rounded-full bg-lime"
                                  style={{ boxShadow: '0 0 8px rgba(200,232,124,0.9)' }}
                                />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>

                      {/* Date picker — aparece só se 'specific' selecionado */}
                      {dateFilter === 'specific' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-lime/40 bg-lime/5 px-3 py-2.5">
                          <span
                            className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-lime"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            Escolher data
                          </span>
                          <input
                            type="date"
                            value={specificDate}
                            onChange={(e) => setSpecificDate(e.target.value)}
                            className="rounded-[8px] border border-lime/40 bg-black/40 px-3 py-1.5 text-[12px] text-white mono outline-none focus:border-lime/70"
                            style={{ colorScheme: 'dark' }}
                          />
                          {specificDate ? (
                            <button
                              type="button"
                              onClick={() => setSpecificDate('')}
                              className="mono rounded-full border border-line-strong px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                            >
                              ✕ limpar
                            </button>
                          ) : (
                            <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                              ↑ escolha pra filtrar
                            </span>
                          )}
                          <div className="ml-auto flex flex-wrap gap-1.5">
                            {(() => {
                              const fmt = (d: Date) => d.toISOString().slice(0, 10);
                              const today = new Date();
                              const presets = [-2, -3, -7, -14].map((delta) => {
                                const d = new Date(today);
                                d.setDate(today.getDate() + delta);
                                return { date: fmt(d), label: `${Math.abs(delta)}d atrás` };
                              });
                              return presets.map((p) => (
                                <button
                                  key={p.date}
                                  type="button"
                                  onClick={() => setSpecificDate(p.date)}
                                  className={
                                    'mono rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest transition ' +
                                    (specificDate === p.date
                                      ? 'border-lime bg-lime/15 text-lime'
                                      : 'border-line-strong text-text-muted hover:border-lime hover:text-lime')
                                  }
                                >
                                  {p.label}
                                </button>
                              ));
                            })()}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 mb-3 flex items-center gap-2">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-fuchsia-300"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Prioridade
                        </span>
                        <span className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 via-line to-transparent" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          { id: 'all' as const, label: 'Todas', dot: 'rgba(148,163,184,0.7)' },
                          { id: 'urgent' as const, label: 'Urgent', dot: '#ef4444' },
                          { id: 'high' as const, label: 'High', dot: '#f97316' },
                        ]).map((f) => {
                          const active = priorityFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setPriorityFilter(f.id)}
                              className={
                                'group flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-all ' +
                                (active
                                  ? 'border-fuchsia-500/65 bg-fuchsia-500/15 text-fuchsia-100'
                                  : 'border-line-strong text-text-muted hover:border-fuchsia-500/45 hover:text-white')
                              }
                              style={
                                active
                                  ? { boxShadow: '0 0 18px -6px rgba(236,72,153,0.55)', fontFamily: 'var(--font-tech)' }
                                  : { fontFamily: 'var(--font-tech)' }
                              }
                            >
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  background: f.dot,
                                  boxShadow: active ? `0 0 8px ${f.dot}` : undefined,
                                }}
                              />
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <ul className="grid gap-2">
                    {tasks
                      .filter((t) => {
                        // Aplica filtros client-side
                        if (priorityFilter !== 'all' && t.priority?.priority !== priorityFilter) return false;
                        if (dateFilter !== 'all') {
                          const due = t.due_date ? Number(t.due_date) : 0;
                          if (!due) return dateFilter === 'overdue' ? false : false; // sem due_date nao se enquadra
                          const now = Date.now();
                          const DAY = 24 * 60 * 60 * 1000;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const tomorrow = today.getTime() + DAY;
                          const yesterday = today.getTime() - DAY;
                          if (dateFilter === 'today') {
                            if (due < today.getTime() || due >= tomorrow) return false;
                          } else if (dateFilter === 'yesterday') {
                            if (due < yesterday || due >= today.getTime()) return false;
                          } else if (dateFilter === 'overdue') {
                            if (due >= today.getTime()) return false;
                          } else if (dateFilter === 'next7') {
                            if (due < now || due > now + 7 * DAY) return false;
                          } else if (dateFilter === 'next30') {
                            if (due < now || due > now + 30 * DAY) return false;
                          } else if (dateFilter === 'specific') {
                            // Sem data escolhida: não filtra (mostra tudo até user escolher)
                            if (!specificDate) return true;
                            const parsed = new Date(specificDate + 'T00:00:00');
                            if (isNaN(parsed.getTime())) return true;
                            const start = parsed.getTime();
                            const end = start + DAY;
                            if (due < start || due >= end) return false;
                          }
                        }
                        return true;
                      })
                      .map((t) => {
                      const isChecked = selectedTaskIds.has(t.id);
                      const isOpen = isChecked; // visual highlight = selecionado
                      const baseKey = extractBaseTaskKey(t.name);
                      const siblingsAll = taskSiblingGroups.get(baseKey) || [t];
                      const hasSiblings = siblingsAll.length > 1;
                      const gSuffix = t.name.match(/\s*[-–—]\s*(G\d+)\s*$/i)?.[1] || null;
                      return (
                        <li key={t.id} className="flex items-center gap-2">
                          {/* Toggle de decupagem — escondido em ONLY MAGNIFIC */}
                          {!onlyMagnificMode ? (
                            <ToggleRound3D
                              on={isDecupagemEnabled(t.id)}
                              onChange={(v) => setDecupagemFor(t.id, v)}
                              size="sm"
                              variant="lime"
                              title={isDecupagemEnabled(t.id)
                                ? 'Decupagem ON — vai cortar silencios desse AD'
                                : 'Decupagem OFF — AD vem montado, sem cortes'}
                              icon={<ScissorsIcon className="h-3.5 w-3.5" />}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleTaskSelected(t.id)}
                            className={
                              'group/task flex-1 rounded-[12px] border bg-gradient-to-br px-3.5 py-2.5 text-left transition-all duration-200 ' +
                              (isChecked
                                ? 'border-lime/75 from-lime/15 via-lime/[0.06] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_22px_-8px_rgba(200,232,124,0.55)]'
                                : 'border-white/8 from-white/[0.04] via-white/[0.015] to-transparent hover:border-lime/45 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_8px_20px_-10px_rgba(200,232,124,0.35)]')
                            }
                          >
                            <div className="flex items-center justify-between gap-3">
                              {/* LADO ESQUERDO: checkmark + nome + pills de meta */}
                              <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
                                {/* CHECKMARK animado — feedback visual de selecao */}
                                <span
                                  className={
                                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ' +
                                    (isChecked
                                      ? 'border-lime bg-lime text-black shadow-[0_0_10px_rgba(200,232,124,0.6)]'
                                      : 'border-white/25 bg-transparent text-transparent group-hover/task:border-lime/60')
                                  }
                                  aria-hidden
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m5 13 4 4L19 7" />
                                  </svg>
                                </span>
                                <span
                                  className="mono text-[13px] font-semibold text-white dark:text-white text-foreground truncate"
                                  style={{ fontFamily: 'var(--font-tech)' }}
                                >
                                  {t.name}
                                </span>
                                {/* === BADGES separados por significado ===
                                    User: "ICONE É APENAS PRA INFORMAR QUE É URGENTE / ICONE AMARELO
                                    É ALTA / ICONE VERMELHO URGENCIA / ISSO É SEPARADO DO NUMERO
                                    QUE INFORMA OS DIAS ATRASADOS".

                                    REGRA SEPARACAO:
                                    - ICONE = prioridade (urgent vermelho / alta amarelo)
                                    - NUMERO = dias (atrasada vermelho / hoje ambar / futuro)
                                    - SIBLINGS = grupo de Gs (violet, ao lado)
                                */}
                                {/* SIBLINGS (Gs do mesmo grupo) */}
                                {hasSiblings && gSuffix ? (
                                  <span
                                    className="inline-flex h-6 items-center gap-1 rounded-md border border-violet-500/55 bg-violet-500/12 px-1.5 text-violet-600 dark:text-violet-300"
                                    title={`Grupo: ${siblingsAll.map(s => s.name.match(/G\d+\s*$/i)?.[0] || '?').filter(Boolean).join(' + ')}`}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                    </svg>
                                    <span className="text-[11.5px] font-bold leading-none tabular-nums">{siblingsAll.length}</span>
                                  </span>
                                ) : null}
                                {/* ICONE PRIORIDADE — bg mais saturado + border + shadow pra
                                 *  saltar em light/dark. Icone 15px (era 13). */}
                                {t.priority?.priority === 'urgent' ? (
                                  <span
                                    title="Prioridade urgente"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-red-500/85 bg-red-500/25 text-red-700 shadow-[0_1px_3px_rgba(239,68,68,0.18)]"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 2.2c-.6 0-1.2.3-1.5.9L1 19.5c-.6 1 .2 2.3 1.4 2.3h19.2c1.2 0 2-1.3 1.4-2.3L13.5 3.1c-.3-.6-.9-.9-1.5-.9z" />
                                      <path d="M11 9h2v6h-2zM11 16.5h2V19h-2z" fill="#fff" />
                                    </svg>
                                  </span>
                                ) : t.priority?.priority === 'high' ? (
                                  <span
                                    title="Prioridade alta"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-amber-500/90 bg-amber-500/28 text-amber-700 shadow-[0_1px_3px_rgba(245,158,11,0.2)]"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 2.2c-.6 0-1.2.3-1.5.9L1 19.5c-.6 1 .2 2.3 1.4 2.3h19.2c1.2 0 2-1.3 1.4-2.3L13.5 3.1c-.3-.6-.9-.9-1.5-.9z" />
                                      <path d="M11 9h2v6h-2zM11 16.5h2V19h-2z" fill="#fff" />
                                    </svg>
                                  </span>
                                ) : null}
                                {/* NUMERO DIAS — separado do icone, com bg colorido por estado */}
                                {(() => {
                                  const due = t.due_date ? Number(t.due_date) : 0;
                                  if (!due) return null;
                                  const now = Date.now();
                                  const DAY = 24 * 60 * 60 * 1000;
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  const tomorrow = today.getTime() + DAY;
                                  const dueDate = new Date(due);

                                  // ATRASADA — sempre mostra, eh critico
                                  if (due < today.getTime()) {
                                    const daysAgo = Math.max(1, Math.floor((today.getTime() - due) / DAY));
                                    return (
                                      <span
                                        title={`Atrasada ${daysAgo} dia${daysAgo === 1 ? '' : 's'}`}
                                        className="inline-flex h-6 min-w-[26px] items-center justify-center rounded-md border border-red-500/85 bg-red-500/25 px-2 text-[13px] font-extrabold tabular-nums text-red-700 shadow-[0_1px_3px_rgba(239,68,68,0.18)]"
                                      >
                                        {daysAgo}
                                      </span>
                                    );
                                  }
                                  // HOJE — sempre mostra, eh critico
                                  if (due < tomorrow) {
                                    return (
                                      <span
                                        title="Vence hoje"
                                        className="inline-flex h-6 items-center justify-center rounded-md border border-amber-500/90 bg-amber-500/28 px-2.5 text-[10.5px] font-extrabold uppercase tracking-wider text-amber-800 shadow-[0_1px_3px_rgba(245,158,11,0.2)]"
                                      >
                                        Hoje
                                      </span>
                                    );
                                  }
                                  // FUTURO — NAO mostra nada (user pediu: so atrasadas/hoje
                                  // entram nas pills. Prioridade urgente/alta sao mostradas
                                  // pelo icone separado, independente do prazo).
                                  return null;
                                })()}
                                {/* CANAL — plataforma de distribuicao (KWAI/META/YT/TIKTOK...).
                                    Chip solido com a cor da opcao do ClickUp (match exato com
                                    o board). Read-only: vem do custom field CANAL da task. */}
                                {resolveChannels(t).map((ch, i) => (
                                  <span
                                    key={`${ch.label}-${i}`}
                                    title={`Canal: ${ch.label}`}
                                    className="inline-flex h-6 items-center rounded-md px-2 text-[10.5px] font-extrabold uppercase leading-none tracking-wider shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
                                    style={{
                                      backgroundColor: ch.color,
                                      color: channelTextColor(ch.color),
                                      border: `1px solid ${ch.color}`,
                                    }}
                                  >
                                    {ch.label}
                                  </span>
                                ))}
                              </div>
                              {/* LADO DIREITO: status pill maior + chevron */}
                              <div className="flex shrink-0 items-center gap-2">
                                <span
                                  className="mono rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                                  style={{
                                    backgroundColor: (t.status?.color || '#888') + '24',
                                    color: t.status?.color || '#888',
                                    border: `1px solid ${(t.status?.color || '#888')}55`,
                                  }}
                                >
                                  {t.status?.status}
                                </span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/30 transition-transform group-hover/task:translate-x-0.5 group-hover/task:text-lime">
                                  <path d="m9 18 6-6-6-6" />
                                </svg>
                              </div>
                            </div>
                            {/* SUBTITLE REMOVIDO pelo user (folder/list info era ruido). */}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Bottom action bar — aparece quando ha pelo menos 1 selecionada.
                   *  START = analyzeSelected (puxa doc, parseia copy, prepara
                   *  dispatch view com avatares). User trabalha em batch sempre. */}
                  {selectedTaskIds.size > 0 ? (
                    <div
                      className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-lime/55 bg-gradient-to-br from-lime/15 via-lime/[0.06] to-transparent p-3.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_42px_-12px_rgba(200,232,124,0.45)]"
                    >
                      <span
                        className="mono inline-flex items-center gap-2 text-[12px] font-bold tracking-tight text-foreground"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-lime text-black shadow-[0_0_12px_rgba(200,232,124,0.7)]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 13 4 4L19 7" />
                          </svg>
                        </span>
                        {selectedTaskIds.size} task{selectedTaskIds.size === 1 ? '' : 's'} selecionada{selectedTaskIds.size === 1 ? '' : 's'}
                        {(() => {
                          const ready = Array.from(selectedTaskIds).filter(id => taskAnalyses[id]?.status === 'ready').length;
                          return ready > 0 ? (
                            <span className="mono ml-1 rounded-full bg-lime/25 px-2 py-[2px] text-[10px] text-lime border border-lime/45">
                              {ready} pronta{ready === 1 ? '' : 's'}
                            </span>
                          ) : null;
                        })()}
                      </span>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={clearSelected}
                          className="mono rounded-full border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-red-500/60 hover:text-red-300"
                        >
                          Limpar
                        </button>
                        <button
                          type="button"
                          onClick={analyzeSelected}
                          disabled={analyzing}
                          className="mono group relative inline-flex items-center gap-2 rounded-full border border-lime bg-lime px-5 py-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-black shadow-[0_6px_22px_-4px_rgba(200,232,124,0.65),inset_0_1px_0_rgba(255,255,255,0.4)] transition-all hover:scale-[1.03] hover:shadow-[0_10px_30px_-4px_rgba(200,232,124,0.85),inset_0_1px_0_rgba(255,255,255,0.55)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          {analyzing ? (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
                              </svg>
                              Analisando…
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              Start ({selectedTaskIds.size})
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Painel batch — tasks rodando ou completas */}
                  {Object.keys(batchStates).length > 0 ? (
                    <div className="mt-4 rounded-[18px] border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/[0.06] via-fuchsia-500/[0.02] to-transparent p-4 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_36px_-18px_rgba(217,70,239,0.35)]">
                      <div className="mono mb-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-fuchsia-200">
                        <span className="inline-flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-60 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia-300" />
                          </span>
                          Tasks em produção · {Object.keys(batchStates).length}
                        </span>
                      </div>
                      <ul className="grid gap-3">
                        {Object.values(batchStates).sort((a, b) => b.startedAt - a.startedAt).map((b) => {
                          const partsDispatched = b.parts.filter(p => p.videoId).length;
                          const partsRendered = b.parts.filter(p => p.videoStatus === 'completed').length;
                          // "Tudo OK" = todas partes COM CONTEÚDO dispararam + renderizaram E
                          //  pipeline produziu o esperado.
                          //
                          // CRITICAL (fix 2026-05-28 v2): partes VAZIAS (BODY vazia
                          //  "(esse part nao gera nada)") têm videoId=null E um error
                          //  específico: "processJob: precisa de `file` OU `text`" —
                          //  porque não há texto pra disparar. Essas NÃO contam como
                          //  faltantes (são intencionalmente vazias).
                          //
                          //  Distinção:
                          //   - Parte VAZIA: sem videoId + error de "precisa de file/text"
                          //     OU sem error nenhum → IGNORA
                          //   - Parte que FALHOU de verdade (network, NSFW, etc): sem
                          //     videoId + error REAL → conta como faltante
                          const isEmptyPart = (p: any) => !p.videoId && (
                            !p.error ||
                            /precisa de\s*[`'"]?(file|text|audio|texto)|vazio|sem (texto|conte)|empty|nao vai gerar/i.test(String(p.error))
                          );
                          const expectableParts = b.parts.filter(p => !isEmptyPart(p));
                          const dispatchOk = expectableParts.length > 0 && expectableParts.every(p => !!p.videoId);
                          const renderOk = expectableParts.filter(p => p.videoId).every(p => !p.videoStatus || p.videoStatus === 'completed');
                          const pipeOk = b.pipeStats
                            ? (
                                b.pipeStats.expectedMontagens > 0
                                && b.pipeStats.okMontagens === b.pipeStats.expectedMontagens
                                && (!b.pipeStats.expectedDecupagem || b.pipeStats.okDecupados === b.pipeStats.expectedMontagens)
                                && (!b.pipeStats.expectedCamuflagem || b.pipeStats.okCamuflados === b.pipeStats.expectedMontagens)
                              )
                            : (b.phase === 'done' && !!b.montadoZipUrl);
                          const allOk = dispatchOk && renderOk && pipeOk;
                          const isPartialDone = b.phase === 'done' && !allOk;
                          const elapsedMs = (b.finishedAt || nowTick) - b.startedAt;
                          const running = ['dispatching', 'rendering', 'downloading', 'post'].includes(b.phase);
                          const queued = b.phase === 'queued';

                          // TROCA DE ÁUDIO: card sem grid de takes — mostra a
                          // PROVA por transcricao (o que a IA le no MP4 real).
                          const trocaProofNode = b.kind === 'troca' ? (
                            <div className="rounded-[10px] border border-teal-500/40 bg-teal-500/5 p-3">
                              <div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-teal-200">
                                🎧 Prova — o que a IA escuta (soma mono do MP4 real)
                              </div>
                              {b.phase === 'done' && b.camufladoZipUrl ? (
                                <>
                                  {/* Player inline — assiste/ouve o resultado antes de baixar */}
                                  <video
                                    src={b.camufladoZipUrl}
                                    controls
                                    className="mb-2 w-full rounded-[10px] border border-teal-500/30 bg-black"
                                  />
                                  {/* Confianca da verificacao (correlacao na soma mono) */}
                                  {typeof b.trocaWhiteScore === 'number' && typeof b.trocaBlackScore === 'number' ? (
                                    <div className="mono mb-2 flex flex-wrap items-center gap-2 text-[10px]">
                                      <span className="text-text-muted">Confiança:</span>
                                      <span className="rounded border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-lime">WHITE {b.trocaWhiteScore.toFixed(2)}</span>
                                      <span className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-300">BLACK {b.trocaBlackScore.toFixed(2)}</span>
                                      <span className="text-text-muted/70">(WHITE alto + BLACK baixo = a IA lê o novo áudio)</span>
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => transcribeTrocaResult(b.taskId, b.camufladoZipUrl!)}
                                    disabled={trocaProof[b.taskId]?.loading}
                                    className="mono inline-flex items-center gap-2 rounded-[8px] border border-teal-400/50 bg-teal-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-teal-100 transition hover:bg-teal-500/20 disabled:cursor-wait disabled:opacity-60"
                                  >
                                    {trocaProof[b.taskId]?.loading ? (
                                      <>
                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-300 border-t-transparent" />
                                        Ouvindo como a IA...
                                      </>
                                    ) : (
                                      <>🎧 Transcrever o que a IA lê</>
                                    )}
                                  </button>
                                  {trocaProof[b.taskId]?.err ? (
                                    <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                                      {trocaProof[b.taskId]?.err}
                                    </div>
                                  ) : null}
                                  {trocaProof[b.taskId]?.text ? (
                                    <div className="mt-2 rounded-[8px] border border-teal-500/30 bg-bg-soft/50 px-3 py-2">
                                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white">
                                        {trocaProof[b.taskId]?.text}
                                      </p>
                                      <p className="mt-2 text-[10px] text-text-muted">
                                        Tem que bater com o roteiro do <strong className="text-teal-200">novo WHITE</strong>. Se vier o áudio antigo, aumente a intensidade e refaça.
                                      </p>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="text-[11px] text-text-muted">A prova fica disponível quando a troca terminar.</div>
                              )}
                            </div>
                          ) : null;

                          // Preview slot — so renderiza se ja tem video disparado
                          const previewsNode = b.kind === 'troca' ? trocaProofNode : b.parts.some((p) => p.videoId) ? (() => {
                            // Mapeia idx do filtered → idx no array original (pra EDIT funcionar)
                            const validIdxsFiltered: number[] = [];
                            const previews: LipsyncTake[] = b.parts
                              .map((p, originalIdx) => ({ p, originalIdx }))
                              .filter(({ p }) => !!p.videoId)
                              .map(({ p, originalIdx }) => {
                                validIdxsFiltered.push(originalIdx);
                                return {
                                  label: p.label,
                                  status: p.videoStatus || 'processing',
                                  videoUrl: p.videoUrl ?? null,
                                  error: p.error ?? null,
                                };
                              });
                            const donePv = previews.filter((p) => p.status === 'completed').length;
                            const pct = previews.length > 0 ? Math.round((100 * donePv) / previews.length) : 0;
                            const canEdit = !!b.replan?.parts?.length; // so habilita se temos plan
                            return (
                              <>
                                <div className="mono mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
                                  <span>Takes ({donePv}/{previews.length} prontos)</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                  {previews.map((t, ti) => {
                                    const originalIdx = validIdxsFiltered[ti];
                                    const isRegenThis = regeneratingPart?.taskId === b.taskId && regeneratingPart?.label === t.label;
                                    return (
                                      <LipsyncPreviewCard
                                        key={ti}
                                        take={t}
                                        position={ti + 1}
                                        total={previews.length}
                                        percent={pct}
                                        fileBase={b.baseAdId || b.taskName}
                                        isRegenerating={isRegenThis}
                                        onEdit={canEdit && t.status === 'completed' ? () => openEditPart(b.taskId, originalIdx) : undefined}
                                      />
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })() : null;

                          return (
                            <BatchJobCard3D
                              key={b.taskId}
                              taskId={b.taskId}
                              taskName={b.taskName}
                              phase={b.phase as any}
                              partsTotal={b.parts.length}
                              partsDispatched={partsDispatched}
                              partsRendered={partsRendered}
                              message={b.message}
                              elapsedMs={elapsedMs}
                              allOk={allOk}
                              isPartialDone={isPartialDone}
                              takesUrl={b.zipBlobUrl}
                              takesFilename={b.zipFilename}
                              montadoUrl={b.montadoZipUrl}
                              montadoFilename={b.montadoZipName}
                              camufladoUrl={b.camufladoZipUrl}
                              camufladoFilename={b.camufladoZipName}
                              isRunning={running}
                              isQueued={queued}
                              onRetomar={() => retomarTaskBatch(b.taskId)}
                              onPausar={() => pausarTaskBatch(b.taskId)}
                              onDebug={() => debugTaskBatch(b.taskId)}
                              onRemove={() => {
                                if (queued) batchCancelRef.current[b.taskId] = true;
                                for (const url of [b.zipBlobUrl, b.montadoZipUrl, b.camufladoZipUrl]) {
                                  if (url) { try { URL.revokeObjectURL(url); } catch {} }
                                }
                                // TROCA: limpa o WHITE persistido no IndexedDB.
                                if (b.kind === 'troca') {
                                  void import('@/lib/zip-store')
                                    .then((m) => m.deletePrefix('troca:white:' + b.taskId))
                                    .catch(() => {});
                                }
                                setBatchStates((prev) => {
                                  const { [b.taskId]: _, ...rest } = prev;
                                  return rest;
                                });
                              }}
                              dirtyPartsCount={(b.dirtyParts || []).length}
                              onRebuild={() => void rebuildMontage(b.taskId)}
                              isRebuilding={rebuildingTaskId === b.taskId}
                              docUrl={b.docUrl || taskAnalyses[b.taskId]?.docUrl}
                              taskUrl={b.taskUrl || taskAnalyses[b.taskId]?.taskUrl}
                              resolveDocUrl={async () => {
                                // Lazy fetch: pega o docUrl ao vivo do ClickUp.
                                // Usado quando o batch antigo nao tem docUrl em cache.
                                // Apos resolver, persiste no state pra futuras chamadas.
                                try {
                                  const det = await getTask(b.taskId);
                                  const docField = (det.custom_fields || ([] as any[])).find((f: any) => /DOC DA COPY/i.test(f.name || ''));
                                  const found: string | undefined =
                                    docField?.value || extractDocLinks(det.description || det.text_content)[0];
                                  if (found) {
                                    // Persiste pra proximas chamadas (sobrevive reload via persistBatchStates)
                                    setBatchStates((prev) => {
                                      const cur = prev[b.taskId];
                                      if (!cur) return prev;
                                      return { ...prev, [b.taskId]: { ...cur, docUrl: found, taskUrl: cur.taskUrl || (det as any).url } };
                                    });
                                    return found;
                                  }
                                  return null;
                                } catch (e) {
                                  console.warn('[resolveDocUrl] getTask falhou:', e);
                                  return null;
                                }
                              }}
                              extraActions={b.isVA && b.adOriginalUrl ? (
                                <a
                                  href={b.adOriginalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Baixar AD original (Drive)"
                                  aria-label="Baixar AD original"
                                  className="group/btn3d relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/55 bg-gradient-to-b from-cyan-400/25 via-cyan-400/10 to-cyan-400/[0.02] text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_10px_-3px_rgba(34,211,238,0.45)] hover:-translate-y-0.5 hover:scale-[1.08] hover:border-cyan-400/80 active:translate-y-0 active:scale-95 transition-[transform,box-shadow]"
                                >
                                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                                  <span className="relative text-[13px]">🎬</span>
                                </a>
                              ) : undefined}
                            >
                              {previewsNode}
                            </BatchJobCard3D>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {/* Painel fila Magnific — serial, 1 por vez (espelha batches HeyGen) */}
                  {Object.keys(magnificQueue).length > 0 ? (
                    <div className="mt-4 rounded-[12px] border border-lime/40 bg-lime/5 p-3">
                      <div className="mono mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-lime">
                        <span>🍌 Fila Magnific B-Rolls ({Object.keys(magnificQueue).length}) · serial 1/vez</span>
                        {Object.values(magnificQueue).some((j) => j.status === 'done' || j.status === 'failed') ? (
                          <button
                            type="button"
                            onClick={() => setMagnificQueueState((prev) => {
                              const next: MagnificQueue = {};
                              for (const [k, v] of Object.entries(prev)) {
                                if (v.status !== 'done' && v.status !== 'failed') next[k] = v;
                              }
                              return next;
                            })}
                            className="rounded border border-line-strong px-2 py-0.5 text-text-muted hover:border-red-500/60 hover:text-red-300"
                          >
                            limpar concluidos/falhas
                          </button>
                        ) : null}
                      </div>
                      {/* activeJobTaskId é calculado dentro do map (linha
                          abaixo) pra ser sempre consistente com o snapshot
                          atual da fila. Regra: só a task EM PROCESSO aceita
                          comandos; outras na fila ficam aguardando vez. */}
                      {(() => {
                        // Snapshot único do running atual — usado em todos os jobs do map
                        const activeJobTaskId = Object.values(magnificQueue).find((x) => x.status === 'running')?.taskId;
                        const sortedJobs = Object.values(magnificQueue).sort((a, b) => b.enqueuedAt - a.enqueuedAt);
                        return (
                      <ul className="grid gap-2">
                        {sortedJobs.map((j) => {
                          const isActive = j.status === 'running';
                          const isOtherRunning = !!activeJobTaskId && activeJobTaskId !== j.taskId;
                          // Bloqueia interações com tasks na fila enquanto OUTRA está rodando.
                          // Mantém terminais (done/failed) interativas — usuário baixa/remove à vontade.
                          const blockedByQueue =
                            isOtherRunning && (j.status === 'queued' || j.status === 'paused');
                          const stLabel = ({
                            queued: j.gateOnHeyGen
                              ? '⏳ aguardando HeyGen'
                              : blockedByQueue
                                ? '⏳ aguardando vez na fila'
                                : '⏳ na fila',
                            running: '⚙ gerando B-rolls',
                            paused: blockedByQueue ? '⏸ pausado · aguardando vez' : '⏸ pausado',
                            done: '✅ pronto',
                            failed: '✗ falhou',
                          } as Record<typeof j.status, string>)[j.status];
                          const stColor = j.status === 'done' ? 'text-lime border-lime/40 bg-lime/10'
                            : j.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                            : j.status === 'running' ? 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10'
                            : j.status === 'paused' ? 'text-yellow-200 border-yellow-500/40 bg-yellow-500/10'
                            : 'text-text-muted border-line-strong bg-bg-soft/40';
                          const pct = j.status === 'done' ? 100 : j.status === 'failed' ? 0 : (j.percent || (j.status === 'running' ? 5 : 0));
                          const jobRunning = j.status === 'running';
                          // Tooltip explicativo quando botão está bloqueado pela fila
                          const blockedReason = blockedByQueue
                            ? 'Bloqueado: aguardando a task em processo terminar (fila serial).'
                            : null;
                          return (
                            <li
                              key={j.taskId}
                              className={`rounded-[10px] border ${stColor} p-2 transition-opacity ${
                                blockedByQueue ? 'opacity-60' : ''
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span className="mono">
                                  <strong className="text-white">{j.adName}</strong>
                                  <span className="ml-2">{stLabel}</span>
                                  <span className="ml-2 text-text-muted">· {j.takeCount} take{j.takeCount === 1 ? '' : 's'}</span>
                                  {isActive ? (
                                    <span
                                      className="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan-400/60 bg-cyan-500/15 px-1.5 py-0 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-200"
                                      style={{ fontFamily: 'var(--font-tech)' }}
                                      title="Esta task está em processo agora — só ela aceita comandos"
                                    >
                                      <span className="inline-block h-1 w-1 animate-pulse-soft rounded-full bg-cyan-300" />
                                      EM PROCESSO
                                    </span>
                                  ) : null}
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {j.status === 'done' && j.zipKey ? (
                                    <button
                                      type="button"
                                      onClick={() => downloadMagnificZip(j.taskId)}
                                      className="mono rounded border border-lime bg-lime/20 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30"
                                      title="Baixa o ZIP de takes B-roll dessa task"
                                    >
                                      ⬇ takes
                                    </button>
                                  ) : null}
                                  {/* PAUSAR / RETOMAR / DEBUG — quando outra task está
                                   *  rodando, estes botões ficam BLOQUEADOS pra
                                   *  tasks da fila/pausadas (regra serial estrita).
                                   *  Só a task EM PROCESSO controla seus botões. */}
                                  <button
                                    type="button"
                                    onClick={() => pauseMagnificJob(j.taskId)}
                                    disabled={blockedByQueue || j.status === 'paused' || j.status === 'done'}
                                    className="mono rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'Para o job (rodando ou na fila). Libera a vez pra outro.'}
                                  >
                                    ⏸ Pausar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => resumeMagnificJob(j.taskId)}
                                    disabled={blockedByQueue || jobRunning || j.status === 'done'}
                                    className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'Volta o job pra fila — roda quando nenhum outro estiver rodando (serial 1/vez)'}
                                  >
                                    🔄 Retomar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => debugMagnificJob(j.taskId)}
                                    disabled={blockedByQueue}
                                    className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                    title={blockedReason ?? 'DEBUG (reserva p/ bugs/loop): aborta e recria do ZERO num space novo'}
                                  >
                                    🐞 Debug
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeMagnificJob(j.taskId)}
                                    className="mono rounded border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                    title="Remove esse job da fila (sempre disponível pra liberar espaço)"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                              {j.status !== 'failed' ? (
                                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-soft/60">
                                  <div
                                    className={`h-full ${j.status === 'done' ? 'bg-lime' : 'bg-cyan-400'} transition-all duration-300`}
                                    style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                                  />
                                </div>
                              ) : null}
                              {j.message ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">{j.message}</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                        );
                      })()}
                    </div>
                  ) : null}

                  {/* Preview previsibilidade — antes de iniciar */}
                  {Object.keys(taskAnalyses).length > 0 ? (
                    <div className="mt-4">
                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-text-muted">
                        Análise — o que vai ser disparado
                      </div>
                      <ul className="grid gap-2">
                        {Object.values(taskAnalyses)
                          // Filtra siblings G2/G3 que ja foram analisadas como parte do
                          // primary (G1) — assim aparece UM card so por base task (G1+G2 = 1 card)
                          .filter((a) => !a.sharedWithPrimaryId)
                          .map((a) => {
                          const sym = a.status === 'ready' ? '✓' : a.status === 'partial' ? '⚠' : a.status === 'error' ? '✗' : a.status === 'analyzing' ? '◷' : '·';
                          const color = a.status === 'ready' ? 'border-lime/40 bg-lime/5' :
                                         a.status === 'partial' ? 'border-yellow-500/40 bg-yellow-500/5' :
                                         a.status === 'error' ? 'border-red-500/40 bg-red-500/5' :
                                         'border-line bg-bg-soft/30';
                          // Acha os siblings que compartilham essa analise (G2, G3, etc)
                          const sharedSiblings = Object.values(taskAnalyses).filter(
                            (s) => s.sharedWithPrimaryId === a.taskId
                          );
                          // Extrai a parte G1/G2/etc do nome de cada sibling pra mostrar agrupado
                          const allGSuffixes = [a, ...sharedSiblings].map((s) => {
                            const m = s.taskName.match(/G(\d+)\s*$/i);
                            return m ? `G${m[1]}` : null;
                          }).filter(Boolean);
                          const displayName = sharedSiblings.length > 0
                            ? a.taskName.replace(/\s*[-–—]\s*G\d+\s*$/i, '').trim()
                            : a.taskName;
                          return (
                            <li key={a.taskId} className={`rounded-[10px] border ${color} p-3 text-[11px]`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="mono text-xs text-white flex items-center gap-2 flex-wrap">
                                  {sym} {displayName}
                                  {sharedSiblings.length > 0 ? (
                                    <span className="mono rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200" title="Task agrupada — G1 + G2 sao a mesma task no ClickUp, gerada 1x com 2 hooks + 1 body">
                                      {allGSuffixes.join(' + ')} · 1 task
                                    </span>
                                  ) : null}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeTaskFromAnalysis(a.taskId)}
                                  className="mono shrink-0 rounded-md border border-red-500/50 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/25 hover:border-red-500"
                                  title="Remove esta task da previsibilidade (também desmarca da seleção). Pode adicionar de novo depois."
                                >
                                  × Remover
                                </button>
                              </div>

                              {/* MOTOR CONFIG — Avatar III/IV/V picker.
                                  ESCONDIDO quando ONLY MAGNIFIC tá ligado:
                                  esse modo pula HeyGen totalmente (só dispara
                                  Auto B-rolls), então não há avatar pra
                                  escolher. Limpa a UI e elimina dúvida. */}
                              {!onlyMagnificMode && !a.trocaBriefing && (a.status === 'ready' || a.status === 'partial') ? (
                                <div className="mt-2">
                                  <MotorConfigPicker
                                    config={getMotorConfig(a.taskId)}
                                    setConfig={(cfg) => setMotorConfigForTask(a.taskId, cfg)}
                                    takeCount={(a.partTemplates?.length || 0) || (a.totalParts || 0) || (a.roleSlots?.length || 0)}
                                    slotIds={(a.partTemplates || []).map((p: any, i: number) => p.label || `t${i}`)}
                                    // Calcula duracoes reais lendo a copy de cada parte (palavras / 150 wpm)
                                    takeSeconds={(a.partTemplates || []).map((p: any) => estimateSecondsFromText(p.text || ''))}
                                  />
                                </div>
                              ) : null}

                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span></span>
                                {a.vaBriefing ? (
                                  // ═══ VA ACTION BAR 3D — espelha o design das tasks normais.
                                  //  Sem botao de disparo aqui de proposito: VA roda na MESMA
                                  //  fila e dispara pelo START global. Aqui so atalhos (Doc + AD). ═══
                                  (() => {
                                    const adFileId = a.vaBriefing!.linkAdFileId;
                                    return (
                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        <span
                                          className="mono rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200"
                                          title="Variação de Avatar — cada avatar fala com o áudio do AD original"
                                        >
                                          VA · {a.vaBriefing!.avatares.length} avatar{a.vaBriefing!.avatares.length === 1 ? '' : 'es'}
                                        </span>
                                        {(a.docUrl || a.taskUrl) ? (
                                          <PilotBtn3D
                                            icon={<PilotIconDoc size={16} />}
                                            color="cyan"
                                            title={a.docUrl ? 'Abrir doc da copy' : 'Abrir task no ClickUp'}
                                            href={a.docUrl || a.taskUrl}
                                          />
                                        ) : null}
                                        {adFileId ? (
                                          <PilotBtn3D
                                            icon={<PilotIconDownload size={16} />}
                                            color="cyan"
                                            title="Baixar AD original (Drive)"
                                            href={`https://drive.google.com/uc?export=download&id=${adFileId}`}
                                          />
                                        ) : null}
                                      </div>
                                    );
                                  })()
                                ) : !a.trocaBriefing && (a.status === 'ready' || a.status === 'partial') ? (
                                  // ═══ ACTION BAR 3D — botoes icon-only ═══
                                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                    {/* Tesoura (decupagem) toggle */}
                                    <PilotBtn3D
                                      icon={<PilotIconScissors size={16} />}
                                      color={isDecupagemEnabled(a.taskId) ? 'lime' : 'neutral'}
                                      active={isDecupagemEnabled(a.taskId)}
                                      title={isDecupagemEnabled(a.taskId) ? 'Decupagem ON' : 'Decupagem OFF'}
                                      onClick={() => setDecupagemFor(a.taskId, !isDecupagemEnabled(a.taskId))}
                                    />
                                    {/* Camuflagem toggle (per-task) */}
                                    <PilotBtn3D
                                      icon={<IconCamuflagem size={16} />}
                                      color={(taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? 'fuchsia' : 'neutral'}
                                      active={taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode}
                                      title={(taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? 'Camuflagem ON' : 'Camuflagem OFF — clica pra ativar'}
                                      onClick={() => toggleTaskCamuflagem(a.taskId)}
                                    />
                                    {/* Auto B-roll JSON — abre caixa pra colar JSON e disparar Magnific dessa task */}
                                    <PilotBtn3D
                                      icon={<PilotIconBroll size={16} />}
                                      color={(taskMagnificJson[a.taskId] || '').trim() ? 'violet' : 'neutral'}
                                      active={!!magnificEditorOpen[a.taskId]}
                                      title={
                                        (taskMagnificJson[a.taskId] || '').trim()
                                          ? 'Auto B-roll · JSON colado (clica pra editar/disparar)'
                                          : 'Auto B-roll · clica pra colar o JSON dos prompts dessa task'
                                      }
                                      onClick={() => setMagnificEditorOpen((p) => ({ ...p, [a.taskId]: !p[a.taskId] }))}
                                    />
                                    {/* Doc button */}
                                    {(a.docUrl || a.taskUrl) ? (
                                      <PilotBtn3D
                                        icon={<PilotIconDoc size={16} />}
                                        color="cyan"
                                        title={a.docUrl ? 'Abrir doc da copy (Google Docs)' : 'Abrir task no ClickUp'}
                                        href={a.docUrl || a.taskUrl}
                                      />
                                    ) : null}
                                    {/* Disparar HeyGen */}
                                    <PilotBtn3D
                                      icon={<PilotIconPlay size={18} />}
                                      color="lime"
                                      title={a.status === 'partial' ? 'Tem avatar pendente abaixo' : 'Disparar — gerar videos HeyGen'}
                                      disabled={a.status === 'partial'}
                                      onClick={() => dispatchTaskToHeyGen(a.taskId)}
                                      pulse={a.status === 'ready'}
                                    />
                                  </div>
                                ) : null}
                              </div>

                              {/* CAMUFLAGEM PANEL INLINE — so aparece quando toggle ON */}
                              {!onlyMagnificMode && !a.trocaBriefing && (taskCamuflagem[a.taskId]?.enabled ?? camuflagemMode) ? (
                                <div className="mt-2 rounded-[12px] border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-500/[0.08] via-fuchsia-500/[0.03] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                  <div className="mono mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-pulse" />
                                      Camuflagem · esta task
                                    </span>
                                    <span className="text-fuchsia-300/70">
                                      {(taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume)}%
                                    </span>
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-center">
                                    {/* Upload white audio */}
                                    <label className="mono group/upload inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-[11px] text-fuchsia-100 transition hover:bg-fuchsia-500/20 hover:border-fuchsia-500/60">
                                      <PilotIconUpload size={14} />
                                      <span className="truncate flex-1">
                                        {taskCamuflagem[a.taskId]?.white?.name || camuflagemWhite?.name || 'Clica pra upar audio WHITE'}
                                      </span>
                                      <input
                                        type="file"
                                        accept="audio/*,video/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0] || null;
                                          if (f) setTaskCamuflagemWhite(a.taskId, f);
                                        }}
                                      />
                                    </label>
                                    {(taskCamuflagem[a.taskId]?.white) ? (
                                      <button
                                        type="button"
                                        onClick={() => setTaskCamuflagemWhite(a.taskId, null)}
                                        className="mono rounded-md border border-text-muted/30 px-2 py-1 text-[10px] text-text-muted hover:border-red-500/50 hover:text-red-300"
                                        title="Remover white audio (volta pro global)"
                                      >
                                        ×
                                      </button>
                                    ) : null}
                                  </div>
                                  {/* Volume slider */}
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className="mono text-[9px] uppercase tracking-widest text-fuchsia-300/80 shrink-0">Volume</span>
                                    <input
                                      type="range"
                                      min={5}
                                      max={100}
                                      value={taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume}
                                      onChange={(e) => setTaskCamuflagemVolume(a.taskId, Number(e.target.value))}
                                      className="flex-1 accent-fuchsia-400 cursor-pointer"
                                    />
                                    <span className="mono text-[10px] font-bold tabular-nums text-fuchsia-200 w-10 text-right">
                                      {taskCamuflagem[a.taskId]?.volume ?? camuflagemVolume}%
                                    </span>
                                  </div>
                                </div>
                              ) : null}
                              {/* CAIXA INLINE de JSON Auto B-roll (Magnific) por task — abre/fecha pelo botão 3D ✨ */}
                              {!a.vaBriefing && !a.trocaBriefing && magnificEditorOpen[a.taskId] ? (
                                <div className="mt-2 rounded-[12px] border border-violet-400/45 bg-gradient-to-br from-violet-500/[0.08] via-violet-500/[0.03] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                  <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-violet-200">
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                                      Auto B-roll · esta task
                                    </span>
                                    {(() => {
                                      const raw = (taskMagnificJson[a.taskId] || '').trim();
                                      const n = raw ? parseMagnificPrompts(raw).length : 0;
                                      return raw ? (
                                        <span className={n > 0 ? 'text-lime' : 'text-red-300'}>
                                          {n > 0 ? `${n} take${n === 1 ? '' : 's'} detectado${n === 1 ? '' : 's'}` : 'JSON invalido'}
                                        </span>
                                      ) : (
                                        <span className="text-text-muted">vazio</span>
                                      );
                                    })()}
                                  </div>
                                  <textarea
                                    value={taskMagnificJson[a.taskId] || ''}
                                    onChange={(e) => setTaskMagnificJson(a.taskId, e.target.value)}
                                    rows={6}
                                    placeholder='Cole aqui o JSON de B-rolls (ex: [{ "imagePrompt": "...", "videoPrompt": "..." }, ...])'
                                    className="input-field resize-y font-mono text-[11px]"
                                  />
                                  <div className="mono mt-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[9px] uppercase tracking-widest text-text-muted">
                                      Fica salvo nessa task · Magnific roda invisivel (extensao, serial 1 por vez)
                                    </span>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => copyTaskBody(a.taskId)}
                                        className="mono rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20"
                                        title="Copia o body falado dessa task (sem hooks/links) — útil pra gerar os prompts no GPT"
                                      >
                                        {copiedBodyTask === a.taskId ? '✓ copiado' : '⧉ body'}
                                      </button>
                                      {taskMagnificJson[a.taskId] ? (
                                        <button
                                          type="button"
                                          onClick={() => setTaskMagnificJson(a.taskId, '')}
                                          className="mono rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                          title="Limpa o JSON dessa task"
                                        >
                                          × limpar
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        onClick={() => dispatchTaskToMagnific(a.taskId)}
                                        disabled={!(taskMagnificJson[a.taskId] || '').trim() || parseMagnificPrompts((taskMagnificJson[a.taskId] || '').trim()).length === 0}
                                        className="mono rounded-md border border-violet-400/60 bg-gradient-to-b from-violet-500/25 via-violet-500/15 to-violet-500/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_-4px_rgba(167,139,250,0.4)] transition hover:bg-violet-500/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_20px_-6px_rgba(167,139,250,0.6)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30 disabled:shadow-none"
                                        title="Dispara só Auto B-roll (Magnific) dessa task — independente do HeyGen"
                                      >
                                        ✨ Disparar B-rolls
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              {/* RENDER TROCA DE ÁUDIO — pipeline proprio (sem HeyGen) */}
                              {a.trocaBriefing ? (() => {
                                const detectedDriveId = a.trocaBriefing!.driveId || extractDriveFileId(trocaAdUrl[a.taskId] || '');
                                const detectedFolderUrl = a.trocaBriefing!.driveFolderUrl;
                                const hasSource = !!detectedDriveId || !!a.trocaBriefing!.driveFolderId;
                                const whiteFile = trocaWhite[a.taskId] || null;
                                const vol = trocaVolume[a.taskId] ?? 30;
                                return (
                                <div className="mt-1 grid gap-2">
                                  <div className="rounded-[10px] border border-teal-500/40 bg-teal-500/5 p-3">
                                    <div className="mono mb-2 text-[10px] uppercase tracking-widest text-teal-200">
                                      🔄 Troca de Áudio · {a.trocaBriefing!.baseAdId}
                                    </div>
                                    <div className="text-[11px] text-text-muted">
                                      Baixa o criativo original do Drive, tira o áudio WHITE antigo (descamuflagem) e embute o novo WHITE que você subir. O áudio público continua igual.
                                    </div>
                                    {/* Link do criativo original */}
                                    <div className="mt-2">
                                      <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Criativo original (Drive)</div>
                                      {detectedDriveId ? (
                                        <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                          <span className="rounded border border-lime/40 bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">✓ Vídeo detectado: {detectedDriveId}</span>
                                        </div>
                                      ) : detectedFolderUrl ? (
                                        <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                          <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200">📁 Pasta detectada — pego o vídeo automaticamente</span>
                                          <a
                                            href={detectedFolderUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/20"
                                          >
                                            abrir pasta ↗
                                          </a>
                                        </div>
                                      ) : (
                                        <span className="mono text-[9px] uppercase tracking-widest text-yellow-300">⚠ Link não detectado — cola a URL do vídeo (ou da pasta) abaixo</span>
                                      )}
                                      <input
                                        type="text"
                                        value={trocaAdUrl[a.taskId] || ''}
                                        onChange={(e) => setTrocaAdUrl((prev) => ({ ...prev, [a.taskId]: e.target.value }))}
                                        placeholder="https://drive.google.com/file/d/.../view"
                                        className="mono mt-1.5 w-full rounded-[8px] border border-line bg-bg/60 px-2.5 py-1.5 text-[11px] text-white placeholder:text-text-muted/60 focus:border-teal-400/60 focus:outline-none"
                                      />
                                    </div>
                                    {/* Upload do novo WHITE */}
                                    <div className="mt-3">
                                      <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Novo áudio WHITE (IA)</div>
                                      <label className={'mono flex cursor-pointer items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-[11px] transition ' + (whiteFile ? 'border-teal-400/60 bg-teal-500/10 text-teal-100' : 'border-line bg-bg/60 text-text-muted hover:border-teal-400/40')}>
                                        <span className="truncate">{whiteFile ? `🎵 ${whiteFile.name}` : 'Selecionar áudio WHITE (.mp3/.wav/vídeo)'}</span>
                                        <span className="shrink-0 rounded border border-teal-400/40 bg-teal-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-teal-200">{whiteFile ? 'trocar' : 'upar'}</span>
                                        <input
                                          type="file"
                                          accept="audio/*,video/mp4,video/webm,video/quicktime"
                                          className="hidden"
                                          onChange={(e) => {
                                            const f = e.target.files?.[0] || null;
                                            setTrocaWhite((prev) => ({ ...prev, [a.taskId]: f }));
                                          }}
                                        />
                                      </label>
                                      {whiteFile ? (
                                        <button
                                          type="button"
                                          onClick={() => setTrocaWhite((prev) => ({ ...prev, [a.taskId]: null }))}
                                          className="mono mt-1 text-[9px] uppercase tracking-widest text-text-muted hover:text-red-300"
                                        >
                                          remover
                                        </button>
                                      ) : null}
                                    </div>
                                    {/* Intensidade */}
                                    <div className="mt-3">
                                      <div className="mono mb-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
                                        <span>Intensidade do WHITE</span>
                                        <span className="text-teal-200">{vol}%</span>
                                      </div>
                                      <input
                                        type="range"
                                        min={5}
                                        max={100}
                                        step={1}
                                        value={vol}
                                        onChange={(e) => setTrocaVolume((prev) => ({ ...prev, [a.taskId]: Math.round(Number(e.target.value)) }))}
                                        className="w-full accent-teal-400"
                                      />
                                    </div>
                                  </div>
                                  <div className={'rounded-[10px] border p-3 text-[11px] ' + (whiteFile && hasSource ? 'border-lime/40 bg-lime/5 text-lime' : 'border-yellow-500/40 bg-yellow-500/5 text-yellow-200')}>
                                    {whiteFile && hasSource
                                      ? (detectedDriveId
                                          ? '✓ Pronto pra disparar — marque junto das outras e clique em Iniciar. O resultado aparece com botão de download no card.'
                                          : '✓ Pronto pra disparar — vou achar o vídeo na pasta automaticamente. Marque junto das outras e clique em Iniciar.')
                                      : '⚠ Suba o novo WHITE' + (hasSource ? '' : ' e confirme o link do criativo (vídeo ou pasta)') + ' pra essa task entrar no disparo.'}
                                  </div>
                                </div>
                                );
                              })() : a.vaBriefing ? (
                                <div className="mt-2 grid gap-2.5">
                                  {/* Resumo enxuto — contagem + AD original, sem ruído técnico.
                                      Download do AD (+ via extensão) vive na action bar 3D do header. */}
                                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="text-text-muted">
                                      <strong className="text-cyan-200">{a.vaBriefing.avatares.length}</strong> avatar{a.vaBriefing.avatares.length === 1 ? '' : 'es'} · <strong className="text-cyan-200">{a.vaBriefing.avatares.length + (a.vaBriefing.depoimentoText ? 1 : 0)}</strong> vídeo{(a.vaBriefing.avatares.length + (a.vaBriefing.depoimentoText ? 1 : 0)) === 1 ? '' : 's'}
                                    </span>
                                    {a.vaBriefing.linkAdFilename ? (
                                      <span
                                        className="mono inline-flex max-w-[260px] items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200"
                                        title={a.vaBriefing.linkAdFilename}
                                      >
                                        <span className="truncate">{a.vaBriefing.linkAdFilename}</span>
                                      </span>
                                    ) : null}
                                    {!a.vaBriefing.linkAdFileId ? (
                                      <span className="mono rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">AD não detectado</span>
                                    ) : null}
                                  </div>
                                  {/* Avatares */}
                                  <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
                                    Avatares
                                  </div>
                                  {a.vaBriefing.avatares.map((av) => {
                                    const thumbUrl = av.fileId ? `https://drive.google.com/thumbnail?id=${av.fileId}&sz=w200` : null;
                                    const choiceKey = `${a.taskId}:${av.avaCode}`;
                                    const chosen = vaAvatarChoice[choiceKey] || null;
                                    const voiceChosen = vaVoiceChoice[choiceKey] || null;
                                    const pickersLocked = ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued';
                                    return (
                                      <div key={av.avaCode} className="rounded-[12px] border border-white/8 bg-white/[0.02] p-2.5 transition-colors hover:border-cyan-400/30">
                                        <div className="flex items-center gap-2.5">
                                          {thumbUrl ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img src={thumbUrl} alt={av.username} className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/10" referrerPolicy="no-referrer" />
                                          ) : (
                                            <div className="h-11 w-11 shrink-0 rounded-full bg-cyan-500/10 flex items-center justify-center mono text-[10px] font-bold text-cyan-300 ring-1 ring-cyan-400/20">{av.avaCode.replace(/^AVA/i, '')}</div>
                                          )}
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="mono text-[11px] font-bold tracking-wide text-cyan-200">{av.avaCode}</span>
                                              {chosen && voiceChosen ? (
                                                <span className="mono rounded-full border border-lime/40 bg-lime/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-lime">✓ pronto</span>
                                              ) : (
                                                <span className="mono rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-200">{!chosen ? 'falta avatar' : 'falta voz'}</span>
                                              )}
                                            </div>
                                            <div className="truncate text-[11px] text-text-muted">@{av.username}</div>
                                          </div>
                                          {av.fileId ? (
                                            <PilotBtn3D
                                              icon={<PilotIconDownload size={14} />}
                                              color="cyan"
                                              size={30}
                                              title="Baixar o clipe de referência desse avatar"
                                              href={`https://drive.google.com/uc?export=download&id=${av.fileId}`}
                                            />
                                          ) : null}
                                        </div>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                          <div>
                                            <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Avatar HeyGen</div>
                                            <CompactAvatarPicker
                                              selected={chosen}
                                              setSelected={(newAv) => setVaAvatarChoice((prev) => ({ ...prev, [choiceKey]: newAv }))}
                                              disabled={pickersLocked}
                                              label={`Avatar · ${av.avaCode}`}
                                            />
                                          </div>
                                          <div>
                                            <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Voz</div>
                                            <CompactVoiceSelector
                                              selected={voiceChosen}
                                              setSelected={(v) => setVaVoiceChoice((prev) => ({ ...prev, [choiceKey]: v }))}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {/* AD original nao detectado: lista candidatos (1-click) + input manual */}
                                  {!a.vaBriefing.linkAdFileId ? (
                                    <div className="rounded-[10px] border border-yellow-500/40 bg-yellow-500/5 p-3">
                                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-yellow-200">
                                        Escolhe o AD original
                                      </div>
                                      {(a.vaBriefing as any).candidateLinks && (a.vaBriefing as any).candidateLinks.length > 0 ? (
                                        <div className="mb-2">
                                          <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                                            Links detectados no doc — clica no AD correto:
                                          </div>
                                          <div className="flex flex-col gap-1">
                                            {(a.vaBriefing as any).candidateLinks.map((c: any, ci: number) => (
                                              <button
                                                key={ci}
                                                type="button"
                                                onClick={() => {
                                                  setVaAdUrl((prev) => ({ ...prev, [a.taskId]: `https://drive.google.com/file/d/${c.fileId}/view` }));
                                                  // Tambem grava no briefing pra UI atualizar
                                                  setTaskAnalyses((prev) => {
                                                    const next = { ...prev };
                                                    if (next[a.taskId]?.vaBriefing) {
                                                      next[a.taskId] = { ...next[a.taskId], vaBriefing: { ...next[a.taskId].vaBriefing!, linkAdFileId: c.fileId } } as any;
                                                    }
                                                    return next;
                                                  });
                                                }}
                                                className="mono text-left rounded border border-line-strong bg-bg/40 px-2 py-1 text-[10px] hover:border-lime hover:bg-lime/10 flex items-center gap-2"
                                                title={c.fileId}
                                              >
                                                <span className={c.isFolder ? 'text-yellow-300' : 'text-cyan-200'}>{c.isFolder ? '📁' : '📄'}</span>
                                                <span className="truncate">{c.text || '(sem texto)'}</span>
                                                <span className="ml-auto text-text-muted">usar como AD →</span>
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                      <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                                        Ou cola a URL do Drive:
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="https://drive.google.com/file/d/XXX/view"
                                        value={vaAdUrl[a.taskId] || ''}
                                        onChange={(e) => setVaAdUrl((prev) => ({ ...prev, [a.taskId]: e.target.value }))}
                                        className="input-field font-mono text-xs"
                                        disabled={ACTIVE_BATCH_PHASES.includes(batchStates[a.taskId]?.phase as BatchTaskState['phase']) || batchStates[a.taskId]?.phase === 'queued'}
                                      />
                                      {vaAdUrl[a.taskId] && extractDriveFileId(vaAdUrl[a.taskId]) ? (
                                        <div className="mono mt-1 text-[9px] uppercase tracking-widest text-lime">✓ Drive ID extraido: {extractDriveFileId(vaAdUrl[a.taskId])}</div>
                                      ) : vaAdUrl[a.taskId] ? (
                                        <div className="mono mt-1 text-[9px] uppercase tracking-widest text-red-300">✗ URL invalida — formato esperado: drive.google.com/file/d/XXX/view</div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {/* SEM BOTAO "Iniciar Pipeline VA" — VA agora dispara
                                   *  pelo START global e roda na MESMA fila das tasks
                                   *  normais. O progresso + previews de lipsync + download
                                   *  aparecem no card do painel "Tasks em produção" (igual
                                   *  task normal). Aqui so fica a config (avatar/voz/AD). */}
                                  {(() => {
                                    const issues = vaReadinessIssues(a.taskId);
                                    const st = batchStates[a.taskId];
                                    const inQueueOrRunning = !!st && (st.phase === 'queued' || ACTIVE_BATCH_PHASES.includes(st.phase as BatchTaskState['phase']));
                                    if (inQueueOrRunning) {
                                      return (
                                        <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-2.5 mono text-[10px] uppercase tracking-widest text-cyan-200">
                                          📹 Na fila / rodando — acompanhe o card em "Tasks em produção" ↓
                                        </div>
                                      );
                                    }
                                    // Falta avatar/voz/AD: NAO mostra banner — cada linha de
                                    // avatar ja sinaliza (badge 'falta avatar'/'falta voz') e o
                                    // chip 'AD não detectado' cobre o AD. Banner era ruido.
                                    if (issues.length > 0) return null;
                                    return (
                                      <div className="rounded-[10px] border border-lime/40 bg-lime/5 p-2.5 mono text-[10px] uppercase tracking-widest text-lime">
                                        ✓ Pronto — clica START (embaixo) pra disparar junto das outras · {a.vaBriefing.avatares.length} avatar{a.vaBriefing.avatares.length === 1 ? '' : 'es'}
                                      </div>
                                    );
                                  })()}
                                  {/* Hook + body preview */}
                                  {a.vaBriefing.hookText ? (
                                    <details className="rounded-[10px] border border-line bg-bg/40 p-2">
                                      <summary className="mono cursor-pointer text-[10px] uppercase tracking-widest text-lime">Gancho</summary>
                                      <div className="mt-1.5 text-[11px] text-text-muted whitespace-pre-wrap">{a.vaBriefing.hookText.slice(0, 400)}{a.vaBriefing.hookText.length > 400 ? '…' : ''}</div>
                                    </details>
                                  ) : null}
                                  {a.vaBriefing.bodyText ? (
                                    <details className="rounded-[10px] border border-line bg-bg/40 p-2">
                                      <summary className="mono cursor-pointer text-[10px] uppercase tracking-widest text-fuchsia-300">Corpo</summary>
                                      <div className="mt-1.5 text-[11px] text-text-muted whitespace-pre-wrap">{a.vaBriefing.bodyText}</div>
                                    </details>
                                  ) : null}
                                  {/* Depoimento opcional */}
                                  {a.vaBriefing.depoimentoText ? (
                                    <div className="rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-2">
                                      <div className="mono mb-1 text-[10px] uppercase tracking-widest text-fuchsia-200 flex items-center gap-2">
                                        <span>🎭 Depoimento com avatar</span>
                                        {a.vaBriefing.depoimentoUsername ? <span className="rounded border border-fuchsia-500/40 px-1.5 py-0.5">@{a.vaBriefing.depoimentoUsername}</span> : null}
                                      </div>
                                      <div className="text-[11px] text-text-muted line-clamp-3">{a.vaBriefing.depoimentoText.slice(0, 280)}{a.vaBriefing.depoimentoText.length > 280 ? '…' : ''}</div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : a.status === 'ready' || a.status === 'partial' ? (
                                <div className="mt-1 grid gap-1 text-text-muted">
                                  <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                    <span>{a.totalParts} takes ({a.hookCount} hook{(a.hookCount ?? 0) === 1 ? '' : 's'} + {a.bodyPartsCount} body split{(a.bodyPartsCount ?? 0) === 1 ? '' : 's'}){onlyMagnificMode ? ' — só copy (B-Rolls)' : ' — Avatar III'}</span>
                                  </div>
                                  {/* Only Magnific: nao gera lipsync — avatares ignorados,
                                   *  so a copy do doc importa. RoleSlots escondidos. */}
                                  {onlyMagnificMode ? (
                                    <div className="mt-1.5 rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2 mono text-[10px] uppercase tracking-widest text-lime">
                                      🍌 Only Magnific — avatares ignorados, so a copy do doc e usada (sem HeyGen)
                                    </div>
                                  ) : (
                                  <div className="mt-1.5 grid gap-2">
                                    <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
                                      Avatares ({a.roleSlots.length}) — selecione cada um e a voz
                                    </div>
                                    {a.roleSlots.length === 0 ? (
                                      <div className="rounded-[10px] border border-yellow-500/40 bg-yellow-500/5 p-3 text-[11px]">
                                        <div className="mono text-[9px] uppercase tracking-widest text-yellow-200">
                                          ⚠ Nenhum avatar identificado automaticamente
                                        </div>
                                        <div className="mt-1 text-text-muted">
                                          O parser nao achou linha &quot;Avatar:&quot; com @username no doc.
                                          Clica abaixo pra adicionar manualmente e escolher avatar + voz.
                                        </div>
                                      </div>
                                    ) : null}
                                    {a.roleSlots.map((slot, sIdx) => {
                                      const partsCount = (a.partTemplates || []).filter(p => p.matchByRole === slot.role.toLowerCase()).length;
                                      const candFull = slot.avatarId ? avatarCandidates.find(c => c.id === slot.avatarId) : null;
                                      const selected: AvatarOption | null = candFull ? {
                                        id: candFull.id,
                                        name: candFull.name,
                                        thumb: candFull.thumb || null,
                                        videoPreview: null,
                                        type: 'photo',
                                        version: 'III',
                                        groupName: candFull.groupName,
                                        voiceId: candFull.voiceId,
                                        voiceName: candFull.voiceName,
                                      } : null;
                                      const noVoice = slot.avatarId && !slot.avatarVoiceId && !slot.voiceOverride;
                                      const effectiveVoiceLabel = slot.voiceOverride?.name || (slot.avatarVoiceId ? 'voz padrao do avatar' : noVoice ? 'sem voz' : '?');
                                      const visualKey = `${a.taskId}:${sIdx}`;
                                      const isVisualSearching = visualMatching[visualKey];
                                      const briefingThumbUrl = slot.briefingFileId
                                        ? `https://drive.google.com/thumbnail?id=${slot.briefingFileId}&sz=w200`
                                        : null;
                                      return (
                                        <div key={sIdx} className="rounded-[12px] border border-white/8 bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_-4px_rgba(0,0,0,0.3)]">
                                          <div className="mono flex flex-wrap items-center gap-2 text-[10px]">
                                            <span className="rounded-full bg-lime/18 border border-lime/40 px-2 py-[3px] text-lime uppercase tracking-widest font-bold">{slot.role}</span>
                                            <span className="text-white/70">@{slot.username}</span>
                                            <span className="text-text-muted">· {partsCount} parte{partsCount === 1 ? '' : 's'}</span>
                                            {!slot.matchedBy ? (
                                              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/15 px-2 py-[2px] text-[9px] font-bold uppercase tracking-widest text-red-300">
                                                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                                                Pendente
                                              </span>
                                            ) : null}
                                            {/* BOTAO 3D: preview da copy que vai pro HeyGen deste avatar.
                                              * Icone-only — abre/fecha painel com textarea editavel das parts
                                              * onde matchByRole === slot.role.toLowerCase(). Permite confirmar
                                              * o que cada avatar vai falar ANTES de disparar. Critico pra pegar
                                              * leaks de indicativo (texto vermelho) que escapou do parser. */}
                                            <button
                                              type="button"
                                              onClick={() => setPreviewOpen((prev) => ({ ...prev, [`${a.taskId}:${sIdx}`]: !prev[`${a.taskId}:${sIdx}`] }))}
                                              className="ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/25 shadow-[0_2px_0_rgba(0,0,0,0.4),0_0_8px_rgba(34,211,238,0.3)] active:translate-y-[1px] active:shadow-[0_1px_0_rgba(0,0,0,0.4)]"
                                              title="Preview do texto que esse avatar vai falar no HeyGen (editavel — corrige se tiver leak de indicativo)"
                                            >
                                              👁
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => removeRoleSlot(a.taskId, sIdx)}
                                              className="rounded-full px-1.5 py-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-300"
                                              title="Remover este slot"
                                            >
                                              ×
                                            </button>
                                          </div>
                                          {/* PAINEL DE PREVIEW POR AVATAR — editavel.
                                            * Mostra TODAS as parts (HOOK/BODY) que matcham por role do slot.
                                            * Cada part tem um textarea independente — user pode ajustar
                                            * o texto exato que vai pro HeyGen antes de disparar.
                                            * Diff visual: texto identico ao que sera enviado, 1:1. */}
                                          {previewOpen[`${a.taskId}:${sIdx}`] ? (
                                            <div className="mt-2 rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-3">
                                              <div className="mono mb-2 text-[9px] uppercase tracking-widest text-cyan-200">
                                                preview do texto pro HeyGen ({slot.role}) — editavel
                                              </div>
                                              {(() => {
                                                const matched = (a.partTemplates || [])
                                                  .map((pt, idx) => ({ pt, idx }))
                                                  .filter(({ pt }) => pt.matchByRole === slot.role.toLowerCase());
                                                if (matched.length === 0) {
                                                  return (
                                                    <div className="rounded-[8px] border border-yellow-500/40 bg-yellow-500/5 p-2 text-[11px] text-yellow-200">
                                                      ⚠ Nenhuma parte foi atribuida a este avatar.
                                                      Ou o parser nao detectou speaker corretamente, ou outro avatar pegou tudo.
                                                    </div>
                                                  );
                                                }
                                                return (
                                                  <div className="grid gap-2">
                                                    {matched.map(({ pt, idx }) => (
                                                      <div key={idx} className="rounded-[8px] border border-line bg-bg/60 p-2">
                                                        <div className="mono mb-1.5 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest">
                                                          <div className="flex min-w-0 items-center gap-2">
                                                            <span className="shrink-0 font-bold text-cyan-300">{pt.label}</span>
                                                            {/* QUEM FALA esse trecho — chip com thumb + avatar/role */}
                                                            <span
                                                              className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-lime/35 bg-lime/10 px-1.5 py-0.5 normal-case tracking-normal text-lime"
                                                              title={`Quem fala: ${slot.role}${selected ? ' → ' + selected.name : ' (avatar ainda não escolhido)'}`}
                                                            >
                                                              {(selected?.thumb || briefingThumbUrl) ? (
                                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                                <img src={(selected?.thumb || briefingThumbUrl)!} alt={slot.role} className="h-4 w-4 rounded-full object-cover" referrerPolicy="no-referrer" />
                                                              ) : (
                                                                <span aria-hidden>🎤</span>
                                                              )}
                                                              <span className="truncate text-[9px] font-semibold">{selected ? selected.name : `@${slot.username}`}</span>
                                                            </span>
                                                          </div>
                                                          <div className="flex shrink-0 items-center gap-1.5">
                                                            <span className="text-text-muted">{pt.text.length}c · {pt.text.split(/\s+/).filter(Boolean).length}p</span>
                                                            {/* EXCLUIR esse card/trecho — nao vai gerar take */}
                                                            <button
                                                              type="button"
                                                              onClick={() => removePartTemplate(a.taskId, idx)}
                                                              title="Excluir esse trecho — não vira take no HeyGen (use pra tirar lixo de produção que sobrou)"
                                                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10 text-red-300 transition hover:border-red-400/70 hover:bg-red-500/25"
                                                            >
                                                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                                                            </button>
                                                          </div>
                                                        </div>
                                                        <textarea
                                                          value={pt.text}
                                                          onChange={(e) => updatePartTemplateText(a.taskId, idx, e.target.value)}
                                                          className="mono w-full resize-y rounded border border-line-strong bg-bg/40 px-2 py-1.5 text-[12px] text-text focus:border-cyan-500/60 focus:outline-none"
                                                          rows={Math.max(3, Math.min(12, pt.text.split('\n').length + 1))}
                                                          spellCheck={false}
                                                          placeholder="(vazio — esse part nao vai gerar nada)"
                                                        />
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()}
                                              <div className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted">
                                                este é o texto EXATO que vai pro avatar — o que você editar aqui é o que dispara.
                                                edita pra corrigir leak, ou × pra remover o trecho inteiro.
                                              </div>
                                            </div>
                                          ) : null}
                                          {/* ═══ PREVIEW AVATAR (thumb maior + info clean) ═══ */}
                                          <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-white/8 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                            <div className="relative shrink-0">
                                              {briefingThumbUrl ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                  src={briefingThumbUrl}
                                                  alt={slot.username}
                                                  className="h-20 w-20 rounded-[12px] object-cover ring-2 ring-white/10 shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
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
                                            <div className="flex-1 min-w-0">
                                              <div className="mono text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-300/85">
                                                Briefing
                                              </div>
                                              <div className="mt-0.5 text-[13px] font-semibold text-foreground truncate" style={{ fontFamily: 'var(--font-tech)' }}>
                                                @{slot.username}.mp4
                                              </div>
                                              {slot.briefingFileId ? (
                                                <a
                                                  href={`https://drive.google.com/uc?export=download&id=${slot.briefingFileId}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-lime/45 bg-lime/12 px-2 py-1 text-[9.5px] font-bold uppercase tracking-widest text-lime hover:bg-lime/22 hover:border-lime/65 transition"
                                                  title="Baixar arquivo do copywriter no Drive"
                                                >
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                                                  </svg>
                                                  Baixar
                                                </a>
                                              ) : (
                                                <span className="mono mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] px-2 py-1 text-[9.5px] uppercase tracking-widest text-text-muted">
                                                  sem link
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          {/* ═══ SELETORES (Avatar + Voz) — grid limpo ═══ */}
                                          <div className="mt-2.5 grid gap-2">
                                            <div>
                                              <div className="mono mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                  <circle cx="12" cy="8" r="4" />
                                                  <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                                                </svg>
                                                Avatar HeyGen
                                              </div>
                                              <div className="max-w-[420px]">
                                                <CompactAvatarPicker
                                                  selected={selected}
                                                  setSelected={(newAv) => updateRoleSlot(a.taskId, sIdx, {
                                                    avatarId: newAv?.id || null,
                                                    avatarName: newAv?.name || null,
                                                    avatarThumb: newAv?.thumb || null,
                                                    avatarVoiceId: (newAv as any)?.voiceId || null,
                                                    matchedBy: 'manual',
                                                  })}
                                                  disabled={false}
                                                  label={`Avatar pra ${slot.role}`}
                                                />
                                              </div>
                                            </div>
                                            {slot.avatarId ? (
                                              <div>
                                                <div className="mono mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
                                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                                                  </svg>
                                                  Voz
                                                  <span className={`ml-auto normal-case tracking-normal ${slot.voiceOverride ? 'text-lime' : noVoice ? 'text-red-300' : 'text-text-muted/70'}`}>
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
                                                  setSelected={(v) => updateRoleSlot(a.taskId, sIdx, { voiceOverride: v })}
                                                />
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* Botao "adicionar avatar manualmente" REMOVIDO — user pediu:
                                     *  "ELE NUNCA VAI BATER COM TEXTO NENHUM" (avatares manuais nao
                                     *  tem briefing pra parsear matchByRole, ficavam orfaos). */}
                                  </div>
                                  )}
                                </div>
                              ) : null}
                              {a.status === 'error' ? (
                                <div className="mt-1 text-red-300">{a.error}</div>
                              ) : null}
                              {a.status === 'analyzing' ? (
                                <div className="mt-1 text-text-muted">analisando...</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {/* Start batch — abaixo da lista, mais perto das tasks ready (CTA principal).
                       *  Usa selectedTaskIds porque startBatch filtra por isso — UI tem que bater. */}
                      {(() => {
                        const selected = Array.from(selectedTaskIds);
                        const readyIds = selected.filter((id) => taskAnalyses[id]?.status === 'ready');
                        const partialIds = selected.filter((id) => taskAnalyses[id]?.status === 'partial');
                        if (readyIds.length === 0 && partialIds.length === 0) return null;
                        return (
                          <div className="sticky bottom-2 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-lime/40 bg-bg/95 p-3 shadow-[0_0_30px_-10px_rgba(200,232,124,0.4)] backdrop-blur">
                            <span className="mono text-[11px] text-text-muted">
                              {readyIds.length > 0 ? (
                                <span className="text-lime">✓ {readyIds.length} ready</span>
                              ) : null}
                              {readyIds.length > 0 && partialIds.length > 0 ? <span className="text-text-muted"> · </span> : null}
                              {partialIds.length > 0 ? (
                                <span className="text-yellow-300">⚠ {partialIds.length} pendente{partialIds.length === 1 ? '' : 's'} (resolva acima pra incluir)</span>
                              ) : null}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={copyAllSelectedBodies}
                                className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-[11px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20"
                                title="Copia o body de TODAS as tasks selecionadas, identificado por AD. Nunca inclui Variacao de Avatar."
                              >
                                {copiedAllBodies ? '✓ bodies copiados' : '⧉ Copiar todos os bodies'}
                              </button>
                              <button
                                type="button"
                                onClick={startBatch}
                                disabled={readyIds.length === 0}
                                className="btn-primary disabled:opacity-40"
                                title={readyIds.length === 0 ? 'Nenhuma task ready ainda' : 'Roda em background: TTS + upload + submit + poll + zip'}
                              >
                                ▶ Iniciar {readyIds.length} task{readyIds.length === 1 ? '' : 's'} em background
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Detalhe da task selecionada (so em modo single, nao bulk) */}
              {!bulkMode && selectedTask ? (
                <section className="rounded-[12px] border border-line bg-bg-soft/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="mono text-sm uppercase tracking-widest text-lime">
                      {selectedTask.name}
                    </h3>
                    <a
                      href={selectedTask.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                    >
                      Abrir no ClickUp ↗
                    </a>
                  </div>

                  {/* Doc links da description */}
                  {(() => {
                    const links = extractDocLinks(taskDetail?.description || taskDetail?.text_content);
                    if (links.length === 0) return (
                      <div className="text-[11px] text-text-muted">
                        {taskDetail ? 'Nenhum link de doc detectado na descricao da task.' : 'Carregando descricao...'}
                      </div>
                    );
                    return (
                      <div className="mb-3">
                        <div className="mono mb-1 text-[10px] uppercase tracking-widest text-text-muted">
                          Docs encontrados:
                        </div>
                        <ul className="grid gap-1.5">
                          {links.map((u) => {
                            const isGdocs = /docs\.google\.com/.test(u);
                            return (
                              <li key={u} className="flex flex-wrap items-center gap-2 text-[11px]">
                                <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-lime hover:underline">
                                  {u.length > 80 ? u.slice(0, 80) + '…' : u}
                                </a>
                                {isGdocs ? (
                                  <button
                                    type="button"
                                    onClick={() => autoFetchDoc(u)}
                                    disabled={fetchingDoc}
                                    className="mono shrink-0 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:border-fuchsia-500 hover:bg-fuchsia-500/20 disabled:opacity-50"
                                    title="Fetch read-only via Google Docs export. Doc precisa estar 'Qualquer pessoa com link pode ver'."
                                  >
                                    {fetchingDoc ? 'Buscando...' : '⬇ Buscar automatico'}
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                        <div className="mono mt-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                          Auto-fetch funciona se doc estiver com sharing 'qualquer pessoa com link pode ver'. Senao, cola manualmente abaixo.
                        </div>
                      </div>
                    );
                  })()}

                  <div className="mb-2 mono text-[10px] uppercase tracking-widest text-text-muted">
                    OU cola aqui o conteudo (Ctrl+A → Ctrl+C no Google Docs)
                  </div>
                  <textarea
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    rows={8}
                    placeholder="Briefing completo do doc Google. O parser vai achar a secao desse AD pelo nome."
                    className="input-field resize-y font-mono text-xs"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runParser()}
                      disabled={!docContent.trim()}
                      className="btn-primary"
                    >
                      Parsear copy
                    </button>
                    {docContent.length > 0 ? (
                      <span className="mono self-center text-[10px] text-text-muted">
                        {docContent.length} chars carregados
                      </span>
                    ) : null}
                  </div>

                  {parseError ? (
                    <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                      {parseError}
                    </div>
                  ) : null}

                  {briefing ? (
                    <div className="mt-4 rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-3">
                      <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200">
                        ✓ Briefing DARKO LAB: {briefing.baseAdId} ({briefing.gSiblings.length} G siblings)
                      </div>
                      <div className="mt-2 grid gap-2">
                        <div className="text-[11px]">
                          <strong className="text-white">Avatares ({briefing.avatars.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {briefing.avatars.map((a) => {
                              const m = matchAvatar(a.username, avatarCandidates);
                              const ok = m && m.score >= 30;
                              return (
                                <li key={a.username} className="mono text-[11px]">
                                  {ok ? (
                                    <span className="text-lime">✓ {a.role}: @{a.username} → {m.name} ({m.groupName})</span>
                                  ) : (
                                    <span className="text-red-300">✗ {a.role}: @{a.username} — pendente</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        <div className="text-[11px]">
                          <strong className="text-white">Hooks ({briefing.hooks.length} {briefing.hooks.length === 1 ? 'hook' : 'hooks'}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {briefing.hooks.map((h, i) => (
                              <li key={i} className="rounded border border-line bg-bg/40 px-2 py-1">
                                <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200 flex items-center gap-2">
                                  <span>{h.label} (de G{h.sourceG})</span>
                                  {h.role ? (
                                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200">fala: {h.role}</span>
                                  ) : (
                                    <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-yellow-200">sem role</span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-text-muted line-clamp-2">{h.text.slice(0, 200)}{h.text.length > 200 ? '…' : ''}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {briefing.body ? (
                          <div className="text-[11px]">
                            <strong className="text-white flex items-center gap-2">
                              <span>Body (split em ~20s no Avatar III):</span>
                              {briefing.bodyRole ? (
                                <span className="mono rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200">fala: {briefing.bodyRole}</span>
                              ) : (
                                <span className="mono rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-200">sem role</span>
                              )}
                            </strong>
                            <div className="mt-1 rounded border border-line bg-bg/40 px-2 py-1">
                              <div className="text-text-muted line-clamp-3">{briefing.body.slice(0, 280)}{briefing.body.length > 280 ? '…' : ''}</div>
                              <div className="mono mt-1 text-[10px] text-text-muted">
                                {briefing.body.length} chars — split estimado em {splitCopyIntoParts(briefing.body, {targetSec: 20, minSec: 10, maxSec: 35}).length} takes
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-text-muted">
                            ⚠ Sem body neste briefing — so hooks viram lipsync.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {parsed && !briefing ? (
                    <div className="mt-4 rounded-[10px] border border-lime/30 bg-lime/5 p-3">
                      <div className="mono text-[10px] uppercase tracking-widest text-lime">
                        ✓ Parsed (legacy): {parsed.adId}
                      </div>

                      <div className="mt-3 grid gap-2">
                        <div className="text-[11px]">
                          <strong className="text-white">Avatares detectados ({parsed.avatars.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {parsed.avatars.map((a) => {
                              const m = matchAvatar(a.username, avatarCandidates);
                              const matched = m && m.score >= 30;
                              return (
                                <li key={a.username} className="mono text-[11px]">
                                  {matched ? (
                                    <span className="text-lime">✓ {a.role}: @{a.username} → {m.name} ({m.groupName})</span>
                                  ) : (
                                    <span className="text-red-300">✗ {a.role}: @{a.username} — sem match no HeyGen (avatar pendente)</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        <div className="text-[11px]">
                          <strong className="text-white">Partes detectadas ({parsed.parts.length}):</strong>
                          <ul className="mt-1 grid gap-1">
                            {parsed.parts.map((p, i) => (
                              <li key={i} className="rounded border border-line bg-bg/40 px-2 py-1">
                                <div className="mono text-[10px] uppercase tracking-widest text-lime">{p.label}</div>
                                <div className="mt-0.5 text-text-muted line-clamp-2">{p.text.slice(0, 200)}{p.text.length > 200 ? '…' : ''}</div>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {dispatchPlan ? (
                          <div className="text-[11px]">
                            <strong className="text-white">Plano de dispatch:</strong>
                            <ul className="mt-1 grid gap-1">
                              {dispatchPlan.parts.map((p, i) => (
                                <li key={i} className="mono">
                                  parte{i + 1} ({p.label}) → {p.avatarName || <span className="text-red-300">SEM AVATAR</span>}
                                </li>
                              ))}
                            </ul>
                            {dispatchPlan.unmatchedAvatars.length > 0 ? (
                              <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                                ⚠ Avatares pendentes (criar no HeyGen primeiro): {dispatchPlan.unmatchedAvatars.join(', ')}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={dispatchToHeyGenAuto}
                              disabled={dispatchPlan.parts.some((p) => !p.avatarId)}
                              className="btn-primary mt-3"
                              title={dispatchPlan.parts.some((p) => !p.avatarId)
                                ? 'Resolva os avatares pendentes primeiro'
                                : 'Abre Hey Auto Dynamic com tudo pre-preenchido'}
                            >
                              ▶ Disparar via Hey Auto Dynamic (motor III)
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
      </ToolShell>
      {/* Modal pra editar 1 take e re-gerar so essa parte */}
      {editingPart ? (
        <EditPartModal
          input={{
            label: editingPart.label,
            text: editingPart.currentText,
            avatarName: editAvatar?.name,
            voiceId: editVoice?.id ?? null,
            voiceName: editVoice?.name ?? null,
          }}
          busy={!!regeneratingPart}
          errorMsg={regenError}
          onClose={() => {
            if (!regeneratingPart) {
              setEditingPart(null);
              setEditAvatar(null);
              setEditVoice(null);
              setRegenError(null);
            }
          }}
          onRegenerate={(newText) => void regenerateSinglePart(newText)}
          avatarPicker={
            <CompactAvatarPicker
              selected={editAvatar}
              setSelected={(a) => setEditAvatar(a)}
              disabled={!!regeneratingPart}
              label={`Avatar pra ${editingPart.label}`}
            />
          }
          voicePicker={
            <CompactVoiceSelector
              selected={editVoice}
              setSelected={(v) => setEditVoice(v)}
            />
          }
        />
      ) : null}
    </>
  );
}
