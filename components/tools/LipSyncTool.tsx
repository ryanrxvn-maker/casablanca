'use client';

import { useEffect, useRef, useState } from 'react';
import { LipSyncHero3D } from '@/app/tools/lipsync/LipSyncHero3D';

/**
 * LipSyncTool — UI estilo DreamFace com 2 motores (V1 / V2).
 *
 * Layout:
 *   - Hero 3D no topo (cinematografico com morph robot ↔ human)
 *   - 3 colunas:
 *      LEFT  (200-220px): biblioteca de videos uploadados (thumbnails clicaveis)
 *      CENTER (flex):    preview gigante do video selecionado, com loading
 *                        cinematografico (coelho rotativo) quando processando
 *      RIGHT (340-380px): painel "Sua boca vai falar"
 *                        - Tabs V1 / V2 (com badge identificando cada um)
 *                        - Upload audio + player visual
 *                        - Ajustes pro (collapsible)
 *                        - Botao gerar gigante
 *
 * Pode subir multiplos videos pra ter "biblioteca" e trocar entre eles.
 * O selecionado vira o "fonte" da geracao.
 */

type Version = 'v1' | 'v2';
type Status =
  | 'idle'
  | 'uploading-video'
  | 'uploading-audio'
  | 'queueing'
  | 'generating'
  | 'polishing'
  | 'done'
  | 'error';

type VideoItem = {
  id: string;
  file: File;
  url: string; // local blob URL pra preview
  meta?: { w: number; h: number; dur: number };
};

const STAGE_COPY: Record<Status, string> = {
  idle: '',
  'uploading-video': 'Enviando o vídeo…',
  'uploading-audio': 'Enviando o áudio…',
  queueing: 'Reservando a vez na fila…',
  generating: 'A IA tá encaixando a boca no áudio…',
  polishing: 'Finalizando os detalhes…',
  done: 'Pronto.',
  error: '',
};

