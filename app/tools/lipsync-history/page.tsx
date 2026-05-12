'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ToolShell } from '@/components/ToolShell';

/**
 * DARKO LAB Lipsync History — todos os lipsyncs feitos pela aplicacao,
 * incluindo batches do ClickUp Pilot + pipelines VA. Persiste localmente
 * via mesma chave que o ClickUp Pilot ja usa.
 *
 * Diferente de /tools/heygen-history (que lista a API HeyGen direto e
 * tem retencao de 60 dias) — esta pagina lista TUDO que o user gerou
 * via DARKO LAB sem limite de tempo (so depende do localStorage).
 *
 * Funcionalidades:
 *  - Lista cronologica reversa (mais novo primeiro)
 *  - Filtros: tipo (batch | VA), status, periodo, busca por nome
 *  - Detalhes expandidos com videoIds das partes
 *  - Re-baixar ZIP: se Blob URL ainda em memoria, download direto.
 *    Se nao, navega pro ClickUp Pilot com hint pra retomar download.
 *  - Remover entrada (nao apaga o batch atual no ClickUp Pilot)
 */

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';
const VA_HISTORY_KEY = 'darkolab:va-pipeline:history';

type BatchTaskState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
  parts: Array<{ label: string; videoId: string | null; videoStatus?: string; error?: string | null; renamedTo: string }>;
  message?: string;
  startedAt: number;
  finishedAt?: number;
  zipBlobUrl?: string;
  zipFilename?: string;
  montadoZipUrl?: string;
  montadoZipName?: string;
  camufladoZipUrl?: string;
  camufladoZipName?: string;
};

type VAHistoryEntry = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  avatares: Array<{ avaCode: string; username: string; status: 'done' | 'failed'; videoId?: string }>;
  startedAt: number;
  finishedAt?: number;
  zipUrl?: string;
  zipName?: string;
};

type Entry = {
  kind: 'batch' | 'va';
  id: string;
  taskName: string;
  baseAdId: string;
  status: 'done' | 'failed' | 'in_progress';
  startedAt: number;
  finishedAt?: number;
  partsTotal: number;
  partsCompleted: number;
  zipsAvailable: Array<{ label: string; href: string; filename: string }>;
  zipsLost: string[];
  raw: BatchTaskState | VAHistoryEntry;
};

