'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { CancelButton } from '@/components/CancelButton';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';
import { useTier, tierCanAutomate } from '@/lib/use-tier';
import { IconRemoverElementos } from '@/components/ToolIcons';

/**
 * Remover Legenda — Smart Mode (motor LOCAL, 100% offline, sem custo).
 *
 * Fluxo ZERO-CONFIG (sem pareamento manual):
 *   1) Usuario clica "Baixar o Motor" -> baixa o zip (~50 KB).
 *   2) Da duplo-clique em INSTALAR.cmd -> instalador GUI Darko baixa
 *      Python 3.11 + paddleocr + opencv + lama + ffmpeg (~600 MB, 1a vez)
 *      e ja inicia o motor + configura auto-start.
 *   3) Pronto. Esta pagina detecta o motor via /health, fica verde e
 *      ja pode processar. Sem codigo, sem cola, sem nada manual.
 *
 * Seguranca: o motor (127.0.0.1:8765) so aceita requests com header
 * Origin de uma whitelist (darkolab.com, *.vercel.app, localhost). O
 * browser SEMPRE seta Origin em cross-origin fetch e NAO pode ser
 * forjado por JS de outro site (spec do fetch garante). Logo, basta
 * a pagina estar carregada do darkolab.com pra autorizar — qualquer
 * outro site fica bloqueado pelo guard.
 *
 * Acesso UI: apenas conta admin (gated no rail e na pagina).
 */

const PORT_CANDIDATES = [8765, 8766, 8767, 8768, 8769];
const MAX_BATCH = 5;
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

type ServerDeps = {
  opencv: boolean;
  numpy: boolean;
  paddleocr: boolean;
  lama: boolean;
  sttn?: boolean;
  propainter?: boolean;
  ffmpeg: boolean;
  /** 'cuda' se torch detectou GPU, senao 'cpu'. */
  device: 'cuda' | 'cpu';
};

type ServerStatus =
  | { state: 'checking' }
  | {
      state: 'online';
      ready: boolean;
      deps: ServerDeps;
      port: number;
    }
  | { state: 'offline'; reason: string };

type JobState =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled';

