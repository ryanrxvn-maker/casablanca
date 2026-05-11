'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { Heartbeat } from '@/components/Heartbeat';
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
import { splitCopyIntoParts } from '@/lib/heygen-extension-bridge';
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
  /** queued | dispatching | rendering | downloading | done | failed */
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'done' | 'failed';
  /** Per-part status durante dispatch (parteN: error|null) */
  parts: Array<{ label: string; videoId: string | null; videoStatus?: VideoStatus['status']; error?: string | null; renamedTo: string }>;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  zipBlobUrl?: string; // gerado quando completo
  zipFilename?: string;
};

type RoleSlot = {
  /** "Doutor", "Mulher", etc — role do briefing */
  role: string;
  /** "@binhoted1" — username bruto do briefing */
  username: string;
  /** Avatar HeyGen escolhido (null = pendente, user precisa selecionar) */
  avatarId: string | null;
  avatarName: string | null;
  avatarThumb: string | null;
  avatarVoiceId: string | null;
  /** Se != null, sobrescreve avatarVoiceId — voz custom escolhida pelo user */
  voiceOverride: { id: string; name: string } | null;
  /** Como matchamos: 'voice_name_exact' | 'voice_name_fuzzy' | 'name_contains' | 'name_tokens' | 'manual' | null */
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

  useEffect(() => {
    const t = getClickUpToken();
    setHasToken(!!t);
    if (!t) setShowTokenSetup(true);
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

  /* ========== Teams + members ========== */
  const [teams, setTeams] = useState<ClickUpTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useToolState<string | null>(
    'clickup:teamId',
    null,
  );
  const [selectedEditor, setSelectedEditor] = useToolState<string | null>(
    'clickup:editorId',
    null,
  );
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
      // Auto-pick editor: o user autenticado (mesmo que dropdown esteja vazio)
      if (me && !selectedEditor) {
        setSelectedEditor(String(me.id));
      }
    } catch (e) {
      setError(`Falha ao carregar teams: ${(e as Error)?.message}`);
    } finally {
      setLoadingTeams(false);
    }
  }
  useEffect(() => { if (hasToken) loadTeams(); /* eslint-disable-next-line */ }, [hasToken]);

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
          const roleSlots: RoleSlot[] = [];
          for (const av of briefing.avatars) {
            const m = matchAvatar(av.username, avatarCandidates);
            if (m && m.score >= 30) {
              const candFull = avatarCandidates.find(c => c.id === m.id);
              roleSlots.push({
                role: av.role,
                username: av.username,
                avatarId: m.id,
                avatarName: m.name,
                avatarThumb: candFull?.thumb || null,
                avatarVoiceId: candFull?.voiceId || null,
                voiceOverride: null,
                matchedBy: m.matchedBy || 'fuzzy',
              });
            } else {
              // Pendente: slot vazio que user vai preencher
              roleSlots.push({
                role: av.role,
                username: av.username,
                avatarId: null,
                avatarName: null,
                avatarThumb: null,
                avatarVoiceId: null,
                voiceOverride: null,
                matchedBy: null,
              });
            }
          }
          // partTemplates: cada parte tem um 'matchByRole' — qual role preencher
          // na hora de gerar o plan final. Default = primeiro role.
          const firstRole = roleSlots[0]?.role.toLowerCase() || null;
          function pickRoleForText(text: string, label: string): string | null {
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
            partTemplates.push({ label: h.label, text: h.text, matchByRole: pickRoleForText(h.text, h.label) });
          }
          const bodyParts = briefing.body ? splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 }) : [];
          bodyParts.forEach((bp, i) => {
            const label = bodyParts.length === 1 ? 'BODY' : `BODY ${i + 1}`;
            partTemplates.push({ label, text: bp, matchByRole: pickRoleForText(bp, label) });
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
    setAnalyzing(false);
  }

  /** Batch state — tasks rodando em background (dispatch + poll + download + zip) */
  const [batchStates, setBatchStates] = useState<Record<string, BatchTaskState>>({});
  const batchCancelRef = useRef<Record<string, boolean>>({});

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

      // 3. Download + zip — iterate por results (mesma ordem das parts no plan)
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'downloading', message: `Baixando + zipando ${validIds.length} videos...` } }));
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let downloaded = 0;
      for (let i = 0; i < results.length; i++) {
        if (batchCancelRef.current[taskId]) break;
        const r = results[i];
        const part = plan.parts[i];
        const fname = labelToFilename(part.label);
        const fnameBase = fname.replace('.mp4', '');
        if (!r.videoId) {
          zip.file(`${fnameBase}_NAO_DISPAROU.txt`, `Erro no dispatch: ${r.error || 'sem detalhes'}`);
          continue;
        }
        const status = finalStatuses[r.videoId];
        if (status?.status !== 'completed' || !status.videoUrl) {
          zip.file(`${fnameBase}_NAO_RENDERIZOU.txt`, `Status: ${status?.status || '?'}\n${status?.error || ''}`);
          continue;
        }
        try {
          const bytes = await downloadVideoBytes(status.videoUrl);
          zip.file(fname, bytes);
          downloaded++;
          setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], message: `Baixando: ${downloaded}/${validIds.length}` } }));
        } catch (e) {
          zip.file(`${fnameBase}_DOWNLOAD_ERROR.txt`, String((e as Error)?.message));
        }
      }

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
      setBatchStates((prev) => ({ ...prev, [taskId]: { ...prev[taskId], phase: 'failed', message: (e as Error)?.message || 'erro', finishedAt: Date.now() } }));
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

  /** Atualiza UM roleSlot da task. Usado quando user troca avatar OU voz. */
  function updateRoleSlot(taskId: string, roleIdx: number, patch: Partial<RoleSlot>) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.roleSlots) return prev;
      const newSlots = a.roleSlots.map((s, i) => i === roleIdx ? { ...s, ...patch } : s);
      const allHaveAvatar = newSlots.every((s) => s.avatarId);
      return { ...prev, [taskId]: { ...a, roleSlots: newSlots, status: allHaveAvatar ? 'ready' : 'partial' } };
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
    function pickAvatarForText(text: string, label: string): { id: string; name: string } | null {
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
        const av = pickAvatarForText(h.text, h.label);
        planParts.push({
          label: h.label,
          text: h.text,
          avatarId: av?.id || null,
          avatarName: av?.name || null,
        });
      }
      if (briefing.body) {
        // Split do body em parts ~20s no Avatar III
        const bodyParts = splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 });
        bodyParts.forEach((bp, i) => {
          const label = bodyParts.length === 1 ? 'BODY' : `BODY ${i + 1}`;
          const av = pickAvatarForText(bp, label);
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

  return (
    <div className="flex min-h-screen flex-col">
      <Heartbeat />
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="ClickUp Pilot"
          description="Cerebro de automacao: le suas tasks no ClickUp, identifica avatares + copy do briefing, e dispara lipsync no HeyGen Auto Dynamic. Motor III sempre (sem custo de creditos)."
        >
          {/* Token setup */}
          {showTokenSetup ? (
            <div className="mb-5 rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-sm">
              <div className="mb-2 font-semibold text-fuchsia-200">
                Configurar token ClickUp
              </div>
              <p className="mb-2 text-[11px] text-text-muted">
                Pega seu token em{' '}
                <a
                  href="https://app.clickup.com/settings/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime hover:underline"
                >
                  app.clickup.com → Settings → Apps → API Token
                </a>
                . Comeca com <code className="mono text-fuchsia-200">pk_</code>. Salvo
                no localStorage do seu browser.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="pk_..."
                  className="input-field flex-1"
                />
                <button
                  type="button"
                  onClick={saveToken}
                  disabled={!tokenInput.trim()}
                  className="btn-primary"
                >
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-center justify-between rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-2 text-xs">
              <span className="text-lime">✓ Token ClickUp configurado</span>
              <button
                type="button"
                onClick={clearToken}
                className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
              >
                Limpar
              </button>
            </div>
          )}

          {error ? (
            <div className="mb-4 error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              {error}
            </div>
          ) : null}

          {hasToken ? (
            <div className="grid gap-6">
              {/* Team + Editor pickers */}
              <section>
                <h2 className="label-field !mb-3">Workspace + Editor</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={selectedTeam || ''}
                    onChange={(e) => { setSelectedTeam(e.target.value); setSelectedEditor(null); setTasks([]); }}
                    disabled={loadingTeams}
                    className="input-field"
                  >
                    <option value="">— Workspace —</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.members.length} membros)</option>
                    ))}
                  </select>
                  <select
                    value={selectedEditor || ''}
                    onChange={(e) => { setSelectedEditor(e.target.value); setTasks([]); }}
                    disabled={!currentTeam}
                    className="input-field"
                  >
                    <option value="">— Editor —</option>
                    {editors.map((u) => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={loadTasks}
                    disabled={!selectedTeam || !selectedEditor || loadingTasks}
                    className="btn-primary"
                  >
                    {loadingTasks ? 'Carregando...' : 'Carregar tasks'}
                  </button>
                  <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                    Filtra status: editar / editando vídeo · <a href="/configuracoes" className="text-lime hover:underline">customizar</a>
                  </span>
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
                        const ready = Array.from(selectedTaskIds).filter(id => taskAnalyses[id]?.status === 'ready');
                        if (ready.length === 0) return null;
                        return (
                          <button
                            type="button"
                            onClick={startBatch}
                            className="btn-primary"
                            title="Roda em background: TTS + upload + submit + poll + zip — sem precisar acompanhar"
                          >
                            ▶ Iniciar {ready.length} task{ready.length === 1 ? '' : 's'} em background
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
                          const phaseLabel = ({ queued: '⏳ na fila', dispatching: '🚀 disparando', rendering: '⚙ renderizando', downloading: '⬇ baixando', done: '✅ pronto', failed: '✗ falhou' })[b.phase];
                          const phaseColor = b.phase === 'done' ? 'text-lime border-lime/40 bg-lime/10' : b.phase === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10' : 'text-fuchsia-200 border-fuchsia-500/30 bg-fuchsia-500/5';
                          const partsDispatched = b.parts.filter(p => p.videoId).length;
                          const partsRendered = b.parts.filter(p => p.videoStatus === 'completed').length;
                          return (
                            <li key={b.taskId} className={`rounded-[10px] border ${phaseColor} p-2`}>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span className="mono">
                                  <strong className="text-white">{b.taskName}</strong>
                                  <span className="ml-2">{phaseLabel}</span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {b.phase === 'done' && b.zipBlobUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => downloadZip(b.taskId)}
                                      className="mono rounded border border-lime bg-lime/20 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30"
                                    >
                                      ⬇ {b.zipFilename}
                                    </button>
                                  ) : null}
                                  {b.phase !== 'done' && b.phase !== 'failed' ? (
                                    <button
                                      type="button"
                                      onClick={() => cancelTaskBatch(b.taskId)}
                                      className="mono rounded border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                                    >
                                      cancelar
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mono mt-1 text-[10px] text-text-muted">
                                {b.parts.length} partes · disparadas: {partsDispatched}/{b.parts.length}{b.phase !== 'dispatching' ? ` · renderizadas: ${partsRendered}/${partsDispatched}` : ''}
                              </div>
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
                                      Avatares do briefing ({a.roleSlots.length}) — selecione cada um e a voz
                                    </div>
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
                                      return (
                                        <div key={sIdx} className="rounded-[10px] border border-line-strong bg-bg/50 p-2">
                                          <div className="mono flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-widest">
                                            <span className="rounded-full bg-lime/15 px-2 py-0.5 text-lime">{slot.role}</span>
                                            <span className="text-text-muted">briefing: @{slot.username}</span>
                                            <span className="text-text-muted">· {partsCount} parte{partsCount === 1 ? '' : 's'}</span>
                                            {slot.matchedBy ? (
                                              <span className={slot.matchedBy === 'manual' ? 'text-lime' : 'text-fuchsia-300'}>
                                                · matched: {slot.matchedBy}
                                              </span>
                                            ) : (
                                              <span className="text-red-300">· PENDENTE — escolha o avatar abaixo</span>
                                            )}
                                          </div>
                                          <div className="mt-2 grid gap-2">
                                            <div className="grid gap-0.5">
                                              <div className="mono text-[9px] uppercase tracking-widest text-text-muted">avatar</div>
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
                                                    <span className="text-red-300">⚠ avatar sem voz padrao — escolha uma voz custom</span>
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
                          <strong className="text-white">Hooks (G siblings → 1 take cada):</strong>
                          <ul className="mt-1 grid gap-1">
                            {briefing.hooks.map((h, i) => (
                              <li key={i} className="rounded border border-line bg-bg/40 px-2 py-1">
                                <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200">
                                  {h.label} (de G{h.sourceG})
                                </div>
                                <div className="mt-0.5 text-text-muted line-clamp-2">{h.text.slice(0, 200)}{h.text.length > 200 ? '…' : ''}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {briefing.body ? (
                          <div className="text-[11px]">
                            <strong className="text-white">Body (split em ~20s no Avatar III):</strong>
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
      </main>
    </div>
  );
}
