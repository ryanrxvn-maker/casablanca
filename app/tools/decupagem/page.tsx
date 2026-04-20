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
  detectSilences,
} from '@/lib/audio-engine';
import { cutVideoSegments, extractAudioAs } from '@/lib/ffmpeg-worker';
import { formatTime } from '@/lib/utils';

type OutputKind = 'video' | 'audio';
type AudioFmt = 'wav' | 'mp3';

type Result =
  | {
      kind: 'video';
      blob: Blob;
      url: string;
      originalDur: number;
      newDur: number;
    }
  | {
      kind: 'audio';
      blob: Blob;
      url: string;
      format: AudioFmt;
      originalDur: number;
      newDur: number;
    };

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
}

function baseName(name?: string | null) {
  if (!name) return 'arquivo';
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

/**
 * A partir das regioes silenciosas, calcula as regioes com fala (complemento),
 * mantendo `keepSilence` segundos nas bordas pra manter o corte natural.
 */
function computeSpeechSegments(
  silences: Array<{ start: number; end: number }>,
  totalDur: number,
  keepSilence: number,
): Array<{ start: number; end: number }> {
  const segs: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const silStart = Math.max(0, s.start + keepSilence);
    const silEnd = Math.min(totalDur, s.end - keepSilence);
    if (silEnd > silStart) {
      if (silStart > cursor) segs.push({ start: cursor, end: silStart });
      cursor = silEnd;
    }
  }
  if (cursor < totalDur) segs.push({ start: cursor, end: totalDur });
  return segs.filter((s) => s.end - s.start > 0.05);
}

export default function DecupagemPage() {
  const [file, setFile] = useState<File | null>(null);
  const [keepSilence, setKeepSilence] = useState(0.05);
  const [outputKind, setOutputKind] = useState<OutputKind>('video');
  const [audioFormat, setAudioFormat] = useState<AudioFmt>('mp3');
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const fileIsVideo = file ? isVideoFile(file) : false;
  const effectiveKind: OutputKind = fileIsVideo ? outputKind : 'audio';

  function reset() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStatus(null);
    setError(null);
    setProgress(null);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      if (effectiveKind === 'audio') {
        await processAudio();
      } else {
        await processVideo();
      }
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? 'Falha ao processar o arquivo.');
      setStatus(null);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  }

  async function processAudio() {
    if (!file) return;
    setStatus('Decodificando audio...');
    const decoded = await decodeAudioRobust(file, (s) => setStatus(s));
    setStatus('Removendo silencios...');
    const trimmed = trimSilences(decoded, keepSilence);

    let blob: Blob;
    if (audioFormat === 'wav') {
      setStatus('Codificando WAV...');
      blob = encodeWAV(trimmed);
    } else {
      setStatus('Codificando MP3 (FFmpeg)...');
      const wav = encodeWAV(trimmed);
      blob = await extractAudioAs(wav, 'mp3', {
        onStage: (s) => setStatus(s),
        onProgress: ({ ratio }) => setProgress(ratio),
      });
    }

    setResult({
      kind: 'audio',
      blob,
      url: URL.createObjectURL(blob),
      format: audioFormat,
      originalDur: decoded.duration,
      newDur: trimmed.duration,
    });
    setStatus(null);
  }

  async function processVideo() {
    if (!file) return;
    setStatus('Analisando audio do video...');
    const decoded = await decodeAudioRobust(file, (s) => setStatus(s));
    const silences = detectSilences(decoded);
    const segments = computeSpeechSegments(
      silences,
      decoded.duration,
      keepSilence,
    );

    if (segments.length === 0) {
      throw new Error(
        'Nao foi possivel detectar fala no video. Tente diminuir a tolerancia de silencio.',
      );
    }

    const newDur = segments.reduce((a, s) => a + (s.end - s.start), 0);

    setStatus(
      `Cortando ${segments.length} trechos de fala (FFmpeg)...`,
    );
    const blob = await cutVideoSegments(file, segments, {
      onStage: (s) => setStatus(s),
      onProgress: ({ ratio }) => setProgress(ratio),
    });

    setResult({
      kind: 'video',
      blob,
      url: URL.createObjectURL(blob),
      originalDur: decoded.duration,
      newDur,
    });
    setStatus(null);
  }

  async function download() {
    if (!result || !file) return;
    const base = baseName(file.name);
    if (result.kind === 'video') {
      await downloadBlob(result.blob, base + '_decupado.mp4');
    } else {
      await downloadBlob(result.blob, base + '_decupado.' + result.format);
    }
  }

  const reducedPct =
    result && result.originalDur > 0
      ? Math.max(0, Math.round((1 - result.newDur / result.originalDur) * 100))
      : 0;

  return (
    <ToolShell
      title="Decupagem"
      description="Remove automaticamente os silencios. Envie audio para receber audio; envie video para receber video (com imagem sincronizada) ou so o audio decupado."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivo</label>
          <FileUpload
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4, WEBM ou MOV"
          />
        </div>

        {fileIsVideo ? (
          <div>
            <label className="label-field">Saida</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOutputKind('video')}
                className={
                  'flex-1 rounded-[12px] border px-4 py-3 text-sm transition ' +
                  (outputKind === 'video'
                    ? 'border-lime bg-lime/10 text-lime'
                    : 'border-line bg-bg text-text-muted hover:border-lime/50')
                }
              >
                Video (MP4)
              </button>
              <button
                type="button"
                onClick={() => setOutputKind('audio')}
                className={
                  'flex-1 rounded-[12px] border px-4 py-3 text-sm transition ' +
                  (outputKind === 'audio'
                    ? 'border-lime bg-lime/10 text-lime'
                    : 'border-line bg-bg text-text-muted hover:border-lime/50')
                }
              >
                Apenas audio
              </button>
            </div>
          </div>
        ) : null}

        {effectiveKind === 'audio' ? (
          <div>
            <label className="label-field">Formato do audio</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAudioFormat('mp3')}
                className={
                  'flex-1 rounded-[12px] border px-4 py-3 text-sm transition ' +
                  (audioFormat === 'mp3'
                    ? 'border-lime bg-lime/10 text-lime'
                    : 'border-line bg-bg text-text-muted hover:border-lime/50')
                }
              >
                MP3 (menor)
              </button>
              <button
                type="button"
                onClick={() => setAudioFormat('wav')}
                className={
                  'flex-1 rounded-[12px] border px-4 py-3 text-sm transition ' +
                  (audioFormat === 'wav'
                    ? 'border-lime bg-lime/10 text-lime'
                    : 'border-line bg-bg text-text-muted hover:border-lime/50')
                }
              >
                WAV (maxima qualidade)
              </button>
            </div>
          </div>
        ) : null}

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
            {result.kind === 'video' ? (
              <video
                src={result.url}
                controls
                className="w-full rounded-[12px] border border-line bg-bg"
              />
            ) : (
              <AudioPlayer src={result.url} label="Preview" />
            )}
            <div className="mt-3 flex justify-end">
              <button onClick={download} className="btn-primary !py-2 text-xs">
                {result.kind === 'video'
                  ? 'Baixar MP4'
                  : 'Baixar ' + result.format.toUpperCase()}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
