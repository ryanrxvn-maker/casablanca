'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { CancelButton } from '@/components/CancelButton';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

/**
 * Remover Legenda — Smart Mode (motor LOCAL, 100% offline, sem custo).
 *
 * O processamento NAO usa API paga (Claude Haiku) nem o servidor do Vercel.
 * Em vez disso, fala direto com o sidecar Python rodando em 127.0.0.1:8765
 * (engine/subtitle-remover-local). Pipeline:
 *   PaddleOCR (deteccao hard-sub) -> mascara persistente -> OpenCV Telea
 *   inpaint frame-a-frame -> remux com audio original (ffmpeg libx264 + aac).
 *
 * Acesso: apenas conta admin (gated no rail e validado server-side em
 * /api/remover-elementos/detect, embora o fluxo principal nem passe la).
 *
 * Pre-requisito: o admin precisa rodar `start.bat` no engine local pra
 * subir o server. A UI mostra status do server e bloqueia upload se off.
 */

const LOCAL_BASE = 'http://127.0.0.1:8765';
const MAX_BATCH = 5;
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

type ServerStatus =
  | { state: 'checking' }
  | { state: 'online'; ready: boolean; deps: Record<string, boolean> }
  | { state: 'offline'; reason: string };

type JobState =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled';

type Job = {
  id: string;            // id local (estavel pra UI)
  remoteId: string | null;
  file: File;
  state: JobState;
  progress: number;      // 0..1
  stage: string;
  resultBlob: Blob | null;
  resultUrl: string | null;
  error: string | null;
  abortCtrl: AbortController | null;
};

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function jobIdFor(f: File) {
  return f.name + ':' + f.size + ':' + f.lastModified;
}

function newJob(file: File): Job {
  return {
    id: jobIdFor(file),
    remoteId: null,
    file,
    state: 'queued',
    progress: 0,
    stage: '',
    resultBlob: null,
    resultUrl: null,
    error: null,
    abortCtrl: null,
  };
}

