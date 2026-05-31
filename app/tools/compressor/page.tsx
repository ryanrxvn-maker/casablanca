'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ToolHero, ToolStep, ToolChoice, ToolSlider, ToolAction, ToolMetric } from '@/components/tool-kit';
import { IconCompressor, IconStepUpload, IconStepSliders, IconStepFormat } from '@/components/ToolIcons';

const HUE = 'rgba(129,140,248,0.4)';
import { BatchFileUpload } from '@/components/BatchFileUpload';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  compressVideoOn,
  estimateCompressedSize,
  isCancellationError,
  probeVideoMetadata,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { destroyFFmpegPool, getFFmpegPool } from '@/lib/ffmpeg-pool';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes } from '@/lib/utils';

type Resolution = 'original' | '1080' | '720' | '480';

/* Metadados ficam num cache module-scope pra não disparar re-renders.
   Chave estável entre tabs: nome + size + lastModified. */
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
  estimatedSize: number;
  resultBlob: Blob | null;
  resultUrl: string | null;
  resultSize: number | null;
  error: string | null;
  /** ms tomados pelo job (medido client-side) */
  elapsedMs?: number;
};

/** Capacidade de processamento simultâneo. O pool decide o real
 *  baseado em RAM/CPU; aqui é só o teto pedido. */
