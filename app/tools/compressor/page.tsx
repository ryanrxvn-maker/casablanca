'use client';

import { useEffect, useMemo } from 'react';
import { ToolHero, ToolStep, ToolChoice, ToolSlider, ToolAction, ToolMetric } from '@/components/tool-kit';
import { IconCompressor } from '@/components/ToolIcons';

const HUE = 'rgba(129,140,248,0.4)';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  compressVideo,
  estimateCompressedSize,
  isCancellationError,
  probeVideoMetadata,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';

type Resolution = 'original' | '1080' | '720' | '480';

// Cache de duracao + altura por arquivo, fora do React state pra nao
// disparar re-renders. A chave e file.name + size + lastModified que e
// estavel entre tabs.
const metaCache = new Map<string, { durationSec: number; height: number }>();
function metaKey(f: File) {
  return f.name + ':' + f.size + ':' + f.lastModified;
}

type JobState = 'queued' | 'running' | 'done' | 'error';

type Job = {
  id: string;
  file: File;
  state: JobState;
  progress: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  resultSize: number | null;
  error: string | null;
};

const MAX_BATCH = 20;

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function makeJob(file: File): Job {
  return {
    id: file.name + ':' + file.size + ':' + file.lastModified,
    file,
    state: 'queued',
    progress: 0,
    resultBlob: null,
    resultUrl: null,
    resultSize: null,
    error: null,
  };
}

