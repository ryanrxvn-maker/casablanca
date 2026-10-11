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
  cancelarMotorSeDono,
  extractReportPcm,
  normalizeVolume,
  type NormalizeEngineInfo,
  type NormalizeOutFormat,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { buildAudioReport, type AudioReport } from '@/lib/audio-report';
import { NormalizeReport } from '@/components/NormalizeReport';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { runFfmpegExclusive, MSG_NA_FILA } from '@/lib/ffmpeg-serial';
import { acquireKeepAlive, releaseKeepAlive } from '@/lib/tab-keepalive';
import { zipCabeNoNavegador, MSG_ZIP_GRANDE, MSG_ZIP_FALHOU } from '@/lib/zip-limite';
import { ToolStep, ToolChoice, ToolAction } from '@/components/tool-kit';
import { IconNormalizador, IconStepFiles, IconStepFormat } from '@/components/ToolIcons';

const HUE = 'rgba(94,234,212,0.4)';

/**
 * Normalizador de Áudio — motor de duas passadas EBU R128 (denoise IA +
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
  /** Formato em que ESTE resultado saiu (10.10): trocar o seletor depois não
   *  pode mudar a extensão do arquivo já pronto (baixava MP3 com nome .wav). */
  output?: NormalizeOutFormat;
};

const MAX_BATCH = 10;

/** Dono deste lote na fila do motor (o Cancelar daqui não derruba outra ferramenta). */
const DONO = 'normalizador';
/** Flag do Cancelar fora do componente (sobrevive a sair e voltar da página). */
const lote = { cancelado: false };

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
    // Mantém os resultados de quem CONTINUA na lista (10.10).
    const ficam = next.slice(0, MAX_BATCH);
    const ids = new Set(ficam.map((f) => f.name + ':' + f.size + ':' + f.lastModified));
    jobs.forEach((j) => { if (!ids.has(j.id)) revokeJobUrls(j); });
    setJobs(jobs.filter((j) => ids.has(j.id)));
    setFiles(ficam);
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    lote.cancelado = false;
    setProcessing(true);
    setStageMsg('Preparando lote...');
    // Reaproveita o que já ficou pronto no MESMO formato (10.10).
    const prontos = new Map(
      jobs.filter((j) => j.state === 'done' && j.output === output).map((j) => [j.id, j] as const),
    );
    jobs.forEach((j) => { if (!prontos.has(j.id)) revokeJobUrls(j); });
    const lista = files.map((f) => prontos.get(f.name + ':' + f.size + ':' + f.lastModified) ?? makeJob(f));
    setJobs(lista);
    const initial = lista.filter((j) => j.state !== 'done');
    const outNow = output;
    // A aba não congela em segundo plano enquanto processa (10.10).
    acquireKeepAlive();

    try {
      for (let i = 0; i < initial.length; i++) {
        const job = initial[i];
        if (lote.cancelado) break;
        updateJob(job.id, { state: 'running', progress: 0 });
        try {
          // Um arquivo por vez na FILA GLOBAL do motor (10.10): rodando junto
          // com outra ferramenta, o Normalizador chegou a entregar o vídeo dela.
          const cancelouNoRelatorio = await runFfmpegExclusive(async () => {
            if (lote.cancelado) throw new Error('CANCELLED_BY_USER');
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
                { output: outNow, onEngineInfo: (info) => { engineRef.info = info; } },
                runOpts,
              );
            } catch (firstErr) {
              if (lote.cancelado) throw firstErr;
              // Instância WASM pode ter sido envenenada por um exec abortado
              // (ex.: "memory access out of bounds" no meio do lote). Zera e
              // tenta UMA vez com instância limpa antes de marcar erro.
              console.warn('[normalizador] job falhou, tentando de novo com instância limpa:', firstErr);
              cancelFFmpeg();
              setStageMsg(`Item ${i + 1}/${initial.length}: ${job.file.name} — tentando de novo…`);
              blob = await normalizeVolume(
                job.file,
                { output: outNow, onEngineInfo: (info) => { engineRef.info = info; } },
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
              if (lote.cancelado) cancelledDuringReport = true;
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
              output: outNow,
            });
            logHistory({ tool: 'normalizador', title: `${job.file.name} normalizado` });
            return cancelledDuringReport;
          }, DONO, () => setStageMsg(MSG_NA_FILA));
          if (cancelouNoRelatorio) {
            // Cancelou durante a medição: o resultado deste job está OK
            // (fica como done, só sem gráfico); os próximos param.
            initial.slice(i + 1).forEach((rest) => {
              updateJob(rest.id, { state: 'error', error: 'Cancelado por você.' });
            });
          }
          if (lote.cancelado) break;
        } catch (e) {
          console.error('[normalizador]', job.file.name, e);
          // Só é "Cancelado por você." se o cliente clicou em Cancelar (10.10).
          if (lote.cancelado) {
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
      setStageMsg(lote.cancelado ? 'Cancelado.' : 'Lote finalizado.');
    } finally {
      releaseKeepAlive();
      setProcessing(false);
    }
  }

  function cancelar() {
    lote.cancelado = true;
    // Só derruba o motor se for a vez DESTE lote (não mata outra ferramenta).
    cancelarMotorSeDono(DONO);
  }

  /** Formato REAL do resultado (o do processamento, não o do seletor agora). */
  const formatoDe = (j: Job): NormalizeOutFormat => j.output ?? output;

  async function downloadOne(job: Job) {
    if (!job.resultBlob) return;
    await downloadBlob(
      job.resultBlob,
      baseName(job.file.name) + '_normalizado.' + formatoDe(job),
    );
  }

  async function downloadZip() {
    const done = jobs.filter((j) => j.state === 'done' && j.resultBlob);
    if (done.length === 0) return;
    if (!zipCabeNoNavegador(done.map((j) => j.resultBlob!.size))) {
      setStageMsg(MSG_ZIP_GRANDE);
      return;
    }
    setZipping(true);
    try {
      const zip = await buildZip(
        done.map((j) => ({
          name: baseName(j.file.name) + '_normalizado.' + formatoDe(j),
          data: j.resultBlob!,
        })),
      );
      await downloadBlob(zip, 'normalizado.zip');
    } catch (e) {
      console.error('[normalizador] zip', e);
      setStageMsg(MSG_ZIP_FALHOU);
    } finally {
      setZipping(false);
    }
  }

  return (
    <ToolShell
      title="Normalizador de Áudio"
      eyebrow="ÁUDIO · VOLUME"
      description="Equilibre o volume das vozes e reduza o ruído de fundo. Compare o áudio original com o resultado e confira o relatório de cada arquivo."
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
              <CancelButton onClick={cancelar} label="Cancelar processamento" />
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
                    {formatoDe(j) === 'mp4' ? (
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
                    ) : formatoDe(j) !== 'mp4' ? (
                      <AudioPlayer src={j.resultUrl} label="Resultado" />
                    ) : null}
                    <div className="flex justify-end">
                      <button
                        onClick={() => downloadOne(j)}
                        className="btn-ghost !py-1 !px-2 text-xs"
                      >
                        Baixar {formatoDe(j).toUpperCase()}
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
