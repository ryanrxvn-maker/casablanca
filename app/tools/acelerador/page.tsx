'use client';

import { useEffect, useMemo } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  speedUpAudio,
  speedUpVideo,
  extractAudioAs,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
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
    await downloadBlob(
      job.resultBlob,
      baseName(job.file.name) + '_' + speed.toFixed(1) + 'x.' + format,
    );
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_' + speed.toFixed(1) + 'x.' + format,
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'acelerador_' + speed.toFixed(1) + 'x.zip');
    } finally {
      setZipping(false);
    }
  }

  const formatOptions: Array<{ id: OutFormat; label: string; disabled: boolean }> = [
    { id: 'mp4', label: 'MP4 (video)', disabled: anyAudio || files.length === 0 },
    { id: 'mp3', label: 'MP3 (audio)', disabled: false },
    { id: 'wav', label: 'WAV (audio)', disabled: false },
  ];

  return (
    <ToolShell
      title="Acelerador"
      description="Acelera audio/video sem mudar o tom. Processa ate 20 arquivos com escolha de formato de saida."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivos (ate {MAX_BATCH})</label>
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
            <span className="mono text-xs text-lime">{speed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="mt-3"
            disabled={processing}
          />
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
                    active
                      ? 'rounded-[12px] bg-lime px-4 py-2 text-sm font-semibold text-black'
                      : 'rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-lime hover:text-white disabled:opacity-40'
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
          <button
            onClick={processAll}
            className="btn-primary"
            disabled={files.length === 0 || processing}
          >
            {processing ? 'Processando...' : `Acelerar ${files.length || ''}`.trim()}
          </button>
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
          <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-xs text-text-muted">
            {stageMsg}
          </div>
        ) : null}

        {jobs.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="rounded-[12px] border border-line bg-bg p-3"
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
