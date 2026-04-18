'use client';

import { useMemo, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { VideoPlayer } from '@/components/VideoPlayer';
import { downloadBlob } from '@/lib/audio-engine';
import { compressVideo, type FFProgress } from '@/lib/ffmpeg-worker';
import { formatBytes } from '@/lib/utils';

type Resolution = 'original' | '1080' | '720' | '480';

const resolutionFactor: Record<Resolution, number> = {
  original: 1,
  '1080': 0.75,
  '720': 0.5,
  '480': 0.28,
};

export default function CompressorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [crf, setCrf] = useState(23);
  const [resolution, setResolution] = useState<Resolution>('original');
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);

  const estimate = useMemo(() => {
    if (!file) return null;
    // tamanho x (crf/23) x fator_resolucao - conforme spec
    const size = file.size * (crf / 23) * resolutionFactor[resolution];
    return Math.max(size, 0);
  }, [file, crf, resolution]);

  function reset() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStatus(null);
    setError(null);
    setProgress(0);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      setStatus('Carregando FFmpeg (pode levar alguns segundos na primeira vez)...');
      const onProgress = (p: FFProgress) => {
        setProgress(Math.round(p.ratio * 100));
        setStatus('Comprimindo... ' + Math.round(p.ratio * 100) + '%');
      };
      const blob = await compressVideo(file, { crf, resolution }, { onProgress });
      const url = URL.createObjectURL(blob);
      setResult({ blob, url });
      setStatus(null);
      setProgress(100);
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? 'Falha ao comprimir o video.');
      setStatus(null);
    } finally {
      setProcessing(false);
    }
  }

  async function download() {
    if (!result || !file) return;
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
    const suffix = resolution === 'original' ? 'crf' + crf : resolution + 'p_crf' + crf;
    await downloadBlob(result.blob, base + '_' + suffix + '.mp4');
  }

  return (
    <ToolShell
      title="Compressor"
      description="Comprime videos grandes mantendo qualidade perceptivel, com H.264 CRF."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Video</label>
          <FileUpload
            accept="video/mp4,video/webm,video/quicktime"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP4, WEBM ou MOV"
          />
        </div>

        {file && (
          <div className="grid gap-3 rounded-[12px] border border-line bg-bg p-4 sm:grid-cols-3">
            <div>
              <div className="label-field">Arquivo</div>
              <div className="truncate text-sm text-white">{file.name}</div>
            </div>
            <div>
              <div className="label-field">Tamanho original</div>
              <div className="mono text-sm text-white">{formatBytes(file.size)}</div>
            </div>
            <div>
              <div className="label-field">Previsao final</div>
              <div className="mono text-sm text-lime">
                {result
                  ? formatBytes(result.blob.size)
                  : estimate
                    ? '~ ' + formatBytes(estimate)
                    : '-'}
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Qualidade (CRF)</label>
            <span className="mono text-xs text-lime">{crf}</span>
          </div>
          <input
            type="range"
            min={18}
            max={35}
            step={1}
            value={crf}
            onChange={(e) => setCrf(parseInt(e.target.value))}
            className="mt-3"
          />
          <div className="mt-2 flex justify-between text-[11px] uppercase tracking-widest text-text-muted">
            <span>Alta qualidade</span>
            <span>Menor arquivo</span>
          </div>
        </div>

        <div>
          <label className="label-field">Resolucao</label>
          <div className="flex flex-wrap gap-2">
            {(['original', '1080', '720', '480'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setResolution(r)}
                className={
                  resolution === r
                    ? 'rounded-[12px] bg-lime px-4 py-2 text-sm font-semibold text-black'
                    : 'rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-lime hover:text-white'
                }
              >
                {r === 'original' ? 'Original' : r + 'p'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={process}
            className="btn-primary"
            disabled={!file || processing}
          >
            {processing ? 'Processando...' : 'Comprimir'}
          </button>
          <button
            onClick={() => {
              reset();
              setFile(null);
            }}
            className="btn-secondary"
            disabled={processing}
          >
            Limpar
          </button>
        </div>

        {status ? (
          <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-xs text-text-muted">
            {status}
            {progress > 0 && progress < 100 ? (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-lime transition-all"
                  style={{ width: progress + '%' }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="mt-2 border-t border-line pt-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs uppercase tracking-widest text-text-muted">
                Resultado
              </div>
              <div className="mono text-xs text-lime">
                {formatBytes(result.blob.size)}
                {file
                  ? ' | ' +
                    Math.round((1 - result.blob.size / file.size) * 100) +
                    '% menor'
                  : ''}
              </div>
            </div>
            <VideoPlayer src={result.url} />
            <div className="mt-3 flex justify-end">
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar MP4
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
