'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ToolShell } from '@/components/ToolShell';
import { getPilotTeamNames, shortWorkspaceLabel } from '@/lib/clickup-pilot-config';

/**
 * Background Tasks — viewer dedicado dos batches do ClickUp Pilot.
 *
 * Le `darkolab:clickup-pilot:batches` do localStorage (mesma chave que
 * o ClickUp Pilot escreve), atualiza ao vivo via 'storage' event +
 * setInterval. Mostra fila + em processo + finalizados + ZIPs.
 *
 * Cancelar: marca taskId em `darkolab:clickup-pilot:cancel` — a aba
 * do ClickUp Pilot (se aberta) le esse flag e aborta o polling.
 * Se a aba nao estiver aberta, o batch ja parou (nao tem worker).
 *
 * Persiste reload via mesma chave localStorage do clickup-pilot.
 */

const BATCH_STATE_KEY = 'darkolab:clickup-pilot:batches';
const CANCEL_KEY = 'darkolab:clickup-pilot:cancel';
const MAGNIFIC_QUEUE_KEY = 'darkolab:clickup-pilot:magnific-queue';

type MagnificJob = {
  taskId: string;
  adName: string;
  takeCount: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  gateOnHeyGen: boolean;
  percent?: number;
  message?: string;
  enqueuedAt: number;
  zipKey?: string;
  zipName?: string;
};

