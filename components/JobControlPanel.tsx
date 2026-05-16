'use client';

import { useEffect, useState } from 'react';
import { sendJobCommand, navigateToEngine } from '@/lib/job-commands';

/**
 * Painel de controle de jobs (Retomar / Pausar / Debug) reutilizavel.
 *
 * Mostra os batches HeyGen (`darkolab:clickup-pilot:batches`) e/ou a fila
 * Magnific (`darkolab:clickup-pilot:magnific-queue`) lidos do localStorage,
 * com os 3 botoes. Os botoes NAO executam aqui — gravam um comando no
 * command-bus; o motor real (pagina ClickUp Pilot) consome e executa.
 *
 * Retomar/Debug navegam pro ClickUp Pilot (garante que o worker rode);
 * Pausar so grava o flag (a aba que estiver rodando o job pausa).
 *
 * Usado em: lipsync-history, heygen-auto, auto-broll — pra ter os 3
 * botoes mesmo sem ter vindo do ClickUp Pilot.
 */

const BATCH_KEY = 'darkolab:clickup-pilot:batches';
const MAGNIFIC_KEY = 'darkolab:clickup-pilot:magnific-queue';

type BatchState = {
  taskId: string;
  taskName: string;
  baseAdId: string;
  phase: 'queued' | 'dispatching' | 'rendering' | 'downloading' | 'post' | 'done' | 'failed';
  parts: Array<{ videoId: string | null }>;
  message?: string;
  startedAt: number;
};

