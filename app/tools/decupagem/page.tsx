'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import {
  decodeAudioRobust,
  downloadBlob,
  encodeWAV,
  trimSilences,
} from '@/lib/audio-engine';
import { formatTime } from '@/lib/utils';

export default function DecupagemPage() {
  const [file, setFile] = useState<File | null>(null);
  const [keepSilence, setKeepSilence] = useState(0.05);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    blob: Blob;
    url: string;
    originalDur: number;
    newDur: number;
  } | null>(null);

  function reset() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStatus(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      setStatus('Decodificando audio...');
      const decoded = await decodeAudioRobust(file, (s) => setStatus(s));
      setStatus('Removendo silencios...');
      const trimmed = trimSilences(decoded, keepSilence);
      setStatus('Codificando WAV...');
      const blob = encodeWAV(trimmed);
      setResult({
        blob,
        url: URL.createObjectURL(blob),
        originalDur: decoded.duration,
        newDur: trimmed.duration,
      });
      setStatus(null);
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? 'Falha ao processar o arquivo.');
      setStatus(null);
    } finally {
      setProcessing(false);
    }
  }

  async function download() {
    if (!result || !file) return;
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
    await downloadBlob(result.blob, base + '_decupado.wav');
  }

  const reducedPct =
    result && result.originalDur > 0
      ? Math.max(0, Math.round((1 - result.newDur / result.originalDur) * 100))
      : 0;

  return (
    <ToolShell
      title="Decupagem"
      description="Remove automaticamente todos os silencios de um audio ou video, deixando so a fala."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivo</label>
          <FileUpload
            accept="audio/*,video/mp4,video/webm"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4 ou WEBM"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Tolerancia de silencio</label>
            <span className="mono text-xs text-lime">
              {keepSilence.toFixed(2)}s
            </span>
          </div>
          <input
            type="range"
            min={0.01}
            max={0.5}
            step={0.01}
            value={keepSilence}
            onChange={(e) => setKeepSilence(parseFloat(e.target.value))}
            className="mt-3"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={process}
            className="btn-primary"
            disabled={!file || processing}
          >
            {processing ? 'Processando...' : 'Decupar'}
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
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="mt-2 border-t border-line pt-6">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="label-field">Duracao original</div>
                <div className="mono text-sm">{formatTime(result.originalDur)}</div>
              </div>
              <div>
                <div className="label-field">Apos decupagem</div>
                <div className="mono text-sm text-lime">
                  {formatTime(result.newDur)}
                </div>
              </div>
              <div>
                <div className="label-field">Reducao</div>
                <div className="mono text-sm text-lime">{reducedPct}%</div>
              </div>
            </div>
            <AudioPlayer src={result.url} label="Preview" />
            <div className="mt-3 flex justify-end">
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar WAV
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