function readMagnificQueue(): Record<string, MagnificJob> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MAGNIFIC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function downloadMagnificZipBg(job: MagnificJob) {
  if (!job.zipKey) return;
  try {
    const { loadZip } = await import('@/lib/zip-store');
    const rec = await loadZip(job.zipKey);
    if (!rec) {
      alert('ZIP Magnific nao encontrado no armazenamento local.');
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
    console.error('[background] download zip', e);
    alert('Não consegui baixar esse pacote agora. Tenta de novo em instantes.');
  }
}

type BatchTaskState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  /** Empresa dona do disparo. Aqui NADA é escondido — este viewer existe
   *  justamente pra você achar o que ficou rodando — mas o card ganha o
   *  selo da empresa pra não confundir uma com a outra. */
  teamId?: string;
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

function readBatches(): Record<string, BatchTaskState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BATCH_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readCancelMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CANCEL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function phaseLabel(p: BatchTaskState['phase']): string {
  const map: Record<BatchTaskState['phase'], string> = {
    queued: 'Na fila',
    dispatching: 'Disparando',
    rendering: 'Renderizando',
    downloading: 'Baixando',
    post: 'Finalizando (juntando + decupando)',
    done: 'Concluído',
    failed: 'Falhou',
  };
  return map[p] || p;
}

function phaseColor(p: BatchTaskState['phase']): string {
  if (p === 'done') return 'text-lime border-lime/40 bg-lime/10';
  if (p === 'failed') return 'text-red-300 border-red-500/40 bg-red-500/10';
  if (p === 'queued') return 'text-text-muted border-line-strong bg-bg-soft/40';
  return 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10';
}

function percentForPhase(b: BatchTaskState): number {
  if (b.phase === 'done') return 100;
  if (b.phase === 'failed') return 0;
  if (b.phase === 'queued') return 5;
  if (b.phase === 'dispatching') return 20;
  if (b.phase === 'rendering') {
    const done = b.parts.filter((p) => p.videoStatus === 'completed').length;
    const total = b.parts.length || 1;
    return 30 + Math.floor((done / total) * 40);
  }
  if (b.phase === 'downloading') return 75;
  if (b.phase === 'post') return 90;
  return 0;
}

export default function BackgroundTasksPage() {
  const [batches, setBatches] = useState<Record<string, BatchTaskState>>({});
  // id→nome das empresas, gravado pelo Pilot — só pro selo do card.
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  useEffect(() => setTeamNames(getPilotTeamNames()), []);
  const [cancelMap, setCancelMap] = useState<Record<string, number>>({});
  const [magnific, setMagnific] = useState<Record<string, MagnificJob>>({});
  const [tick, setTick] = useState(0);
  /** Filtro de tipo: tudo | so lipsync (HeyGen) | so b-rolls (Magnific) */
  const [typeFilter, setTypeFilter] = useState<'all' | 'lip' | 'broll'>('all');

  useEffect(() => {
    setBatches(readBatches());
    setCancelMap(readCancelMap());
    setMagnific(readMagnificQueue());
    const onStorage = (e: StorageEvent) => {
      if (e.key === BATCH_STATE_KEY) setBatches(readBatches());
      if (e.key === CANCEL_KEY) setCancelMap(readCancelMap());
      if (e.key === MAGNIFIC_QUEUE_KEY) setMagnific(readMagnificQueue());
    };
    window.addEventListener('storage', onStorage);
    // Tambem refazer leitura periodica pra abas mesma origem nao disparam storage
    const id = setInterval(() => {
      setBatches(readBatches());
      setMagnific(readMagnificQueue());
      setTick((t) => t + 1);
    }, 1500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  const sorted = useMemo(() => {
    const arr = Object.values(batches);
    // Ordem: em processo > queued > done > failed (mais novos primeiro)
    const phaseOrder: Record<BatchTaskState['phase'], number> = {
      dispatching: 0,
      rendering: 0,
      downloading: 0,
      post: 0,
      queued: 1,
      done: 2,
      failed: 3,
    };
    return arr.sort((a, b) => {
      const pa = phaseOrder[a.phase] ?? 9;
      const pb = phaseOrder[b.phase] ?? 9;
      if (pa !== pb) return pa - pb;
      return b.startedAt - a.startedAt;
    });
  }, [batches, tick]);

  const counts = useMemo(() => {
    const running = sorted.filter((b) => ['dispatching', 'rendering', 'downloading', 'post'].includes(b.phase)).length;
    const queued = sorted.filter((b) => b.phase === 'queued').length;
    const done = sorted.filter((b) => b.phase === 'done').length;
    const failed = sorted.filter((b) => b.phase === 'failed').length;
    return { running, queued, done, failed, total: sorted.length };
  }, [sorted]);

  function cancelTask(taskId: string) {
    if (!confirm('Cancelar esse item? Vai parar os downloads e a finalização que estiverem em andamento.')) return;
    const map = readCancelMap();
    map[taskId] = Date.now();
    localStorage.setItem(CANCEL_KEY, JSON.stringify(map));
    setCancelMap(map);
    // Tambem marca o batch como failed pra dar feedback imediato
    const current = readBatches();
    if (current[taskId]) {
      current[taskId] = { ...current[taskId], phase: 'failed', message: 'Cancelado por você', finishedAt: Date.now() };
      localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(current));
      setBatches(current);
    }
  }

  function removeTask(taskId: string) {
    if (!confirm('Remover esse item do histórico? (Não apaga os ZIPs que você já baixou)')) return;
    const current = readBatches();
    delete current[taskId];
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(current));
    setBatches(current);
  }

  function clearAllDone() {
    if (!confirm('Limpar tudo que já concluiu ou falhou?')) return;
    const current = readBatches();
    for (const k of Object.keys(current)) {
      if (current[k].phase === 'done' || current[k].phase === 'failed') {
        delete current[k];
      }
    }
    localStorage.setItem(BATCH_STATE_KEY, JSON.stringify(current));
    setBatches(current);
  }

  return (
    <ToolShell
      title="Tarefas em segundo plano"
      eyebrow="FILA"
      description="Tudo o que está rodando agora. Você pode fechar a aba — o trabalho continua."
      hue="rgba(34,211,238,0.42)"
    >
      <div className="space-y-4">
        {/* Top — contadores + acoes */}
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line-strong bg-bg-soft/30 p-3">
          <span className="mono rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-200">
            Em processo: {counts.running}
          </span>
          <span className="mono rounded-full border border-line-strong bg-bg/40 px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted">
            Na fila: {counts.queued}
          </span>
          <span className="mono rounded-full border border-lime/40 bg-lime/10 px-3 py-1 text-[10px] uppercase tracking-widest text-lime">
            Concluídos: {counts.done}
          </span>
          <span className="mono rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-red-300">
            Falhas: {counts.failed}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/tools/clickup-pilot"
              className="label-tech rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
            >
              ← Pilot
            </Link>
            <button
              type="button"
              onClick={clearAllDone}
              disabled={counts.done + counts.failed === 0}
              className="label-tech rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
            >
              Limpar concluídos/falhas
            </button>
          </div>
        </div>

        {/* Filtro de tipo — separa lipsync (HeyGen) de b-rolls (Magnific) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-tech text-[10px] uppercase tracking-widest text-text-muted">Mostrar:</span>
          {([
            { k: 'all', label: 'Tudo' },
            { k: 'lip', label: '🎙 Lipsync (HeyGen)' },
            { k: 'broll', label: '🍌 B-Rolls (Magnific)' },
          ] as const).map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() => setTypeFilter(opt.k)}
              className={
                'label-tech rounded-md border px-3 py-1.5 text-[10px] uppercase tracking-widest transition ' +
                (typeFilter === opt.k
                  ? 'border-lime bg-lime/15 text-lime'
                  : 'border-line-strong text-text-muted hover:border-lime/50 hover:text-lime')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {typeFilter === 'broll' ? null : sorted.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-strong bg-bg-soft/20 p-12 text-center">
            <div className="label-tech text-[11px] uppercase tracking-widest text-text-muted">
              Nenhum trabalho em andamento
            </div>
            <div className="mt-3 text-[13px] text-text-muted">
              Volte pro <Link href="/tools/clickup-pilot" className="text-lime hover:underline">Pilot</Link> e dispare
              uma task analisada — ela aparece aqui ao vivo.
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {sorted.map((b) => {
              const isRunning = ['dispatching', 'rendering', 'downloading', 'post'].includes(b.phase);
              const pct = percentForPhase(b);
              const partsTotal = b.parts.length;
              const partsDispatched = b.parts.filter((p) => p.videoId).length;
              const partsRendered = b.parts.filter((p) => p.videoStatus === 'completed').length;
              const partsFailed = b.parts.filter((p) => p.error).length;
              const elapsed = (b.finishedAt ?? Date.now()) - b.startedAt;

              return (
                <div key={b.taskId} className="rounded-[14px] border border-line-strong bg-bg-soft/30 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-cyan-200">
                          {b.baseAdId}
                        </span>
                        <span className={`label-tech rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${phaseColor(b.phase)}`}>
                          {phaseLabel(b.phase)}
                        </span>
                        <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                          {fmtElapsed(elapsed)}
                        </span>
                        {b.phase !== 'done' && b.phase !== 'failed' ? (
                          <span className="mono text-[10px] uppercase tracking-widest text-lime">
                            {pct}%
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-white">
                        {b.taskName}
                        {b.teamId ? (
                          <span className="mono rounded-full border border-line-strong px-2 py-0.5 text-[9.5px] uppercase tracking-widest text-text-muted">
                            {shortWorkspaceLabel(teamNames[b.teamId] ?? b.teamId)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-muted">{b.message || '—'}</div>

                      {/* Barra de progresso */}
                      {b.phase !== 'failed' ? (
                        <div className="mt-2 h-1 rounded bg-bg/60 overflow-hidden">
                          <div className={`h-full transition-all ${b.phase === 'done' ? 'bg-lime' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      ) : null}

                      {/* Parts breakdown */}
                      {partsTotal > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                          <span className="mono rounded border border-line-strong bg-bg/40 px-1.5 py-0.5 uppercase tracking-widest text-text-muted">
                            partes: {partsTotal}
                          </span>
                          {partsDispatched > 0 ? (
                            <span className="mono rounded border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 uppercase tracking-widest text-cyan-200">
                              disparadas: {partsDispatched}
                            </span>
                          ) : null}
                          {partsRendered > 0 ? (
                            <span className="mono rounded border border-lime/30 bg-lime/5 px-1.5 py-0.5 uppercase tracking-widest text-lime">
                              renderizadas: {partsRendered}
                            </span>
                          ) : null}
                          {partsFailed > 0 ? (
                            <span className="mono rounded border border-red-500/40 bg-red-500/5 px-1.5 py-0.5 uppercase tracking-widest text-red-300">
                              falhas: {partsFailed}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {/* ZIPs disponiveis */}
                      {b.phase === 'done' && (b.zipFilename || b.montadoZipName || b.camufladoZipName) ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {b.zipBlobUrl && b.zipFilename ? (
                            <a
                              href={b.zipBlobUrl}
                              download={b.zipFilename}
                              className="mono rounded border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20"
                            >
                              ↓ takes ({b.zipFilename})
                            </a>
                          ) : b.zipFilename ? (
                            <span className="mono rounded border border-text-muted/30 bg-bg/30 px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted" title="O ZIP foi gerado, mas o link se perdeu ao recarregar a página. Gere de novo pelo Pilot.">
                              takes (perdido no reload)
                            </span>
                          ) : null}
                          {b.montadoZipUrl && b.montadoZipName ? (
                            <a
                              href={b.montadoZipUrl}
                              download={b.montadoZipName}
                              className="mono rounded border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20"
                            >
                              ↓ montado/decupado ({b.montadoZipName})
                            </a>
                          ) : b.montadoZipName ? (
                            <span className="mono rounded border border-text-muted/30 bg-bg/30 px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted">
                              montado (perdido no reload)
                            </span>
                          ) : null}
                          {b.camufladoZipUrl && b.camufladoZipName ? (
                            <a
                              href={b.camufladoZipUrl}
                              download={b.camufladoZipName}
                              className="mono rounded border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20"
                            >
                              ↓ camuflado ({b.camufladoZipName})
                            </a>
                          ) : b.camufladoZipName ? (
                            <span className="mono rounded border border-text-muted/30 bg-bg/30 px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted">
                              camuflado (perdido no reload)
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5">
                      {isRunning || b.phase === 'queued' ? (
                        <button
                          type="button"
                          onClick={() => cancelTask(b.taskId)}
                          className="label-tech rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                          title="Para os downloads e a finalização desse item"
                        >
                          ✕ Cancelar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeTask(b.taskId)}
                        className="label-tech rounded-md border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                        title="Remove essa entrada do histórico (não apaga os ZIPs que você já baixou)"
                      >
                        Remover
                      </button>
                      {cancelMap[b.taskId] ? (
                        <span className="label-tech rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-yellow-200 text-center">
                          cancelamento pedido
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Fila Magnific B-Rolls — serial 1/vez */}
        {typeFilter !== 'lip' && Object.keys(magnific).length > 0 ? (
          <div className="rounded-[14px] border border-lime/40 bg-lime/5 p-4">
            <div className="label-tech mb-3 text-[11px] uppercase tracking-widest text-lime">
              🍌 Fila Magnific B-Rolls ({Object.keys(magnific).length}) · serial 1 por vez
            </div>
            <div className="grid gap-3">
              {Object.values(magnific).sort((a, b) => b.enqueuedAt - a.enqueuedAt).map((j) => {
                const stLabel = ({
                  queued: j.gateOnHeyGen ? 'Aguardando HeyGen da task' : 'Na fila',
                  running: 'Gerando B-rolls',
                  done: 'Concluído',
                  failed: 'Falhou',
                })[j.status];
                const stColor = j.status === 'done' ? 'text-lime border-lime/40 bg-lime/10'
                  : j.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                  : j.status === 'running' ? 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10'
                  : 'text-text-muted border-line-strong bg-bg-soft/40';
                const pct = j.status === 'done' ? 100 : j.status === 'failed' ? 0 : (j.percent || (j.status === 'running' ? 5 : 0));
                return (
                  <div key={j.taskId} className="rounded-[12px] border border-line-strong bg-bg-soft/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono rounded-md border border-lime/40 bg-lime/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                        {j.adName}
                      </span>
                      <span className={`label-tech rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${stColor}`}>
                        {stLabel}
                      </span>
                      <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                        {j.takeCount} take{j.takeCount === 1 ? '' : 's'}
                      </span>
                      {j.status === 'done' && j.zipKey ? (
                        <button
                          type="button"
                          onClick={() => downloadMagnificZipBg(j)}
                          className="mono ml-auto rounded border border-lime/40 bg-lime/10 px-2 py-1 text-[10px] uppercase tracking-widest text-lime hover:bg-lime/20"
                        >
                          ↓ takes ({j.zipName})
                        </button>
                      ) : null}
                    </div>
                    {j.message ? <div className="mt-1 text-[11px] text-text-muted">{j.message}</div> : null}
                    {j.status !== 'failed' ? (
                      <div className="mt-2 h-1 rounded bg-bg/60 overflow-hidden">
                        <div className={`h-full transition-all ${j.status === 'done' ? 'bg-lime' : 'bg-cyan-400'}`} style={{ width: `${pct}%` }} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="mono mt-3 text-[10px] text-text-muted leading-relaxed">
              Os B-rolls rodam 1 por vez, em fila. Cada item espera os avatares
              daquela task ficarem prontos antes de começar. A fila vive na aba do ClickUp
              Pilot — se fechar a aba ela pausa; reabra e ela retoma do ponto.
            </div>
          </div>
        ) : null}

        <div className="rounded-[14px] border border-dashed border-line-strong bg-bg-soft/10 p-3">
          <div className="label-tech text-[10px] uppercase tracking-widest text-text-muted">
            Como funciona
          </div>
          <div className="mt-1 text-[11px] text-text-muted leading-relaxed">
            Tasks iniciadas no Pilot aparecem aqui ao vivo. O andamento fica salvo
            no seu navegador, então sobrevive se você recarregar a página. Os ZIPs gerados
            ficam disponíveis na própria aba do Pilot (o link de download se perde
            ao recarregar — gere de novo se precisar).
            <br/><br/>
            Cancelar avisa a aba do Pilot pra parar aquele item.
            Se aquela aba já foi fechada, não tem mais nada rodando — aí o &quot;cancelar&quot;
            só ajusta o estado visual.
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