const POOL_SIZE = 5;
const MAX_BATCH = 20;

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function makeJob(file: File, estimatedSize: number): Job {
  return {
    id: file.name + ':' + file.size + ':' + file.lastModified,
    file,
    state: 'queued',
    progress: 0,
    estimatedSize,
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

  /**
   * Fator de calibração — multiplica o estimate base. Começa em 1.0;
   * depois do primeiro job concluído, recalibramos pela razão real:
   *   calibration = actualSize / predictedSize
   *
   * Aplicado aos jobs ainda na fila e na preview da próxima leva.
   * Persiste em useToolState pra calibração sobreviver entre sessões
   * (mesmo CRF + resolução tendem a manter calibração estável).
   */
  const [calibration, setCalibration] = useToolState<number>(
    `compressor:cal:${resolution}:${crf}`,
    1,
  );

  const cancelledRef = useRef(false);

  // Total de bytes de entrada
  const totalInput = useMemo(
    () => files.reduce((acc, f) => acc + f.size, 0),
    [files],
  );

  /* Probe das metadatas em paralelo. */
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

  /** Estimativa CALIBRADA por arquivo (aplica o factor depois). */
  function estimateOne(f: File): number {
    const meta = metaCache.get(metaKey(f)) ?? { durationSec: 0, height: 0 };
    const raw = estimateCompressedSize({
      durationSec: meta.durationSec,
      inputHeight: meta.height,
      inputBytes: f.size,
      crf,
      resolution,
    });
    // Calibração: ajusta pelo histórico de erro do par (CRF, resolução).
    // Clampa em [0.5, 1.5] pra evitar deriva exagerada em casos atípicos.
    const cal = Math.max(0.5, Math.min(1.5, calibration));
    return Math.round(raw * cal);
  }

  /** Total estimado calibrado. */
  const totalEstimate = useMemo(() => {
    let total = 0;
    for (const f of files) total += estimateOne(f);
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, crf, resolution, metaTick, calibration]);

  /** Soma de durações. */
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
  const runningJobs = jobs.filter((j) => j.state === 'running');
  const queuedJobs = jobs.filter((j) => j.state === 'queued');
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

  /* Cancela tudo, mata pool e libera estado. */
  function handleCancel() {
    cancelledRef.current = true;
    destroyFFmpegPool();
    setProcessing(false);
    setStageMsg('Cancelado.');
  }

  /* Roda 1 job: pega instância do pool, processa, libera. */
  async function runJob(job: Job, batchIdx: number, batchTotal: number) {
    const pool = getFFmpegPool(POOL_SIZE);
    const t0 = performance.now();
    updateJob(job.id, { state: 'running', progress: 0 });
    const ff = await pool.acquire();
    try {
      if (cancelledRef.current) throw new Error('CANCELLED_BY_USER');
      const blob = await compressVideoOn(
        ff,
        job.file,
        { crf, resolution },
        {
          onProgress: (p: FFProgress) =>
            updateJob(job.id, { progress: Math.round(p.ratio * 100) }),
          onStage: (s) =>
            setStageMsg(`${batchIdx}/${batchTotal} · ${job.file.name} — ${s}`),
        },
      );
      const url = URL.createObjectURL(blob);
      const elapsedMs = performance.now() - t0;
      updateJob(job.id, {
        state: 'done',
        progress: 100,
        resultBlob: blob,
        resultUrl: url,
        resultSize: blob.size,
        elapsedMs,
      });
      // Recalibra pelo PRIMEIRO job concluído (mais robusto que média).
      if (job.estimatedSize > 0) {
        const ratio = blob.size / job.estimatedSize;
        // Atualiza só se erro >5% — evita oscilar à toa
        if (Math.abs(ratio - 1) > 0.05) {
          // Suaviza: 70% do novo + 30% do antigo (EWMA leve)
          setCalibration((prev) => prev * 0.3 + ratio * 0.7);
        }
      }
    } catch (e) {
      if (isCancellationError(e) || cancelledRef.current) {
        updateJob(job.id, { state: 'error', error: 'Cancelado pelo usuario.' });
      } else {
        // eslint-disable-next-line no-console
        console.error('[compressor]', job.file.name, e);
        updateJob(job.id, {
          state: 'error',
          error: (e as Error).message ?? 'Falha.',
        });
      }
    } finally {
      pool.release(ff);
    }
  }

  async function processAll() {
    if (files.length === 0 || processing) return;
    cancelledRef.current = false;
    setProcessing(true);
    setStageMsg(`Aquecendo motor (até ${POOL_SIZE} simultâneos)…`);

    // Limpa URLs antigas
    jobs.forEach((j) => j.resultUrl && URL.revokeObjectURL(j.resultUrl));
    const initial = files.map((f) => makeJob(f, estimateOne(f)));
    setJobs(initial);

    const total = initial.length;
    let dispatched = 0;
    let completed = 0;

    /* Worker que pega o próximo job da fila enquanto houver. Quando
       libera, dispara o próximo automaticamente (pool já reusa
       instância). É exatamente o "auto-fill" que o usuário pediu. */
    const worker = async () => {
      while (true) {
        if (cancelledRef.current) break;
        const idx = dispatched++;
        if (idx >= initial.length) break;
        const job = initial[idx];
        await runJob(job, idx + 1, total);
        completed++;
        setStageMsg(`${completed}/${total} concluídos…`);
      }
    };

    // Spawna POOL_SIZE workers competindo pelos jobs.
    const workers = Array.from(
      { length: Math.min(POOL_SIZE, initial.length) },
      () => worker(),
    );

    try {
      await Promise.all(workers);
      if (!cancelledRef.current) setStageMsg(`Concluído · ${total}/${total}`);
    } finally {
      setProcessing(false);
    }
  }

  /* Limpa o pool quando o usuário sai da página. */
  useEffect(() => {
    return () => {
      destroyFFmpegPool();
    };
  }, []);

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

  /* Precisão da estimate até agora (mostrado discreto na UI). */
  const estimateAccuracy = useMemo(() => {
    const done = jobs.filter((j) => j.state === 'done' && j.estimatedSize > 0);
    if (done.length === 0) return null;
    const errs = done.map((j) =>
      Math.abs((j.resultSize ?? 0) - j.estimatedSize) / Math.max(1, j.estimatedSize),
    );
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    return Math.max(0, Math.round((1 - avg) * 100));
  }, [jobs]);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 md:px-8">
      <ToolHero
        title="Compressor"
        eyebrow="VÍDEO · ATÉ 5 EM PARALELO"
        subtitle={`Reduz o peso dos vídeos sem perder qualidade visível. Até ${POOL_SIZE} comprimindo ao mesmo tempo, com preview de tamanho calibrado.`}
        hue={HUE}
        icon={<IconCompressor size={56} />}
      />
      <div className="mt-6 flex flex-col gap-5">
        <ToolStep
          n={1}
          icon={<IconStepUpload size={18} />}
          title="Solta os vídeos"
          hint={`Até ${MAX_BATCH} arquivos · MP4, WEBM ou MOV`}
          hue={HUE}
        >
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
                label={hasResults ? 'Saída real' : 'Previsão'}
                accent="lime"
              />
            </div>
          ) : null}

          {hasResults && totalInput > 0 ? (
            <SavingsBar
              input={totalInput}
              output={totalOutput}
              estimate={totalEstimate}
              accuracy={estimateAccuracy}
            />
          ) : null}
        </ToolStep>

        <ToolStep
          n={2}
          icon={<IconStepSliders size={18} />}
          title="Qualidade"
          hint="CRF mais alto = arquivo menor, mais perda visual"
          hue={HUE}
        >
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

        <ToolStep n={3} icon={<IconStepFormat size={18} />} title="Resolução" hue={HUE}>
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
              <CancelButton onClick={handleCancel} label="Cancelar processamento" />
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

          {/* Status do pool em execução — mostra quantos rodando agora */}
          {processing ? (
            <PoolStatus
              running={runningJobs.length}
              queued={queuedJobs.length}
              done={doneJobs.length}
              total={jobs.length}
              maxParallel={POOL_SIZE}
            />
          ) : null}
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
              <JobRow
                key={j.id}
                job={j}
                idx={idx}
                onDownload={() => downloadOne(j)}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ──────────────────────── Subcomponents ──────────────────────── */

