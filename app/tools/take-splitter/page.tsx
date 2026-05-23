'use client';

import { useEffect, useMemo } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  isCancellationError,
  splitVideoByScenes,
  probeVideoMetadata,
  type Take,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { buildZip } from '@/lib/zip-builder';
import { formatBytes, formatTime } from '@/lib/utils';
import { ToolStep, ToolSlider, ToolAction, ToolMetric } from '@/components/tool-kit';
import { IconTakeSplitter } from '@/components/ToolIcons';

const HUE = 'rgba(134,239,172,0.4)';

/**
 * Take Splitter — separa um video em "takes" baseado nos cortes de cena
 * detectados pelo FFmpeg WASM.
 *
 * Arquitetura: 100% client-side. Roda 2 passadas:
 *  1. Scan completo com select='gt(scene,T)' pra detectar timestamps
 *  2. Pra cada segmento entre cortes: -c copy (zero re-encode, lossless)
 *
 * Limite pratico: ~2GB de input por causa do MEMFS do FFmpeg WASM.
 * Pra documentarios maiores, comprima primeiro com a ferramenta Compressor.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

type StoredTake = {
  index: number;
  startSec: number;
  endSec: number;
  url: string;
  size: number;
};

function sanitizeNiche(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase() || 'take'
  );
}

function takeFileName(index: number, niche: string): string {
  const safe = sanitizeNiche(niche);
  return `take_${String(index).padStart(3, '0')}_${safe}.mp4`;
}

export default function TakeSplitterPage() {
  const [file, setFile] = useToolState<File | null>('takesplit:file', null);
  const [niche, setNiche] = useToolState<string>('takesplit:niche', 'memoria');
  const [threshold, setThreshold] = useToolState<number>(
    'takesplit:threshold',
    0.3,
  );
  const [minDur, setMinDur] = useToolState<number>('takesplit:minDur', 3);
  const [processing, setProcessing] = useToolState<boolean>(
    'takesplit:processing',
    false,
  );
  const [status, setStatus] = useToolState<string | null>(
    'takesplit:status',
    null,
  );
  const [progress, setProgress] = useToolState<number | null>(
    'takesplit:progress',
    null,
  );
  const [takes, setTakes] = useToolState<StoredTake[]>('takesplit:takes', []);
  const [error, setError] = useToolState<string | null>(
    'takesplit:error',
    null,
  );
  const [zipping, setZipping] = useToolState<boolean>(
    'takesplit:zipping',
    false,
  );
  const [duration, setDuration] = useToolState<number | null>(
    'takesplit:duration',
    null,
  );
  const [useAi, setUseAi] = useToolState<boolean>('takesplit:useAi', false);

  // Probe metadata quando arquivo entra
  useEffect(() => {
    if (!file) {
      setDuration(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const meta = await probeVideoMetadata(file);
      if (!cancelled && meta) setDuration(meta.durationSec);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const sizeError = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      return `Arquivo de ${formatBytes(file.size)} excede o limite de 2GB pra processamento client-side. Comprima primeiro com a ferramenta Compressor.`;
    }
    return null;
  }, [file]);

  // Mantem apenas takes em forma serializavel (URL + metadados). O blob
  // fica vivo enquanto a URL nao for revoked.
  function reset() {
    takes.forEach((t) => URL.revokeObjectURL(t.url));
    setTakes([]);
    setStatus(null);
    setProgress(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    if (sizeError) {
      setError(sizeError);
      return;
    }
    reset();
    setProcessing(true);
    try {
      setStatus('Carregando...');
      const result: Take[] = await splitVideoByScenes(
        file,
        {
          threshold,
          minDurationSec: minDur,
          aiVerify: useAi
            ? async (candidates) => {
                const res = await fetch('/api/take-splitter/verify-cuts', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ candidates }),
                });
                const json = await res.json();
                if (!res.ok) {
                  throw new Error(json.error || 'Verificacao IA falhou.');
                }
                return json.verified ?? [];
              }
            : undefined,
        },
        {
          onStage: (s) => setStatus(s),
          onProgress: (p: FFProgress) => setProgress(p.ratio),
        },
      );
      const stored: StoredTake[] = result.map((t) => ({
        index: t.index,
        startSec: t.startSec,
        endSec: t.endSec,
        url: URL.createObjectURL(t.blob),
        size: t.blob.size,
      }));
      setTakes(stored);
      setStatus(null);
      setProgress(null);
    } catch (e) {
      console.error(e);
      if (isCancellationError(e)) {
        setStatus('Cancelado pelo usuario.');
        setError(null);
      } else {
        setError(
          (e as Error)?.message ??
            'Falha ao processar. O arquivo pode estar corrompido ou ser muito grande.',
        );
        setStatus(null);
      }
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  }

  async function downloadTake(t: StoredTake) {
    const res = await fetch(t.url);
    const blob = await res.blob();
    await downloadBlob(blob, takeFileName(t.index, niche));
  }

  async function downloadAllZip() {
    if (takes.length === 0) return;
    setZipping(true);
    try {
      // Baixa cada blob via fetch da URL (eles ainda estao vivos)
      const items = await Promise.all(
        takes.map(async (t) => {
          const res = await fetch(t.url);
          const blob = await res.blob();
          return { name: takeFileName(t.index, niche), data: blob };
        }),
      );
      const zip = await buildZip(items);
      await downloadBlob(zip, `takes_${sanitizeNiche(niche)}.zip`);
    } finally {
      setZipping(false);
    }
  }

  return (
    <ToolShell
      title="Separar takes"
      eyebrow="VÍDEO"
      description="Recebe o bruto, devolve cada take separado em um arquivo. Tudo direto no navegador, sem perder qualidade."
      hue={HUE}
      icon={<IconTakeSplitter size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} title="Vídeo" hint="MP4, MOV, WEBM, MKV — até 2GB" hue={HUE}>
          <FileUpload
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP4, MOV, WEBM, MKV — ate 2GB"
          />
          {file ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <ToolMetric value={formatBytes(file.size)} label="Tamanho" />
              {duration !== null ? (
                <ToolMetric value={formatTime(duration)} label="Duração" accent="lime" />
              ) : null}
            </div>
          ) : null}
          {sizeError ? (
            <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {sizeError}
            </div>
          ) : null}
        </ToolStep>

        <ToolStep n={2} title="Nome dos arquivos" hint="Vai virar o sufixo de cada take" hue={HUE}>
          <input
            id="niche"
            type="text"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="memoria"
            className="input-field"
            disabled={processing}
            maxLength={40}
          />
          <p className="mt-2 text-[11px] text-text-muted">
            Saída:{' '}
            <span className="mono text-violet">
              {takeFileName(1, niche || 'take')}
            </span>
            ,{' '}
            <span className="mono text-violet">
              {takeFileName(2, niche || 'take')}
            </span>
            …
          </p>
        </ToolStep>

        <ToolStep n={3} title="Sensibilidade" hint="Quão sensível é a detecção de corte" hue={HUE}>
          <ToolSlider
            label="Threshold"
            min={0.1}
            max={0.6}
            step={0.05}
            value={threshold}
            onChange={(v) => setThreshold(v)}
            display={(v) => v.toFixed(2)}
            disabled={processing}
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-text-muted">
            <span>Mais cortes</span>
            <span>Menos cortes</span>
          </div>
          <p className="mt-3 text-[11px] text-text-muted leading-relaxed">
            0.30 é padrão pra documentário/entrevista. Aumente pra 0.45+ se pega cortes falsos por movimento. Diminua pra 0.20 pra transições sutis.
          </p>

          <div className="mt-4">
            <ToolSlider
              label="Duração mínima por take"
              min={1}
              max={30}
              step={1}
              value={minDur}
              onChange={(v) => setMinDur(Math.round(v))}
              display={(v) => v + 's'}
              disabled={processing}
            />
          </div>
        </ToolStep>

        <ToolStep n={4} title="Verificação IA" hint="Opcional — filtra falsos positivos" hue={HUE}>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              disabled={processing}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-violet"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-white">Claude Haiku Vision</span>
                <span className="mono rounded-full bg-violet/10 px-2 py-0.5 text-[10px] uppercase text-violet">
                  ~$0.05 / 5min
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                Verifica cada corte comparando frame antes/depois. Filtra motion blur, flash e transições. Requer Anthropic key.
              </p>
            </div>
          </label>
        </ToolStep>

        <ToolStep n={5} title={processing ? 'Detectando…' : 'Detectar e separar'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            {processing ? (
              <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
            ) : (
              <ToolAction onClick={process} disabled={!file || !!sizeError}>
                Detectar e Separar
              </ToolAction>
            )}
            <button
              onClick={() => {
                reset();
                setFile(null);
                setDuration(null);
              }}
              className="btn-secondary"
              disabled={processing}
            >
              Limpar
            </button>
            {takes.length > 1 ? (
              <button
                onClick={downloadAllZip}
                className="btn-secondary"
                disabled={zipping || processing}
              >
                {zipping ? 'Zipando...' : `Baixar ZIP (${takes.length})`}
              </button>
            ) : null}
          </div>
        </ToolStep>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {status ? (
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
              <span className="mono uppercase tracking-widest">{status}</span>
            </div>
            {progress !== null ? (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-lime transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {takes.length > 0 ? (
          <div className="fade-in-up mt-2 border-t border-line pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
                </span>
                {takes.length}{' '}
                {takes.length === 1 ? 'take detectado' : 'takes detectados'}
              </h3>
            </div>
            <ul className="grid gap-2">
              {takes.map((t, idx) => (
                <li
                  key={t.index}
                  className="fade-in-up flex flex-col gap-2 rounded-[12px] border border-line bg-bg p-3"
                  style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-lime">
                        TAKE {String(t.index).padStart(3, '0')}
                      </span>
                      <span className="mono text-white">
                        {formatTime(t.startSec)} → {formatTime(t.endSec)}
                      </span>
                      <span className="mono text-text-muted">
                        ({(t.endSec - t.startSec).toFixed(1)}s ·{' '}
                        {formatBytes(t.size)})
                      </span>
                    </div>
                    <button
                      onClick={() => downloadTake(t)}
                      className="btn-ghost !py-1 !px-2 text-xs"
                    >
                      Baixar
                    </button>
                  </div>
                  <video
                    src={t.url}
                    controls
                    preload="metadata"
                    className="w-full rounded-[8px] border border-line bg-bg"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
