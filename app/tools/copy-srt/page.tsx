'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { CancelButton } from '@/components/CancelButton';
import { CostHint } from '@/components/CostHint';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { estimateDecupagemCopy } from '@/lib/cost-estimator';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  extractAudioForTranscription,
  isCancellationError,
  probeVideoMetadata,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { formatBytes, formatTime } from '@/lib/utils';

/**
 * Copy → SRT — gera legendas SRT pulando a revisao manual.
 *
 * Voce ja tem o texto da copy. AssemblyAI da timestamps por palavra.
 * O servidor combina os dois e devolve um SRT pronto, com texto exato
 * da copy + tempos do audio real. Importa direto no CapCut/Premiere.
 */

const MAX_FILE_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 60 * 60;

export default function CopySrtPage() {
  const [file, setFile] = useToolState<File | null>('copysrt:file', null);
  const [copyText, setCopyText] = useToolState<string>('copysrt:copy', '');
  const [processing, setProcessing] = useToolState<boolean>(
    'copysrt:processing',
    false,
  );
  const [stage, setStage] = useToolState<string | null>('copysrt:stage', null);
  const [progress, setProgress] = useToolState<number | null>(
    'copysrt:progress',
    null,
  );
  const [srt, setSrt] = useToolState<string | null>('copysrt:srt', null);
  const [duration, setDuration] = useToolState<number | null>(
    'copysrt:duration',
    null,
  );
  const [error, setError] = useToolState<string | null>('copysrt:error', null);
  const abortRef = useRef<AbortController | null>(null);

  function handleCancel() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

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

  const validation = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      return `Arquivo de ${formatBytes(file.size)} excede o limite de 800MB.`;
    }
    if (duration !== null && duration > MAX_DURATION_SEC) {
      return `Audio de ${Math.round(duration / 60)}min excede o limite de 60min.`;
    }
    return null;
  }, [file, duration]);

  function reset() {
    setSrt(null);
    setStage(null);
    setProgress(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    if (validation) {
      setError(validation);
      return;
    }
    if (!copyText.trim()) {
      setError('Cole o texto da copy.');
      return;
    }
    reset();
    setProcessing(true);
    try {
      setStage('Extraindo audio...');
      setProgress(0.1);
      const audio = await extractAudioForTranscription(file, {
        onStage: (s) => setStage(s),
        onProgress: (p: FFProgress) => setProgress(p.ratio * 0.3),
      });

      if (audio.size > 4_400_000) {
        throw new Error(
          `Audio extraido tem ${formatBytes(audio.size)} — excede o limite (~4.4MB) do servidor. Use audio mais curto.`,
        );
      }

      setStage('Transcrevendo (Groq Whisper, fallback AAI) + alinhando copy...');
      setProgress(0.4);

      const fd = new FormData();
      fd.append('audio', audio, 'audio.opus');
      fd.append('copy', copyText);
      fd.append('provider', 'groq');

      abortRef.current = new AbortController();
      const res = await fetch('/api/mind-ads/transcribe-srt', {
        method: 'POST',
        body: fd,
        signal: abortRef.current.signal,
      });

      const text = await res.text();
      let json: { srt?: string; provider?: string; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          /Request Entity Too Large/i.test(text)
            ? 'Audio acima do limite do servidor.'
            : `Resposta nao-JSON (HTTP ${res.status})`,
        );
      }
      if (!res.ok || !json.srt) {
        throw new Error(json.error || 'Falha na geracao do SRT.');
      }

      setSrt(json.srt);
      setStage(null);
      setProgress(null);
    } catch (e) {
      console.error(e);
      if (isCancellationError(e) || (e as Error)?.name === 'AbortError') {
        setStage('Cancelado pelo usuario.');
        setError(null);
      } else {
        setError((e as Error)?.message ?? 'Falha.');
        setStage(null);
      }
      setProgress(null);
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  async function download() {
    if (!srt || !file) return;
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/\s+/g, '_');
    const blob = new Blob([srt], { type: 'application/x-subrip' });
    await downloadBlob(blob, baseName + '.srt');
  }

  return (
    <ToolShell
      title="SRT Generator"
      eyebrow="TEXTO COM IA"
      description="Gera legendas prontas no tempo do seu áudio pra importar no editor. Texto exato da copy."
    >
      <div className="flex flex-col gap-6">
        <MissingKeyBanner services={['groq']} />

        <div>
          <label className="label-field">Audio ou video</label>
          <FileUpload
            accept="audio/*,video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4, MOV, WEBM — ate 800MB e 60min"
          />
          {file ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span>
                {file.name} —{' '}
                <span
                  className={
                    'mono ' +
                    (file.size > MAX_FILE_BYTES ? 'text-red-300' : 'text-lime')
                  }
                >
                  {formatBytes(file.size)}
                </span>
              </span>
              {duration !== null ? (
                <span>
                  · <span className="mono text-lime">{formatTime(duration)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
          {validation ? (
            <div className="mt-2 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {validation}
            </div>
          ) : null}
        </div>

        <div>
          <label className="label-field" htmlFor="copy">
            Texto da copy (sera o conteudo do SRT)
          </label>
          <textarea
            id="copy"
            value={copyText}
            onChange={(e) => setCopyText(e.target.value)}
            placeholder="Cole aqui o texto da copy. O SRT vai sair com este texto exato + os tempos extraidos do audio."
            rows={10}
            className="input-field resize-y font-mono text-sm"
            disabled={processing}
          />
          <div className="mt-1 text-xs text-text-muted">
            <span className="mono text-lime">{copyText.trim().length}</span>{' '}
            caracteres
          </div>
        </div>

        {file && duration !== null && duration > 0 ? (
          <CostHint estimate={estimateDecupagemCopy(duration)} />
        ) : null}

        <div className="flex flex-wrap gap-3">
          {processing ? (
            <CancelButton onClick={handleCancel} label="Cancelar" />
          ) : (
            <button
              onClick={process}
              className="btn-primary"
              disabled={!file || !!validation || !copyText.trim()}
            >
              Gerar SRT
            </button>
          )}
          <button
            onClick={() => {
              reset();
              setFile(null);
              setCopyText('');
            }}
            className="btn-secondary"
            disabled={processing}
          >
            Limpar
          </button>
        </div>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {stage ? (
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
              <span className="mono uppercase tracking-widest">{stage}</span>
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

        {srt ? (
          <div className="fade-in-up mt-2 border-t border-line pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
                </span>
                SRT pronto
              </h3>
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar .SRT
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-lime/30 bg-black/40 p-3 text-xs leading-relaxed text-white">
              {srt}
            </pre>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
