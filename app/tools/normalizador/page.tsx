'use client';

import { useEffect, useMemo } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  isCancellationError,
  normalizeVolume,
  type NormalizeOutFormat,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { ToolStep, ToolChoice, ToolAction } from '@/components/tool-kit';
import { IconNormalizador, IconStepFiles, IconStepFormat } from '@/components/ToolIcons';

const HUE = 'rgba(94,234,212,0.4)';

/**
 * Normalizador de Volume — equilibra o volume com compressor estatico.
 *
 * Modo batch (igual Compressor/Acelerador): aceita ate 10 arquivos,
 * processa em fila com progresso por job e oferece ZIP no final.
 *
 * Saida: MP4 (mantem video), MP3 ou WAV. Se qualquer input for so audio,
 * MP4 fica indisponivel automaticamente (igual Acelerador).
 */

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

const MAX_BATCH = 10;

function isVideoFile(f: File | null) {
  if (!f) return false;
  return f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(f.name);
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

export default function NormalizadorPage() {
  const [files, setFiles] = useToolState<File[]>('normalizador:files', []);
  const [output, setOutput] = useToolState<NormalizeOutFormat>(
    'normalizador:output',
    'mp4',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'normalizador:processing',
    false,
  );
  const [jobs, setJobs] = useToolState<Job[]>('normalizador:jobs', []);
  const [stageMsg, setStageMsg] = useToolState<string | null>(
    'normalizador:stageMsg',
    null,
  );
  const [zipping, setZipping] = useToolState<boolean>(
    'normalizador:zipping',
    false,
  );

  const allVideos = useMemo(() => files.length > 0 && files.every(isVideoFile), [files]);
  const anyAudio = useMemo(() => files.some((f) => !isVideoFile(f)), [files]);

  // Se chegou audio puro e o output era MP4, joga pra MP3.
  useEffect(() => {
    if (output === 'mp4' && anyAudio) setOutput('mp3');
  }, [anyAudio, output, setOutput]);

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
          const blob = await normalizeVolume(
            job.file,
            { output },
            {
              onProgress: (p: FFProgress) =>
                updateJob(job.id, { progress: Math.round(p.ratio * 100) }),
              onStage: (s) =>
                setStageMsg(`Item ${i + 1}/${initial.length}: ${job.file.name} — ${s}`),
            },
          );
          const url = URL.createObjectURL(blob);
          updateJob(job.id, {
            state: 'done',
            progress: 100,
            resultBlob: blob,
            resultUrl: url,
          });
        } catch (e) {
          console.error('[normalizador]', job.file.name, e);
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

  async function downloadOne(job: Job) {
    if (!job.resultBlob) return;
    await downloadBlob(
      job.resultBlob,
      baseName(job.file.name) + '_normalizado.' + output,
    );
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_normalizado.' + output,
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'normalizado.zip');
    } finally {
      setZipping(false);
    }
  }

  return (
    <ToolShell
      title="Normalizador"
      eyebrow="ÁUDIO · MULTI-AVATAR"
      description="Tem 2 ou mais vozes no mesmo vídeo, uma alta e outra baixa? Ele resolve. Todas as vozes saem no mesmo nível confortável de ouvir — e ainda limpa o chiado de fundo, sem você mexer em nada."
      hue={HUE}
      icon={<IconNormalizador size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} icon={<IconStepFiles size={18} />} title="Arquivos" hint={`Até ${MAX_BATCH} · MP3, WAV, MP4, WEBM ou MOV`} hue={HUE}>
          <BatchFileUpload
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            value={files}
            onChange={setFilesSafe}
            max={MAX_BATCH}
            hint="MP3, WAV, MP4, WEBM ou MOV"
            disabled={processing}
          />
        </ToolStep>

        <ToolStep n={2} icon={<IconStepFormat size={18} />} title="Formato de saída" hue={HUE}>
          <ToolChoice
            value={output}
            onChange={(v) => {
              const disabled = v === 'mp4' && (anyAudio || files.length === 0);
              if (!disabled && !processing) setOutput(v as NormalizeOutFormat);
            }}
            options={[
              { value: 'mp4', label: 'MP4', sub: 'vídeo' },
              { value: 'mp3', label: 'MP3', sub: 'áudio' },
              { value: 'wav', label: 'WAV', sub: 'áudio' },
            ]}
            disabled={processing}
            hue={HUE}
          />
          <p className="mt-2 text-xs text-text-muted">
            {output === 'mp4'
              ? 'Vídeo mantido; só a trilha de áudio é normalizada.'
              : allVideos
                ? 'A imagem do vídeo é descartada — saída é só o áudio normalizado.'
                : 'Saída de áudio normalizado.'}
          </p>
        </ToolStep>

        <ToolStep n={3} title={processing ? 'Normalizando…' : 'Normalizar'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            {processing ? (
              <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
            ) : (
              <ToolAction onClick={processAll} disabled={files.length === 0}>
                {`Normalizar ${files.length || ''}`.trim()}
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
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
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
                          ? 'OK'
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
                {j.state === 'done' && j.resultUrl ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {output === 'mp4' ? (
                      <video
                        src={j.resultUrl}
                        controls
                        className="w-full rounded-[12px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,232,124,0.4)]"
                      />
                    ) : (
                      <AudioPlayer src={j.resultUrl} label="Resultado" />
                    )}
                    <div className="flex justify-end">
                      <button
                        onClick={() => downloadOne(j)}
                        className="btn-ghost !py-1 !px-2 text-xs"
                      >
                        Baixar {output.toUpperCase()}
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
