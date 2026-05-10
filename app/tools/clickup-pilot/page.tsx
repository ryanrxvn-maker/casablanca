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
  matchAvatar,
  type ParsedAdSection,
} from '@/lib/copy-parser';
import {
  getLibrarySnapshot,
  reloadLibrary,
  subscribeLibrary,
} from '@/lib/heygen-library-cache';

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
  parts: Array<{ label: string; text: string; avatarId: string | null; avatarName: string | null }>;
  unmatchedAvatars: string[];
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

  async function autoFetchDoc(url: string) {
    setFetchingDoc(true);
    setParseError(null);
    try {
      const r = await fetch(`/api/docs/fetch?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!j.ok) {
        setParseError(`Falha ao buscar doc: ${j.error || 'erro desconhecido'}`);
        return;
      }
      setDocContent(j.text || '');
      // Auto-parse depois de fetch
      setTimeout(() => runParser(j.text || ''), 100);
    } catch (e) {
      setParseError(`Falha de rede: ${(e as Error)?.message}`);
    } finally {
      setFetchingDoc(false);
    }
  }

  function runParser(textOverride?: string) {
    setParseError(null);
    setParsed(null);
    const text = textOverride ?? docContent;
    if (!text.trim()) {
      setParseError('Cola o conteudo do doc OU usa o botao "Buscar doc automatico".');
      return;
    }
    if (!selectedTask) return;
    // Identifica AD ID a partir do nome da task: ex "AD135GL - VFPB04"
    const taskName = selectedTask.name;
    const adIdMatch = taskName.match(/AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i);
    const adId = adIdMatch ? adIdMatch[0].toUpperCase() : taskName.toUpperCase().trim();
    const result = parseAdSection(text, adId);
    if (!result) {
      // Tenta com prefixo (ex so "AD135GL")
      const prefix = adId.split(/\s|-/)[0];
      const r2 = parseAdSection(text, prefix);
      if (!r2) {
        setParseError(`Nao achei secao "${adId}" nem "${prefix}" no doc. Confere se a copy do AD ta no doc.`);
        return;
      }
      setParsed(r2);
    } else {
      setParsed(result);
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

  // Flat avatar candidates pra matcher
  const avatarCandidates = useMemo(() => {
    const flat: Array<{ id: string; name: string; groupName: string }> = [];
    for (const g of librarySnap.groups) {
      for (const l of g.looks) {
        flat.push({ id: l.id, name: l.name, groupName: g.name });
      }
    }
    return flat;
  }, [librarySnap.groups]);

  /* ========== Plano de dispatch ========== */
  const dispatchPlan: DispatchPlan | null = useMemo(() => {
    if (!parsed || !selectedTask) return null;
    const adName = parsed.adId.replace(/[^a-z0-9_-]/gi, '_');
    const matchedByRole: Record<string, { id: string; name: string }> = {};
    const unmatchedAvatars: string[] = [];
    for (const av of parsed.avatars) {
      const m = matchAvatar(av.username, avatarCandidates);
      if (m && m.score >= 30) {
        matchedByRole[av.role.toLowerCase()] = { id: m.id, name: m.name };
      } else {
        unmatchedAvatars.push(`${av.role}: @${av.username}`);
      }
    }
    // Pra cada parte, escolhe avatar baseado em:
    // 1. Se a parte menciona um role (ex "HOOK 1 - Doutor"), usa esse role
    // 2. Senao, usa o PRIMEIRO avatar matchado (default)
    const firstMatched = Object.values(matchedByRole)[0] || null;
    const parts = parsed.parts.map((p) => {
      // Tenta detectar role na label da parte ("HOOK 1 - DOUTOR" etc)
      let chosen: { id: string; name: string } | null = firstMatched;
      const labelLower = p.label.toLowerCase();
      for (const role of Object.keys(matchedByRole)) {
        if (labelLower.includes(role.toLowerCase())) {
          chosen = matchedByRole[role];
          break;
        }
      }
      // Tambem checa nas primeiras linhas do texto da parte
      if (chosen === firstMatched) {
        const firstLines = p.text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
        for (const role of Object.keys(matchedByRole)) {
          if (firstLines.includes(role)) {
            chosen = matchedByRole[role];
            break;
          }
        }
      }
      return {
        label: p.label,
        text: p.text,
        avatarId: chosen?.id || null,
        avatarName: chosen?.name || null,
      };
    });
    return { adName, parts, unmatchedAvatars };
  }, [parsed, selectedTask, avatarCandidates]);

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
                  <h2 className="label-field !mb-3">Tasks ({tasks.length})</h2>
                  <ul className="grid gap-2">
                    {tasks.map((t) => {
                      const isOpen = selectedTask?.id === t.id;
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => openTask(t)}
                            className={
                              'w-full rounded-[10px] border px-3 py-2 text-left text-sm transition ' +
                              (isOpen
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
                </section>
              ) : null}

              {/* Detalhe da task selecionada */}
              {selectedTask ? (
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

                  {parsed ? (
                    <div className="mt-4 rounded-[10px] border border-lime/30 bg-lime/5 p-3">
                      <div className="mono text-[10px] uppercase tracking-widest text-lime">
                        ✓ Parsed: {parsed.adId}
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