type Job = {
  id: string;
  remoteId: string | null;
  file: File;
  state: JobState;
  progress: number;
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
  // ---------- Tier gate (client-side) ----------
  // Smart Remover é Pro+ (Pro/Admin liberam). Free/Basic não acessam.
  // O middleware já bloqueia via PRO_ONLY_TOOLS — esse gate é só pra
  // mostrar UI consistente caso o user chegue aqui de algum link.
  const tier = useTier();
  const adminCheck: 'loading' | 'allowed' | 'denied' =
    tier === null
      ? 'loading'
      : tierCanAutomate(tier)  // admin OU pro
        ? 'allowed'
        : 'denied';

  // ---------- Server status (zero-config: sem token) ----------
  const [server, setServer] = useState<ServerStatus>({ state: 'checking' });
  const [port, setPort] = useState<number>(8765);

  const baseUrl = `http://127.0.0.1:${port}`;

  const checkServer = useCallback(async () => {
    setServer({ state: 'checking' });
    // varre o range de portas pra detectar onde o motor esta ouvindo
    for (const p of [port, ...PORT_CANDIDATES.filter((x) => x !== port)]) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(`http://127.0.0.1:${p}/health`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        clearTimeout(t);
        if (!res.ok) continue;
        const json = (await res.json()) as {
          ok: boolean;
          ready: boolean;
          deps: ServerDeps;
          port: number;
          service: string;
        };
        if (json.service !== 'darko-subtitle-remover') continue;
        if (p !== port) {
          setPort(p);
        }
        setServer({
          state: 'online',
          ready: json.ready,
          deps: json.deps,
          port: p,
        });
        return;
      } catch {
        /* tenta proxima porta */
      }
    }
    setServer({ state: 'offline', reason: 'motor nao detectado' });
  }, [port]);

  useEffect(() => {
    if (adminCheck !== 'allowed') return;
    checkServer();
    const id = setInterval(checkServer, 15_000);
    return () => clearInterval(id);
  }, [adminCheck, checkServer]);

  // ---------- Tool state ----------
  // Smart Mode = auto: motor escolhe STTN (temporal, qualidade Vmake) se
  // o modelo .pth estiver presente, senao cai pra LaMa single-frame.
  const mode: 'auto' = 'auto';
  const [files, setFiles] = useToolState<File[]>('remover:files', []);
  const [jobs, setJobs] = useToolState<Job[]>('remover:jobs', []);
  const [processing, setProcessing] = useToolState<boolean>(
    'remover:processing',
    false,
  );
  const [zipping, setZipping] = useToolState<boolean>('remover:zipping', false);
  const [error, setError] = useToolState<string | null>('remover:error', null);

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
      stage: 'Enviando video pro motor local...',
      abortCtrl: abort,
    });

    const form = new FormData();
    form.append('file', job.file);
    form.append('mode', mode);

    let remoteId: string;
    try {
      const res = await fetch(baseUrl + '/jobs', {
        method: 'POST',
        body: form,
        signal: abort.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(
          res.status === 403
            ? 'Motor recusou a origem desta pagina (Origin guard). Verifique se voce esta acessando o DarkoLab em uma URL valida.'
            : 'Falha ao iniciar job: ' + (t || res.status),
        );
      }
      const json = (await res.json()) as { job_id: string };
      remoteId = json.job_id;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        updateJob(job.id, {
          state: 'cancelled',
          error: 'Cancelado pelo usuario.',
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

    let done = false;
    while (!done) {
      if (abort.signal.aborted) {
        try {
          await fetch(baseUrl + '/jobs/' + remoteId, {
            method: 'DELETE',
              });
        } catch {
          /* noop */
        }
        updateJob(job.id, {
          state: 'cancelled',
          error: 'Cancelado pelo usuario.',
        });
        return;
      }

      try {
        const res = await fetch(baseUrl + '/jobs/' + remoteId, {
          });
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
          error: 'Conexao com o motor caiu: ' + (e as Error).message,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    updateJob(job.id, { stage: 'Baixando video limpo...', progress: 0.97 });
    try {
      const res = await fetch(baseUrl + '/jobs/' + remoteId + '/result', {
      });
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
        'Motor local offline. Abra o INSTALAR.cmd ou inicie pelo atalho do menu.',
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
        title="Smart Remover"
        eyebrow="VÍDEO COM IA"
        description="Disponível só pra contas Pro."
        hue="rgba(244,114,182,0.45)"
      >
        <div className="flex flex-col items-start gap-4 rounded-[16px] border border-violet/30 bg-violet/5 p-6">
          <div className="flex items-start gap-3">
            <span className="mt-1 text-2xl">🔒</span>
            <div>
              <h3
                className="text-[18px] font-bold tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Smart Remover é Pro
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                Remove legenda hardcoded + marca d&apos;água usando IA local (PaddleOCR + LaMa neural inpainting). Roda no seu PC, sem custo por uso. Disponível só pra contas Pro.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/planos"
              className="rounded-full border border-violet/60 bg-violet/15 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.14em] text-violet-100 transition hover:bg-violet/25"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Ver planos →
            </a>
            <a
              href="https://wa.me/5531991262437"
              className="rounded-full border border-line-strong bg-bg-soft/60 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted transition hover:border-lime hover:text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </ToolShell>
    );
  }

  const doneJobs = jobs.filter((j) => j.state === 'done');
  const hasResults = doneJobs.length > 0;

  const motorOnline = server.state === 'online' && server.ready;

  return (
    <ToolShell
      title="Smart Remover"
      eyebrow="VÍDEO COM IA"
      description="Remove legenda e marca d’água sem deixar borrão. A IA reconstrói o fundo."
      hue="rgba(244,114,182,0.45)"
      icon={<IconRemoverElementos size={56} />}
    >
      <div className="flex flex-col gap-6">
        {/* === BANNER UNICO — zero-config (sem pareamento manual) === */}
        {motorOnline ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-lime">
                Motor online
              </span>
              {server.state === 'online' &&
              (server.deps.propainter || server.deps.sttn || server.deps.lama) ? (
                <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                  {server.deps.device === 'cuda' ? 'Rápido' : 'Padrão'}
                </span>
              ) : (
                <span className="mono ml-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] uppercase text-yellow-300">
                  Atualize o motor
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="text-lime">⬇</span>
              <strong className="flex-1 text-sm text-lime">
                Motor de Remocao de Legenda (roda no seu PC, sem custo)
              </strong>
            </div>
            <p className="mono mt-1 text-[11px] text-text-muted">
              Instala uma vez. A IA detecta a legenda hardcoded e limpa
              frame-a-frame com PaddleOCR + LaMa neural inpainting. Nada
              sai do seu PC, sem token de API, sem limite. Zero-config:
              instalou, ja funciona.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/subtitle-remover-engine/installer"
                className="btn-primary !py-2 text-xs"
                download
              >
                1. Baixar Instalador (.exe)
              </a>
              <button
                type="button"
                className="btn-secondary !py-2 text-xs"
                onClick={checkServer}
                disabled={server.state === 'checking'}
              >
                {server.state === 'checking'
                  ? 'Detectando...'
                  : '2. Recheck motor'}
              </button>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-lime/80 hover:text-lime">
                Como instalar (passo a passo)
              </summary>
              <ol className="mono mt-2 list-decimal space-y-1 pl-5 text-[11px] text-text-muted">
                <li>
                  Baixa o <b>Instalador</b> (botao 1) — eh um <code className="mono text-white">.exe</code> de ~230 KB.
                </li>
                <li>
                  Da <b>duplo-clique</b> no{' '}
                  <code className="mono text-white">.exe</code> baixado (se
                  o Windows avisar, &quot;Mais informacoes&quot; → &quot;Executar
                  assim mesmo&quot;). Ele se extrai automaticamente, baixa tudo
                  (Python + IA + ffmpeg, ~500 MB, 1a vez), instala, inicia
                  o motor e configura auto-start junto com o Windows.
                </li>
                <li>
                  Volta aqui. <b>Pronto</b> — a caixa fica verde
                  automaticamente, sem precisar colar codigo nenhum.
                </li>
              </ol>
              <p className="mono mt-2 text-[10px] text-text-muted">
                Requer Windows 64-bit. O motor roda 100% no PC do usuario.
                Instalador leve (~230 KB); ao executar baixa Python +
                paddleocr + opencv + LaMa + ffmpeg (~500 MB, uma vez,
                ~10-12 min) automaticamente.
              </p>
            </details>

            {server.state === 'offline' ? (
              <p className="mono mt-3 text-[10px] uppercase tracking-widest text-text-muted">
                status: motor offline ({server.reason})
              </p>
            ) : null}
          </div>
        )}

        {/* Upload */}
        <div>
          <label className="label-field">Videos (ate {MAX_BATCH})</label>
          <BatchFileUpload
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP4, MOV, WEBM, MKV — ate 500MB cada"
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

        {/* Smart Mode info — sem seletor, motor decide tudo */}
        <div className="rounded-[12px] border border-lime/30 bg-lime/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold uppercase tracking-widest text-lime">
                Modo inteligente
              </span>
              <span className="mono shrink-0 rounded-full border border-lime/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                AI
              </span>
              {server.state === 'online' ? (
                <span
                  className={
                    'mono shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ' +
                    (server.deps.device === 'cuda'
                      ? 'border-lime/60 text-lime'
                      : 'border-line text-text-muted')
                  }
                >
                  {server.deps.device === 'cuda' ? 'Rápido' : 'Padrão'}
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            O motor detecta onde a legenda fica fixa e reconstrói o fundo, sem blur.
            {server.state === 'online' && server.deps.device === 'cpu' ? (
              <span className="ml-1 text-yellow-300">
                Sem placa dedicada, pode demorar mais.
              </span>
            ) : null}
          </p>
        </div>

        {/* Acoes */}
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
                !motorOnline
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
