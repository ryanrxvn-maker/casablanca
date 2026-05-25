'use client';

import { useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';

/**
 * LipSyncTool — UI admin-only pra rodar fal-ai/latentsync.
 *
 * Fluxo:
 *  1. user seleciona video (rosto) + audio (fala)
 *  2. upload dos dois pra storage do Fal (via /api/fal/proxy)
 *  3. POST /api/tools/lipsync com as 2 URLs
 *  4. recebe URL do video gerado e exibe + download
 *
 * Sem dependencia em libs novas — apenas tema dark + ToolShell.
 */

type Status = 'idle' | 'uploading' | 'generating' | 'done' | 'error';

export default function LipSyncTool() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>('');
  const [audioPreview, setAudioPreview] = useState<string>('');
  const [outputUrl, setOutputUrl] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [progress, setProgress] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLoading = status === 'uploading' || status === 'generating';

  function startTicker() {
    setElapsedSec(0);
    if (tickRef.current) clearInterval(tickRef.current);
    const start = Date.now();
    tickRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  function stopTicker() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function uploadToFal(file: File): Promise<string> {
    const { fal } = await import('@fal-ai/client');
    fal.config({ proxyUrl: '/api/fal/proxy' });
    const url = await fal.storage.upload(file);
    return url;
  }

  async function handleGenerate() {
    if (!videoFile || !audioFile) {
      setErrorMsg('Selecione o video e o audio antes de gerar.');
      setStatus('error');
      return;
    }

    setStatus('uploading');
    setErrorMsg('');
    setOutputUrl('');
    startTicker();

    try {
      setProgress('Enviando video pro Fal storage...');
      const video_url = await uploadToFal(videoFile);

      setProgress('Enviando audio pro Fal storage...');
      const audio_url = await uploadToFal(audioFile);

      setStatus('generating');
      setProgress('Gerando lipsync (LatentSync) — costuma levar 60-180s...');

      const res = await fetch('/api/tools/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url, audio_url }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setOutputUrl(data.output_video_url);
      setStatus('done');
      setProgress('');
      stopTicker();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setErrorMsg(msg || 'Algo deu errado. Tenta de novo.');
      setProgress('');
      stopTicker();
    }
  }

  function handleVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoPreview(URL.createObjectURL(file));
    setOutputUrl('');
    setStatus('idle');
    setErrorMsg('');
  }

  function handleAudioChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setAudioPreview(URL.createObjectURL(file));
    setStatus('idle');
    setErrorMsg('');
  }

  function handleReset() {
    setVideoFile(null);
    setAudioFile(null);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setVideoPreview('');
    setAudioPreview('');
    setOutputUrl('');
    setStatus('idle');
    setErrorMsg('');
    setProgress('');
    stopTicker();
    setElapsedSec(0);
    if (videoRef.current) videoRef.current.value = '';
    if (audioRef.current) audioRef.current.value = '';
  }

  return (
    <ToolShell
      title="LipSync (Beta · Admin)"
      eyebrow="LAB INTERNO"
      description="Sincroniza o movimento labial de um video com um audio. Powered by LatentSync via Fal.ai."
      hue="rgba(236,72,153,0.42)"
    >
      <div className="space-y-5">
        {/* Aviso admin */}
        <div className="rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3">
          <div className="mono text-[10px] uppercase tracking-widest text-fuchsia-200">
            🔒 ADMIN ONLY · Teste interno
          </div>
          <div className="mt-1 text-[12px] text-fuchsia-100/80">
            Custo Fal.ai por geracao: ~$0.05-0.15. Tempo medio: 60-180s. Use videos curtos
            (2-15s) com rosto bem visivel pro melhor resultado.
          </div>
        </div>

        {/* Inputs */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Video */}
          <div className="rounded-[14px] border border-line-strong bg-bg-soft/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono inline-flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-bg/60 text-[10px] text-text-muted">
                1
              </span>
              <span className="text-[13px] font-semibold text-white">Video fonte (rosto)</span>
            </div>
            <p className="text-[11px] text-text-muted">MP4 ou MOV · 2-30s · ate ~50MB</p>
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              onChange={handleVideoChange}
              disabled={isLoading}
              className="block w-full text-[12px] text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-bg/60 file:px-3 file:py-1.5 file:text-[11px] file:font-medium file:text-white file:cursor-pointer hover:file:bg-bg/80 disabled:opacity-50"
            />
            {videoPreview ? (
              <video
                src={videoPreview}
                controls
                muted
                className="mt-2 max-h-40 w-full rounded-lg bg-black object-contain"
              />
            ) : null}
            {videoFile ? (
              <p className="mono text-[10px] text-lime">✓ {videoFile.name} · {(videoFile.size / 1024 / 1024).toFixed(1)}MB</p>
            ) : null}
          </div>

          {/* Audio */}
          <div className="rounded-[14px] border border-line-strong bg-bg-soft/30 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono inline-flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-bg/60 text-[10px] text-text-muted">
                2
              </span>
              <span className="text-[13px] font-semibold text-white">Audio (o que a boca fala)</span>
            </div>
            <p className="text-[11px] text-text-muted">MP3, WAV, M4A · ate ~20MB</p>
            <input
              ref={audioRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioChange}
              disabled={isLoading}
              className="block w-full text-[12px] text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-bg/60 file:px-3 file:py-1.5 file:text-[11px] file:font-medium file:text-white file:cursor-pointer hover:file:bg-bg/80 disabled:opacity-50"
            />
            {audioPreview ? (
              <audio src={audioPreview} controls className="mt-2 w-full" />
            ) : null}
            {audioFile ? (
              <p className="mono text-[10px] text-lime">✓ {audioFile.name} · {(audioFile.size / 1024 / 1024).toFixed(1)}MB</p>
            ) : null}
          </div>
        </div>

        {/* Acoes */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!videoFile || !audioFile || isLoading}
            className="mono inline-flex items-center gap-2 rounded-lg border border-lime/60 bg-lime/15 px-5 py-2.5 text-[12px] uppercase tracking-widest text-lime hover:bg-lime/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-lime border-t-transparent" />
                Processando...
              </>
            ) : (
              <>▶ Gerar LipSync</>
            )}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isLoading}
            className="mono rounded-lg border border-line-strong px-4 py-2.5 text-[11px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
          >
            Limpar
          </button>
        </div>

        {/* Progresso */}
        {progress ? (
          <div className="flex items-center gap-3 rounded-[12px] border border-cyan-500/40 bg-cyan-500/10 px-4 py-3">
            <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
            <div className="flex-1 text-[12px] text-cyan-100">{progress}</div>
            <div className="mono text-[11px] text-cyan-300">{elapsedSec}s</div>
          </div>
        ) : null}

        {/* Erro */}
        {status === 'error' && errorMsg ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            ❌ {errorMsg}
          </div>
        ) : null}

        {/* Resultado */}
        {status === 'done' && outputUrl ? (
          <div className="space-y-3 rounded-[14px] border border-lime/40 bg-lime/5 p-4">
            <div className="flex items-center gap-2">
              <span className="mono rounded-md border border-lime/40 bg-lime/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-lime">
                ✓ Pronto
              </span>
              <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
                Gerado em {elapsedSec}s
              </span>
            </div>
            <video
              src={outputUrl}
              controls
              autoPlay
              className="w-full rounded-lg bg-black max-h-[480px] object-contain"
            />
            <div className="flex flex-wrap gap-2">
              <a
                href={outputUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="mono inline-flex items-center gap-2 rounded-lg border border-lime/60 bg-lime/15 px-4 py-2 text-[11px] uppercase tracking-widest text-lime hover:bg-lime/25"
              >
                ⬇ Baixar video
              </a>
              <button
                type="button"
                onClick={handleReset}
                className="mono rounded-lg border border-line-strong px-4 py-2 text-[11px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
              >
                Gerar outro
              </button>
            </div>
          </div>
        ) : null}

        {/* Notas */}
        <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/20 p-3">
          <div className="mono text-[10px] uppercase tracking-widest text-text-muted">Notas</div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-text-muted leading-relaxed">
            <li>· Modelo: <span className="mono text-white/80">fal-ai/latentsync</span> (ByteDance)</li>
            <li>· Rosto centralizado e bem iluminado da o melhor resultado.</li>
            <li>· Audio mais longo que o video = video sera estendido (loop) automaticamente.</li>
            <li>· A geracao roda no servidor do Fal; se a aba fechar, o credito ja foi consumido.</li>
          </ul>
        </div>
      </div>
    </ToolShell>
  );
}
