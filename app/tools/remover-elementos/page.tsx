'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { CostHint } from '@/components/CostHint';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { estimateRemoverElementos } from '@/lib/cost-estimator';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  isCancellationError,
  removeRegions,
  extractFrameAt,
  probeVideoMetadata,
  type RemoveRegion,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';

/**
 * Remover Legendas & Marca d'Agua — pipeline 100% client-side com IA
 * SO pra deteccao.
 *
 * Fluxo por video:
 *  1. Probe metadata (duration, height, width) via HTMLVideo
 *  2. Modo Smart/Subtitle/Watermark: extrai 3 frames via FFmpeg WASM →
 *     manda pra /api/remover-elementos/detect (Claude 3.5 Haiku vision)
 *     → recebe regions (x,y,w,h em %)
 *     Modo Manual/Bottom: regions vem da escolha do usuario
 *  3. Aplica filtro delogo do FFmpeg WASM com as coords convertidas pra px
 *  4. Output MP4 → download
 *
 * Como nao subimos o video pra servidor (so 3 JPGs ~200KB cada), a
 * limitacao de 4.5MB do Vercel nao bate. Vai ate ~500MB tranquilo.
 */

const MAX_BATCH = 5;
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_DURATION_SEC = 40 * 60; // 40 min

type DetectMode = 'smart' | 'subtitle' | 'watermark' | 'bottom' | 'manual';