export default function RemoverElementosPage() {
  // ---------- Admin gate (client-side) ----------
  const [adminCheck, setAdminCheck] = useState<
    'loading' | 'allowed' | 'denied'
  >('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) {
          if (!cancelled) setAdminCheck('denied');
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled) return;
        setAdminCheck(data?.is_admin ? 'allowed' : 'denied');
      } catch {
        if (!cancelled) setAdminCheck('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Server status ----------
  const [server, setServer] = useState<ServerStatus>({ state: 'checking' });

  const checkServer = useCallback(async () => {
    setServer({ state: 'checking' });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(LOCAL_BASE + '/health', {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(t);
      if (!res.ok) {
        setServer({ state: 'offline', reason: 'HTTP ' + res.status });
        return;
      }
      const json = (await res.json()) as {
        ok: boolean;
        ready: boolean;
        deps: Record<string, boolean>;
      };
      setServer({ state: 'online', ready: json.ready, deps: json.deps });
    } catch (e) {
      setServer({
        state: 'offline',
        reason:
          e instanceof Error && e.name === 'AbortError'
            ? 'timeout'
            : 'sem resposta',
      });
    }
  }, []);

  useEffect(() => {
    if (adminCheck !== 'allowed') return;
    checkServer();
    const id = setInterval(checkServer, 15_000);
    return () => clearInterval(id);
  }, [adminCheck, checkServer]);

  // ---------- Tool state ----------
  const [files, setFiles] = useToolState<File[]>('remover:files', []);
  const [mode, setMode] = useToolState<'telea' | 'lama'>(
    'remover:mode',
    'telea',
  );
  const [jobs, setJobs] = useToolState<Job[]>('remover:jobs', []);
  const [processing, setProcessing] = useToolState<boolean>(
    'remover:processing',
    false,
  );
  const [zipping, setZipping] = useToolState<boolean>('remover:zipping', false);
  const [error, setError] = useToolState<string | null>('remover:error', null);

  const activeRef = useRef(false);
  activeRef.current = processing;

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  function setFilesSafe(next: File[]) {
    if (processing) return;
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    setJobs([]);
    setError(null);
    setFiles(next.slice(0, MAX_BATCH));
  }

  const validation: string[] = (() => {
    const errs: string[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        errs.push(`${f.name}: ${formatBytes(f.size)} excede 500MB.`);
      }
    }
    return errs;
  })();

  // ---------- Worker por job ----------
  async function processOne(job: Job) {
    const abort = new AbortController();
    updateJob(job.id, {
      state: 'uploading',
      progress: 0,
      stage: 'Enviando vídeo pro motor local...',
      abortCtrl: abort,
    });

    // 1) cria o job no server local
    const form = new FormData();
    form.append('file', job.file);
    form.append('mode', mode);

    let remoteId: string;
    try {
      const res = await fetch(LOCAL_BASE + '/jobs', {
        method: 'POST',
        body: form,
        signal: abort.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('Falha ao iniciar job: ' + (t || res.status));
      }
      const json = (await res.json()) as { job_id: string };
      remoteId = json.job_id;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        updateJob(job.id, {
          state: 'cancelled',
          error: 'Cancelado pelo usuário.',
        });
        return;
      }
      updateJob(job.id, {
        state: 'error',
        error: (e as Error).message ?? 'Falha desconhecida.',
      });
      return;
    }

    updateJob(job.id, {
      remoteId,
      state: 'processing',
      stage: 'PaddleOCR + inpaint...',
      progress: 0.05,
    });

    // 2) polling
    let done = false;
    while (!done) {
      if (abort.signal.aborted) {
        try {
          await fetch(LOCAL_BASE + '/jobs/' + remoteId, { method: 'DELETE' });
        } catch {
          /* noop */
        }
        updateJob(job.id, {
          state: 'cancelled',
          error: 'Cancelado pelo usuário.',
        });
        return;
      }

      try {
        const res = await fetch(LOCAL_BASE + '/jobs/' + remoteId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = (await res.json()) as {
          state: string;
          progress: number;
          stage: string;
          error: string | null;
        };
        if (json.state === 'running' || json.state === 'queued') {
          updateJob(job.id, {
            progress: json.progress || 0,
            stage: json.stage || '...',
          });
        } else if (json.state === 'done') {
          done = true;
          break;
        } else if (json.state === 'error') {
          updateJob(job.id, {
            state: 'error',
            error: json.error ?? 'Falha no motor local.',
          });
          return;
        }
      } catch (e) {
        updateJob(job.id, {
          state: 'error',
          error: 'Conexão com o motor local caiu: ' + (e as Error).message,
        });
        return;
      }
      // Polling rate 800ms — suficiente pra UI suave
      await new Promise((r) => setTimeout(r, 800));
    }

    // 3) baixa o resultado
    updateJob(job.id, { stage: 'Baixando vídeo limpo...', progress: 0.97 });
    try {
      const res = await fetch(LOCAL_BASE + '/jobs/' + remoteId + '/result');
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('Falha ao baixar resultado: ' + (t || res.status));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      updateJob(job.id, {
        state: 'done',
        progress: 1,
        stage: '',
        resultBlob: blob,
        resultUrl: url,
      });
    } catch (e) {
      updateJob(job.id, {
        state: 'error',
        error: (e as Error).message ?? 'Falha ao baixar.',
      });
    }
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    if (validation.length > 0) {
      setError(validation[0]);
      return;
    }
    if (server.state !== 'online' || !server.ready) {
      setError(
        'Motor local offline. Inicie o sidecar (engine/subtitle-remover-local/start.bat) e tente de novo.',
      );
      return;
    }

    setProcessing(true);
    setError(null);
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    const initial = files.map(newJob);
    setJobs(initial);

    try {
      for (const j of initial) {
        await processOne(j);
      }
    } finally {
      setProcessing(false);
    }
  }

  function cancelAll() {
    jobs.forEach((j) => j.abortCtrl?.abort());
  }

  async function downloadOne(job: Job) {
    if (!job.resultBlob) return;
    await downloadBlob(job.resultBlob, baseName(job.file.name) + '_limpo.mp4');
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_limpo.mp4',
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'videos_limpos.zip');
    } finally {
      setZipping(false);
    }
  }

  // ---------- Render ----------

  if (adminCheck === 'loading') {
    return (
      <ToolShell title="Remover Legenda" description="Verificando acesso...">
        <div className="mono text-xs uppercase tracking-widest text-text-muted">
          carregando...
        </div>
      </ToolShell>
    );
  }

  if (adminCheck === 'denied') {
    return (
      <ToolShell
        title="Acesso restrito"
        description="Esta ferramenta está disponível apenas para a conta admin."
      >
        <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Acesso negado.
        </div>
      </ToolShell>
    );
  }

  const doneJobs = jobs.filter((j) => j.state === 'done');
  const hasResults = doneJobs.length > 0;

  const serverBadge = (() => {
    if (server.state === 'checking') {
      return (
        <span className="mono inline-flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
          Detectando motor local...
        </span>
      );
    }
    if (server.state === 'offline') {
      return (
        <span className="mono inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
          Motor offline ({server.reason})
        </span>
      );
    }
    const deps = server.deps;
    const allOk = server.ready;
    return (
      <span
        className={
          'mono inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest ' +
          (allOk
            ? 'border-lime/50 bg-lime/10 text-lime'
            : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300')
        }
      >
        <span
          className={
            'h-1.5 w-1.5 rounded-full ' +
            (allOk ? 'bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]' : 'bg-yellow-400')
          }
        />
        Motor local {allOk ? 'pronto' : 'parcial'} · OCR{' '}
        {deps.paddleocr ? '✓' : '✗'} · FF {deps.ffmpeg ? '✓' : '✗'}
        {deps.lama ? ' · LaMa ✓' : ''}
      </span>
    );
  })();

  return (
    <ToolShell
      title="Remover Legenda & Marca d'Água"
      description="Smart Mode local: PaddleOCR detecta legendas hard-coded e o motor de inpainting limpa o vídeo frame-a-frame. 100% offline, sem custo de API. Apenas admin."
    >
      <div className="flex flex-col gap-6">
        {/* Status do motor local */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-bg-soft/40 px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-widest text-text-muted">
              motor de processamento
            </span>
            <span className="text-sm text-white">
              {LOCAL_BASE.replace('http://', '')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {serverBadge}
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 text-[10px] uppercase tracking-widest"
              onClick={checkServer}
              disabled={server.state === 'checking'}
            >
              recheck
            </button>
          </div>
        </div>

        {server.state === 'offline' ? (
          <div className="rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-100">
            <div className="mono mb-2 text-[10px] uppercase tracking-widest text-yellow-300">
              Como iniciar o motor local
            </div>
            <ol className="ml-4 list-decimal space-y-1 text-text">
              <li>
                Abra <code className="mono text-lime">engine/subtitle-remover-local/start.bat</code>
              </li>
              <li>
                (Primeira vez) Rode:&nbsp;
                <code className="mono text-lime">python -m venv .venv</code>,&nbsp;
                <code className="mono text-lime">.venv\Scripts\activate</code>,&nbsp;
                <code className="mono text-lime">pip install -r requirements.txt</code>
              </li>
              <li>
                Deixe a janela aberta enquanto usar a ferramenta. Esta página
                detecta automaticamente.
              </li>
            </ol>
          </div>
        ) : null}

        {/* Upload */}
        <div>
          <label className="label-field">Vídeos (até {MAX_BATCH})</label>
          <BatchFileUpload
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP4, MOV, WEBM, MKV — até 500MB cada"
            disabled={processing}
          />
          {validation.length > 0 ? (
            <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {validation.map((v, i) => (
                <div key={i}>· {v}</div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Modo de inpaint */}
        <div>
          <label className="label-field">Qualidade do inpainting</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              {
                id: 'telea' as const,
                label: 'Rápido (Telea)',
                desc: 'OpenCV Telea — CPU, ~1x realtime. Ótimo pra fundos uniformes.',
                badge: 'CPU',
              },
              {
                id: 'lama' as const,
                label: 'Qualidade (LaMa)',
                desc: 'Modelo neural single-frame — mais lento, melhor em fundos complexos.',
                badge: server.state === 'online' && server.deps.lama ? 'AI' : 'AI ✗',
                disabled: server.state === 'online' && !server.deps.lama,
              },
            ].map((opt) => {
              const active = mode === opt.id;
              const dis = (opt as { disabled?: boolean }).disabled;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => !dis && setMode(opt.id)}
                  disabled={processing || dis}
                  className={
                    'relative flex flex-col items-start gap-1 rounded-[12px] border px-3 py-3 text-left transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ' +
                    (active
                      ? 'border-lime bg-lime/10 text-lime shadow-[0_0_18px_-4px_rgba(200,255,0,0.5)]'
                      : 'border-line bg-bg text-text-muted hover:border-lime/50 hover:text-white')
                  }
                >
                  <div className="flex w-full items-center justify-between gap-1">
                    <span className="text-sm font-semibold uppercase tracking-widest">
                      {opt.label}
                    </span>
                    <span
                      className={
                        'mono shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ' +
                        (active
                          ? 'border-lime/60 text-lime'
                          : 'border-line text-text-dim')
                      }
                    >
                      {opt.badge}
                    </span>
                  </div>
                  <span className="text-[11px] leading-snug text-text-muted">
                    {opt.desc}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Smart Mode automático: o motor amostra 16 frames, detecta onde a
            legenda aparece de forma persistente (≥40% das amostras), unifica
            tudo em uma máscara dilatada e aplica o inpainting na região.
          </p>
        </div>

        {/* Ações */}
        <div className="flex flex-wrap gap-3">
          {processing ? (
            <CancelButton onClick={cancelAll} label="Cancelar processamento" />
          ) : (
            <button
              onClick={processAll}
              className="btn-primary"
              disabled={
                files.length === 0 ||
                validation.length > 0 ||
                server.state !== 'online' ||
                (server.state === 'online' && !server.ready)
              }
            >
              {`Remover legenda ${files.length || ''}`.trim()}
            </button>
          )}
          <button
            onClick={() => setFilesSafe([])}
            className="btn-secondary"
            disabled={processing || files.length === 0}
          >
            Limpar
          </button>
          {hasResults && !processing ? (
            <button
              onClick={downloadZip}
              className="btn-secondary"
              disabled={zipping}
            >
              {zipping ? 'Zipando...' : `Baixar ZIP (${doneJobs.length})`}
            </button>
          ) : null}
        </div>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {/* Lista de jobs */}
        {jobs.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {jobs.map((j, idx) => (
              <li
                key={j.id}
                className="fade-in-up rounded-[12px] border border-line bg-bg p-4"
                style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-white">
                    {j.file.name}
                  </span>
                  <span
                    className={
                      'mono shrink-0 ' +
                      (j.state === 'done'
                        ? 'text-lime'
                        : j.state === 'error' || j.state === 'cancelled'
                          ? 'text-red-400'
                          : 'text-text-muted')
                    }
                  >
                    {j.state === 'queued'
                      ? 'na fila'
                      : j.state === 'uploading'
                        ? 'enviando'
                        : j.state === 'processing'
                          ? Math.round((j.progress || 0) * 100) + '%'
                          : j.state === 'done'
                            ? 'OK'
                            : j.state === 'cancelled'
                              ? 'cancelado'
                              : 'erro'}
                  </span>
                </div>

                {(j.state === 'uploading' || j.state === 'processing') ? (
                  <>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-lime transition-all"
                        style={{ width: Math.round((j.progress || 0) * 100) + '%' }}
                      />
                    </div>
                    {j.stage ? (
                      <div className="mono mt-1 text-[10px] uppercase tracking-widest text-text-muted">
                        {j.stage}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {(j.state === 'error' || j.state === 'cancelled') && j.error ? (
                  <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {j.error}
                  </div>
                ) : null}

                {j.state === 'done' && j.resultUrl ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <SideBySidePreview
                      originalFile={j.file}
                      resultUrl={j.resultUrl}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => downloadOne(j)}
                        className="btn-ghost !py-1 !px-2 text-xs"
                      >
                        Baixar MP4
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ToolShell>
  );
}

/**
 * Side-by-side player: original a esquerda, resultado a direita.
 */
function SideBySidePreview({
  originalFile,
  resultUrl,
}: {
  originalFile: File;
  resultUrl: string;
}) {
  const leftRef = useRef<HTMLVideoElement | null>(null);
  const rightRef = useRef<HTMLVideoElement | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(originalFile);
    setOriginalUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [originalFile]);

  function syncFromLeft() {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    if (Math.abs(right.currentTime - left.currentTime) > 0.3) {
      right.currentTime = left.currentTime;
    }
    if (left.paused !== right.paused) {
      if (left.paused) right.pause();
      else right.play().catch(() => {});
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-widest text-text-muted">
          Original
        </div>
        {originalUrl ? (
          <video
            ref={leftRef}
            src={originalUrl}
            controls
            onPlay={syncFromLeft}
            onPause={syncFromLeft}
            onSeeked={syncFromLeft}
            className="w-full rounded-[12px] border border-line bg-bg"
          />
        ) : (
          <div className="aspect-video rounded-[12px] border border-line bg-bg" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-widest text-lime">
          Limpo
        </div>
        <video
          ref={rightRef}
          src={resultUrl}
          controls
          className="w-full rounded-[12px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,255,0,0.4)]"
        />
      </div>
    </div>
  );
}
