'use client';

import { useEffect, useRef, useState } from 'react';
import { LipSyncHero3D } from '@/app/tools/lipsync/LipSyncHero3D';

/**
 * LipSyncTool — UI premium da ferramenta LipSync (admin-only).
 *
 * Layout:
 *   1. Hero 3D cinematografico (LipSyncHero3D)
 *   2. Dois dropzones 3D paralelos (video + audio) com mouse-tilt
 *      e particulas reativas no hover
 *   3. Settings avancados (collapsible) — guidance_scale, loop_mode, seed
 *   4. Botao GERAR foda com sheen + pulse
 *   5. Phase indicator cinematografico (Upload → Queue → Generate → Polish → Done)
 *   6. Reveal foda do resultado — scanlines de revelacao + comparacao
 *
 * Fluxo:
 *   1. uploadToFal(video) → /api/fal/proxy ata o storage
 *   2. uploadToFal(audio) → idem
 *   3. POST /api/tools/lipsync com { video_url, audio_url, guidance_scale, loop_mode, seed }
 *   4. Recebe output_video_url, mostra com reveal
 */

type Status = 'idle' | 'uploading-video' | 'uploading-audio' | 'queueing' | 'generating' | 'polishing' | 'done' | 'error';

const PHASES: Array<{ key: Status; label: string; sub: string; icon: string }> = [
  { key: 'uploading-video', label: 'UPLOAD VÍDEO', sub: 'sending to fal storage', icon: '🎬' },
  { key: 'uploading-audio', label: 'UPLOAD ÁUDIO', sub: 'sending to fal storage', icon: '🎙' },
  { key: 'queueing', label: 'FILA NEURAL', sub: 'reserving gpu', icon: '⏱' },
  { key: 'generating', label: 'GERANDO', sub: 'latentsync forward pass', icon: '🧠' },
  { key: 'polishing', label: 'POLINDO', sub: 'face refine + render', icon: '✨' },
];