type DetectedRegion = {
  type: 'subtitle' | 'watermark';
  // Normalizadas: 0-100 do frame
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type JobState = 'queued' | 'detecting' | 'processing' | 'done' | 'error';

type Job = {
  id: string;
  file: File;
  state: JobState;
  progress: number;
  stage: string;
  resultBlob: Blob | null;
  resultUrl: string | null;
  detectedRegions: DetectedRegion[];
  error: string | null;
};

const metaCache = new Map<string, { durationSec: number; height: number; width: number }>();
function metaKey(f: File) {
  return f.name + ':' + f.size + ':' + f.lastModified;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function makeJob(file: File): Job {
  return {
    id: file.name + ':' + file.size + ':' + file.lastModified,
    file,
    state: 'queued',
    progress: 0,
    stage: '',
    resultBlob: null,
    resultUrl: null,
    detectedRegions: [],
    error: null,
  };
}

const MODE_OPTIONS: Array<{
  id: DetectMode;
  label: string;
  description: string;
  badge?: string;
}> = [
  {
    id: 'smart',
    label: 'Smart AI',
    description: 'IA detecta legendas + watermarks automaticamente.',
    badge: 'AI',
  },
  {
    id: 'subtitle',
    label: 'So Legenda',
    description: 'IA detecta apenas legendas/textos sobrepostos.',
    badge: 'AI',
  },
  {
    id: 'watermark',
    label: 'So Watermark',
    description: 'IA detecta apenas logos / marcas d\'agua.',
    badge: 'AI',
  },
  {
    id: 'bottom',
    label: 'Bottom 18%',
    description: 'Preset rapido: tira faixa inferior. Sem IA.',
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'Voce define a regiao em %. Sem IA.',
  },
];

export default function RemoverElementosPage() {
  const [files, setFiles] = useToolState<File[]>('remover:files', []);
  const [mode, setMode] = useToolState<DetectMode>('remover:mode', 'smart');
  const [confidence, setConfidence] = useToolState<number>(
    'remover:confidence',
    0.5,
  );
  const [preserveAudio, setPreserveAudio] = useToolState<boolean>(
    'remover:preserveAudio',
    true,
  );
  const [manualX, setManualX] = useToolState<number>('remover:manualX', 5);
  const [manualY, setManualY] = useToolState<number>('remover:manualY', 80);
  const [manualW, setManualW] = useToolState<number>('remover:manualW', 90);
  const [manualH, setManualH] = useToolState<number>('remover:manualH', 15);

  const [jobs, setJobs] = useToolState<Job[]>('remover:jobs', []);
  const [processing, setProcessing] = useToolState<boolean>(
    'remover:processing',
    false,
  );
  const [stageMsg, setStageMsg] = useToolState<string | null>(
    'remover:stageMsg',
    null,
  );
  const [zipping, setZipping] = useToolState<boolean>('remover:zipping', false);
  const [error, setError] = useToolState<string | null>('remover:error', null);

  // Metadata probe ao adicionar arquivos
  const [metaTick, setMetaTick] = useToolState<number>('remover:metaTick', 0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const newOnes = files.filter((f) => !metaCache.has(metaKey(f)));
      if (newOnes.length === 0) return;
      await Promise.all(
        newOnes.map(async (f) => {
          const meta = await probeVideoMetadata(f);
          if (cancelled) return;
          metaCache.set(metaKey(f), {
            durationSec: meta?.durationSec ?? 0,
            height: meta?.height ?? 0,
            width: 0,
          });
          // Probe height ja vem; pra width precisamos de fallback via video element
          try {
            const url = URL.createObjectURL(f);
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = url;
            video.muted = true;
            await new Promise<void>((res) => {
              video.onloadedmetadata = () => res();
              video.onerror = () => res();
              setTimeout(res, 5000);
            });
            const cur = metaCache.get(metaKey(f));
            if (cur) {
              metaCache.set(metaKey(f), {
                ...cur,
                width: video.videoWidth || 0,
                height: cur.height || video.videoHeight || 0,
              });
            }
            URL.revokeObjectURL(url);
          } catch {
            /* noop */
          }
        }),
      );
      if (!cancelled) setMetaTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const validation = useMemo(() => {
    const errs: string[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        errs.push(`${f.name}: ${formatBytes(f.size)} excede o limite de 500MB.`);
      }
      const meta = metaCache.get(metaKey(f));
      if (meta && meta.durationSec > MAX_DURATION_SEC) {
        errs.push(
          `${f.name}: ${Math.round(meta.durationSec / 60)}min excede o limite de 40min.`,
        );
      }
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, metaTick]);

  const doneJobs = jobs.filter((j) => j.state === 'done');
  const hasResults = doneJobs.length > 0;

  function setFilesSafe(next: File[]) {
    if (processing) return;
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    setJobs([]);
    setError(null);
    setFiles(next.slice(0, MAX_BATCH));
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  /**
   * Pra cada job: detecta regioes (via IA ou preset) e aplica delogo.
   */
  async function processOne(job: Job, index: number, total: number): Promise<void> {
    const meta = metaCache.get(metaKey(job.file)) ?? {
      durationSec: 0,
      height: 0,
      width: 0,
    };
    if (!meta.width || !meta.height) {
      throw new Error(
        'Nao consegui ler metadados do video. Arquivo corrompido ou formato nao suportado.',
      );
    }

    let regions: DetectedRegion[] = [];

    // Resolve regioes baseado no modo
    if (mode === 'manual') {
      regions = [
        {
          type: 'subtitle',
          x: manualX,
          y: manualY,
          width: manualW,
          height: manualH,
          confidence: 1,
        },
      ];
    } else if (mode === 'bottom') {
      regions = [
        {
          type: 'subtitle',
          x: 5,
          y: 78,
          width: 90,
          height: 18,
          confidence: 1,
        },
      ];
    } else {
      // Modo IA: extrai 3 frames + chama detect
      updateJob(job.id, { state: 'detecting', stage: 'Extraindo frames...' });
      setStageMsg(`[${index + 1}/${total}] ${job.file.name} — extraindo frames`);

      const sampleTimes = [
        Math.max(1, meta.durationSec * 0.2),
        Math.max(1, meta.durationSec * 0.5),
        Math.max(1, meta.durationSec * 0.8),
      ];

      const frameBlobs: Blob[] = [];
      for (let i = 0; i < sampleTimes.length; i++) {
        const t = sampleTimes[i];
        const blob = await extractFrameAt(job.file, t, { maxWidth: 1024, quality: 5 });
        frameBlobs.push(blob);
        updateJob(job.id, {
          stage: `Frame ${i + 1}/${sampleTimes.length}`,
          progress: ((i + 1) / sampleTimes.length) * 30,
        });
      }

      updateJob(job.id, { stage: 'IA analisando frames...', progress: 35 });
      setStageMsg(`[${index + 1}/${total}] ${job.file.name} — IA detectando regioes`);

      // Chama API pra cada frame, junta os resultados
      const allDetected: DetectedRegion[] = [];
      for (let i = 0; i < frameBlobs.length; i++) {
        const base64 = await blobToBase64(frameBlobs[i]);
        const apiMode =
          mode === 'subtitle' ? 'subtitle' : mode === 'watermark' ? 'watermark' : 'smart';
        const res = await fetch('/api/remover-elementos/detect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ frame: base64, mode: apiMode }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          regions?: DetectedRegion[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || 'Falha na deteccao por IA.');
        }
        if (json.regions) allDetected.push(...json.regions);
        updateJob(job.id, {
          progress: 35 + ((i + 1) / frameBlobs.length) * 25,
        });
      }

      // Agregacao: pega regioes consistentes entre os frames (aparecem em
      // pelo menos 2 dos 3) e funde overlapping em uma so. Filtra por
      // confidence minimo do slider.
      regions = aggregateRegions(allDetected, confidence);
    }

    if (regions.length === 0) {
      throw new Error(
        'Nenhuma regiao detectada com confianca suficiente. Tente outro modo ou abaixe o slider de sensibilidade.',
      );
    }

    updateJob(job.id, { detectedRegions: regions });

    // Converte regioes de % pra pixels do video
    const pxRegions: RemoveRegion[] = regions.map((r) => ({
      x: (r.x / 100) * meta.width,
      y: (r.y / 100) * meta.height,
      width: (r.width / 100) * meta.width,
      height: (r.height / 100) * meta.height,
    }));

    updateJob(job.id, { state: 'processing', stage: 'Removendo regioes...', progress: 60 });
    setStageMsg(`[${index + 1}/${total}] ${job.file.name} — aplicando delogo`);

    const blob = await removeRegions(job.file, pxRegions, {
      preserveAudio,
      onProgress: (p: FFProgress) => {
        updateJob(job.id, { progress: 60 + Math.round(p.ratio * 40) });
      },
      onStage: (s) => updateJob(job.id, { stage: s }),
    });

    const url = URL.createObjectURL(blob);
    updateJob(job.id, {
      state: 'done',
      progress: 100,
      resultBlob: blob,
      resultUrl: url,
      stage: '',
    });
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    if (validation.length > 0) {
      setError(validation[0]);
      return;
    }
    setProcessing(true);
    setError(null);
    setStageMsg('Preparando lote...');
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    const initial = files.map(makeJob);
    setJobs(initial);

    try {
      for (let i = 0; i < initial.length; i++) {
        const job = initial[i];
        try {
          await processOne(job, i, initial.length);
        } catch (e) {
          console.error('[remover]', job.file.name, e);
          if (isCancellationError(e)) {
            updateJob(job.id, { state: 'error', error: 'Cancelado pelo usuario.' });
            initial.slice(i + 1).forEach((rest) => {
              updateJob(rest.id, { state: 'error', error: 'Cancelado pelo usuario.' });
            });
            break;
          }
          updateJob(job.id, {
            state: 'error',
            error: (e as Error).message ?? 'Falha desconhecida.',
          });
        }
      }
      setStageMsg('Lote finalizado.');
    } finally {
      setProcessing(false);
    }
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

  return (
    <ToolShell
      title="Remover Legenda & Marca d'Água"
      description="IA detecta legendas / watermarks nos seus videos e o FFmpeg apaga as regioes (filtro delogo). Tudo client-side: o video nao sai do seu browser, so 3 frames JPG vao pra IA detectar (~$0.02 por video). Batch ate 5 videos × 500MB × 40min."
    >
      <div className="flex flex-col gap-6">
        <MissingKeyBanner services={['anthropic']} />

        <div>
          <label className="label-field">Videos (ate {MAX_BATCH})</label>
          <BatchFileUpload
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP4, MOV, WEBM, MKV — ate 500MB e 40min cada"
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

        <div>
          <label className="label-field">Modo de deteccao</label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  disabled={processing}
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
                    {opt.badge ? (
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
                    ) : null}
                  </div>
                  <span className="text-[11px] leading-snug text-text-muted">
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {mode === 'smart' || mode === 'subtitle' || mode === 'watermark' ? (
          <div>
            <div className="flex items-center justify-between">
              <label className="label-field !mb-0">
                Sensibilidade da deteccao
              </label>
              <span className="mono text-xs text-lime">
                {Math.round(confidence * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.9}
              step={0.05}
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="mt-3"
              disabled={processing}
            />
            <p className="mt-2 text-[11px] text-text-muted">
              Confianca minima pra considerar uma regiao detectada. Mais alto =
              menos falsos positivos. Mais baixo = pega mais coisa.
            </p>
          </div>
        ) : null}

        {mode === 'manual' ? (
          <div className="rounded-[12px] border border-line bg-bg-soft/30 p-4">
            <div className="label-field">Regiao manual (em % do video)</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              {(
                [
                  { label: 'X (esq)', value: manualX, set: setManualX, max: 95 },
                  { label: 'Y (topo)', value: manualY, set: setManualY, max: 95 },
                  { label: 'Largura', value: manualW, set: setManualW, max: 100 },
                  { label: 'Altura', value: manualH, set: setManualH, max: 100 },
                ] as const
              ).map((field) => (
                <div key={field.label}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">
                      {field.label}
                    </span>
                    <span className="mono text-xs text-lime">{field.value}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={field.max}
                    step={1}
                    value={field.value}
                    onChange={(e) => field.set(parseInt(e.target.value))}
                    className="mt-2"
                    disabled={processing}
                  />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-text-muted">
              Padrao: faixa inferior central (5,80,90,15) — bom pra legendas
              hardcoded em VSL.
            </p>
          </div>
        ) : null}

        <label className="flex items-center gap-3 rounded-[12px] border border-line bg-bg p-3 text-sm">
          <input
            type="checkbox"
            checked={preserveAudio}
            onChange={(e) => setPreserveAudio(e.target.checked)}
            className="h-4 w-4 accent-lime"
            disabled={processing}
          />
          <div className="flex-1">
            <div className="text-white">Preservar audio original (sem perda)</div>
            <div className="text-[11px] text-text-muted">
              Mantém a trilha de audio bit-perfect (copy). Desligue se for
              re-encodar a saida pra outro codec.
            </div>
          </div>
        </label>

        {files.length > 0 &&
        (mode === 'smart' || mode === 'subtitle' || mode === 'watermark') ? (
          <CostHint
            estimate={estimateRemoverElementos({ numVideos: files.length })}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          {processing ? (
            <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
          ) : (
            <button
              onClick={processAll}
              className="btn-primary"
              disabled={files.length === 0 || validation.length > 0}
            >
              {`Analisar e Remover ${files.length || ''}`.trim()}
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

        {stageMsg ? (
          <div
            className={
              'rounded-[12px] border px-4 py-3 text-xs ' +
              (processing
                ? 'scan-line border-lime/40 bg-bg-soft/40 text-lime'
                : 'border-line bg-bg text-text-muted')
            }
          >
            <div className="flex items-center gap-2">
              {processing ? (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                </span>
              ) : null}
              <span className="mono uppercase tracking-widest">{stageMsg}</span>
            </div>
          </div>
        ) : null}

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
                        : j.state === 'error'
                          ? 'text-red-400'
                          : 'text-text-muted')
                    }
                  >
                    {j.state === 'queued'
                      ? 'na fila'
                      : j.state === 'detecting'
                        ? 'detectando ' + Math.round(j.progress) + '%'
                        : j.state === 'processing'
                          ? 'removendo ' + Math.round(j.progress) + '%'
                          : j.state === 'done'
                            ? 'OK'
                            : 'erro'}
                  </span>
                </div>

                {(j.state === 'detecting' || j.state === 'processing') ? (
                  <>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-lime transition-all"
                        style={{ width: j.progress + '%' }}
                      />
                    </div>
                    {j.stage ? (
                      <div className="mono mt-1 text-[10px] uppercase tracking-widest text-text-muted">
                        {j.stage}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {j.state === 'error' && j.error ? (
                  <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {j.error}
                  </div>
                ) : null}

                {j.state === 'done' && j.resultUrl ? (
                  <div className="mt-3 flex flex-col gap-3">
                    {j.detectedRegions.length > 0 ? (
                      <div className="text-[10px] uppercase tracking-widest text-text-muted">
                        {j.detectedRegions.length} regiao(oes) removida(s):{' '}
                        {j.detectedRegions
                          .map(
                            (r) =>
                              `${r.type === 'subtitle' ? 'legenda' : 'logo'} ${Math.round(r.width)}×${Math.round(r.height)}%`,
                          )
                          .join(' · ')}
                      </div>
                    ) : null}
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
 * Side-by-side player: original a esquerda, resultado a direita, com
 * sincronia de play/pause/seek e slider divisor.
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
  const [originalUrl, setOriginalUrl] = useToolState<string | null>(
    'remover:preview:' + originalFile.name + ':' + originalFile.size,
    null,
  );

  useEffect(() => {
    if (originalUrl) return;
    const url = URL.createObjectURL(originalFile);
    setOriginalUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

// ---------- Helpers ----------

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.replace(/^data:image\/[^;]+;base64,/, ''));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Pega regioes detectadas em multiplos frames e:
 *  1. Filtra por confidence minimo (do slider).
 *  2. Funde retangulos que se sobrepoem >50%.
 *  3. Mantem so regioes que aparecem em pelo menos 2 frames (= mais
 *     estaveis temporalmente — descarta detecoes acidentais de 1 frame).
 */
function aggregateRegions(
  detected: DetectedRegion[],
  minConfidence: number,
): DetectedRegion[] {
  const filtered = detected.filter((r) => r.confidence >= minConfidence);
  if (filtered.length === 0) return [];

  // Cluster por overlap. Para cada regiao, ve se ja existe um cluster
  // que se sobrepoe muito; se sim, funde; se nao, cria novo cluster.
  type Cluster = {
    type: 'subtitle' | 'watermark';
    x: number; y: number; width: number; height: number;
    count: number;
    confSum: number;
  };
  const clusters: Cluster[] = [];

  for (const r of filtered) {
    let merged = false;
    for (const c of clusters) {
      if (c.type !== r.type) continue;
      const ov = overlapRatio(r, c);
      if (ov > 0.5) {
        // funde — bounding box union
        const x1 = Math.min(c.x, r.x);
        const y1 = Math.min(c.y, r.y);
        const x2 = Math.max(c.x + c.width, r.x + r.width);
        const y2 = Math.max(c.y + c.height, r.y + r.height);
        c.x = x1;
        c.y = y1;
        c.width = x2 - x1;
        c.height = y2 - y1;
        c.count += 1;
        c.confSum += r.confidence;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        type: r.type,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        count: 1,
        confSum: r.confidence,
      });
    }
  }

  // Mantem clusters que aparecem em >= 2 frames (de 3 amostrados)
  // — exceto se so houver 1 frame analisado, mantem todos.
  const totalFramesSeen = Math.min(3, Math.max(1, Math.ceil(detected.length / 1)));
  const minCount = totalFramesSeen >= 2 ? 2 : 1;

  return clusters
    .filter((c) => c.count >= minCount)
    .map((c) => ({
      type: c.type,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      confidence: c.confSum / c.count,
    }));
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.width, b.x + b.width);
  const iy2 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return inter / Math.min(aArea, bArea);
}
