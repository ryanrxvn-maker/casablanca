'use client';

import { useEffect, useMemo } from 'react';
import { logHistory } from '@/lib/history';
import { toFriendlyMessage } from '@/lib/friendly-error';
import { ToolShell } from '@/components/ToolShell';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  extractReportPcm,
  isCancellationError,
  normalizeVolume,
  type NormalizeEngineInfo,
  type NormalizeOutFormat,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { buildAudioReport, type AudioReport } from '@/lib/audio-report';
import { NormalizeReport } from '@/components/NormalizeReport';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { ToolStep, ToolChoice, ToolAction } from '@/components/tool-kit';
import { IconNormalizador, IconStepFiles, IconStepFormat } from '@/components/ToolIcons';

const HUE = 'rgba(94,234,212,0.4)';

/**
 * Normalizador de Volume — motor de duas passadas EBU R128 (denoise IA +
 * leveling + ganho estático medido; ver normalizeVolume no ffmpeg-worker),
 * com reforço automático pra casos extremos de oscilação.
 *
 * Modo batch (igual Compressor/Acelerador): aceita ate 10 arquivos,
 * processa em fila com progresso por job e oferece ZIP no final.
 *
 * Cada job concluído ganha um RELATÓRIO antes × depois (NormalizeReport):
 * onda sonora comparada, curva de volume com faixa nivelada, métricas
 * medidas de verdade no resultado (LUFS/oscilação/pico/ruído) e player A/B.
 *
 * Saida: MP4 (mantem video), MP3 ou WAV. Se qualquer input for so audio,
 * MP4 fica indisponivel automaticamente (igual Acelerador).
 */

type JobState = 'queued' | 'running' | 'done' | 'error';

type JobReport = { before: AudioReport; after: AudioReport };

type Job = {
  id: string;
  file: File;
  state: JobState;
  progress: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  /** URL do arquivo ORIGINAL (player A/B do relatório). */
  beforeUrl: string | null;
  /** Relatório antes × depois; null se a medição falhou (card sai sem gráfico). */
  report: JobReport | null;
  /** O que o motor decidiu (denoise, ganho, reforço extremo). */
  engine: NormalizeEngineInfo | null;
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
    beforeUrl: null,
    report: null,
    engine: null,
    error: null,
  };
}