export default function LipSyncTool() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>('');
  const [audioPreview, setAudioPreview] = useState<string>('');
  const [videoMeta, setVideoMeta] = useState<{ w: number; h: number; dur: number } | null>(null);
  const [audioDur, setAudioDur] = useState<number>(0);

  const [outputUrl, setOutputUrl] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Advanced settings
  const [advanced, setAdvanced] = useState(false);
  const [guidanceScale, setGuidanceScale] = useState<number>(2.5);
  const [loopMode, setLoopMode] = useState<'loop' | 'pingpong'>('loop');
  const [seedEnabled, setSeedEnabled] = useState(false);
  const [seed, setSeed] = useState<number>(42);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const isLoading = status !== 'idle' && status !== 'done' && status !== 'error';
  const phaseIdx = PHASES.findIndex((p) => p.key === status);

  // Validations
  const videoTooShort = videoMeta && videoMeta.dur < 1.5;
  const videoTooLong = videoMeta && videoMeta.dur > 60;
  const videoLowRes = videoMeta && Math.min(videoMeta.w, videoMeta.h) < 360;
  const audioTooShort = audioDur > 0 && audioDur < 0.8;

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

  async function uploadToFal(file: File): Promise<string> {
    const { fal } = await import('@fal-ai/client');
    fal.config({ proxyUrl: '/api/fal/proxy' });
    return fal.storage.upload(file);
  }

  async function handleGenerate() {
    if (!videoFile || !audioFile) {
      setErrorMsg('Sobe o vídeo e o áudio primeiro.');
      setStatus('error');
      return;
    }
    setErrorMsg('');
    setOutputUrl('');
    startTicker();

    try {
      setStatus('uploading-video');
      const video_url = await uploadToFal(videoFile);

      setStatus('uploading-audio');
      const audio_url = await uploadToFal(audioFile);

      setStatus('queueing');
      // Pequena pausa só pra deixar a fase visível
      await new Promise((r) => setTimeout(r, 600));

      setStatus('generating');
      const body: Record<string, unknown> = {
        video_url,
        audio_url,
        guidance_scale: guidanceScale,
        loop_mode: loopMode,
      };
      if (seedEnabled) body.seed = seed;

      const res = await fetch('/api/tools/lipsync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Trocamos pra polishing nos ultimos segundos visualmente — mas
      // como o fetch eh sincrono, vamos so trocar antes de parse
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
    setVideoFile(null);
    setAudioFile(null);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setVideoPreview('');
    setAudioPreview('');
    setVideoMeta(null);
    setAudioDur(0);
    setOutputUrl('');
    setStatus('idle');
    setErrorMsg('');
    stopTicker();
    setElapsedSec(0);
  }

  useEffect(() => {
    return () => {
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      if (audioPreview) URL.revokeObjectURL(audioPreview);
      stopTicker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 md:px-8 space-y-6">
      <LipSyncHero3D />

      {/* DROPZONES 3D */}
      <div className="grid gap-5 md:grid-cols-2">
        <UltraDropzone
          accent="fuchsia"
          stepIcon="🎬"
          stepNum="01"
          title="Vídeo fonte"
          hint="rosto frontal · bem iluminado · 360p+ · 2–30s"
          accept="video/mp4,video/quicktime,video/*"
          file={videoFile}
          onFile={async (f) => {
            if (videoPreview) URL.revokeObjectURL(videoPreview);
            if (!f) {
              setVideoFile(null);
              setVideoPreview('');
              setVideoMeta(null);
              return;
            }
            setVideoFile(f);
            const url = URL.createObjectURL(f);
            setVideoPreview(url);
            // probe meta
            try {
              const v = document.createElement('video');
              v.preload = 'metadata';
              v.src = url;
              await new Promise<void>((resolve, reject) => {
                v.onloadedmetadata = () => resolve();
                v.onerror = () => reject();
              });
              setVideoMeta({
                w: v.videoWidth,
                h: v.videoHeight,
                dur: v.duration,
              });
            } catch {
              setVideoMeta(null);
            }
          }}
          disabled={isLoading}
          preview={
            videoPreview ? (
              <video
                src={videoPreview}
                muted
                loop
                autoPlay
                playsInline
                className="h-full w-full object-cover"
              />
            ) : null
          }
          meta={
            videoMeta ? (
              <>
                <Pill tone="fuchsia">{videoMeta.w}×{videoMeta.h}</Pill>
                <Pill tone="fuchsia">{videoMeta.dur.toFixed(1)}s</Pill>
                <Pill tone="muted">{(videoFile!.size / 1024 / 1024).toFixed(1)}MB</Pill>
              </>
            ) : null
          }
        />

        <UltraDropzone
          accent="violet"
          stepIcon="🎙"
          stepNum="02"
          title="Áudio alvo"
          hint="MP3 · WAV · M4A · voz limpa, sem ruído"
          accept="audio/*"
          file={audioFile}
          onFile={async (f) => {
            if (audioPreview) URL.revokeObjectURL(audioPreview);
            if (!f) {
              setAudioFile(null);
              setAudioPreview('');
              setAudioDur(0);
              return;
            }
            setAudioFile(f);
            const url = URL.createObjectURL(f);
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
          }}
          disabled={isLoading}
          preview={
            audioPreview ? (
              <AudioVisualizer src={audioPreview} />
            ) : null
          }
          meta={
            audioDur > 0 && audioFile ? (
              <>
                <Pill tone="violet">{audioDur.toFixed(1)}s</Pill>
                <Pill tone="muted">{(audioFile.size / 1024 / 1024).toFixed(1)}MB</Pill>
              </>
            ) : null
          }
        />
      </div>

      {/* WARNINGS — só aparece quando há algo a sinalizar */}
      {(videoTooShort || videoTooLong || videoLowRes || audioTooShort) && (
        <div className="rounded-[14px] border border-amber-400/40 bg-amber-400/5 px-4 py-3 space-y-1">
          <div
            className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ⚠ Atenção pra qualidade
          </div>
          <ul className="text-[12px] text-amber-100/90 space-y-0.5">
            {videoTooShort && <li>· Vídeo muito curto (&lt;1.5s) — o modelo precisa de tempo pra encaixar a boca.</li>}
            {videoTooLong && <li>· Vídeo longo (&gt;60s) — vai consumir mais crédito e demorar mais.</li>}
            {videoLowRes && <li>· Resolução baixa — dentes podem sair borrados. Idealmente 720p+.</li>}
            {audioTooShort && <li>· Áudio muito curto — verifique se tem fala mesmo.</li>}
          </ul>
        </div>
      )}

      {/* SETTINGS AVANÇADOS */}
      <div className="rounded-[16px] border border-line/60 bg-bg-soft/30 overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          disabled={isLoading}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 hover:bg-bg-soft/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-violet/40 bg-violet/10 text-[16px]"
              style={{ boxShadow: '0 0 14px -4px rgba(167,139,250,0.5)' }}
            >
              ⚙
            </span>
            <div className="text-left">
              <div
                className="text-[13px] font-bold tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Ajustes pro
              </div>
              <div className="mono text-[10.5px] uppercase tracking-widest text-text-muted">
                guidance · loop · seed
              </div>
            </div>
          </div>
          <span className="text-text-muted text-[13px]">{advanced ? '▲' : '▼'}</span>
        </button>

        {advanced && (
          <div className="border-t border-line/40 px-5 py-5 space-y-5 bg-bg/30">
            {/* Guidance scale */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label
                  className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Guidance Scale
                </label>
                <span className="mono text-[13px] text-fuchsia-300 font-bold">
                  {guidanceScale.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={guidanceScale}
                onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                disabled={isLoading}
                className="w-full accent-fuchsia-500"
              />
              <div className="mt-1 flex justify-between text-[10px] text-text-dim mono">
                <span>natural (1.0)</span>
                <span>balance (2.5)</span>
                <span>preciso (4.0)</span>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                Maior = boca mais aderente ao áudio. Menor = movimento mais natural. 2.5 é o sweet spot.
              </p>
            </div>

            {/* Loop mode */}
            <div>
              <label
                className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted mb-2 block"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Modo do Loop (áudio &gt; vídeo)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['loop', 'pingpong'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLoopMode(m)}
                    disabled={isLoading}
                    className={
                      'rounded-[12px] border px-4 py-3 text-left transition-all ' +
                      (loopMode === m
                        ? 'border-fuchsia-400/60 bg-fuchsia-400/10 shadow-[0_0_22px_-6px_rgba(232,121,249,0.6)]'
                        : 'border-line-strong bg-bg-soft/50 hover:border-fuchsia-400/40')
                    }
                  >
                    <div
                      className="text-[12.5px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {m === 'loop' ? '🔁 Loop' : '↔ Ping-pong'}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-text-muted">
                      {m === 'loop' ? 'reinicia do começo' : 'inverte ao fim'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Seed */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Seed (reproduzir resultado)
                </label>
                <button
                  type="button"
                  onClick={() => setSeedEnabled(!seedEnabled)}
                  disabled={isLoading}
                  className={
                    'mono rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-widest transition ' +
                    (seedEnabled
                      ? 'border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-300'
                      : 'border-line-strong text-text-muted hover:border-fuchsia-400/40')
                  }
                >
                  {seedEnabled ? '● fixado' : 'aleatório'}
                </button>
              </div>
              {seedEnabled && (
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                  disabled={isLoading}
                  className="mono w-full rounded-[10px] border border-line-strong bg-bg/40 px-3 py-2 text-[13px] text-white focus:border-fuchsia-400/60 focus:outline-none"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="flex flex-wrap gap-3">
        <UltraButton
          onClick={handleGenerate}
          disabled={!videoFile || !audioFile || isLoading}
          loading={isLoading}
        />
        <button
          type="button"
          onClick={handleReset}
          disabled={isLoading}
          className="mono rounded-[14px] border border-line-strong px-5 py-3.5 text-[11px] uppercase tracking-[0.18em] text-text-muted hover:border-red-500/60 hover:text-red-300 disabled:opacity-40 transition"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Limpar tudo
        </button>
      </div>

      {/* PHASE INDICATOR — só aparece quando processando */}
      {isLoading && (
        <PhasePanel currentIdx={phaseIdx} elapsedSec={elapsedSec} />
      )}

      {/* ERRO */}
      {status === 'error' && errorMsg && (
        <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-5 py-4">
          <div
            className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-red-300 mb-1"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ✕ Erro
          </div>
          <div className="text-[13px] text-red-100">{errorMsg}</div>
        </div>
      )}

      {/* RESULTADO — REVEAL CINEMATOGRÁFICO */}
      {status === 'done' && outputUrl && (
        <ResultReveal
          outputUrl={outputUrl}
          elapsedSec={elapsedSec}
          onReset={handleReset}
        />
      )}

      {/* RODAPÉ DE NOTAS */}
      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3 mt-3">
        <div
          className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Como ter o melhor resultado
        </div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Rosto frontal, centralizado, sem oclusão (sem mão na boca).</li>
          <li>· Iluminação uniforme — luz lateral cria sombra que vira artefato.</li>
          <li>· Áudio limpo, sem música por trás (a IA precisa ouvir o fonema).</li>
          <li>· 720p+ pro modelo render dentes nítidos.</li>
          <li>· Vídeo entre 3 e 20 segundos é o sweet spot de qualidade × custo.</li>
          <li>· Mesma pessoa, mesma língua — sotaques fortes pioram o sync.</li>
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────── COMPONENTS ─────────────────────────── */

function UltraDropzone({
  accent,
  stepIcon,
  stepNum,
  title,
  hint,
  accept,
  file,
  onFile,
  disabled,
  preview,
  meta,
}: {
  accent: 'fuchsia' | 'violet';
  stepIcon: string;
  stepNum: string;
  title: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  preview?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [dragOver, setDragOver] = useState(false);

  const accentColor = accent === 'fuchsia' ? 'rgba(232,121,249,0.55)' : 'rgba(167,139,250,0.55)';
  const accentBorder = accent === 'fuchsia' ? 'border-fuchsia-400/50' : 'border-violet/50';
  const accentBg = accent === 'fuchsia' ? 'bg-fuchsia-400/5' : 'bg-violet/5';
  const accentText = accent === 'fuchsia' ? 'text-fuchsia-300' : 'text-violet';

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 6;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 6;
      setTilt({ x: -y, y: x });
    }
    function onLeave() {
      setTilt({ x: 0, y: 0 });
    }
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      className={
        'group relative overflow-hidden rounded-[20px] border-2 transition-all duration-300 ' +
        (file ? `${accentBorder} ${accentBg}` : dragOver ? `${accentBorder} ${accentBg}` : 'border-dashed border-line-strong bg-bg-soft/30 hover:border-line-glow')
      }
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        transformStyle: 'preserve-3d',
        transform: file ? 'none' : `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: 'transform 0.3s cubic-bezier(.2,.8,.2,1), border-color 0.3s, background-color 0.3s',
      }}
      onClick={() => !disabled && !file && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (disabled) return;
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />

      {/* Hover glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(60% 80% at 50% 50%, ${accentColor.replace('0.55', '0.18')}, transparent 70%)`,
        }}
      />

      {/* Step number badge — top right */}
      <div className="absolute top-3 right-3 z-10">
        <span
          className={`mono inline-flex items-center gap-1 rounded-full border ${accentBorder} bg-bg/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] ${accentText}`}
          style={{ fontFamily: 'var(--font-tech)', backdropFilter: 'blur(8px)' }}
        >
          {stepNum}
        </span>
      </div>

      {!file ? (
        <div className="relative flex flex-col items-center justify-center gap-3 px-6 py-14 text-center min-h-[280px]">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-black/40 text-[40px] transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6"
            style={{
              boxShadow: `0 0 28px -6px ${accentColor}, inset 0 1px 0 rgba(255,255,255,0.08)`,
            }}
          >
            {stepIcon}
          </div>
          <div>
            <div
              className={`text-[14px] font-bold uppercase tracking-[0.18em] ${accentText}`}
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {title}
            </div>
            <p className="mt-1 text-[12px] text-text-muted">{hint}</p>
            <div className="mt-3 mono text-[10px] uppercase tracking-widest text-text-dim">
              arraste · ou · clique
            </div>
          </div>
        </div>
      ) : (
        <div className="relative">
          {/* Preview */}
          <div className="aspect-[16/9] w-full overflow-hidden bg-black">
            {preview}
          </div>
          {/* Info bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-line/40">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-white">
                {file.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">{meta}</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
              }}
              disabled={disabled}
              className="shrink-0 rounded-full border border-red-500/40 px-3 py-1 text-[10.5px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/10 active:scale-95 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Trocar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AudioVisualizer({ src }: { src: string }) {
  // simple visual: ondas estilizadas + player nativo
  return (
    <div className="relative h-full w-full bg-gradient-to-br from-violet/15 via-fuchsia-500/10 to-bg flex items-center justify-center">
      <div className="absolute inset-0 flex items-center justify-center gap-1 px-6">
        {Array.from({ length: 28 }).map((_, i) => {
          const h = 14 + Math.abs(Math.sin(i * 0.7)) * 60;
          return (
            <span
              key={i}
              className="block w-1.5 rounded-full bg-gradient-to-t from-violet to-fuchsia-300"
              style={{
                height: `${h}px`,
                opacity: 0.6 + (i % 3) * 0.15,
                animation: `audioBar ${0.7 + (i % 4) * 0.1}s ease-in-out ${i * 0.05}s infinite alternate`,
              }}
            />
          );
        })}
      </div>
      <audio src={src} controls className="relative z-10 w-[85%]" />
      <style jsx>{`
        @keyframes audioBar {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: 'fuchsia' | 'violet' | 'muted';
  children: React.ReactNode;
}) {
  const map = {
    fuchsia: 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300',
    violet: 'border-violet/40 bg-violet/10 text-violet',
    muted: 'border-line-strong bg-bg/40 text-text-muted',
  };
  return (
    <span
      className={`mono inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-widest ${map[tone]}`}
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      {children}
    </span>
  );
}

function UltraButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ultra-btn group relative flex-1 overflow-hidden rounded-[16px] border border-fuchsia-400/50 px-6 py-4 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background:
          'linear-gradient(135deg, rgba(232,121,249,0.22) 0%, rgba(167,139,250,0.22) 50%, rgba(103,232,249,0.18) 100%)',
        boxShadow:
          '0 0 30px -4px rgba(232,121,249,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      {/* sheen */}
      <span
        aria-hidden
        className="ultra-btn-sheen pointer-events-none absolute inset-y-0 left-[-30%] w-[40%] opacity-0 group-hover:opacity-100"
        style={{
          background:
            'linear-gradient(120deg, transparent, rgba(255,255,255,0.32), transparent)',
        }}
      />
      <span className="relative flex items-center justify-center gap-3">
        {loading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-fuchsia-200 border-t-transparent" />
            <span
              className="text-[14px] font-bold uppercase tracking-[0.22em] text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Processando…
            </span>
          </>
        ) : (
          <>
            <span className="text-[20px]">▶</span>
            <span
              className="text-[15px] font-bold uppercase tracking-[0.22em] text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Gerar LipSync Cinematográfico
            </span>
            <span className="text-[18px] transition-transform duration-300 group-hover:translate-x-1.5">
              →
            </span>
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
  );
}

function PhasePanel({ currentIdx, elapsedSec }: { currentIdx: number; elapsedSec: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-[20px] border border-fuchsia-400/35 px-5 py-5 md:px-6"
      style={{
        background:
          'linear-gradient(135deg, rgba(232,121,249,0.10), rgba(167,139,250,0.08) 60%, rgba(103,232,249,0.08))',
      }}
    >
      {/* scanlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(232,121,249,0.6) 2px, rgba(232,121,249,0.6) 3px)',
          animation: 'phaseScan 4s linear infinite',
        }}
      />

      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-fuchsia-400 animate-pulse shadow-[0_0_12px_rgba(232,121,249,0.9)]" />
          <span
            className="mono text-[11px] font-bold uppercase tracking-[0.22em] text-fuchsia-300"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            LATENTSYNC EM EXECUÇÃO
          </span>
        </div>
        <span
          className="mono text-[13px] font-bold text-white"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {elapsedSec}s
        </span>
      </div>

      {/* Phases */}
      <div className="relative grid grid-cols-5 gap-2">
        {PHASES.map((phase, i) => {
          const isActive = i === currentIdx;
          const isDone = currentIdx > i;
          return (
            <div
              key={phase.key}
              className={
                'relative flex flex-col items-center gap-1 rounded-[12px] border px-2 py-3 transition-all duration-500 ' +
                (isActive
                  ? 'border-fuchsia-400/60 bg-fuchsia-400/10 shadow-[0_0_22px_-4px_rgba(232,121,249,0.6)] scale-[1.04]'
                  : isDone
                    ? 'border-violet/40 bg-violet/5'
                    : 'border-line-strong bg-bg-soft/30 opacity-50')
              }
            >
              <span
                className={'text-[20px] ' + (isActive ? 'animate-bounce' : '')}
              >
                {isDone ? '✓' : phase.icon}
              </span>
              <span
                className={
                  'mono text-center text-[8.5px] font-bold uppercase leading-tight ' +
                  (isActive
                    ? 'text-fuchsia-200'
                    : isDone
                      ? 'text-violet'
                      : 'text-text-dim')
                }
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '0.08em' }}
              >
                {phase.label}
              </span>
              <span
                className={
                  'mono text-center text-[8px] uppercase leading-tight ' +
                  (isActive ? 'text-fuchsia-300/80' : 'text-text-dim/60')
                }
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {phase.sub}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative mt-4 text-[11px] text-text-muted text-center">
        Geração média: 60–180s. Mantém a aba aberta — o crédito já foi reservado.
      </div>

      <style jsx>{`
        @keyframes phaseScan {
          0% { background-position: 0 0; }
          100% { background-position: 0 60px; }
        }
      `}</style>
    </div>
  );
}

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
      className="result-reveal relative overflow-hidden rounded-[24px] border border-lime/45 p-5 md:p-7"
      style={{
        background:
          'linear-gradient(135deg, rgba(200,255,0,0.10), rgba(232,121,249,0.08) 50%, rgba(167,139,250,0.10))',
        boxShadow:
          '0 0 50px -10px rgba(200,255,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-70 blur-3xl"
        style={{ background: 'rgba(200,255,0,0.4)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -bottom-16 h-48 w-48 rounded-full opacity-50 blur-3xl"
        style={{ background: 'rgba(232,121,249,0.4)' }}
      />

      <div className="relative">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div
              className="mono inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="h-2 w-2 rounded-full bg-lime animate-pulse shadow-[0_0_12px_rgba(200,255,0,0.9)]" />
              SINCRONIZADO · PRONTO
            </div>
            <h3
              className="mt-1 text-[26px] md:text-[32px] font-extrabold tracking-tight text-white"
              style={{
                fontFamily: 'var(--font-tech)',
                letterSpacing: '-0.02em',
              }}
            >
              A boca tá falando.
            </h3>
            <p className="mt-1 text-[13px] text-text-muted">
              Gerado em <span className="text-white font-semibold">{elapsedSec}s</span> · LatentSync · 32 FPS
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={outputUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="mono inline-flex items-center gap-2 rounded-[12px] border border-lime/60 bg-lime/15 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-lime hover:bg-lime/25 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ⬇ Baixar
            </a>
            <button
              type="button"
              onClick={onReset}
              className="mono rounded-[12px] border border-line-strong px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted hover:border-fuchsia-400/60 hover:text-fuchsia-300 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ↻ Gerar outro
            </button>
          </div>
        </div>

        {/* Video reveal */}
        <div
          className="relative overflow-hidden rounded-[16px] bg-black"
          style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? 'scale(1)' : 'scale(0.96)',
            transition: 'opacity 0.8s cubic-bezier(.2,.8,.2,1), transform 0.8s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          {/* Scanline reveal effect */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-lime/80"
            style={{
              boxShadow: '0 0 22px rgba(200,255,0,0.9)',
              animation: 'resultScan 1.2s ease-out',
            }}
          />
          <video
            src={outputUrl}
            controls
            autoPlay
            className="w-full max-h-[540px] object-contain"
          />
        </div>
      </div>

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
