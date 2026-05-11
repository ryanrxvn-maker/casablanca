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
  getCurrentUser,
  extractDocLinks,
  type ClickUpTeam,
  type ClickUpTask,
  type ClickUpUser,
} from '@/lib/clickup-client';
import {
  parseAdSection,
  parseDarkoBriefing,
  matchAvatar,
  type ParsedAdSection,
  type ParsedDarkoBriefing,
} from '@/lib/copy-parser';
import { splitCopyIntoParts, cloneVoiceViaExtension } from '@/lib/heygen-extension-bridge';
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
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
import { CompactVoiceSelector } from '@/components/CompactVoiceSelector';
import type { AvatarOption } from '@/components/HeyGenAvatarPicker';
import { recallByVoiceName, rememberPairing, normalizeVoiceName } from '@/lib/voice-avatar-memory';
import { Toggle3D } from '@/components/Toggle3D';
import { getPilotTeam, setPilotTeam, getPilotEditor, setPilotEditor } from '@/lib/clickup-pilot-config';
import { runPostPipeline } from '@/lib/clickup-pilot-pipeline';

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
  /** queued | dispatching | rendering | downloading | post (concat+decupagem+camo) | done | failed */
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
  /** Per-part status durante dispatch (parteN: error|null) */
  parts: Array<{ label: string; videoId: string | null; videoStatus?: VideoStatus['status']; error?: string | null; renamedTo: string }>;
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
  error?: string;
  /** Quando disparou pra HeyGen (timestamp) — null se ainda nao */
  dispatchedAt?: number | null;
};