type MagnificJob = {
  taskId: string;
  adName: string;
  takeCount: number;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  gateOnHeyGen?: boolean;
  message?: string;
  enqueuedAt: number;
};

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function JobControlPanel({
  scopes = ['heygen', 'magnific'],
}: {
  scopes?: Array<'heygen' | 'magnific'>;
}) {
  const [batches, setBatches] = useState<Record<string, BatchState>>({});
  const [magnific, setMagnific] = useState<Record<string, MagnificJob>>({});
  const [open, setOpen] = useState(false); // minimizado por padrao

  useEffect(() => {
    const refresh = () => {
      setBatches(readJson<Record<string, BatchState>>(BATCH_KEY) || {});
      setMagnific(readJson<Record<string, MagnificJob>>(MAGNIFIC_KEY) || {});
    };
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === BATCH_KEY || e.key === MAGNIFIC_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    const id = setInterval(refresh, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  const act = (
    scope: 'heygen' | 'magnific',
    taskId: string,
    action: 'retomar' | 'pausar' | 'debug',
    label: string,
  ) => {
    if (action === 'debug' && !confirm(`DEBUG: reiniciar "${label}" do ZERO?\n\nAborta o processo atual e recomeca limpo (space/videos novos).`)) return;
    sendJobCommand(scope, taskId, action);
    if (action === 'pausar') {
      // Pausar nao navega — so sinaliza. Se houver aba ClickUp Pilot
      // rodando o job, ela pausa; se nao ha worker, nada esta rodando.
      return;
    }
    // Retomar/Debug precisam do motor: abre o ClickUp Pilot, que consome
    // o comando no mount e executa no worker real.
    navigateToEngine();
  };

  const Btns = ({
    scope,
    taskId,
    label,
  }: {
    scope: 'heygen' | 'magnific';
    taskId: string;
    label: string;
  }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => act(scope, taskId, 'retomar', label)}
        className="mono rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/25"
        title="Retomar (abre o ClickUp Pilot e re-roda/baixa no motor real)"
      >
        🔄 Retomar
      </button>
      <button
        type="button"
        onClick={() => act(scope, taskId, 'pausar', label)}
        className="mono rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-yellow-200 hover:bg-yellow-500/20"
        title="Pausar (sinaliza a aba que estiver rodando o job pra abortar)"
      >
        ⏸ Pausar
      </button>
      <button
        type="button"
        onClick={() => act(scope, taskId, 'debug', label)}
        className="mono rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20"
        title="DEBUG (reserva p/ bugs/loop): aborta e recria do ZERO no motor"
      >
        🐞 Debug
      </button>
    </div>
  );

  const batchList = Object.values(batches).sort((a, b) => b.startedAt - a.startedAt);
  const magList = Object.values(magnific).sort((a, b) => b.enqueuedAt - a.enqueuedAt);
  const showHeygen = scopes.includes('heygen');
  const showMag = scopes.includes('magnific');
  const empty =
    (!showHeygen || batchList.length === 0) && (!showMag || magList.length === 0);

  const total =
    (showHeygen ? batchList.length : 0) + (showMag ? magList.length : 0);

  return (
    <div className="rounded-[14px] border border-line-strong bg-bg-soft/30 p-3">
      <div className="mono flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-text-muted">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-text-muted hover:text-lime"
          title={open ? 'Minimizar' : 'Expandir lista de jobs'}
        >
          <span>{open ? '▾' : '▸'}</span>
          <span>Controle de jobs — Retomar / Pausar / Debug</span>
          <span className="rounded-full border border-line-strong bg-bg/40 px-2 py-0.5 text-text-muted">
            {total}
          </span>
        </button>
        <a
          href="/tools/clickup-pilot"
          className="rounded border border-line-strong px-2 py-0.5 text-text-muted hover:border-lime hover:text-lime"
        >
          → motor (ClickUp Pilot)
        </a>
      </div>

      {!open ? null : empty ? (
        <div className="rounded-[10px] border border-dashed border-line-strong bg-bg/20 px-3 py-4 text-center text-[11px] text-text-muted">
          Nenhum job persistido ainda. Quando voce disparar lipsyncs/B-rolls,
          eles aparecem aqui e podem ser controlados de qualquer tela.
        </div>
      ) : (
        <div className="grid gap-3">
          {showHeygen && batchList.length > 0 ? (
            <div>
              <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-cyan-200">
                HeyGen Auto (lipsync) — {batchList.length}
              </div>
              <ul className="grid gap-1.5">
                {batchList.map((b) => {
                  const stColor =
                    b.phase === 'done' ? 'text-lime border-lime/40 bg-lime/10'
                      : b.phase === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                      : 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10';
                  const dispatched = b.parts.filter((p) => p.videoId).length;
                  return (
                    <li key={b.taskId} className={`rounded-[10px] border ${stColor} p-2`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="mono">
                          <strong className="text-white">{b.taskName || b.baseAdId}</strong>
                          <span className="ml-2 uppercase">{b.phase}</span>
                          <span className="ml-2 text-text-muted">· {dispatched}/{b.parts.length} disparados</span>
                        </span>
                        <Btns scope="heygen" taskId={b.taskId} label={b.taskName || b.baseAdId} />
                      </div>
                      {b.message ? (
                        <div className="mono mt-1 text-[10px] text-text-muted">{b.message}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {showMag && magList.length > 0 ? (
            <div>
              <div className="mono mb-1.5 text-[9px] uppercase tracking-widest text-lime">
                Magnific Auto B-Rolls — {magList.length} · fila serial 1/vez
              </div>
              <ul className="grid gap-1.5">
                {magList.map((j) => {
                  const stColor =
                    j.status === 'done' ? 'text-lime border-lime/40 bg-lime/10'
                      : j.status === 'failed' ? 'text-red-300 border-red-500/40 bg-red-500/10'
                      : j.status === 'paused' ? 'text-yellow-200 border-yellow-500/40 bg-yellow-500/10'
                      : j.status === 'running' ? 'text-cyan-200 border-cyan-500/40 bg-cyan-500/10'
                      : 'text-text-muted border-line-strong bg-bg-soft/40';
                  return (
                    <li key={j.taskId} className={`rounded-[10px] border ${stColor} p-2`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="mono">
                          <strong className="text-white">{j.adName}</strong>
                          <span className="ml-2 uppercase">{j.status}</span>
                          <span className="ml-2 text-text-muted">· {j.takeCount} takes</span>
                        </span>
                        <Btns scope="magnific" taskId={j.taskId} label={j.adName} />
                      </div>
                      {j.message ? (
                        <div className="mono mt-1 text-[10px] text-text-muted">{j.message}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {open ? (
        <div className="mono mt-2 text-[9px] text-text-muted leading-relaxed">
          Retomar/Debug abrem o ClickUp Pilot (o motor) e executam no worker real —
          funciona mesmo sem ter vindo de la. Pausar sinaliza a aba que estiver
          rodando o job. A fila Magnific roda 1 por vez sempre.
        </div>
      ) : null}
    </div>
  );
}
