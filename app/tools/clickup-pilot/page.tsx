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
import {
  getLibrarySnapshot,
  reloadLibrary,
  subscribeLibrary,
} from '@/lib/heygen-library-cache';
import { CompactAvatarPicker } from '@/components/CompactAvatarPicker';
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

const DEFAULT_EDIT_STATUSES = [
  'EDITAR VIDEO',
  'EDITAR VÍDEO',
  'EDITANDO VIDEO',
  'EDITANDO VÍDEO',
  'REVISAO VIDEO',
  'REVISÃO VÍDEO',
  'REVISAO VÍDEO',
];

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

type TaskAnalysis = {
  taskId: string;
  taskName: string;
  status: 'pending' | 'analyzing' | 'ready' | 'partial' | 'error';
  baseAdId?: string;
  hookCount?: number;
  bodyPartsCount?: number;
  totalParts?: number;
  avatarsTotal?: number;
  avatarsMatched?: number;
  unmatchedAvatars?: string[];
  error?: string;
  plan?: DispatchPlan;
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

  async function loadTeams() {
    if (!hasToken) return;
    setLoadingTeams(true);
    setError(null);
    try {
      const ts = await listTeams();
      setTeams(ts);
      if (ts.length > 0 && !selectedTeam) setSelectedTeam(ts[0].id);
    } catch (e) {
      setError(`Falha ao carregar teams: ${(e as Error)?.message}`);
    } finally {
      setLoadingTeams(false);
    }
  }
  useEffect(() => { if (hasToken) loadTeams(); /* eslint-disable-next-line */ }, [hasToken]);

  const currentTeam = useMemo(() => teams.find((t) => t.id === selectedTeam) || null, [teams, selectedTeam]);
  const editors: ClickUpUser[] = useMemo(() => {
    return (currentTeam?.members || []).map((m) => m.user).sort((a, b) => a.username.localeCompare(b.username));
  }, [currentTeam]);

  /* ========== Tasks ========== */
  const [statusFilter, setStatusFilter] = useToolState<string>(
    'clickup:statuses',
    DEFAULT_EDIT_STATUSES.join(','),
  );
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
    const targets = tasks.filter((t) => selectedTaskIds.has(t.id));
    // Init status pendente pra todos
    setTaskAnalyses(() => {
      const init: Record<string, TaskAnalysis> = {};
      for (const t of targets) {
        init[t.id] = { taskId: t.id, taskName: t.name, status: 'pending' };
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
          // 3.5. Resolve Drive file IDs pros avatares (pra visual match)
          for (const av of briefing.avatars) {
            av.videoFileId = resolveVideoFileId(av.username, docR.driveLinks);
          }
          // 4. Monta plano de dispatch
          // PRIORIDADE: visual match (Claude vision) > voice_name > nome fuzzy
          const matchedByRole: Record<string, { id: string; name: string; thumb?: string | null; matchedBy?: string }> = {};
          const unmatched: string[] = [];
          for (const av of briefing.avatars) {
            // Visual match primeiro se tem fileId (Drive thumbnail funciona pra
            // qualquer doc que voce tem acesso na sessao Google atual)
            if (av.videoFileId && avatarCandidates.length > 0) {
              const refUrl = `https://drive.google.com/thumbnail?id=${av.videoFileId}&sz=w400`;
              const cand20 = avatarCandidates.slice(0, 20).map(c => ({ id: c.id, name: c.name, groupName: c.groupName, thumbUrl: c.thumb || '' })).filter(c => c.thumbUrl);
              if (cand20.length > 0) {
                const visual = await visualMatchAvatar(refUrl, cand20);
                if (visual) {
                  const candFull = avatarCandidates.find(c => c.id === visual.id);
                  matchedByRole[av.role.toLowerCase()] = {
                    id: visual.id,
                    name: visual.name,
                    thumb: candFull?.thumb,
                    matchedBy: `visual (${visual.confidence})`,
                  };
                  continue;
                }
              }
            }
            // Fallback: voice_name + nome fuzzy
            const m = matchAvatar(av.username, avatarCandidates);
            if (m && m.score >= 30) {
              const candFull = avatarCandidates.find(c => c.id === m.id);
              matchedByRole[av.role.toLowerCase()] = {
                id: m.id,
                name: m.name,
                thumb: candFull?.thumb,
                matchedBy: m.matchedBy || 'fuzzy',
              };
            } else {
              unmatched.push(`${av.role}: @${av.username}`);
            }
          }
          const firstMatched = Object.values(matchedByRole)[0] || null;
          function pickAvatar(text: string, label: string) {
            const ll = label.toLowerCase();
            for (const r of Object.keys(matchedByRole)) if (ll.includes(r)) return matchedByRole[r];
            const fl = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
            for (const r of Object.keys(matchedByRole)) if (fl.includes(r)) return matchedByRole[r];
            return firstMatched;
          }
          const planParts: DispatchPlan['parts'] = [];
          for (const h of briefing.hooks) {
            const av = pickAvatar(h.text, h.label);
            planParts.push({
              label: h.label,
              text: h.text,
              avatarId: av?.id || null,
              avatarName: av?.name || null,
              avatarThumb: (av as any)?.thumb || null,
              matchedBy: (av as any)?.matchedBy,
            });
          }
          if (briefing.body) {
            const bps = splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 });
            bps.forEach((bp, i) => {
              const label = bps.length === 1 ? 'BODY' : `BODY ${i + 1}`;
              const av = pickAvatar(bp, label);
              planParts.push({
                label,
                text: bp,
                avatarId: av?.id || null,
                avatarName: av?.name || null,
                avatarThumb: (av as any)?.thumb || null,
                matchedBy: (av as any)?.matchedBy,
              });
            });
          }
          const plan: DispatchPlan = {
            adName: briefing.baseAdId.replace(/[^a-z0-9_-]/gi, '_'),
            parts: planParts,
            unmatchedAvatars: unmatched,
          };
          const allHaveAvatar = planParts.every((p) => p.avatarId);
          setTaskAnalyses((prev) => ({
            ...prev,
            [task.id]: {
              ...prev[task.id],
              status: allHaveAvatar ? 'ready' : 'partial',
              baseAdId,
              hookCount: briefing.hooks.length,
              bodyPartsCount: briefing.body ? splitCopyIntoParts(briefing.body, { targetSec: 20, minSec: 10, maxSec: 35 }).length : 0,
              totalParts: planParts.length,
              avatarsTotal: briefing.avatars.length,
              avatarsMatched: briefing.avatars.length - unmatched.length,
              unmatchedAvatars: unmatched,
              plan,
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

  /** Substitui um avatar em todas as partes da task que usavam o oldAvatarId.
   *  User pode trocar o avatar suggested pelo correto antes de disparar. */
  function swapAvatarInTask(taskId: string, oldAvatarId: string, newAvatar: AvatarOption | null) {
    setTaskAnalyses((prev) => {
      const a = prev[taskId];
      if (!a?.plan) return prev;
      const updatedParts = a.plan.parts.map((p) => {
        if (p.avatarId === oldAvatarId) {
          return {
            ...p,
            avatarId: newAvatar?.id || null,
            avatarName: newAvatar?.name || null,
            avatarThumb: newAvatar?.thumb || null,
            matchedBy: 'manual',
          };
        }
        return p;
      });
      const newPlan: DispatchPlan = { ...a.plan, parts: updatedParts };
      const allHaveAvatar = updatedParts.every((p) => p.avatarId);
      const matchedCount = a.avatarsTotal ?? 0; // mantemos o count original
      return {
        ...prev,
        [taskId]: {
          ...a,
          plan: newPlan,
          status: allHaveAvatar ? 'ready' : 'partial',
        },
      };
    });
  }

  /** Dispara via HeyGen Auto a partir de um plano ja analisado */
  function dispatchPlanToHeyGen(plan: DispatchPlan) {
    if (plan.parts.some((p) => !p.avatarId)) {
      setError(`Plano tem parte(s) sem avatar. Cria os avatares pendentes primeiro.`);
      return;
    }
    const handoff = {
      adName: plan.adName,
      motor: 'III',
      mode: 'copy',
      dynamic: true,
      partTexts: plan.parts.map((p) => p.text),
      partLabels: plan.parts.map((p) => p.label),
      partAvatarIds: plan.parts.map((p) => p.avatarId),
      copy: plan.parts.map((p) => p.text).join('\n\n'),
    };
    sessionStorage.setItem('darkolab:heygen-auto:handoff', JSON.stringify(handoff));
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

  // Flat avatar candidates pra matcher (incluindo voice_name + thumb pra visual)
  const avatarCandidates = useMemo(() => {
    const flat: Array<{ id: string; name: string; groupName: string; voiceName?: string | null; thumb?: string | null }> = [];
    for (const g of librarySnap.groups) {
      for (const l of g.looks) {
        flat.push({
          id: l.id,
          name: l.name,
          groupName: g.name,
          voiceName: (l as any).voiceName ?? null,
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
                  <input
                    type="text"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    placeholder="Status (csv)"
                    className="input-field flex-1 min-w-[260px]"
                    title="Lista CSV dos status que filtram. Default: status 'pra editar'."
                  />
                  <button
                    type="button"
                    onClick={loadTasks}
                    disabled={!selectedTeam || !selectedEditor || loadingTasks}
                    className="btn-primary"
                  >
                    {loadingTasks ? 'Carregando...' : 'Carregar tasks'}
                  </button>
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
                        ⚙ {selectedTaskIds.size} task{selectedTaskIds.size === 1 ? '' : 's'} selecionada{selectedTaskIds.size === 1 ? '' : 's'} pra analisar
                      </span>
                      <button
                        type="button"
                        onClick={analyzeSelected}
                        disabled={analyzing}
                        className="btn-primary"
                      >
                        {analyzing ? 'Analisando...' : `🔍 Analisar selecionadas (${selectedTaskIds.size})`}
                      </button>
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
                                    onClick={() => a.plan && dispatchPlanToHeyGen(a.plan)}
                                    disabled={a.status === 'partial'}
                                    className="mono shrink-0 rounded border border-lime bg-lime/20 px-3 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/30 disabled:opacity-40"
                                    title={a.status === 'partial' ? 'Tem avatar pendente — cria primeiro no HeyGen' : 'Abre HeyGen Auto Dynamic com tudo pre-preenchido'}
                                  >
                                    ▶ Disparar
                                  </button>
                                ) : null}
                              </div>
                              {a.status === 'ready' || a.status === 'partial' ? (
                                <div className="mt-1 grid gap-1 text-text-muted">
                                  <div className="mono text-[10px]">
                                    {a.totalParts} takes ({a.hookCount} hook{(a.hookCount ?? 0) === 1 ? '' : 's'} + {a.bodyPartsCount} body split{(a.bodyPartsCount ?? 0) === 1 ? '' : 's'}) — Avatar III
                                  </div>
                                  {/* Avatares unicos selecionados — clicaveis pra trocar antes de disparar */}
                                  {a.plan ? (
                                    <div className="mt-1.5 grid gap-1.5">
                                      <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
                                        Avatares (clica pra trocar antes de disparar)
                                      </div>
                                      {Array.from(new Map(a.plan.parts.filter(p => p.avatarId).map(p => [p.avatarId, p])).values()).map((p) => {
                                        // Quantos partes desse avatar existem no plano
                                        const usedInParts = a.plan!.parts.filter(pp => pp.avatarId === p.avatarId).length;
                                        // AvatarOption pra passar pro CompactAvatarPicker
                                        const candFull = avatarCandidates.find(c => c.id === p.avatarId);
                                        const selected: AvatarOption | null = candFull ? {
                                          id: candFull.id,
                                          name: candFull.name,
                                          thumb: candFull.thumb || null,
                                          videoPreview: null,
                                          type: 'photo',
                                          version: 'III',
                                          groupName: candFull.groupName,
                                          voiceId: null,
                                          voiceName: candFull.voiceName,
                                        } : null;
                                        return (
                                          <div key={p.avatarId} className="grid gap-0.5">
                                            <div className="mono flex items-center gap-2 text-[9px] uppercase tracking-widest text-text-muted">
                                              <span>usado em {usedInParts} parte{usedInParts === 1 ? '' : 's'}</span>
                                              {p.matchedBy ? (
                                                <span className={p.matchedBy === 'manual' ? 'text-lime' : 'text-fuchsia-300'}>
                                                  · matched: {p.matchedBy}
                                                </span>
                                              ) : null}
                                            </div>
                                            <div className="max-w-[400px]">
                                              <CompactAvatarPicker
                                                selected={selected}
                                                setSelected={(newAv) => swapAvatarInTask(a.taskId, p.avatarId!, newAv)}
                                                disabled={false}
                                                label="Trocar avatar dessas partes"
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                  {(a.unmatchedAvatars?.length ?? 0) > 0 ? (
                                    <div className="mono text-[10px] text-yellow-300">
                                      ⚠ pendente: {a.unmatchedAvatars!.join(', ')}
                                    </div>
                                  ) : null}
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