function revokeJobUrls(job: Job) {
  if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
  if (job.beforeUrl) URL.revokeObjectURL(job.beforeUrl);
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
    jobs.forEach(revokeJobUrls);
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
    jobs.forEach(revokeJobUrls);
    const initial = files.map(makeJob);
    setJobs(initial);

    try {
      for (let i = 0; i < initial.length; i++) {
        const job = initial[i];
        updateJob(job.id, { state: 'running', progress: 0 });
        try {
          // Objeto mutável (não `let`) pro TS não estreitar o tipo pra null —
          // o callback preenche durante o processamento.
          const engineRef: { info: NormalizeEngineInfo | null } = { info: null };
          const runOpts = {
            onProgress: (p: FFProgress) =>
              updateJob(job.id, { progress: Math.round(p.ratio * 100) }),
            onStage: (s: string) =>
              setStageMsg(`Item ${i + 1}/${initial.length}: ${job.file.name} — ${s}`),
          };
          let blob: Blob;
          try {
            blob = await normalizeVolume(
              job.file,
              { output, onEngineInfo: (info) => { engineRef.info = info; } },
              runOpts,
            );
          } catch (firstErr) {
            if (isCancellationError(firstErr)) throw firstErr;
            // Instância WASM pode ter sido envenenada por um exec abortado
            // (ex.: "memory access out of bounds" no meio do lote). Zera e
            // tenta UMA vez com instância limpa antes de marcar erro.
            console.warn('[normalizador] job falhou, tentando de novo com instância limpa:', firstErr);
            cancelFFmpeg();
            setStageMsg(`Item ${i + 1}/${initial.length}: ${job.file.name} — reiniciando motor...`);
            blob = await normalizeVolume(
              job.file,
              { output, onEngineInfo: (info) => { engineRef.info = info; } },
              runOpts,
            );
          }
          const url = URL.createObjectURL(blob);

          // Relatório antes × depois: mede o ORIGINAL e o RESULTADO de
          // verdade (EBU R128 + envelope). Não-fatal: se falhar, o card sai
          // sem gráfico — o resultado normalizado NUNCA é descartado por
          // causa do relatório.
          let report: JobReport | null = null;
          let cancelledDuringReport = false;
          try {
            setStageMsg(
              `Item ${i + 1}/${initial.length}: ${job.file.name} — medindo antes × depois...`,
            );
            const rawBefore = await extractReportPcm(job.file);
            const beforeRep = buildAudioReport(
              rawBefore.pcm,
              rawBefore.sampleRate,
              rawBefore.loudnorm,
            );
            const rawAfter = await extractReportPcm(blob);
            const afterRep = buildAudioReport(
              rawAfter.pcm,
              rawAfter.sampleRate,
              rawAfter.loudnorm,
            );
            report = { before: beforeRep, after: afterRep };
          } catch (reportErr) {
            if (isCancellationError(reportErr)) cancelledDuringReport = true;
            else console.warn('[normalizador] relatório falhou:', reportErr);
          }

          updateJob(job.id, {
            state: 'done',
            progress: 100,
            resultBlob: blob,
            resultUrl: url,
            beforeUrl: URL.createObjectURL(job.file),
            report,
            engine: engineRef.info,
          });
          logHistory({ tool: 'normalizador', title: `${job.file.name} normalizado` });

          if (cancelledDuringReport) {
            // Cancelou durante a medição: o resultado deste job está OK
            // (fica como done, só sem gráfico); os próximos param.
            initial.slice(i + 1).forEach((rest) => {
              updateJob(rest.id, { state: 'error', error: 'Cancelado por você.' });
            });
            break;
          }
        } catch (e) {
          console.error('[normalizador]', job.file.name, e);
          if (isCancellationError(e)) {
            updateJob(job.id, { state: 'error', error: 'Cancelado por você.' });
            initial.slice(i + 1).forEach((rest) => {
              updateJob(rest.id, { state: 'error', error: 'Cancelado por você.' });
            });
            break;
          }
          updateJob(job.id, {
            state: 'error',
            error: toFriendlyMessage(
              e,
              'Não consegui normalizar esse arquivo. Tenta de novo — se repetir, ele pode estar corrompido ou muito pesado.',
            ),
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
      description="Tem 2 ou mais vozes no mesmo vídeo, uma alta e outra baixa? Ele resolve. Todas as vozes saem no mesmo nível confortável de ouvir — e ainda limpa o chiado de fundo, sem você mexer em nada. Cada arquivo sai com um relatório antes × depois: onda sonora, curva de volume, métricas e player pra comparar de ouvido."
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
              { value: 'mp4', label: 'MP4' },
              { value: 'mp3', label: 'MP3' },
              { value: 'wav', label: 'WAV' },
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
              <span className="label-tech uppercase tracking-widest">{stageMsg}</span>
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
                  <div className="mt-3 flex flex-col gap-2.5">
                    {output === 'mp4' ? (
                      <video
                        src={j.resultUrl}
                        controls
                        className="w-full rounded-[12px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,232,124,0.4)]"
                      />
                    ) : null}
                    {j.report && j.beforeUrl ? (
                      <NormalizeReport
                        before={j.report.before}
                        after={j.report.after}
                        beforeUrl={j.beforeUrl}
                        afterUrl={j.resultUrl}
                        engine={j.engine}
                      />
                    ) : output !== 'mp4' ? (
                      <AudioPlayer src={j.resultUrl} label="Resultado" />
                    ) : null}
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
