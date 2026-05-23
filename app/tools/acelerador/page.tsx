'use client';

import { useEffect, useMemo } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  isCancellationError,
  speedUpAudio,
  speedUpVideo,
  extractAudioAs,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';

type OutFormat = 'mp4' | 'mp3' | 'wav';

type JobState = 'queued' | 'running' | 'done' | 'error';

type Job = {
  id: string;
  file: File;
  state: JobState;
  progress: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  error: string | null;
};

const MAX_BATCH = 20;

function isVideo(f: File) {
  return f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(f.name);
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
    resultBlob: null,
    resultUrl: null,
    error: null,
  };
}

export default function AceleradorPage() {
  const [files, setFiles] = useToolState<File[]>('acelerador:files', []);
  const [speed, setSpeed] = useToolState<number>('acelerador:speed', 1.5);
  const [format, setFormat] = useToolState<OutFormat>(
    'acelerador:format',
    'mp4',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'acelerador:processing',
    false,
  );
  const [jobs, setJobs] = useToolState<Job[]>('acelerador:jobs', []);
  const [stageMsg, setStageMsg] = useToolState<string | null>(
    'acelerador:stageMsg',
    null,
  );
  const [zipping, setZipping] = useToolState<boolean>(
    'acelerador:zipping',
    false,
  );

  const allVideos = useMemo(() => files.length > 0 && files.every(isVideo), [
    files,
  ]);
  const anyAudio = useMemo(() => files.some((f) => !isVideo(f)), [files]);

  // Se ha algum audio e o format atual e MP4, troca pra MP3
  useEffect(() => {
    if (format === 'mp4' && anyAudio) setFormat('mp3');
  }, [anyAudio, format]);

  const doneJobs = jobs.filter((j) => j.state === 'done');
  const hasResults = doneJobs.length > 0;

  function setFilesSafe(next: File[]) {
    if (processing) return;
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    setJobs([]);
    setFiles(next.slice(0, MAX_BATCH));
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function processOne(job: Job, i: number, total: number): Promise<void> {
    const fmt = format;
    const onProgress = (p: FFProgress) =>
      updateJob(job.id, { progress: Math.round(p.ratio * 100) });
    const onStage = (s: string) =>
      setStageMsg(`Item ${i + 1}/${total}: ${job.file.name} — ${s}`);

    if (fmt === 'mp4') {
      const blob = await speedUpVideo(job.file, speed, { onProgress, onStage });
      return finish(job, blob);
    }
    // Audio output (mp3 ou wav)
    if (isVideo(job.file)) {
      // Primeiro extrai audio no formato, depois acelera
      onStage('Extraindo audio...');
      const audio = await extractAudioAs(job.file, fmt, { onStage });
      onStage('Acelerando audio...');
      const out = await speedUpAudio(audio, speed, fmt, { onProgress, onStage });
      return finish(job, out);
    }
    const out = await speedUpAudio(job.file, speed, fmt, { onProgress, onStage });
    return finish(job, out);
  }

  function finish(job: Job, blob: Blob) {
    const url = URL.createObjectURL(blob);
    updateJob(job.id, {
      state: 'done',
      progress: 100,
      resultBlob: blob,
      resultUrl: url,
    });
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    setProcessing(true);
    setStageMsg('Preparando lote...');
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    const initial = files.map(makeJob);
    setJobs(initial);

    try {
      for (let i = 0; i < initial.length; i++) {
        const job = initial[i];
        updateJob(job.id, { state: 'running', progress: 0 });
        try {
          await processOne(job, i, initial.length);
        } catch (e) {
          console.error('[acelerador]', job.file.name, e);
          if (isCancellationError(e)) {
            updateJob(job.id, { state: 'error', error: 'Cancelado pelo usuario.' });
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

  function suffixTag(s: number) {
    // 1.50 -> "1.5x" ; 0.85 -> "0.85x" ; 2.00 -> "2x"
    const str = s.toFixed(2).replace(/\.?0+$/, '');
    return str + 'x';
  }

  async function downloadOne(job: Job) {
    if (!job.resultBlob) return;
    await downloadBlob(
      job.resultBlob,
      baseName(job.file.name) + '_' + suffixTag(speed) + '.' + format,
    );
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_' + suffixTag(speed) + '.' + format,
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'mixer_' + suffixTag(speed) + '.zip');
    } finally {
      setZipping(false);
    }
  }

  const formatOptions: Array<{ id: OutFormat; label: string; disabled: boolean }> = [
    { id: 'mp4', label: 'MP4 (video)', disabled: anyAudio || files.length === 0 },
    { id: 'mp3', label: 'MP3 (audio)', disabled: false },
    { id: 'wav', label: 'WAV (audio)', disabled: false },
  ];

  const speedMode: 'slow' | 'same' | 'fast' =
    speed < 0.99 ? 'slow' : speed > 1.01 ? 'fast' : 'same';
  const actionLabel =
    speedMode === 'slow' ? 'Desacelerar' : speedMode === 'fast' ? 'Acelerar' : 'Processar';

  return (
    <ToolShell
      title="Acelerador"
      eyebrow="VÍDEO / ÁUDIO"
      description="Acelera ou desacelera sem deixar a voz robotizada. Vários arquivos de uma vez."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivos (até {MAX_BATCH})</label>
          <BatchFileUpload
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP3, WAV, MP4, WEBM ou MOV"
            disabled={processing}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Velocidade</label>
            <span
              className={
                'mono text-xs ' +
                (speedMode === 'slow'
                  ? 'text-cyan-300'
                  : speedMode === 'fast'
                    ? 'text-lime'
                    : 'text-text-muted')
              }
            >
              {speed.toFixed(2)}x
              <span className="ml-2 uppercase tracking-widest opacity-60">
                {speedMode === 'slow'
                  ? 'desacelerando'
                  : speedMode === 'fast'
                    ? 'acelerando'
                    : 'original'}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={3.0}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="mt-3"
            disabled={processing}
          />
          <div className="mono mt-1 flex justify-between text-[10px] uppercase tracking-widest text-text-muted">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>3.0x</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[0.75, 0.85, 1.0, 1.25, 1.5, 2.0].map((preset) => {
              const active = Math.abs(speed - preset) < 0.001;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSpeed(preset)}
                  disabled={processing}
                  className={
                    'mono rounded-[8px] px-2 py-1 text-[11px] transition-all duration-150 disabled:opacity-40 ' +
                    (active
                      ? 'bg-lime/90 font-semibold text-black'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                >
                  {preset.toFixed(2)}x
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label-field">Formato de saida</label>
          <div className="flex flex-wrap gap-2">
            {formatOptions.map((opt) => {
              const active = format === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => !opt.disabled && setFormat(opt.id)}
                  disabled={processing || opt.disabled}
                  className={
                    'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 ' +
                    (active
                      ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                  title={opt.disabled ? 'MP4 indisponivel: um dos arquivos nao e video' : undefined}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {allVideos && format !== 'mp4' ? (
            <p className="mt-2 text-xs text-text-muted">
              Saida de audio puro: o video sera descartado e so o audio
              acelerado sera exportado.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          {processing ? (
            <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
          ) : (
            <button
              onClick={processAll}
              className="btn-primary"
              disabled={files.length === 0 || speedMode === 'same'}
              title={
                speedMode === 'same'
                  ? 'Mova o slider para acelerar ou desacelerar'
                  : undefined
              }
            >
              {`${actionLabel} ${files.length || ''}`.trim()}
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
                          ? formatBytes(j.resultBlob?.size ?? 0)
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
                  <div className="mt-2 flex items-center justify-end text-xs text-text-muted">
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
    </ToolShell>
  );
}