export default function ClickUpPilotPage() {
  const router = useRouter();

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
  /** Audio WHITE pra camuflagem (file blob nao persiste — volta toda sessao) */
  const [camuflagemWhite, setCamuflagemWhite] = useState<File | null>(null);
  const [camuflagemVolume, setCamuflagemVolume] = useToolState<number>('clickup-pilot:camuflagemVolume', 30);

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
  const [analyzing, setAnalyzing] = useState(false);

  function toggleTaskSelected(id: string) {
    setSelectedTaskIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
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

  /** Resolve username pra Drive file ID pesquisando driveLinks por match de texto.
   *  '@marcella.malvar2' procura link cujo texto contem 'marcella.malvar2.mp4'. */
  function resolveVideoFileId(username: string, driveLinks: Array<{ text: string; fileId: string }> | undefined): string | null {
    if (!driveLinks || driveLinks.length === 0) return null;
    const u = username.toLowerCase().replace(/^@/, '').replace(/\.mp4$|\.mov$/, '');
    for (const link of driveLinks) {
      const t = link.text.toLowerCase();
      if (t.includes(u)) return link.fileId;
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
    const targets = tasks.filter((t) => selectedTaskIds.has(t.id));
    // Init status pendente pra todos
    setTaskAnalyses(() => {
      const init: Record<string, TaskAnalysis> = {};
      for (const t of targets) {
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
          const docField = (det.custom_fields || ([] as any[])).find((f: any) => /DOC DA COPY/i.test(f.name || ''));
          const docUrl = docField?.value || extractDocLinks(det.description || det.text_content)[0];
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
          // 3. Parse: encontra base AD ID + briefing
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
              roleSlots.push({
                role: av.role,
                username: av.username,
                briefingFileId,
                avatarId: m.id,
                avatarName: m.name,
                avatarThumb: candFull?.thumb || null,
                avatarVoiceId: candFull?.voiceId || null,
                // Se avatar nao tem voz default mas existe voz "@x" na lib, usa como override
                voiceOverride: !candFull?.voiceId && voiceFromLib ? voiceFromLib : null,
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
                roleSlots.push({
                  role: av.role,
                  username: av.username,
                  briefingFileId,
                  avatarId: recalled.avatarId,
                  avatarName: recalled.avatarName,
                  avatarThumb: candFull.thumb || null,
                  avatarVoiceId: recalled.voiceId,
                  voiceOverride: null,
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
          const bodyParts = briefing.body ? splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 }) : [];
          bodyParts.forEach((bp, i) => {
            const label = bodyParts.length === 1 ? 'BODY' : `BODY ${i + 1}`;
            // Todas as parts do body herdam o mesmo bodyRole (split nao muda speaker)
            partTemplates.push({ label, text: bp, matchByRole: pickRoleForText(bp, label, briefing.bodyRole) });
          });
          const allHaveAvatar = roleSlots.every((s) => s.avatarId);
          setTaskAnalyses((prev) => ({
            ...prev,
            [task.id]: {
              ...prev[task.id],
              status: allHaveAvatar ? 'ready' : 'partial',
              baseAdId,
              hookCount: briefing.hooks.length,
              bodyPartsCount: bodyParts.length,
              totalParts: partTemplates.length,
              roleSlots,
              partTemplates,
              dispatchedAt: getDispatchedAt(task.id),
            },
          }));
        } catch (e) {
          setTaskAnalyses((prev) => ({ ...prev, [task.id]: { ...prev[task.id], status: 'error', error: (e as Error)?.message || 'erro' } }));
        }
      }
    }
    const workers = Array.from({ length: PARALLEL }, () => worker());
    await Promise.all(workers);
    // IA Search MODE: roda visual match auto pra todo slot pendente que tem briefingFileId
    if (iaSearchMode && hasAnthropic !== false) {
      setAnalyzing(false);
      // Coleta tasks que sobraram com pendentes
      const targetIds = targets.map((t) => t.id);
      for (const taskId of targetIds) {
        await runVisualMatchAllPendingForTask(taskId);
      }
      return;
    }
    setAnalyzing(false);
  }

  /** Batch state — tasks rodando em background (dispatch + poll + download + zip) */
  const [batchStates, setBatchStates] = useState<Record<string, BatchTaskState>>({});
  const batchCancelRef = useRef<Record<string, boolean>>({});

  /** Restore persisted batch states no mount. Marca como "interrompido" qualquer
   *  batch que estava rodando — videos podem ja ter renderizado no HeyGen.
   *  Mostra botao "Retomar" pra re-poll + download. */
  useEffect(() => {
    const persisted = loadPersistedBatchStates() as Record<string, BatchTaskState>;
    if (Object.keys(persisted).length === 0) return;
    const restored: Record<string, BatchTaskState> = {};
    for (const [taskId, state] of Object.entries(persisted)) {
      const wasRunning = state.phase !== 'done' && state.phase !== 'failed';
      restored[taskId] = wasRunning
        ? { ...state, phase: 'failed', message: '⚠ Pagina foi recarregada durante o run. Click Retomar pra re-checar status no HeyGen.' }
        : state;
    }
    setBatchStates(restored);
  }, []);

  /** Persist batchStates a cada mudanca pra sobreviver reload. */
  useEffect(() => {
    persistBatchStates(batchStates);
  }, [batchStates]);

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
    if (!a) return;
    const plan = buildPlan(a);
    if (!plan) return;
    const partsLen = plan.parts.length;
    const adNameClean = (a.baseAdId || a.taskName).replace(/[^A-Z0-9]/gi, '_');

    // Re-run da mesma task: revoga blob URLs antigos pra nao vazar memoria
    for (const url of [batchStates[taskId]?.zipBlobUrl, batchStates[taskId]?.montadoZipUrl, batchStates[taskId]?.camufladoZipUrl]) {
      if (url) { try { URL.revokeObjectURL(url); } catch {} }
    }
    // Limpa flag de cancel de runs anteriores
    batchCancelRef.current[taskId] = false;

    setBatchStates((prev) => ({
      ...prev,
      [taskId]: {
        taskId, taskName: a.taskName, baseAdId: a.baseAdId || a.taskName,
        phase: 'dispatching',
        parts: plan.parts.map((p: any) => ({ label: p.label, videoId: null, renamedTo: labelToFilename(p.label) })),
        startedAt: Date.now(),
        message: 'TTS + upload + submit por parte...',
      },
    }));

    try {
      // 1. Dispatch via runHeyGenJobs (re-usa toda logica do HeyGen Auto runner)
      const jobs = plan.parts.map((p: any) => ({
        label: p.label,
        copy: p.text,
        avatarId: p.avatarId!,
        voiceId: p.voiceId,
      }));
      const results = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode: 'copy',
        avatarId: plan.parts[0]?.avatarId || '',
        voiceId: undefined,
        motor: 'III',
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

      markDispatched(taskId);

      // 2. Poll status ate todos prontos (ou alguns falharem)
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'rendering', message: `Aguardando renderizacao no HeyGen (${validIds.length} videos)...` } }));
      const finalStatuses = await pollVideosUntilReady(validIds, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onStatus: (st) => {
          const done = Object.values(st).filter((s) => s.status === 'completed').length;
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p) => {
              const ps = p.videoId ? st[p.videoId] : null;
              return ps ? { ...p, videoStatus: ps.status } : p;
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
          partBlobs[i] = { label: part.label, blob: new Blob([bytes as BlobPart], { type: 'video/mp4' }) };
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
        pipeRes = await runPostPipeline({
          baseAdId: a.baseAdId || a.taskName,
          parts: partBlobs,
          decupagem: true,
          camuflagem: camuflagemMode,
          whiteAudio: camuflagemMode ? camuflagemWhite : null,
          camuflagemVolume,
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
        montadoName = `${adNameClean}_montado_decupado.zip`;
        montadoUrl = URL.createObjectURL(blob2);
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
      }

      const totalSize = takesBlob.size + (montadoUrl ? assembled.reduce((n, it) => n + (it.decupado?.size || it.rawAssembled?.size || 0), 0) : 0);
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
    const validParts = state.parts.filter((p) => p.videoId);
    if (validParts.length === 0) {
      setError('Sem videoIds salvos pra retomar — task tem que ser disparada do zero.');
      return;
    }
    batchCancelRef.current[taskId] = false;
    const adNameClean = state.baseAdId.replace(/[^A-Z0-9]/gi, '_');
    const validIds = validParts.map((p) => p.videoId!);

    setBatchStates((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], phase: 'rendering', message: `Re-checando status de ${validIds.length} videos no HeyGen...`, finishedAt: undefined },
    }));

    try {
      const finalStatuses = await pollVideosUntilReady(validIds, {
        intervalMs: 8000,
        timeoutMs: 30 * 60 * 1000,
        isCancelled: () => !!batchCancelRef.current[taskId],
        onStatus: (st) => {
          const done = Object.values(st).filter((s) => s.status === 'completed').length;
          setBatchStates((prev) => {
            const s = prev[taskId];
            if (!s) return prev;
            const newParts = s.parts.map((p) => {
              const ps = p.videoId ? st[p.videoId] : null;
              return ps ? { ...p, videoStatus: ps.status } : p;
            });
            return { ...prev, [taskId]: { ...s, parts: newParts, message: `Renderizando: ${done}/${validIds.length} prontos` } };
          });
        },
      });

      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Baixando + zipando ${validIds.length} videos...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let downloaded = 0;
      const downloadOne = async (idx: number) => {
        if (batchCancelRef.current[taskId]) return;
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

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const filename = `${adNameClean}.zip`;
      const url = URL.createObjectURL(blob);
      setBatchStates((prev) => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          phase: 'done',
          message: `Pronto: ${downloaded}/${validIds.length} videos · ${(blob.size / (1024 * 1024)).toFixed(1)}MB`,
          finishedAt: Date.now(),
          zipBlobUrl: url,
          zipFilename: filename,
        },
      }));
    } catch (e) {
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: `Retomar falhou: ${(e as Error)?.message || 'erro'}`, finishedAt: Date.now() } }));
    }
  }

  /** Inicia batch: filtra tasks selecionadas que estao 'ready' + roda em
   *  paralelo (max 2 simultaneas pra nao saturar HeyGen) */
  async function startBatch() {
    const ready = Array.from(selectedTaskIds).filter((id) => taskAnalyses[id]?.status === 'ready');
    if (ready.length === 0) {
      setError('Nenhuma task ready selecionada. Confira que avatares + voz estao OK.');
      return;
    }
    setError(null);
    // Dispara em paralelo (max 2 — cada uma usa 3 workers internos)
    const queue = [...ready];
    const PARALLEL = 2;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < PARALLEL; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const taskId = queue.shift()!;
          await runTaskInBackground(taskId);
        }
      })());
    }
    await Promise.all(workers);
  }

  function cancelTaskBatch(taskId: string) {
    batchCancelRef.current[taskId] = true;
  }

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
      const newSlots = a.roleSlots.map((s, i) => i === roleIdx ? { ...s, ...patch } : s);
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
    const plan = buildPlan(a);
    if (!plan || plan.parts.some((p: any) => !p.avatarId)) {
      setError(`Tem avatar sem selecionar. Click no slot e escolhe.`);
      return;
    }
    // Se ja foi disparada antes, confirma
    if (a.dispatchedAt) {
      const when = new Date(a.dispatchedAt).toLocaleString('pt-BR');
      if (!confirm(`Esta task foi disparada antes em ${when}.\n\nVai disparar de novo? (vai criar mais ${plan.parts.length} videos no HeyGen)`)) {
        return;
      }
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
    markDispatched(taskId);
    setTaskAnalyses(prev => ({ ...prev, [taskId]: { ...prev[taskId], dispatchedAt: Date.now() } }));
    router.push('/tools/heygen-auto?from=clickup-pilot');
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
      if (briefing.body) {
        // Split do body em parts ~20s no Avatar III (todas herdam bodyRole)
        const bodyParts = splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 });
        bodyParts.forEach((bp, i) => {
          const label = bodyParts.length === 1 ? 'BODY' : `BODY ${i + 1}`;
          const av = pickAvatarForText(bp, label, briefing.bodyRole);
          planParts.push({
            label,
            text: bp,
            avatarId: av?.id || null,
            avatarName: av?.name || null,
          });
        });
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
        `Alguns avatares nao foram encontrados no HeyGen: ${dispatchPlan.unmatchedAvatars.join(', ')}. Cria eles primeiro OU edita manualmente no HeyGen Auto.`,
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

  /** Dispara clone de voz pro slot. Aceita audio (mp3/wav) ou video.
   *  No ready: seta voiceOverride no slot e adiciona voz na library cache. */
  async function handleCloneVoiceForSlot(taskId: string, sIdx: number, file: File) {
    const key = `${taskId}:${sIdx}`;
    setCloningVoice((prev) => ({ ...prev, [key]: { stage: 'starting', percent: 0, message: 'Iniciando...' } }));
    try {
      const res = await cloneVoiceViaExtension(file, {
        removeBackgroundNoise: true,
        removeBackgroundMusic: true,
        onProgress: (stage, percent, message) => {
          setCloningVoice((prev) => ({
            ...prev,
            [key]: { stage, percent: percent ?? prev[key]?.percent ?? 0, message: message || '' },
          }));
        },
      });
      if (!res.ok) {
        setError(`Falha ao clonar voz: ${res.error}`);
        setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
        return;
      }
      // Sucesso — seta voiceOverride no slot + recarrega biblioteca pra cache atualizar
      updateRoleSlot(taskId, sIdx, { voiceOverride: { id: res.voiceId, name: res.voiceName } });
      // Recarrega lista de avatares/vozes (cache) — voz nova aparece pro user
      reloadLibrary().catch(() => {});
      setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
    } catch (e) {
      setError(`Falha ao clonar voz: ${(e as Error)?.message || 'erro desconhecido'}`);
      setCloningVoice((prev) => { const c = { ...prev }; delete c[key]; return c; });
    }
  }

  return (
    <>
      <ToolShell
        title="ClickUp Pilot"
        description="Cerebro de automacao: le suas tasks no ClickUp, identifica avatares + copy do briefing, e dispara lipsync no HeyGen Auto Dynamic. Motor III sempre (sem custo de creditos)."
      >
          {/* Setup status — todo o config (token + workspace + editor + status filter)
           *  fica em /configuracoes/clickup-pilot. Aqui so mostramos um chip status. */}
          {(() => {
            const setupOK = hasToken && selectedTeam && selectedEditor;
            if (setupOK) {
              return (
                <div className="mb-5 flex items-center justify-between rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-2 text-xs">
                  <span className="text-lime">
                    ✓ Setup OK
                    <span className="ml-2 text-text-muted">
                      · {currentTeam?.name || '?'} · {editors.find(u => String(u.id) === selectedEditor)?.username || authUser?.username || '?'}
                    </span>
                  </span>
                  <a
                    href="/configuracoes/clickup-pilot"
                    className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                  >
                    Configurar
                  </a>
                </div>
              );
            }
            return (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-xs">
                <span className="text-fuchsia-200">
                  ⚙ Configure ClickUp Pilot pra comecar — {!hasToken ? 'falta token' : 'falta workspace/editor'}
                </span>
                <a href="/configuracoes/clickup-pilot" className="btn-primary !py-1 !px-3 !text-xs">
                  Ir pras configuracoes →
                </a>
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
              <section>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle3D
                    on={iaSearchMode}
                    onChange={setIaSearchMode}
                    label="IA Search"
                    hint={hasAnthropic === false ? 'Falta chave Anthropic' : 'Vision pra avatares pendentes'}
                    variant="cyan"
                    icon={<span className="text-base">🤖</span>}
                  />
                  <Toggle3D
                    on={camuflagemMode}
                    onChange={setCamuflagemMode}
                    label="Camuflagem"
                    hint="Gera 3a pasta com audio camuflado"
                    variant="fuchsia"
                    icon={<span className="text-base">🎭</span>}
                  />
                </div>

                {/* Camuflagem inputs — so quando ON */}
                {camuflagemMode ? (
                  <div className="mt-3 rounded-[12px] border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
                    <div className="mono mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                      Audio WHITE pra camuflagem
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_140px] items-center">
                      <input
                        type="file"
                        accept="audio/*,video/*"
                        onChange={(e) => setCamuflagemWhite(e.target.files?.[0] || null)}
                        className="input-field text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={camuflagemVolume}
                          onChange={(e) => setCamuflagemVolume(Number(e.target.value))}
                          className="flex-1 accent-fuchsia-400"
                        />
                        <span className="mono w-10 text-right text-[11px] text-fuchsia-200">{camuflagemVolume}%</span>
                      </div>
                    </div>
                    <p className="mono mt-2 text-[9px] uppercase tracking-widest text-text-muted">
                      Aceita audio (mp3/wav) OU video (extrai audio). Volume = % do nivel padrao.
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={loadTasks}
                    disabled={loadingTasks}
                    className="btn-primary"
                  >
                    {loadingTasks ? 'Carregando...' : 'Carregar tasks'}
                  </button>
                  <a href="/configuracoes/clickup-pilot" className="mono text-[10px] uppercase tracking-widest text-text-muted hover:text-lime">
                    Configurar workspace, editor e filtros →
                  </a>
                </div>
              </section>

              {/* Lista de tasks */}
              {tasks.length > 0 ? (
                <section>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="label-field !mb-0">Tasks ({tasks.length})</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="mono flex cursor-pointer items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-muted">
                        <input
                          type="checkbox"
                          checked={bulkMode}
                          onChange={(e) => { setBulkMode(e.target.checked); if (!e.target.checked) clearSelected(); }}
                          className="h-3.5 w-3.5 cursor-pointer accent-fuchsia-400"
                        />
                        Modo BATCH
                      </label>
                      {bulkMode ? (
                        <>
                          <button
                            type="button"
                            onClick={selectAllTasks}
                            className="mono rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                          >
                            Selecionar todas
                          </button>
                          <button
                            type="button"
                            onClick={clearSelected}
                            disabled={selectedTaskIds.size === 0}
                            className="mono rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
                          >
                            Limpar
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <ul className="grid gap-2">
                    {tasks.map((t) => {
                      const isOpen = !bulkMode && selectedTask?.id === t.id;
                      const isChecked = bulkMode && selectedTaskIds.has(t.id);
                      return (
                        <li key={t.id} className="flex items-center gap-2">
                          {bulkMode ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleTaskSelected(t.id)}
                              className="h-4 w-4 shrink-0 cursor-pointer accent-fuchsia-400"
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => bulkMode ? toggleTaskSelected(t.id) : openTask(t)}
                            className={
                              'flex-1 rounded-[10px] border px-3 py-2 text-left text-sm transition ' +
                              (isOpen || isChecked
                                ? 'border-lime bg-lime/10'
                                : 'border-line bg-bg-soft/40 hover:border-lime/60')
                            }
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="mono text-xs text-lime">{t.name}</span>
                              <span
                                className="mono rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest"
                                style={{ backgroundColor: t.status?.color + '33', color: t.status?.color }}
                              >
                                {t.status?.status}
                              </span>
                            </div>
                            {t.list?.name ? (
                              <div className="mono mt-0.5 text-[10px] text-text-muted">
                                {t.space?.name ? `${t.space.name} / ` : ''}
                                {t.folder?.name ? `${t.folder.name} / ` : ''}
                                {t.list.name}
                              </div>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {bulkMode && selectedTaskIds.size > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-fuchsia-500/40 bg-fuchsia-500/10 p-3">
                      <span className="mono flex-1 text-[11px] text-fuchsia-200">
                        ⚙ {selectedTaskIds.size} selecionada{selectedTaskIds.size === 1 ? '' : 's'}
                        {(() => {
                          const ready = Array.from(selectedTaskIds).filter(id => taskAnalyses[id]?.status === 'ready').length;
                          return ready > 0 ? ` · ${ready} ready pra disparar` : '';
                        })()}
                      </span>
                      <button
                        type="button"
                        onClick={analyzeSelected}
                        disabled={analyzing}
                        className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime disabled:opacity-50"
                      >
                        {analyzing ? 'Analisando...' : `🔍 Analisar (${selectedTaskIds.size})`}
                      </button>
                      {(() => {
                        // Total slots pendentes (sem avatar) com briefingFileId nas tasks selecionadas
                        const pendingSlots = Array.from(selectedTaskIds).reduce((sum, id) => {
                          const a = taskAnalyses[id];
                          return sum + (a?.roleSlots?.filter(s => !s.avatarId && s.briefingFileId).length || 0);
                        }, 0);
                        if (pendingSlots === 0) return null;
                        if (hasAnthropic === false) {
                          return (
                            <a
                              href="/configuracoes/api"
                              className="mono rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/20"
                              title="IA Search precisa de chave Anthropic"
                            >
                              🔧 Configurar Anthropic pra IA Search ({pendingSlots} pendentes)
                            </a>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={async () => {
                              for (const id of Array.from(selectedTaskIds)) {
                                await runVisualMatchAllPendingForTask(id);
                              }
                            }}
                            className="mono rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                            title="Claude vision identifica avatares pendentes comparando thumbs do briefing com biblioteca HeyGen"
                          >
                            🤖 IA Search ({pendingSlots} pendentes)
                          </button>
                        );
                      })()}
                    </div>
                  ) : null}

                  {/* Painel batch — tasks rodando ou completas */}
                  {Object.keys(batchStates).length > 0 ? (
                    <div className="mt-4 rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 p-3">
                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-fuchsia-200">
                        Batch em andamento ({Object.keys(batchStates).length})
                      </div>
                      <ul className="grid gap-2">
                        {Object.values(batchStates).sort((a, b) => b.startedAt - a.startedAt).map((b) => {
                          const phaseLabel = ({ queued: '⏳ na fila', dispatching: '🚀 disparando', rendering: '⚙ renderizando', downloading: '⬇ baixando', post: '✂ pos-producao', done: '✅ pronto', failed: '✗ falhou' })[b.phase];
                          const phaseColor = b.phase === 'done' ? 'text-lime border-lime/40 bg-lime/10' : b.phase === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-fuchsia-200 border-fuchsia-500/30 bg-fuchsia-500/5';
                          const partsDispatched = b.parts.filter(p => p.videoId).length;
                          const partsRendered = b.parts.filter(p => p.videoStatus === 'completed').length;
                          const elapsedMs = (b.finishedAt || nowTick) - b.startedAt;
                          const elapsedMin = Math.floor(elapsedMs / 60000);
                          const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
                          const elapsedLabel = elapsedMin > 0 ? `${elapsedMin}m${String(elapsedSec).padStart(2, '0')}s` : `${elapsedSec}s`;
                          return (
                            <li key={b.taskId} className={`rounded-[10px] border ${phaseColor} p-2`}>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span className="mono">
                                  <strong className="text-white">{b.taskName}</strong>
                                  <span className="ml-2">{phaseLabel}</span>
                                  <span className="ml-2 text-text-muted">· {elapsedLabel}</span>
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {b.phase === 'done' && b.zipBlobUrl ? (
                                    <a
                                      href={b.zipBlobUrl}
                                      download={b.zipFilename}
                                      className="mono rounded border border-lime bg-lime/20 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30"
                                      title="Pasta com os takes individuais (HOOK1.mp4, BODY1.mp4, etc)"
                                    >
                                      ⬇ takes
                                    </a>
                                  ) : null}
                                  {b.phase === 'done' && b.montadoZipUrl ? (
                                    <a
                                      href={b.montadoZipUrl}
                                      download={b.montadoZipName}
                                      className="mono rounded border border-cyan-500/60 bg-cyan-500/20 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/30"
                                      title="Versoes ja montadas (HOOK[N]+BODY) e decupadas — prontas pra publicacao"
                                    >
                                      ⬇ montados
                                    </a>
                                  ) : null}
                                  {b.phase === 'done' && b.camufladoZipUrl ? (
                                    <a
                                      href={b.camufladoZipUrl}
                                      download={b.camufladoZipName}
                                      className="mono rounded border border-fuchsia-500/60 bg-fuchsia-500/20 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/30"
                                      title="Versoes montadas + audio camuflado (inversao de fase)"
                                    >
                                      ⬇ camuflados
                                    </a>
                                  ) : null}
                                  {b.phase === 'done' && !b.zipBlobUrl && b.parts.some(p => p.videoId) ? (
                                    // Estado restaurado de localStorage — blob nao sobrevive reload, oferece re-baixar
                                    <button
                                      type="button"
                                      onClick={() => resumeTaskBatch(b.taskId)}
                                      className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25"
                                      title="ZIP foi perdido no reload — re-baixa videos do HeyGen"
                                    >
                                      🔄 Re-baixar zip
                                    </button>
                                  ) : null}
                                  {b.phase === 'failed' && b.parts.some(p => p.videoId) ? (
                                    <button
                                      type="button"
                                      onClick={() => resumeTaskBatch(b.taskId)}
                                      className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25"
                                      title="Re-checa status no HeyGen (videos podem estar prontos) + baixa"
                                    >
                                      🔄 Retomar
                                    </button>
                                  ) : null}
                                  {b.phase === 'done' || b.phase === 'failed' ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        for (const url of [b.zipBlobUrl, b.montadoZipUrl, b.camufladoZipUrl]) {
                                          if (url) { try { URL.revokeObjectURL(url); } catch {} }
                                        }
                                        setBatchStates((prev) => {
                                          const { [b.taskId]: _, ...rest } = prev;
                                          return rest;
                                        });
                                      }}
                                      className="mono rounded border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                      title="Remove esta entrada do painel"
                                    >
                                      ✕
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => cancelTaskBatch(b.taskId)}
                                      className="mono rounded border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                    >
                                      cancelar
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="mono mt-1 text-[10px] text-text-muted">
                                {b.parts.length} partes · disparadas: {partsDispatched}/{b.parts.length}{b.phase !== 'dispatching' ? ` · renderizadas: ${partsRendered}/${partsDispatched}` : ''}
                              </div>
                              {/* Progress bar visual — peso por fase: 30% dispatch, 60% render, 10% download */}
                              {b.phase !== 'failed' ? (() => {
                                const dispatchProgress = b.parts.length > 0 ? partsDispatched / b.parts.length : 0;
                                const renderProgress = partsDispatched > 0 ? partsRendered / partsDispatched : 0;
                                const downloadProgress = b.phase === 'done' ? 1 : (b.phase === 'downloading' ? 0.5 : 0);
                                const totalPct = b.phase === 'done' ? 100 :
                                  Math.round((dispatchProgress * 30 + renderProgress * 60 + downloadProgress * 10));
                                const barColor = b.phase === 'done' ? 'bg-lime' : 'bg-fuchsia-400';
                                return (
                                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-soft/60">
                                    <div
                                      className={`h-full ${barColor} transition-all duration-300`}
                                      style={{ width: `${Math.min(100, Math.max(2, totalPct))}%` }}
                                    />
                                  </div>
                                );
                              })() : null}
                              {b.message ? (
                                <div className="mono mt-0.5 text-[10px] text-text-muted">{b.message}</div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {/* Preview previsibilidade — antes de iniciar */}
                  {bulkMode && Object.keys(taskAnalyses).length > 0 ? (
                    <div className="mt-4">
                      <div className="mono mb-2 text-[10px] uppercase tracking-widest text-text-muted">
                        Previsibilidade — o que vai ser disparado
                      </div>
                      <ul className="grid gap-2">
                        {Object.values(taskAnalyses).map((a) => {
                          const sym = a.status === 'ready' ? '✓' : a.status === 'partial' ? '⚠' : a.status === 'error' ? '✗' : a.status === 'analyzing' ? '◷' : '·';
                          const color = a.status === 'ready' ? 'border-lime/40 bg-lime/5' :
                                         a.status === 'partial' ? 'border-yellow-500/40 bg-yellow-500/5' :
                                         a.status === 'error' ? 'border-red-500/40 bg-red-500/5' :
                                         'border-line bg-bg-soft/30';
                          return (
                            <li key={a.taskId} className={`rounded-[10px] border ${color} p-3 text-[11px]`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="mono text-xs text-white">
                                  {sym} {a.taskName}
                                </span>
                                {a.status === 'partial' && a.roleSlots?.some(s => !s.avatarId && s.briefingFileId) ? (
                                  hasAnthropic === false ? (
                                    <a
                                      href="/configuracoes/api"
                                      className="mono shrink-0 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/20"
                                      title="IA Search precisa de chave Anthropic"
                                    >
                                      🔧 Configurar Anthropic
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => runVisualMatchAllPendingForTask(a.taskId)}
                                      className="mono shrink-0 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20"
                                      title="Roda Claude vision em todos os avatares pendentes desta task pra tentar achar match visual"
                                    >
                                      🤖 IA Search pendentes ({a.roleSlots.filter(s => !s.avatarId && s.briefingFileId).length})
                                    </button>
                                  )
                                ) : null}
                                {a.status === 'ready' || a.status === 'partial' ? (
                                  <button
                                    type="button"
                                    onClick={() => dispatchTaskToHeyGen(a.taskId)}
                                    disabled={a.status === 'partial'}
                                    className="mono shrink-0 rounded border border-lime bg-lime/20 px-3 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30 disabled:opacity-40"
                                    title={a.status === 'partial' ? 'Tem avatar pendente — escolhe um abaixo' : (a.dispatchedAt ? 'Ja disparada antes — vai pedir confirmacao' : 'Abre HeyGen Auto Dynamic com tudo pre-preenchido')}
                                  >
                                    ▶ {a.dispatchedAt ? 'Disparar de novo' : 'Disparar'}
                                  </button>
                                ) : null}
                              </div>
                              {a.status === 'ready' || a.status === 'partial' ? (
                                <div className="mt-1 grid gap-1 text-text-muted">
                                  <div className="mono text-[10px] flex flex-wrap items-center gap-2">
                                    <span>{a.totalParts} takes ({a.hookCount} hook{(a.hookCount ?? 0) === 1 ? '' : 's'} + {a.bodyPartsCount} body split{(a.bodyPartsCount ?? 0) === 1 ? '' : 's'}) — Avatar III</span>
                                    {a.dispatchedAt ? (
                                      <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-fuchsia-300">
                                        ⚠ ja disparada {new Date(a.dispatchedAt).toLocaleDateString('pt-BR')}
                                      </span>
                                    ) : null}
                                  </div>
                                  {/* RoleSlots — UM por avatar do briefing, mesmo se sem match */}
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
                                        <div key={sIdx} className="rounded-[10px] border border-line-strong bg-bg/50 p-2">
                                          <div className="mono flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-widest">
                                            <span className="rounded-full bg-lime/15 px-2 py-0.5 text-lime">{slot.role}</span>
                                            <span className="text-text-muted">briefing: @{slot.username}</span>
                                            <span className="text-text-muted">· {partsCount} parte{partsCount === 1 ? '' : 's'}</span>
                                            {slot.matchedBy ? (
                                              (() => {
                                                // Visual match: extrai confianca pra colorir o pill
                                                const isVisual = slot.matchedBy.startsWith('visual');
                                                const conf = isVisual ? (slot.matchedBy.match(/\((alta|media|baixa)\)/i)?.[1]?.toLowerCase() || '') : '';
                                                const baseColor = slot.matchedBy === 'manual'
                                                  ? 'text-lime'
                                                  : isVisual ? 'text-cyan-300' : 'text-fuchsia-300';
                                                const confPill = conf === 'alta'
                                                  ? 'border-lime/60 bg-lime/15 text-lime'
                                                  : conf === 'media'
                                                  ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-200'
                                                  : conf === 'baixa'
                                                  ? 'border-red-500/60 bg-red-500/15 text-red-300'
                                                  : '';
                                                const label = isVisual ? 'matched: visual' : `matched: ${slot.matchedBy}`;
                                                return (
                                                  <span className={`flex items-center gap-1 ${baseColor}`}>
                                                    <span>· {label}</span>
                                                    {conf ? (
                                                      <span
                                                        className={`rounded-full border px-1.5 py-0 ${confPill}`}
                                                        title={conf === 'alta' ? 'Alta confianca — match visual confiavel' : conf === 'media' ? 'Media confianca — confira manualmente' : 'Baixa confianca — provavelmente errado, troque manualmente'}
                                                      >
                                                        {conf === 'alta' ? '✓ alta' : conf === 'media' ? '⚠ media' : '✗ baixa'}
                                                      </span>
                                                    ) : null}
                                                  </span>
                                                );
                                              })()
                                            ) : (
                                              <span className="text-red-300">· PENDENTE — escolha o avatar abaixo OU click 🤖 IA SEARCH</span>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => removeRoleSlot(a.taskId, sIdx)}
                                              className="ml-auto rounded-full px-1.5 py-0.5 text-text-muted hover:bg-red-500/10 hover:text-red-300"
                                              title="Remover este slot"
                                            >
                                              ×
                                            </button>
                                          </div>
                                          {/* Thumb do video do briefing (sempre visivel pra user identificar) */}
                                          {briefingThumbUrl ? (
                                            <div className="mt-2 flex items-center gap-3 rounded-[8px] border border-blue-500/30 bg-blue-500/5 p-2">
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={briefingThumbUrl}
                                                alt={slot.username}
                                                className="h-16 w-16 shrink-0 rounded-full object-cover"
                                                referrerPolicy="no-referrer"
                                              />
                                              <div className="flex-1 min-w-0">
                                                <div className="mono text-[9px] uppercase tracking-widest text-blue-200">
                                                  preview avatar
                                                </div>
                                                <div className="text-[11px] text-text-muted">@{slot.username}.mp4</div>
                                                {hasAnthropic !== false ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => runVisualMatchForSlot(a.taskId, sIdx)}
                                                    disabled={isVisualSearching}
                                                    className="mono mt-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                                                    title="Claude vision compara essa thumb com toda biblioteca HeyGen e escolhe o melhor match visual"
                                                  >
                                                    {isVisualSearching ? '🔍 buscando...' : '🤖 IA SEARCH (vision)'}
                                                  </button>
                                                ) : null}
                                              </div>
                                            </div>
                                          ) : null}
                                          <div className="mt-2 grid gap-2">
                                            <div className="grid gap-0.5">
                                              <div className="mono text-[9px] uppercase tracking-widest text-text-muted">avatar HeyGen escolhido</div>
                                              <div className="max-w-[400px]">
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
                                              <div className="grid gap-0.5">
                                                <div className="mono text-[9px] uppercase tracking-widest text-text-muted flex items-center gap-2">
                                                  <span>voz</span>
                                                  <span className={slot.voiceOverride ? 'text-lime' : noVoice ? 'text-red-300' : 'text-text-muted'}>
                                                    · {effectiveVoiceLabel}
                                                  </span>
                                                  {noVoice && !slot.voiceOverride ? (
                                                    <span className="text-red-300">⚠ avatar sem voz padrao — escolha uma voz custom OU clone uma nova</span>
                                                  ) : null}
                                                </div>
                                                <CompactVoiceSelector
                                                  selected={slot.voiceOverride}
                                                  setSelected={(v) => updateRoleSlot(a.taskId, sIdx, { voiceOverride: v })}
                                                />
                                                {/* Clone voice — aparece se cloning em andamento OU se botao foi clicado.
                                                 *  File picker programatico: clica no botao → abre file input invisivel. */}
                                                {(() => {
                                                  const cloneKey = `${a.taskId}:${sIdx}`;
                                                  const cloning = cloningVoice[cloneKey];
                                                  if (cloning) {
                                                    return (
                                                      <div className="mt-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5">
                                                        <div className="mono text-[9px] uppercase tracking-widest text-cyan-200">
                                                          🎤 Clonando voz · {cloning.stage} · {Math.round(cloning.percent)}%
                                                        </div>
                                                        {cloning.message ? (
                                                          <div className="text-[10px] text-text-muted mt-0.5">{cloning.message}</div>
                                                        ) : null}
                                                        <div className="mt-1 h-1 rounded bg-bg/60 overflow-hidden">
                                                          <div className="h-full bg-cyan-400 transition-all" style={{ width: `${cloning.percent}%` }} />
                                                        </div>
                                                      </div>
                                                    );
                                                  }
                                                  return (
                                                    <label className="mono mt-1 inline-flex items-center gap-1 self-start rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20 cursor-pointer">
                                                      🎤 Clonar voz nova (audio ou video)
                                                      <input
                                                        type="file"
                                                        accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.mp4,.mov,.webm"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                          const f = e.target.files?.[0];
                                                          e.target.value = '';
                                                          if (f) handleCloneVoiceForSlot(a.taskId, sIdx, f);
                                                        }}
                                                      />
                                                    </label>
                                                  );
                                                })()}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* SEMPRE permite adicionar avatar manual — quando parser
                                     *  falha OU quando user quer adicionar mais um speaker */}
                                    <button
                                      type="button"
                                      onClick={() => addManualRoleSlot(a.taskId)}
                                      className="mono rounded-[10px] border border-dashed border-line-strong bg-bg/30 py-2 px-3 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime/40 hover:bg-lime/5 hover:text-lime transition"
                                    >
                                      + adicionar avatar manualmente
                                    </button>
                                  </div>
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
                          <div className="sticky bottom-2 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-lime/40 bg-bg/95 p-3 shadow-[0_0_30px_-10px_rgba(200,255,0,0.4)] backdrop-blur">
                            <span className="mono text-[11px] text-text-muted">
                              {readyIds.length > 0 ? (
                                <span className="text-lime">✓ {readyIds.length} ready</span>
                              ) : null}
                              {readyIds.length > 0 && partialIds.length > 0 ? <span className="text-text-muted"> · </span> : null}
                              {partialIds.length > 0 ? (
                                <span className="text-yellow-300">⚠ {partialIds.length} pendente{partialIds.length === 1 ? '' : 's'} (resolva acima pra incluir)</span>
                              ) : null}
                            </span>
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
                                : 'Abre HeyGen Auto Dynamic com tudo pre-preenchido'}
                            >
                              ▶ Disparar via HeyGen Auto Dynamic (motor III)
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
    </>
  );
}
