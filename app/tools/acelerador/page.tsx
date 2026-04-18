'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { VideoPlayer } from '@/components/VideoPlayer';
import { downloadBlob } from '@/lib/audio-engine';
import {
  speedUpAudio,
  speedUpVideo,
  type FFProgress,
} from '@/lib/ffmpeg-worker';

type AudioFormat = 'wav' | 'mp3';

export default function AceleradorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [speed, setSpeed] = useState(1.5);
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('wav');
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    blob: Blob;
    url: string;
    isVideo: boolean;
  } | null>(null);

  const isVideo = file?.type.startsWith('video/') ?? false;

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
        setStatus('Processando... ' + Math.round(p.ratio * 100) + '%');
      };

      let blob: Blob;
      if (isVideo) {
        blob = await speedUpVideo(file, speed, { onProgress });
      } else {
        blob = await speedUpAudio(file, speed, audioFormat, { onProgress });
      }

      const url = URL.createObjectURL(blob);
      setResult({ blob, url, isVideo });
      setStatus(null);
      setProgress(100);
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
    const ext = result.isVideo ? 'mp4' : audioFormat;
    await downloadBlob(result.blob, base + '_' + speed.toFixed(1) + 'x.' + ext);
  }

  return (
    <ToolShell
      title="Acelerador"
      description="Acelera o audio ou video sem alterar o tom da voz (atempo + setpts)."
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
            hint="Audio (MP3, WAV) ou video (MP4, WEBM)"
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
          />
        </div>

        {!isVideo && file ? (
          <div>
            <label className="label-field">Formato de saida</label>
            <div className="flex flex-wrap gap-2">
              {(['wav', 'mp3'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setAudioFormat(f)}
                  className={
                    audioFormat === f
                      ? 'rounded-[12px] bg-lime px-4 py-2 text-sm font-semibold text-black'
                      : 'rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-lime hover:text-white'
                  }
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={process}
            className="btn-primary"
            disabled={!file || processing}
          >
            {processing ? 'Processando...' : 'Acelerar'}
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
            <div className="mb-3 text-xs uppercase tracking-widest text-text-muted">
              Resultado ({speed.toFixed(1)}x)
            </div>
            {result.isVideo ? (
              <VideoPlayer src={result.url} />
            ) : (
              <AudioPlayer src={result.url} label="Preview" />
            )}
            <div className="mt-3 flex justify-end">
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