function SavingsBar({
  input,
  output,
  estimate: _estimate,
  accuracy,
}: {
  input: number;
  output: number;
  estimate: number;
  accuracy: number | null;
}) {
  const pctSaved = Math.max(0, Math.round((1 - output / input) * 100));
  return (
    <div className="mt-3 rounded-[12px] border border-lime/30 bg-lime/[0.04] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-[11px] font-bold uppercase tracking-[0.18em] text-lime"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Você economizou
        </div>
        <div className="flex items-center gap-3 text-[12px] text-text-muted">
          <span>
            <span className="mono text-white">{formatBytes(input - output)}</span>{' '}
            (
            <span className="mono text-lime">{pctSaved}%</span>)
          </span>
          {accuracy !== null ? (
            <span
              className="mono"
              title="Quão perto a previsão ficou do tamanho real"
            >
              precisão{' '}
              <span className={accuracy >= 90 ? 'text-lime' : accuracy >= 75 ? 'text-amber-300' : 'text-rose-300'}>
                {accuracy}%
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-lime via-cyan-300 to-violet transition-all duration-700"
          style={{ width: pctSaved + '%' }}
        />
      </div>
    </div>
  );
}

function PoolStatus({
  running,
  queued,
  done,
  total,
  maxParallel,
}: {
  running: number;
  queued: number;
  done: number;
  total: number;
  maxParallel: number;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Chip color="lime" label={`Rodando · ${running}/${maxParallel}`} />
      <Chip color="violet" label={`Fila · ${queued}`} />
      <Chip color="cyan" label={`Concluídos · ${done}/${total}`} />
    </div>
  );
}

function Chip({
  color,
  label,
}: {
  color: 'lime' | 'violet' | 'cyan';
  label: string;
}) {
  const map = {
    lime: 'border-lime/45 bg-lime/10 text-lime',
    violet: 'border-violet/45 bg-violet/10 text-violet',
    cyan: 'border-cyan-400/45 bg-cyan-400/10 text-cyan-300',
  };
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em] ${map[color]}`}
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      <span
        className="inline-block h-1 w-1 animate-pulse-soft rounded-full"
        style={{ background: 'currentColor' }}
      />
      {label}
    </span>
  );
}

function JobRow({
  job,
  idx,
  onDownload,
}: {
  job: Job;
  idx: number;
  onDownload: () => void;
}) {
  const predicted = job.estimatedSize;
  const actual = job.resultSize ?? 0;
  const inputBytes = job.file.size;
  const pctSaved = actual > 0 ? Math.round((1 - actual / inputBytes) * 100) : 0;
  const predictedPctSaved = predicted > 0
    ? Math.round((1 - predicted / inputBytes) * 100)
    : 0;

  return (
    <li
      className="fade-in-up rounded-[12px] border border-line bg-bg p-3"
      style={{ animationDelay: `${Math.min(idx, 8) * 35}ms` }}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-white">
          {job.file.name}
        </span>
        <span
          className={
            'mono shrink-0 ' +
            (job.state === 'done'
              ? 'text-lime'
              : job.state === 'error'
                ? 'text-red-400'
                : job.state === 'running'
                  ? 'text-violet'
                  : 'text-text-muted')
          }
        >
          {job.state === 'queued'
            ? `na fila · prev. ${formatBytes(predicted)}`
            : job.state === 'running'
              ? job.progress + '%'
              : job.state === 'done'
                ? formatBytes(actual)
                : 'erro'}
        </span>
      </div>
      {job.state === 'running' ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-violet transition-all"
            style={{ width: job.progress + '%' }}
          />
        </div>
      ) : null}
      {job.state === 'queued' && predicted > 0 ? (
        <div className="mt-1 text-[10.5px] text-text-muted">
          Previsão: <span className="mono text-text-muted">{formatBytes(predicted)}</span> ({predictedPctSaved}% menor)
        </div>
      ) : null}
      {job.state === 'error' && job.error ? (
        <div className="mt-2 text-xs text-red-300">{job.error}</div>
      ) : null}
      {job.state === 'done' ? (
        <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
          <span>
            <span className="mono">{formatBytes(inputBytes)}</span>{' '}
            →{' '}
            <span className="mono text-lime">{formatBytes(actual)}</span>{' '}
            (<span className="mono text-lime">{pctSaved}%</span> menor)
            {predicted > 0 ? (
              <span className="mono ml-2 text-text-dim" title="Erro da previsão vs real">
                · prev. {formatBytes(predicted)} (
                {actual > predicted
                  ? '+' + Math.round(((actual - predicted) / predicted) * 100) + '%'
                  : '−' + Math.round(((predicted - actual) / predicted) * 100) + '%'}
                )
              </span>
            ) : null}
            {job.elapsedMs ? (
              <span className="mono ml-2 text-text-dim">
                · {(job.elapsedMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </span>
          <button
            onClick={onDownload}
            className="btn-ghost !py-1 !px-2 text-xs"
          >
            Baixar
          </button>
        </div>
      ) : null}
    </li>
  );
}