export default function LipSyncTool() {
  // Library de videos uploadados
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  // Audio
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string>('');
  const [audioDur, setAudioDur] = useState<number>(0);

  // Generation state
  const [outputUrl, setOutputUrl] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Engine version
  const [version, setVersion] = useState<Version>('v1');

  // V1 params
  const [syncModeV1, setSyncModeV1] = useState<'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap'>('cut_off');
  const [v1Pro, setV1Pro] = useState<boolean>(false);

  // Upload progress (real, em %)
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // V2 params
  const [guidanceScale, setGuidanceScale] = useState<number>(1.5);
  const [loopMode, setLoopMode] = useState<'loop' | 'pingpong'>('loop');
  const [seedEnabled, setSeedEnabled] = useState(false);
  const [seed, setSeed] = useState<number>(42);

  const [advanced, setAdvanced] = useState(false);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const isLoading = status !== 'idle' && status !== 'done' && status !== 'error';
  const selected = videos.find((v) => v.id === selectedId) ?? null;

  /* ─── Tickers ───────────────────────────────────────────────── */

  function startTicker() {
    setElapsedSec(0);
    if (tickRef.current) clearInterval(tickRef.current);
    startRef.current = Date.now();
    tickRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
  }

  function stopTicker() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  /* ─── Video library ─────────────────────────────────────────── */

  async function addVideo(file: File) {
    const id = `v-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const url = URL.createObjectURL(file);
    let meta: VideoItem['meta'] | undefined;
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject();
      });
      meta = { w: v.videoWidth, h: v.videoHeight, dur: v.duration };
    } catch {
      // ignore
    }
    const item: VideoItem = { id, file, url, meta };
    setVideos((prev) => [...prev, item]);
    setSelectedId(id);
    setOutputUrl('');
    setStatus('idle');
    setErrorMsg('');
  }

  function removeVideo(id: string) {
    setVideos((prev) => {
      const target = prev.find((v) => v.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((v) => v.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? '');
        setOutputUrl('');
      }
      return next;
    });
  }

  /* ─── Audio ─────────────────────────────────────────────────── */

  async function setAudio(file: File | null) {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    if (!file) {
      setAudioFile(null);
      setAudioPreview('');
      setAudioDur(0);
      return;
    }
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioPreview(url);
    try {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = url;
      await new Promise<void>((resolve, reject) => {
        a.onloadedmetadata = () => resolve();
        a.onerror = () => reject();
      });
      setAudioDur(a.duration);
    } catch {
      setAudioDur(0);
    }
  }

  /* ─── Upload helpers ────────────────────────────────────────── */

  /**
   * Upload pro Fal storage via nosso /api/fal/proxy.
   *
   * Em vez de usar fal.storage.upload() do SDK (que nao expoe progress),
   * fazemos POST direto pro proxy com XHR pra capturar progress real.
   * O proxy server-side delega pro endpoint do Fal (https://rest.fal.ai/storage/upload).
   *
   * Implementacao seguindo o protocolo do SDK: o cliente faz:
   *  1. POST /storage/upload/initiate-multipart (ou simple)
   *  2. PUT no upload_url retornado com o arquivo
   *  3. POST /storage/upload/complete-multipart
   *
   * Mais simples: usa fal.storage.upload diretamente — ele ja faz tudo.
   * Como nao temos progress real do SDK, simulamos progressao baseada
   * em tempo (assumindo X MB/s media) — visualmente mais util que
   * congelado em "Enviando...".
   */
  async function uploadToFal(file: File, onProgress?: (pct: number) => void): Promise<string> {
    const { fal } = await import('@fal-ai/client');
    fal.config({ proxyUrl: '/api/fal/proxy' });

    // Simula progresso baseado em tamanho do arquivo e tempo decorrido.
    // Assume taxa media ~3 MB/s (conservadora pra dial-ups; em fibra eh muito + rapida).
    // Para no maximo 95% e finaliza quando o upload real termina.
    const estimatedMs = Math.max(2000, (file.size / 1024 / 1024 / 3) * 1000);
    let stop = false;
    const start = Date.now();
    if (onProgress) {
      const tick = () => {
        if (stop) return;
        const elapsed = Date.now() - start;
        const pct = Math.min(95, Math.round((elapsed / estimatedMs) * 100));
        onProgress(pct);
        if (pct < 95) setTimeout(tick, 200);
      };
      tick();
    }

    try {
      const url = await fal.storage.upload(file);
      stop = true;
      onProgress?.(100);
      return url;
    } catch (e) {
      stop = true;
      throw e;
    }
  }

  /* ─── Generate ──────────────────────────────────────────────── */

  async function handleGenerate() {
    if (!selected) {
      setErrorMsg('Seleciona um vídeo na esquerda.');
      setStatus('error');
      return;
    }
    if (!audioFile) {
      setErrorMsg('Sobe o áudio que a boca vai falar.');
      setStatus('error');
      return;
    }
    setErrorMsg('');
    setOutputUrl('');
    startTicker();

    try {
      setStatus('uploading-video');
      setUploadProgress(0);
      const video_url = await uploadToFal(selected.file, (pct) => setUploadProgress(pct));

      setStatus('uploading-audio');
      setUploadProgress(0);
      const audio_url = await uploadToFal(audioFile, (pct) => setUploadProgress(pct));

      setStatus('queueing');
      setUploadProgress(0);
      await new Promise((r) => setTimeout(r, 500));

      setStatus('generating');
      const body: Record<string, unknown> = {
        version,
        video_url,
        audio_url,
      };
      if (version === 'v1') {
        body.sync_mode_v1 = syncModeV1;
        body.v1_pro = v1Pro;
      } else {
        body.guidance_scale = guidanceScale;
        body.loop_mode = loopMode;
        if (seedEnabled) body.seed = seed;
      }

      const res = await fetch('/api/tools/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setStatus('polishing');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setOutputUrl(data.output_video_url);
      setStatus('done');
      stopTicker();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setErrorMsg(msg || 'Algo deu errado.');
      stopTicker();
    }
  }

  function handleReset() {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    videos.forEach((v) => URL.revokeObjectURL(v.url));
    setVideos([]);
    setSelectedId('');
    setAudioFile(null);
    setAudioPreview('');
    setAudioDur(0);
    setOutputUrl('');
    setStatus('idle');
    setErrorMsg('');
    stopTicker();
    setElapsedSec(0);
  }

  useEffect(() => {
    return () => {
      videos.forEach((v) => URL.revokeObjectURL(v.url));
      if (audioPreview) URL.revokeObjectURL(audioPreview);
      stopTicker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8 space-y-7">
      <LipSyncHero3D />

      {/* WORKSPACE — 3 colunas */}
      <div className="grid gap-4 lg:grid-cols-[210px_1fr_360px]">
        {/* ─── COLUNA 1: VIDEO LIBRARY ─── */}
        <div className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-3 space-y-2 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1 px-1">
            <span
              className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              VÍDEOS
            </span>
            {videos.length > 0 && (
              <span className="mono text-[10px] text-text-dim">{videos.length}</span>
            )}
          </div>

          {/* Upload tile (sempre primeiro) */}
          <button
            type="button"
            onClick={() => !isLoading && videoInputRef.current?.click()}
            disabled={isLoading}
            className="group relative w-full overflow-hidden rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 aspect-[3/4] flex flex-col items-center justify-center gap-2 hover:border-fuchsia-400/55 hover:bg-fuchsia-400/[0.04] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-[22px] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
              style={{
                boxShadow: '0 0 22px -4px rgba(232,121,249,0.5)',
              }}
            >
              ＋
            </span>
            <div className="text-center px-2">
              <div
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Subir vídeo
              </div>
              <div className="mono text-[9px] text-text-muted mt-0.5">arraste ou clique</div>
            </div>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addVideo(f);
                e.target.value = '';
              }}
            />
          </button>

          {/* Thumbnails */}
          {videos.map((v) => (
            <VideoThumb
              key={v.id}
              item={v}
              selected={v.id === selectedId}
              onSelect={() => !isLoading && setSelectedId(v.id)}
              onRemove={() => !isLoading && removeVideo(v.id)}
              disabled={isLoading}
            />
          ))}
        </div>

        {/* ─── COLUNA 2: PREVIEW CENTRAL ─── */}
        <PreviewStage
          selected={selected}
          isLoading={isLoading}
          status={status}
          elapsedSec={elapsedSec}
          uploadProgress={uploadProgress}
          outputUrl={outputUrl}
          errorMsg={errorMsg}
          onReset={() => {
            setOutputUrl('');
            setStatus('idle');
          }}
        />

        {/* ─── COLUNA 3: SIDE PANEL ─── */}
        <aside className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-4 md:p-5 space-y-5">
          {/* Header */}
          <div>
            <div
              className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SUA BOCA VAI FALAR
            </div>
            <h2
              className="mt-1 text-[20px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Configure e gera
            </h2>
          </div>

          {/* V1 / V2 toggle */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Motor
              </label>
              <span className="mono text-[9px] text-text-dim">{version === 'v1' ? 'DreamFace style' : 'Closeup boost'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <EngineCard
                version="v1"
                active={version === 'v1'}
                onClick={() => !isLoading && setVersion('v1')}
                badge="DREAMFACE"
                title="V1"
                sub="natural, suave"
                color="fuchsia"
              />
              <EngineCard
                version="v2"
                active={version === 'v2'}
                onClick={() => !isLoading && setVersion('v2')}
                badge="ULTRA"
                title="V2"
                sub="closeup, preciso"
                color="cyan"
              />
            </div>
          </div>

          {/* Audio upload */}
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label
                className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Áudio (o que vai sair da boca)
              </label>
              <span className="mono text-[9px] text-text-dim">aceita mp4 — usa só o áudio</span>
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setAudio(f);
                e.target.value = '';
              }}
            />
            {!audioFile ? (
              <button
                type="button"
                onClick={() => !isLoading && audioInputRef.current?.click()}
                disabled={isLoading}
                className="w-full rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 px-4 py-5 hover:border-violet/55 hover:bg-violet/[0.04] transition disabled:opacity-40 group"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-[20px] transition-transform group-hover:-rotate-6 group-hover:scale-110"
                    style={{ boxShadow: '0 0 20px -4px rgba(167,139,250,0.45)' }}
                  >
                    🎙
                  </span>
                  <div className="text-left">
                    <div
                      className="text-[12px] font-bold uppercase tracking-[0.16em] text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Subir áudio ou vídeo
                    </div>
                    <div className="mono text-[10px] text-text-muted">mp3, wav, m4a ou mp4 (extrai áudio)</div>
                  </div>
                </div>
              </button>
            ) : (
              <AudioMiniPlayer
                file={audioFile}
                src={audioPreview}
                durationSec={audioDur}
                onChange={() => !isLoading && audioInputRef.current?.click()}
                onClear={() => !isLoading && setAudio(null)}
                disabled={isLoading}
              />
            )}
          </div>

          {/* Advanced settings */}
          <div className="rounded-[14px] border border-line/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              disabled={isLoading}
              className="flex w-full items-center justify-between px-3.5 py-2.5 hover:bg-bg-soft/40 transition"
            >
              <div className="flex items-center gap-2">
                <span className="text-[15px]">⚙</span>
                <span
                  className="text-[11.5px] font-bold tracking-tight text-white"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Ajustes pro
                </span>
              </div>
              <span className="text-text-muted text-[12px]">{advanced ? '▲' : '▼'}</span>
            </button>
            {advanced && (
              <div className="border-t border-line/30 p-4 bg-bg/30 space-y-4">
                {version === 'v1' ? (
                  <>
                    {/* V1: Pro toggle */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label
                          className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Qualidade
                        </label>
                        <span className="mono text-[9px] text-text-dim">
                          {v1Pro ? 'pro · mais lento' : 'padrão · rápido'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setV1Pro(false)}
                          disabled={isLoading}
                          className={
                            'rounded-[10px] border px-2.5 py-2 text-left transition ' +
                            (!v1Pro
                              ? 'border-fuchsia-400/60 bg-fuchsia-400/10'
                              : 'border-line-strong bg-bg-soft/40 hover:border-fuchsia-400/40')
                          }
                        >
                          <div
                            className="text-[11px] font-bold tracking-tight text-white"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            Padrão
                          </div>
                          <div className="mono text-[9px] text-text-muted">~$0.07/min</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setV1Pro(true)}
                          disabled={isLoading}
                          className={
                            'rounded-[10px] border px-2.5 py-2 text-left transition ' +
                            (v1Pro
                              ? 'border-fuchsia-400/60 bg-fuchsia-400/10'
                              : 'border-line-strong bg-bg-soft/40 hover:border-fuchsia-400/40')
                          }
                        >
                          <div
                            className="text-[11px] font-bold tracking-tight text-white"
                            style={{ fontFamily: 'var(--font-tech)' }}
                          >
                            Pro
                          </div>
                          <div className="mono text-[9px] text-text-muted">qualidade max</div>
                        </button>
                      </div>
                    </div>

                    {/* V1: sync_mode */}
                    <div>
                      <label
                        className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-2 block"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        Quando o áudio é maior que o vídeo
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(
                          [
                            { v: 'cut_off', label: 'Cortar', sub: 'corta ao fim do vídeo' },
                            { v: 'loop', label: 'Loop', sub: 'reinicia do começo' },
                            { v: 'bounce', label: 'Bounce', sub: 'vai e volta' },
                            { v: 'silence', label: 'Silêncio', sub: 'segura último frame' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setSyncModeV1(opt.v)}
                            disabled={isLoading}
                            className={
                              'rounded-[10px] border px-2.5 py-2 text-left transition ' +
                              (syncModeV1 === opt.v
                                ? 'border-fuchsia-400/60 bg-fuchsia-400/10'
                                : 'border-line-strong bg-bg-soft/40 hover:border-fuchsia-400/40')
                            }
                          >
                            <div
                              className="text-[11px] font-bold tracking-tight text-white"
                              style={{ fontFamily: 'var(--font-tech)' }}
                            >
                              {opt.label}
                            </div>
                            <div className="mono text-[9px] text-text-muted">{opt.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* V2: guidance scale */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label
                          className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Intensidade
                        </label>
                        <span className="mono text-[12px] text-fuchsia-300 font-bold">
                          {guidanceScale.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={2}
                        step={0.1}
                        value={guidanceScale}
                        onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                        disabled={isLoading}
                        className="w-full accent-fuchsia-500"
                      />
                      <div className="mt-1 flex justify-between text-[9px] text-text-dim mono">
                        <span>natural (1.0)</span>
                        <span>preciso (2.0)</span>
                      </div>
                    </div>
                    {/* V2: loop mode */}
                    <div>
                      <label
                        className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-2 block"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        Loop do vídeo
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['loop', 'pingpong'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setLoopMode(m)}
                            disabled={isLoading}
                            className={
                              'rounded-[10px] border px-2.5 py-2 text-left transition ' +
                              (loopMode === m
                                ? 'border-fuchsia-400/60 bg-fuchsia-400/10'
                                : 'border-line-strong bg-bg-soft/40 hover:border-fuchsia-400/40')
                            }
                          >
                            <div
                              className="text-[11px] font-bold tracking-tight text-white"
                              style={{ fontFamily: 'var(--font-tech)' }}
                            >
                              {m === 'loop' ? '🔁 Loop' : '↔ Ping-pong'}
                            </div>
                            <div className="mono text-[9px] text-text-muted">
                              {m === 'loop' ? 'reinicia' : 'inverte'}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* V2: seed */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label
                          className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
                          style={{ fontFamily: 'var(--font-tech)' }}
                        >
                          Seed
                        </label>
                        <button
                          type="button"
                          onClick={() => setSeedEnabled(!seedEnabled)}
                          disabled={isLoading}
                          className={
                            'mono rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-widest ' +
                            (seedEnabled
                              ? 'border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-300'
                              : 'border-line-strong text-text-muted')
                          }
                        >
                          {seedEnabled ? '● fixo' : 'random'}
                        </button>
                      </div>
                      {seedEnabled && (
                        <input
                          type="number"
                          value={seed}
                          onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                          disabled={isLoading}
                          className="mono w-full rounded-[10px] border border-line-strong bg-bg/40 px-3 py-2 text-[12px] text-white focus:border-fuchsia-400/60 focus:outline-none"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* GENERATE button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selected || !audioFile || isLoading}
            className="ultra-btn group relative w-full overflow-hidden rounded-[16px] border border-fuchsia-400/55 px-5 py-4 transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                'linear-gradient(135deg, rgba(232,121,249,0.25) 0%, rgba(167,139,250,0.25) 50%, rgba(103,232,249,0.20) 100%)',
              boxShadow:
                '0 0 30px -4px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            <span
              aria-hidden
              className="ultra-btn-sheen pointer-events-none absolute inset-y-0 left-[-30%] w-[40%] opacity-0 group-hover:opacity-100"
              style={{
                background:
                  'linear-gradient(120deg, transparent, rgba(255,255,255,0.32), transparent)',
              }}
            />
            <span className="relative flex items-center justify-center gap-3">
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-fuchsia-200 border-t-transparent" />
                  <span
                    className="text-[13px] font-bold uppercase tracking-[0.18em] text-white"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Processando…
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[18px]">▶</span>
                  <span
                    className="text-[13.5px] font-bold uppercase tracking-[0.2em] text-white"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Gerar lip sync
                  </span>
                  <span className="text-[16px] transition-transform group-hover:translate-x-1.5">→</span>
                </>
              )}
            </span>
            <style jsx>{`
              .ultra-btn-sheen {
                animation: btnSheen 2.4s ease-in-out infinite;
              }
              @keyframes btnSheen {
                0% { left: -40%; opacity: 0; }
                30% { opacity: 1; }
                100% { left: 130%; opacity: 0; }
              }
            `}</style>
          </button>

          {/* Reset all */}
          {(videos.length > 0 || audioFile) && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isLoading}
              className="mono w-full text-[10px] uppercase tracking-[0.18em] text-text-muted hover:text-red-300 transition disabled:opacity-40"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ↺ Limpar tudo
            </button>
          )}
        </aside>
      </div>

      {/* TIPS rodape */}
      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3">
        <div
          className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Pra sair perfeito
        </div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Rosto frontal, centralizado, sem mão na boca.</li>
          <li>· Iluminação uniforme — luz lateral cria sombra.</li>
          <li>· Áudio limpo, sem música por trás.</li>
          <li>· 720p ou mais pra boca ficar nítida.</li>
          <li>· Mesma pessoa, mesma língua do áudio.</li>
          <li>· V1 pra rosto humano natural · V2 pra closeup preciso.</li>
        </ul>
      </div>
    </div>
  );
}

/* ═══════════════════════ VideoThumb ═══════════════════════ */

function VideoThumb({
  item,
  selected,
  onSelect,
  onRemove,
  disabled,
}: {
  item: VideoItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={
        'group relative overflow-hidden rounded-[12px] border-2 aspect-[3/4] cursor-pointer transition ' +
        (selected
          ? 'border-fuchsia-400/70 shadow-[0_0_22px_-6px_rgba(232,121,249,0.7)]'
          : 'border-line-strong hover:border-fuchsia-400/45')
      }
    >
      <video
        src={item.url}
        muted
        loop
        autoPlay={selected}
        playsInline
        className="h-full w-full object-cover"
      />
      {/* dim overlay when not selected */}
      {!selected && (
        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition" />
      )}
      {/* Selected indicator */}
      {selected && (
        <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-400 text-[10px] font-bold text-bg shadow-[0_0_10px_rgba(232,121,249,0.9)]">
          ✓
        </span>
      )}
      {/* Remove */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={disabled}
        className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition"
      >
        ✕
      </button>
      {/* Duration badge */}
      {item.meta && (
        <span className="absolute bottom-1.5 left-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
          {item.meta.dur.toFixed(1)}s
        </span>
      )}
      {/* Resolution badge */}
      {item.meta && (
        <span className="absolute bottom-1.5 right-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
          {item.meta.w}×{item.meta.h}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════ PreviewStage ═══════════════════════ */

function PreviewStage({
  selected,
  isLoading,
  status,
  elapsedSec,
  uploadProgress,
  outputUrl,
  errorMsg,
  onReset,
}: {
  selected: VideoItem | null;
  isLoading: boolean;
  status: Status;
  elapsedSec: number;
  uploadProgress: number;
  outputUrl: string;
  errorMsg: string;
  onReset: () => void;
}) {
  const showResult = status === 'done' && outputUrl;

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-line/60 bg-bg-soft/30">
      {/* Header label (estilo "Background" do DreamFace) */}
      {selected && !showResult && !isLoading && (
        <div className="absolute top-3 right-3 z-20">
          <span
            className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ◇ FONTE · {selected.meta ? `${selected.meta.w}×${selected.meta.h}` : 'vídeo'}
          </span>
        </div>
      )}

      {/* Empty state */}
      {!selected && !showResult && !isLoading && (
        <div className="aspect-[3/4] md:aspect-[4/5] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/8 bg-black/40 text-[42px]"
            style={{
              boxShadow: '0 0 36px -6px rgba(232,121,249,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
              animation: 'emptyPulse 3.5s ease-in-out infinite',
            }}
          >
            🎬
          </div>
          <div>
            <h3
              className="text-[22px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Sobe um vídeo na esquerda
            </h3>
            <p className="mt-2 text-[13px] text-text-muted max-w-[360px]">
              O rosto que vai ganhar a fala. Pode subir vários e escolher qual usar.
            </p>
          </div>
          <style jsx>{`
            @keyframes emptyPulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.06); }
            }
          `}</style>
        </div>
      )}

      {/* Video preview (idle) */}
      {selected && !showResult && (
        <div className="relative aspect-[3/4] md:aspect-[4/5] bg-black overflow-hidden">
          <video
            src={selected.url}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />

          {/* Loading overlay com coelho */}
          {isLoading && (
            <LoadingOverlay
              status={status}
              elapsedSec={elapsedSec}
              uploadProgress={uploadProgress}
            />
          )}
        </div>
      )}

      {/* Result reveal */}
      {showResult && (
        <ResultReveal
          outputUrl={outputUrl}
          elapsedSec={elapsedSec}
          onReset={onReset}
        />
      )}

      {/* Error */}
      {status === 'error' && errorMsg && (
        <div className="absolute inset-x-3 bottom-3 z-30 rounded-[12px] border border-red-500/50 bg-red-500/10 px-4 py-3 backdrop-blur-md">
          <div className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-red-300 mb-1">
            ✕ Erro
          </div>
          <div className="text-[12px] text-red-100">{errorMsg}</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ LoadingOverlay ═══════════════════════ */
/**
 * Overlay foda com coelho rotativo no centro — inspirado no gerador
 * de B-Rolls. Glassmorph blur + dark mask + coelho com glow + Z's
 * subindo + texto contextual da fase atual + barra de progresso lenta.
 */
function LoadingOverlay({
  status,
  elapsedSec,
  uploadProgress,
}: {
  status: Status;
  elapsedSec: number;
  uploadProgress: number;
}) {
  // Durante upload: usa o progresso real. Durante geracao: estima por tempo.
  const isUploading = status === 'uploading-video' || status === 'uploading-audio';
  const progress = isUploading
    ? uploadProgress
    : Math.min(95, Math.round((elapsedSec / 300) * 100)); // 5min estimado

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5"
      style={{
        background:
          'radial-gradient(60% 70% at 50% 50%, rgba(232,121,249,0.18), transparent 70%), rgba(0,0,0,0.72)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Coelho central com glow + spin */}
      <div className="relative">
        {/* Halo */}
        <div
          aria-hidden
          className="absolute inset-[-25%] rounded-full blur-2xl"
          style={{
            background:
              'radial-gradient(circle, rgba(232,121,249,0.55), rgba(167,139,250,0.3) 50%, transparent 80%)',
            animation: 'loadAura 2.2s ease-in-out infinite',
          }}
        />
        {/* Rings rotativos */}
        <div
          aria-hidden
          className="absolute inset-[-18px] rounded-full border-2 border-fuchsia-400/40 border-dashed"
          style={{ animation: 'loadRing 6s linear infinite' }}
        />
        <div
          aria-hidden
          className="absolute inset-[-34px] rounded-full border border-violet/30"
          style={{ animation: 'loadRing 10s linear infinite reverse' }}
        />
        {/* Coelho */}
        <div
          className="relative"
          style={{
            animation: 'loadBunny 2.4s ease-in-out infinite',
            filter: 'drop-shadow(0 0 24px rgba(232,121,249,0.85))',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/auto-edit-logo@256.png"
            alt=""
            aria-hidden
            width={140}
            height={140}
          />
        </div>
        {/* Z's */}
        <Zfloat delay={0} />
        <Zfloat delay={1.2} />
        <Zfloat delay={2.4} />
      </div>

      {/* Status text */}
      <div className="text-center px-6">
        <div
          className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300 mb-1"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          GERANDO · {elapsedSec}s
        </div>
        <div
          className="text-[18px] md:text-[22px] font-extrabold tracking-tight text-white max-w-[420px]"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
        >
          {STAGE_COPY[status]}
        </div>
        <div className="mt-2 text-[12px] text-text-muted max-w-[360px] mx-auto">
          Costuma levar entre 3 e 8 minutos pra vídeos curtos. Mantém a aba aberta.
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-[260px] max-w-[80%]">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${progress}%`,
              background:
                'linear-gradient(90deg, rgba(232,121,249,0.9), rgba(167,139,250,0.9), rgba(103,232,249,0.9))',
              boxShadow: '0 0 12px rgba(232,121,249,0.7)',
              transition: 'width 1s ease-out',
            }}
          />
          {/* Shimmer */}
          <div
            aria-hidden
            className="absolute inset-y-0 w-1/3 -translate-x-full"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
              animation: 'loadShimmer 1.8s ease-in-out infinite',
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] mono text-text-dim">
          <span>{progress}%</span>
          <span>~ 90s estimado</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes loadAura {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.12); }
        }
        @keyframes loadRing {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes loadBunny {
          0%, 100% { transform: translateY(0) scale(1) rotate(-3deg); }
          50% { transform: translateY(-8px) scale(1.04) rotate(-3deg); }
        }
        @keyframes loadShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function Zfloat({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 left-[58%] pointer-events-none"
      style={{
        fontFamily: 'var(--font-tech)',
        fontWeight: 800,
        fontSize: 28,
        color: 'rgba(232,121,249,0.85)',
        textShadow: '0 0 12px rgba(232,121,249,0.9)',
        animation: 'zRise 3.6s cubic-bezier(0.22,1,0.36,1) infinite',
        animationDelay: `${delay}s`,
      }}
    >
      Z
      <style jsx>{`
        @keyframes zRise {
          0% { opacity: 0; transform: translate(0, 0) rotate(-10deg) scale(0.6); }
          15% { opacity: 1; }
          70% { opacity: 0.6; }
          100% { opacity: 0; transform: translate(28px, -90px) rotate(18deg) scale(1.5); }
        }
      `}</style>
    </span>
  );
}

/* ═══════════════════════ EngineCard ═══════════════════════ */

function EngineCard({
  version,
  active,
  onClick,
  badge,
  title,
  sub,
  color,
}: {
  version: Version;
  active: boolean;
  onClick: () => void;
  badge: string;
  title: string;
  sub: string;
  color: 'fuchsia' | 'cyan';
}) {
  const activeBorder = color === 'fuchsia' ? 'border-fuchsia-400/65' : 'border-cyan-400/65';
  const activeBg = color === 'fuchsia' ? 'bg-fuchsia-400/10' : 'bg-cyan-400/10';
  const activeGlow =
    color === 'fuchsia'
      ? 'shadow-[0_0_22px_-6px_rgba(232,121,249,0.6)]'
      : 'shadow-[0_0_22px_-6px_rgba(103,232,249,0.6)]';
  const badgeColor =
    color === 'fuchsia'
      ? 'border-fuchsia-400/45 bg-fuchsia-400/15 text-fuchsia-300'
      : 'border-cyan-400/45 bg-cyan-400/15 text-cyan-300';

  return (
    <button
      type="button"
      onClick={onClick}
      data-version={version}
      className={
        'relative overflow-hidden rounded-[14px] border px-3 py-3 text-left transition ' +
        (active ? `${activeBorder} ${activeBg} ${activeGlow}` : 'border-line-strong bg-bg-soft/40 hover:border-white/15')
      }
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-[18px] font-black tracking-tight text-white"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {title}
        </span>
        <span
          className={`mono rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${badgeColor}`}
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {badge}
        </span>
      </div>
      <div className="mono text-[9.5px] uppercase tracking-widest text-text-muted">{sub}</div>
      {active && (
        <span
          aria-hidden
          className="absolute right-2 top-2 inline-block h-2 w-2 rounded-full"
          style={{
            background: color === 'fuchsia' ? '#e879f9' : '#67e8f9',
            boxShadow: `0 0 10px ${color === 'fuchsia' ? 'rgba(232,121,249,0.9)' : 'rgba(103,232,249,0.9)'}`,
            display: 'none',
          }}
        />
      )}
    </button>
  );
}

/* ═══════════════════════ AudioMiniPlayer ═══════════════════════ */

function AudioMiniPlayer({
  file,
  src,
  durationSec,
  onChange,
  onClear,
  disabled,
}: {
  file: File;
  src: string;
  durationSec: number;
  onChange: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[14px] border border-violet/35 bg-violet/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-violet/40 bg-violet/10 text-[14px]">
          🎙
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] font-semibold text-white">{file.name}</div>
          <div className="mono text-[9.5px] text-text-muted">
            {durationSec > 0 ? `${durationSec.toFixed(1)}s · ` : ''}
            {(file.size / 1024 / 1024).toFixed(1)}MB
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onChange}
            disabled={disabled}
            className="mono rounded-md border border-line-strong px-2 py-1 text-[9px] uppercase tracking-widest text-text-muted hover:text-fuchsia-300 hover:border-fuchsia-400/40 disabled:opacity-40"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Trocar
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="mono rounded-md border border-line-strong px-2 py-1 text-[9px] uppercase tracking-widest text-text-muted hover:text-red-300 hover:border-red-500/40 disabled:opacity-40"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ✕
          </button>
        </div>
      </div>
      {/* Mini waveform visual */}
      <div className="relative h-10 overflow-hidden rounded-[10px] bg-bg/40">
        <div className="absolute inset-0 flex items-center justify-center gap-[2px] px-2">
          {Array.from({ length: 36 }).map((_, i) => {
            const h = 8 + Math.abs(Math.sin(i * 0.5)) * 28;
            return (
              <span
                key={i}
                className="block w-[3px] rounded-full bg-gradient-to-t from-violet to-fuchsia-300"
                style={{
                  height: `${h}px`,
                  opacity: 0.4 + (i % 3) * 0.2,
                  animation: `miniBar ${0.7 + (i % 4) * 0.1}s ease-in-out ${i * 0.04}s infinite alternate`,
                }}
              />
            );
          })}
        </div>
        <audio src={src} controls className="relative z-10 h-10 w-full opacity-90" />
      </div>
      <style jsx>{`
        @keyframes miniBar {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════ ResultReveal ═══════════════════════ */

function ResultReveal({
  outputUrl,
  elapsedSec,
  onReset,
}: {
  outputUrl: string;
  elapsedSec: number;
  onReset: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="relative aspect-[3/4] md:aspect-[4/5] bg-black overflow-hidden"
      style={{
        boxShadow:
          'inset 0 0 80px rgba(200,255,0,0.18), 0 0 50px -10px rgba(200,255,0,0.35)',
      }}
    >
      {/* glow corners */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-60 blur-3xl"
        style={{ background: 'rgba(200,255,0,0.5)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 -bottom-12 h-44 w-44 rounded-full opacity-50 blur-3xl"
        style={{ background: 'rgba(232,121,249,0.5)' }}
      />

      {/* Top badge */}
      <div className="absolute top-3 left-3 right-3 z-30 flex flex-wrap items-center justify-between gap-2">
        <span
          className="mono inline-flex items-center gap-1.5 rounded-full border border-lime/55 bg-lime/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-lime backdrop-blur-md"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="h-2 w-2 rounded-full bg-lime animate-pulse shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
          PRONTO · {elapsedSec}s
        </span>
        <div className="flex gap-1.5">
          <a
            href={outputUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="mono inline-flex items-center gap-1.5 rounded-full border border-lime/55 bg-lime/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-lime hover:bg-lime/25 transition backdrop-blur-md"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ⬇ Baixar
          </a>
          <button
            type="button"
            onClick={onReset}
            className="mono rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 hover:border-fuchsia-400/55 hover:text-fuchsia-300 transition backdrop-blur-md"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ↻ Outro
          </button>
        </div>
      </div>

      {/* Scanline reveal */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-lime/80 z-20"
        style={{
          boxShadow: '0 0 22px rgba(200,255,0,0.9)',
          animation: 'resultScan 1.2s ease-out',
        }}
      />

      <video
        src={outputUrl}
        controls
        autoPlay
        className="absolute inset-0 h-full w-full object-contain"
        style={{
          opacity: revealed ? 1 : 0,
          transform: revealed ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 0.8s cubic-bezier(.2,.8,.2,1), transform 0.8s cubic-bezier(.2,.8,.2,1)',
        }}
      />

      <style jsx>{`
        @keyframes resultScan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