export default function CompressorPage() {
  const [files, setFiles] = useToolState<File[]>('compressor:files', []);
  const [crf, setCrf] = useToolState<number>('compressor:crf', 23);
  const [resolution, setResolution] = useToolState<Resolution>(
    'compressor:resolution',
    'original',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'compressor:processing',
    false,
  );
  const [jobs, setJobs] = useToolState<Job[]>('compressor:jobs', []);
  const [stageMsg, setStageMsg] = useToolState<string | null>(
    'compressor:stageMsg',
    null,
  );
  const [zipping, setZipping] = useToolState<boolean>(
    'compressor:zipping',
    false,
  );

  const totalInput = useMemo(
    () => files.reduce((acc, f) => acc + f.size, 0),
    [files],
  );

  // Probe de metadata por arquivo (rodado em paralelo). Quando termina,
  // mexe num counter local pra forcar recalculo do total.
  const [metaTick, setMetaTick] = useToolState<number>(
    'compressor:metaTick',
    0,
  );
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
          });
        }),
      );
      if (!cancelled) setMetaTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Estimativa precisa por arquivo + soma. Quando duracao = 0 (probe falhou)
  // o estimate cai pra heuristica baseada em input bytes.
  const totalEstimate = useMemo(() => {
    let total = 0;
    for (const f of files) {
      const meta = metaCache.get(metaKey(f)) ?? {
        durationSec: 0,
        height: 0,
      };
      total += estimateCompressedSize({
        durationSec: meta.durationSec,
        inputHeight: meta.height,
        inputBytes: f.size,
        crf,
        resolution,
      });
    }
    return total;
    // metaTick entra no deps pra recalcular quando probes terminam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, crf, resolution, metaTick]);

  // Soma de duracoes (em segundos) — mostrado no card de totais.
  const totalDuration = useMemo(() => {
    let dur = 0;
    let hasAnyMeta = false;
    for (const f of files) {
      const meta = metaCache.get(metaKey(f));
      if (meta && meta.durationSec > 0) {
        dur += meta.durationSec;
        hasAnyMeta = true;
      }
    }
    return hasAnyMeta ? dur : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, metaTick]);

  function formatDuration(sec: number): string {
    if (sec < 60) return Math.round(sec) + 's';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    if (m < 60) return m + 'min ' + s + 's';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h + 'h ' + mm + 'min';
  }

  const totalOutput = useMemo(
    () => jobs.reduce((acc, j) => acc + (j.resultSize ?? 0), 0),
    [jobs],
  );

  const doneJobs = jobs.filter((j) => j.state === 'done');
  const hasResults = doneJobs.length > 0;

  function setFilesSafe(next: File[]) {
    if (processing) return;
    // Limpa resultados anteriores
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    setJobs([]);
    setFiles(next.slice(0, MAX_BATCH));
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    setProcessing(true);
    setStageMsg('Preparando lote...');

    // Limpa URLs antigas
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    const initial = files.map(makeJob);
    setJobs(initial);

    try {
      for (let i = 0; i < initial.length; i++) {
        const job = initial[i];
        setStageMsg(`Comprimindo ${i + 1}/${initial.length}: ${job.file.name}`);
        updateJob(job.id, { state: 'running', progress: 0 });

        const onProgress = (p: FFProgress) => {
          const pct = Math.round(p.ratio * 100);
          updateJob(job.id, { progress: pct });
        };

        try {
          const blob = await compressVideo(
            job.file,
            { crf, resolution },
            {
              onProgress,
              onStage: (s) =>
                setStageMsg(
                  `Comprimindo ${i + 1}/${initial.length}: ${job.file.name} — ${s}`,
                ),
            },
          );
          const url = URL.createObjectURL(blob);
          updateJob(job.id, {
            state: 'done',
            progress: 100,
            resultBlob: blob,
            resultUrl: url,
            resultSize: blob.size,
          });
        } catch (e) {
          console.error('[compressor]', job.file.name, e);
          if (isCancellationError(e)) {
            updateJob(job.id, { state: 'error', error: 'Cancelado pelo usuario.' });
            // marca os jobs restantes como cancelados tambem
            initial.slice(i + 1).forEach((rest) => {
              updateJob(rest.id, { state: 'error', error: 'Cancelado pelo usuario.' });
            });
            break;
          }
          updateJob(job.id, {
            state: 'error',
            error: (e as Error).message ?? 'Falha.',
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
    const suffix =
      resolution === 'original' ? 'crf' + crf : resolution + 'p_crf' + crf;
    await downloadBlob(
      job.resultBlob,
      baseName(job.file.name) + '_' + suffix + '.mp4',
    );
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const suffix =
        resolution === 'original' ? 'crf' + crf : resolution + 'p_crf' + crf;
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_' + suffix + '.mp4',
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'compressor_' + suffix + '.zip');
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 md:px-8">
      <ToolHero
        title="Compressor"
        eyebrow="VÍDEO"
        subtitle="Reduz o peso dos vídeos sem perder qualidade visível. Até vinte de uma vez."
        hue={HUE}
        icon={<IconCompressor size={56} />}
      />
      <div className="mt-6 flex flex-col gap-5">
        <ToolStep n={1} title="Solta os vídeos" hint={`Até ${MAX_BATCH} arquivos · MP4, WEBM ou MOV`} hue={HUE}>
          <BatchFileUpload
            accept="video/mp4,video/webm,video/quicktime"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP4, WEBM ou MOV"
            disabled={processing}
          />
          {files.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <ToolMetric value={String(files.length)} label="Arquivos" />
              <ToolMetric value={formatBytes(totalInput)} label="Entrada" />
              <ToolMetric
                value={totalDuration !== null ? formatDuration(totalDuration) : '…'}
                label="Duração"
              />
              <ToolMetric
                value={
                  hasResults
                    ? formatBytes(totalOutput)
                    : '~' + formatBytes(totalEstimate)
                }
                label={hasResults ? 'Saída' : 'Previsão'}
                accent="lime"
              />
            </div>
          ) : null}
        </ToolStep>

        <ToolStep n={2} title="Qualidade" hint="CRF mais alto = arquivo menor, mais perda visual" hue={HUE}>
          <ToolSlider
            label="CRF"
            min={18}
            max={35}
            step={1}
            value={crf}
            onChange={(v) => setCrf(v)}
            display={(v) => String(v)}
            disabled={processing}
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-text-muted">
            <span>Alta qualidade</span>
            <span>Menor arquivo</span>
          </div>
        </ToolStep>

        <ToolStep n={3} title="Resolução" hue={HUE}>
          <ToolChoice
            value={resolution}
            onChange={(v) => !processing && setResolution(v as Resolution)}
            options={[
              { value: 'original', label: 'Original', sub: 'mantém' },
              { value: '1080', label: '1080p', sub: 'Full HD' },
              { value: '720', label: '720p', sub: 'HD' },
              { value: '480', label: '480p', sub: 'leve' },
            ]}
            disabled={processing}
            hue={HUE}
          />
        </ToolStep>

        <ToolStep n={4} title={processing ? 'Comprimindo…' : 'Comprimir'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            {processing ? (
              <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
            ) : (
              <ToolAction
                onClick={processAll}
                disabled={files.length === 0}
              >
                {`Comprimir ${files.length || ''} ${files.length === 1 ? 'vídeo' : 'vídeos'}`.trim()}
              </ToolAction>
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
        </ToolStep>

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
          <ul className="flex flex-col gap-2">
            {jobs.map((j, idx) => (
              <li
                key={j.id}
                className="fade-in-up rounded-[12px] border border-line bg-bg p-3"
                style={{ animationDelay: `${Math.min(idx, 8) * 35}ms` }}
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
                      : j.state === 'running'
                        ? j.progress + '%'
                        : j.state === 'done'
                          ? formatBytes(j.resultSize ?? 0)
                          : 'erro'}
                  </span>
                </div>
                {j.state === 'running' ? (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full bg-lime transition-all"
                      style={{ width: j.progress + '%' }}
                    />
                  </div>
                ) : null}
                {j.state === 'error' && j.error ? (
                  <div className="mt-2 text-xs text-red-300">{j.error}</div>
                ) : null}
                {j.state === 'done' ? (
                  <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
                    <span>
                      <span className="mono">{formatBytes(j.file.size)}</span>{' '}
                      →{' '}
                      <span className="mono text-lime">
                        {formatBytes(j.resultSize ?? 0)}
                      </span>{' '}
                      (
                      <span className="mono text-lime">
                        {Math.round(
                          (1 - (j.resultSize ?? 0) / j.file.size) * 100,
                        )}
                        %
                      </span>{' '}
                      menor)
                    </span>
                    <button
                      onClick={() => downloadOne(j)}
                      className="btn-ghost !py-1 !px-2 text-xs"
                    >
                      Baixar
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