function readBatches(): Record<string, BatchTaskState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readVAHistory(): VAHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(VA_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function toEntries(): Entry[] {
  const out: Entry[] = [];
  // Batches
  for (const b of Object.values(readBatches())) {
    const partsTotal = b.parts.length;
    const partsCompleted = b.parts.filter((p) => p.videoStatus === 'completed').length;
    const status: Entry['status'] = b.phase === 'done' ? 'done' : b.phase === 'failed' ? 'failed' : 'in_progress';
    const zipsAvailable: Entry['zipsAvailable'] = [];
    const zipsLost: string[] = [];
    if (b.zipBlobUrl && b.zipFilename) zipsAvailable.push({ label: 'takes', href: b.zipBlobUrl, filename: b.zipFilename });
    else if (b.zipFilename) zipsLost.push('takes');
    if (b.montadoZipUrl && b.montadoZipName) zipsAvailable.push({ label: 'montado/decupado', href: b.montadoZipUrl, filename: b.montadoZipName });
    else if (b.montadoZipName) zipsLost.push('montado');
    if (b.camufladoZipUrl && b.camufladoZipName) zipsAvailable.push({ label: 'camuflado', href: b.camufladoZipUrl, filename: b.camufladoZipName });
    else if (b.camufladoZipName) zipsLost.push('camuflado');
    out.push({
      kind: 'batch',
      id: `batch:${b.taskId}`,
      taskName: b.taskName,
      baseAdId: b.baseAdId,
      status,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
      partsTotal,
      partsCompleted,
      zipsAvailable,
      zipsLost,
      raw: b,
    });
  }
  // VA history
  for (const v of readVAHistory()) {
    const partsTotal = v.avatares.length;
    const partsCompleted = v.avatares.filter((a) => a.status === 'done').length;
    const status: Entry['status'] = partsCompleted === partsTotal ? 'done' : v.finishedAt ? 'failed' : 'in_progress';
    const zipsAvailable: Entry['zipsAvailable'] = [];
    const zipsLost: string[] = [];
    if (v.zipUrl && v.zipName) zipsAvailable.push({ label: 'VA avatares', href: v.zipUrl, filename: v.zipName });
    else if (v.zipName) zipsLost.push('VA avatares');
    out.push({
      kind: 'va',
      id: `va:${v.taskId}:${v.startedAt}`,
      taskName: v.taskName,
      baseAdId: v.baseAdId,
      status,
      startedAt: v.startedAt,
      finishedAt: v.finishedAt,
      partsTotal,
      partsCompleted,
      zipsAvailable,
      zipsLost,
      raw: v,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

type Period = 'all' | '7d' | '30d' | '90d' | '180d';
type KindFilter = 'all' | 'batch' | 'va';
type StatusFilter = 'all' | 'done' | 'failed' | 'in_progress';

export default function LipsyncHistoryPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEntries(toEntries());
    const onStorage = (e: StorageEvent) => {
      if (e.key === BATCH_STATE_KEY || e.key === VA_HISTORY_KEY) setEntries(toEntries());
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(() => setEntries(toEntries()), 3000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const periodMs: Record<Period, number> = {
      all: Infinity,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '180d': 180 * 24 * 60 * 60 * 1000,
    };
    const cutoff = now - periodMs[period];
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.startedAt < cutoff) return false;
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (q && !e.taskName.toLowerCase().includes(q) && !e.baseAdId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, period, kindFilter, statusFilter, search]);

  function removeEntry(e: Entry) {
    if (!confirm(`Remover "${e.taskName}" do historico?`)) return;
    if (e.kind === 'batch') {
      const cur = readBatches();
      const taskId = (e.raw as BatchTaskState).taskId;
      delete cur[taskId];
      localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(cur));
    } else {
      const cur = readVAHistory();
      const filtered = cur.filter((v) => !(v.taskId === (e.raw as VAHistoryEntry).taskId && v.startedAt === (e.raw as VAHistoryEntry).startedAt));
      localStorage.setItem(VA_HISTORY_KEY, JSON.stringify(filtered));
    }
    setEntries(toEntries());
  }

  function clearAllFailed() {
    if (!confirm('Limpar todas entradas com status failed?')) return;
    const batches = readBatches();
    for (const k of Object.keys(batches)) {
      if (batches[k].phase === 'failed') delete batches[k];
    }
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(batches));
    const va = readVAHistory().filter((v) => v.avatares.some((a) => a.status === 'done'));
    localStorage.setItem(VA_HISTORY_KEY, JSON.stringify(va));
    setEntries(toEntries());
  }

  const stats = useMemo(() => {
    return {
      total: entries.length,
      done: entries.filter((e) => e.status === 'done').length,
      failed: entries.filter((e) => e.status === 'failed').length,
      inProgress: entries.filter((e) => e.status === 'in_progress').length,
      videosDone: entries.reduce((sum, e) => sum + e.partsCompleted, 0),
    };
  }, [entries]);

  return (
    <ToolShell title="lipsync history" tagline="Todos os lipsyncs gerados pelo DARKO LAB — batches + VA">
      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-[10px] border border-line-strong bg-bg-soft/30 px-3 py-2">
            <div className="mono text-[9px] uppercase tracking-widest text-text-muted">Total</div>
            <div className="font-bold text-white text-lg">{stats.total}</div>
          </div>
          <div className="rounded-[10px] border border-lime/40 bg-lime/5 px-3 py-2">
            <div className="mono text-[9px] uppercase tracking-widest text-lime">Concluidos</div>
            <div className="font-bold text-lime text-lg">{stats.done}</div>
          </div>
          <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 px-3 py-2">
            <div className="mono text-[9px] uppercase tracking-widest text-cyan-200">Rodando</div>
            <div className="font-bold text-cyan-200 text-lg">{stats.inProgress}</div>
          </div>
          <div className="rounded-[10px] border border-red-500/40 bg-red-500/5 px-3 py-2">
            <div className="mono text-[9px] uppercase tracking-widest text-red-300">Falhas</div>
            <div className="font-bold text-red-300 text-lg">{stats.failed}</div>
          </div>
          <div className="rounded-[10px] border border-purple-500/40 bg-purple-500/5 px-3 py-2">
            <div className="mono text-[9px] uppercase tracking-widest text-purple-300">Videos gerados</div>
            <div className="font-bold text-purple-200 text-lg">{stats.videosDone}</div>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid gap-2 rounded-[14px] border border-line-strong bg-bg-soft/30 p-3 sm:grid-cols-4">
          <input
            type="text"
            placeholder="Buscar por nome / AD ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field text-xs sm:col-span-2"
          />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="input-field text-xs"
          >
            <option value="all">Todo o periodo</option>
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
            <option value="90d">Ultimos 90 dias</option>
            <option value="180d">Ultimos 180 dias</option>
          </select>
          <div className="flex gap-1">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="input-field text-xs flex-1"
            >
              <option value="all">Tipo: todos</option>
              <option value="batch">Batch (ClickUp Pilot)</option>
              <option value="va">VA (Variacao Avatar)</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="input-field text-xs flex-1"
            >
              <option value="all">Status: todos</option>
              <option value="done">Concluido</option>
              <option value="in_progress">Em andamento</option>
              <option value="failed">Falha</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
            {filtered.length} {filtered.length === 1 ? 'entrada' : 'entradas'}
          </span>
          <div className="ml-auto flex gap-2">
            <Link
              href="/tools/clickup-pilot"
              className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
            >
              → ClickUp Pilot
            </Link>
            <Link
              href="/tools/background"
              className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-fuchsia-500/60 hover:text-fuchsia-300"
            >
              → Background ao vivo
            </Link>
            <button
              type="button"
              onClick={clearAllFailed}
              className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
            >
              Limpar falhas
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-strong bg-bg-soft/20 p-10 text-center">
            <div className="mono text-[11px] uppercase tracking-widest text-text-muted">
              Nenhum lipsync no historico
            </div>
            <div className="mt-2 text-[13px] text-text-muted">
              Gere lipsyncs via <Link href="/tools/clickup-pilot" className="text-lime hover:underline">ClickUp Pilot</Link> — eles aparecem aqui automaticamente.
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((e) => {
              const isExpanded = !!expanded[e.id];
              const duration = e.finishedAt ? e.finishedAt - e.startedAt : null;
              const statusColor =
                e.status === 'done' ? 'border-lime/40 bg-lime/10 text-lime' :
                e.status === 'failed' ? 'border-red-500/40 bg-red-500/10 text-red-300' :
                'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
              const statusLabel =
                e.status === 'done' ? 'Concluido' :
                e.status === 'failed' ? 'Falhou' : 'Em andamento';

              return (
                <div key={e.id} className="rounded-[12px] border border-line-strong bg-bg-soft/30 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`mono rounded-md border px-2 py-0.5 text-[9px] uppercase tracking-widest ${e.kind === 'va' ? 'border-purple-500/40 bg-purple-500/10 text-purple-200' : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'}`}>
                          {e.kind === 'va' ? 'VA' : 'BATCH'}
                        </span>
                        <span className="mono rounded-md border border-line-strong bg-bg/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted">
                          {e.baseAdId}
                        </span>
                        <span className={`mono rounded-md border px-2 py-0.5 text-[9px] uppercase tracking-widest ${statusColor}`}>
                          {statusLabel}
                        </span>
                        <span className="mono text-[9px] uppercase tracking-widest text-text-muted">
                          {fmtDate(e.startedAt)}
                        </span>
                        {duration ? (
                          <span className="mono text-[9px] uppercase tracking-widest text-text-muted">
                            · {fmtElapsed(duration)}
                          </span>
                        ) : null}
                        <span className="mono text-[9px] uppercase tracking-widest text-lime">
                          {e.partsCompleted}/{e.partsTotal} videos
                        </span>
                      </div>
                      <div className="mt-1 text-[13px] text-white truncate">{e.taskName}</div>

                      {/* ZIPs */}
                      {e.zipsAvailable.length > 0 || e.zipsLost.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {e.zipsAvailable.map((z, i) => (
                            <a
                              key={i}
                              href={z.href}
                              download={z.filename}
                              className="mono rounded border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20"
                              title={z.filename}
                            >
                              ↓ {z.label}
                            </a>
                          ))}
                          {e.zipsLost.map((label, i) => (
                            <span
                              key={i}
                              className="mono rounded border border-text-muted/30 bg-bg/30 px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted"
                              title="ZIP foi gerado nessa sessao mas a Blob URL nao persiste em reload. Re-gere via ClickUp Pilot."
                            >
                              {label} (perdido)
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {/* Expanded details */}
                      {isExpanded ? (
                        <div className="mt-3 rounded-md border border-line/40 bg-bg/40 p-2">
                          {e.kind === 'batch' ? (
                            <div className="space-y-1">
                              {(e.raw as BatchTaskState).parts.map((p, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                  <span className="mono text-text-muted shrink-0">{p.label}</span>
                                  <span className="text-text-muted truncate">→ {p.renamedTo}</span>
                                  <span className={`mono ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${
                                    p.videoStatus === 'completed' ? 'bg-lime/10 text-lime' :
                                    p.error ? 'bg-red-500/10 text-red-300' :
                                    'bg-bg-soft/40 text-text-muted'
                                  }`}>
                                    {p.videoStatus || (p.error ? 'falha' : 'pendente')}
                                  </span>
                                  {p.videoId ? (
                                    <span className="mono text-[9px] text-text-muted truncate" title={p.videoId}>
                                      {p.videoId.slice(0, 12)}...
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {(e.raw as VAHistoryEntry).avatares.map((a, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                  <span className="mono text-purple-200 shrink-0">{a.avaCode}</span>
                                  <span className="text-text-muted">@{a.username}</span>
                                  <span className={`mono ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${
                                    a.status === 'done' ? 'bg-lime/10 text-lime' : 'bg-red-500/10 text-red-300'
                                  }`}>
                                    {a.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {(e.raw as BatchTaskState).message ? (
                            <div className="mt-2 text-[10px] text-text-muted italic">{(e.raw as BatchTaskState).message}</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [e.id]: !prev[e.id] }))}
                        className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                      >
                        {isExpanded ? '▲ Menos' : '▼ Detalhes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(e)}
                        className="mono rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-[14px] border border-dashed border-line-strong bg-bg-soft/10 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-text-muted">Notas</div>
          <div className="mt-1 text-[11px] text-text-muted leading-relaxed">
            • Persistencia local — depende do localStorage do browser. Limpar dados do site apaga tudo.<br/>
            • ZIPs marcados como &quot;perdido&quot; foram gerados numa sessao anterior; a Blob URL foi
            descartada no reload. Os videoIds das partes ficam salvos, entao da pra re-gerar o ZIP
            via &quot;Retomar&quot; no ClickUp Pilot enquanto a retencao HeyGen estiver ativa (60 dias).<br/>
            • Pra ver status atual ao vivo dos batches rodando, use{' '}
            <Link href="/tools/background" className="text-fuchsia-300 hover:underline">Background</Link>.
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
