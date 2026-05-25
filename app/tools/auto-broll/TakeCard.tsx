'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TakeState } from '@/lib/magnific-pipeline';

/**
 * TakeCard — card individual de cada take em geração.
 * Aspecto 9:16 (vertical). 3 estados visuais:
 *  - LOADING (idle/running): bunny animado + skeleton + status text
 *  - VIDEO READY (video-done/ready): <video> com hover-to-play + download
 *  - FAILED: ícone erro + retry hint
 *
 * Interações:
 *  - Hover: 3D tilt + glow violet
 *  - Click no video: play/pause inline
 *  - Botão download: baixa MP4 individual via blob
 */

type Props = {
  take: TakeState;
  /** Index no job (não no take state — que é o idx do prompt). */
  position: number;
  /** Total de takes neste job. */
  total: number;
};

function statusMeta(status: TakeState['status']) {
  switch (status) {
    case 'idle':
      return { label: 'NA FILA', tone: 'idle' as const };
    case 'running':
      return { label: 'EM PRODUÇÃO', tone: 'loading' as const };
    case 'image-done':
      return { label: 'FRAME OK', tone: 'mid' as const };
    case 'video-done':
      return { label: 'RENDERIZADO', tone: 'ready' as const };
    case 'downloading':
      return { label: 'ARQUIVANDO', tone: 'loading' as const };
    case 'ready':
      return { label: 'ENTREGUE', tone: 'ready' as const };
    case 'failed':
      return { label: 'ERRO', tone: 'err' as const };
  }
}

export function TakeCard({ take, position, total }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const meta = statusMeta(take.status);
  // Video URL disponível em video-done e ready
  const videoUrl =
    take.status === 'video-done' || take.status === 'ready'
      ? take.videoUrl
      : null;
  // Image URL como poster — preview visível assim que o vídeo fica pronto,
  // sem precisar clicar. Suportado em image-done, video-done E ready.
  const posterUrl =
    take.status === 'image-done'
      ? take.imageUrl
      : take.status === 'video-done'
      ? take.imageUrl
      : take.status === 'ready'
      ? take.imageUrl
      : null;

  const mp4Mb =
    take.status === 'ready' && take.mp4Size > 0
      ? (take.mp4Size / 1024 / 1024).toFixed(1)
      : null;

  const failedMsg = take.status === 'failed' ? take.error : null;
  const runPercent = take.status === 'running' ? take.percent : 0;

  function openExpanded() {
    // Pausa inline preview se rodando, abre modal fullscreen
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setExpanded(true);
  }

  async function downloadOne() {
    if (!videoUrl || downloading) return;
    setDownloading(true);
    try {
      const r = await fetch(videoUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `take_${String(take.idx).padStart(2, '0')}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Download falhou', e);
    } finally {
      setDownloading(false);
    }
  }

  // 3D tilt baseado em mouse (transform via CSS var atualizada inline)
  const cardRef = useRef<HTMLDivElement | null>(null);
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current || !hovered) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 → 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    const rotX = (-y * 5).toFixed(2); // tilt vertical
    const rotY = (x * 5).toFixed(2);
    cardRef.current.style.setProperty('--rotX', rotX + 'deg');
    cardRef.current.style.setProperty('--rotY', rotY + 'deg');
  }
  function handleMouseLeave() {
    setHovered(false);
    if (cardRef.current) {
      cardRef.current.style.setProperty('--rotX', '0deg');
      cardRef.current.style.setProperty('--rotY', '0deg');
    }
  }

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      className={
        'take-card-3d group relative flex flex-col overflow-hidden rounded-[14px] border transition-all duration-300 ' +
        (meta.tone === 'ready'
          ? 'border-emerald-500/40 bg-gradient-to-b from-emerald-600/[0.06] to-bg-soft/40 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.25)] hover:shadow-[0_20px_40px_-16px_rgba(16,185,129,0.45),0_0_36px_-12px_rgba(16,185,129,0.35)] hover:border-emerald-500/70'
          : meta.tone === 'err'
          ? 'border-red-500/40 bg-gradient-to-b from-red-500/[0.05] to-bg-soft/40 shadow-[0_8px_24px_-12px_rgba(239,68,68,0.25)] hover:shadow-[0_20px_40px_-16px_rgba(239,68,68,0.5)] hover:border-red-500/70'
          : meta.tone === 'mid'
          ? 'border-cyan-400/30 bg-gradient-to-b from-cyan-400/[0.03] to-bg-soft/40 hover:border-cyan-400/60 hover:shadow-[0_16px_32px_-16px_rgba(34,211,238,0.4)]'
          : meta.tone === 'loading'
          ? 'border-violet/30 bg-gradient-to-b from-violet/[0.03] to-bg-soft/40 hover:border-violet/60 hover:shadow-[0_16px_32px_-16px_rgba(167,139,250,0.45)]'
          : 'border-line bg-bg-soft/30 hover:border-text-muted')
      }
      style={{
        transform:
          'perspective(1000px) rotateX(var(--rotX, 0deg)) rotateY(var(--rotY, 0deg)) translateZ(0)',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* HEADER bar — só TAKE NN/MM, zero pill. Visual silencioso. */}
      <div className="relative z-10 flex items-center justify-between px-3 py-2">
        <span
          className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-white"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          TAKE{' '}
          <span className="text-lime">
            {String(position).padStart(2, '0')}
          </span>
          <span className="text-text-dim">/{String(total).padStart(2, '0')}</span>
        </span>
      </div>

      {/* BODY 9:16 aspect */}
      <div className="relative mx-3 mb-3 aspect-[9/16] overflow-hidden rounded-[10px] border border-line bg-black">
        {videoUrl ? (
          <>
            {/* Video poster — preview aparece sem clicar (poster=imageUrl) */}
            <video
              ref={videoRef}
              src={videoUrl}
              poster={posterUrl || undefined}
              preload="auto"
              playsInline
              muted
              loop
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
            {/* Click target gigante = todo o video. Abre modal. */}
            <button
              type="button"
              onClick={openExpanded}
              className="absolute inset-0 flex cursor-pointer items-center justify-center"
              aria-label="Assistir em tela maior"
            >
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:bg-emerald-500/90"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-white group-hover:text-black"
                  style={{ marginLeft: 3 }}
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
            {/* Top-right: 2 icones SO (sempre visiveis em mobile, fade-in no hover desktop) */}
            <div className="pointer-events-auto absolute right-1.5 top-1.5 z-20 flex items-center gap-1.5">
              {/* Expand icon */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openExpanded();
                }}
                aria-label="Expandir"
                title="Expandir"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-white/70 hover:bg-black/85 active:scale-95"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
              {/* Download icon */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadOne();
                }}
                disabled={downloading}
                aria-label="Baixar MP4"
                title="Baixar MP4"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-500/70 bg-emerald-500/95 text-white shadow-[0_4px_14px_rgba(16,185,129,0.5)] transition-all hover:scale-110 hover:bg-emerald-400 active:scale-95 disabled:opacity-60"
              >
                {downloading ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                    <circle cx="12" cy="12" r="10" strokeDasharray="32 32" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                  </svg>
                )}
              </button>
            </div>
            {mp4Mb && (
              <div className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 backdrop-blur-sm">
                <span className="mono text-[9px] font-semibold uppercase tracking-widest text-emerald-300">
                  {mp4Mb} MB
                </span>
              </div>
            )}
          </>
        ) : meta.tone === 'err' ? (
          // FAILED STATE
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="text-3xl">⚠</span>
            <span className="mono text-[10px] font-bold uppercase tracking-widest text-red-300">
              Falha
            </span>
            <p className="line-clamp-3 text-[10px] leading-relaxed text-red-300/80">
              {failedMsg}
            </p>
          </div>
        ) : (
          // LOADING STATE
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet/[0.08] via-bg-soft to-bg">
            {/* Skeleton shimmer */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent"
                style={{ animation: 'cardShimmer 2.4s ease-in-out infinite' }}
              />
            </div>
            {/* Bunny logo animado — sem textos, só a animação */}
            <div className="relative z-10 flex items-center justify-center">
              {/* Aura halo atrás do bunny */}
              <div
                aria-hidden
                className="absolute h-24 w-24 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(167,139,250,0.45), rgba(200,255,0,0.10) 50%, transparent 75%)',
                  filter: 'blur(14px)',
                  animation: 'bunnyAuraSoft 3s ease-in-out infinite',
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/auto-edit-logo@64.png"
                alt="Auto Edit"
                width={48}
                height={48}
                className="relative z-10 drop-shadow-[0_0_18px_rgba(167,139,250,0.85)]"
                style={{ animation: 'bunnyHop 1.6s ease-in-out infinite' }}
              />
            </div>
            {/* Progress bar bottom */}
            {(take.status === 'running' || take.status === 'image-done') && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-line/40">
                <div
                  className="h-full bg-gradient-to-r from-violet via-violet-deep to-cyan-400 transition-all duration-500"
                  style={{
                    width:
                      take.status === 'image-done'
                        ? '50%'
                        : `${Math.max(runPercent, 5)}%`,
                    boxShadow: '0 0 10px rgba(167,139,250,0.6)',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS local */}
      <style jsx>{`
        .take-card-3d {
          will-change: transform;
        }
        @keyframes cardShimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
        @keyframes bunnyHop {
          0%, 100% { transform: translateY(0) scale(1) rotate(-3deg); }
          25% { transform: translateY(-6px) scale(1.04) rotate(0deg); }
          50% { transform: translateY(-10px) scale(1.08) rotate(3deg); }
          75% { transform: translateY(-6px) scale(1.04) rotate(0deg); }
        }
        @keyframes bunnyAuraSoft {
          0%, 100% { transform: scale(0.85); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
        }
      `}</style>

      {/* ─────────── EXPANDED MODAL via PORTAL ─────────── */}
      {/* Portal escapa do contexto 3D do card (perspective transform
          cria stacking context que clipa fixed positioning). */}
      {expanded && videoUrl && typeof window !== 'undefined'
        ? createPortal(
            <ExpandedVideoModal
              videoUrl={videoUrl}
              posterUrl={posterUrl || undefined}
              takeIdx={take.idx}
              total={total}
              onClose={() => setExpanded(false)}
              onDownload={downloadOne}
              downloading={downloading}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

/* ─────────── EXPANDED VIDEO MODAL ─────────── */
function ExpandedVideoModal({
  videoUrl,
  posterUrl,
  takeIdx,
  total,
  onClose,
  onDownload,
  downloading,
}: {
  videoUrl: string;
  posterUrl?: string;
  takeIdx: number;
  total: number;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  // ESC para fechar + lock scroll
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6 backdrop-blur-md"
      onClick={onClose}
      style={{ animation: 'modalFadeIn 0.25s ease-out' }}
    >
      {/* Top bar */}
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-between gap-3 px-6 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-white"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Take <span className="text-lime">{String(takeIdx).padStart(2, '0')}</span>
          <span className="text-text-dim"> / {String(total).padStart(2, '0')}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="mono inline-flex items-center gap-2 rounded-full border border-lime/60 bg-lime/95 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black shadow-[0_8px_24px_-8px_rgba(200,255,0,0.5)] transition-all hover:scale-105 disabled:opacity-60"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
            </svg>
            {downloading ? 'Baixando' : 'Baixar MP4'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur transition-all hover:scale-110 hover:border-white/60 hover:bg-black/80"
            title="Fechar (ESC)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </div>
      {/* Video */}
      <video
        src={videoUrl}
        poster={posterUrl}
        controls
        autoPlay
        playsInline
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full rounded-[14px] shadow-[0_30px_80px_rgba(0,0,0,0.8)]"
        style={{ aspectRatio: '9/16' }}
      />
      <style jsx>{`
        @keyframes modalFadeIn {
          from { opacity: 0; backdrop-filter: blur(0); }
          to { opacity: 1; backdrop-filter: blur(12px); }
        }
      `}</style>
    </div>
  );
}


function StatusPill({
  tone,
  label,
}: {
  tone: 'idle' | 'loading' | 'mid' | 'ready' | 'err';
  label: string;
}) {
  const cls = {
    idle: 'border-line bg-bg/60 text-text-muted',
    loading:
      'border-violet/50 bg-violet/15 text-violet shadow-[0_0_10px_rgba(167,139,250,0.35)]',
    mid: 'border-cyan-400/50 bg-cyan-400/15 text-cyan-300',
    ready: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
    err: 'border-red-500/60 bg-red-500/15 text-red-300',
  }[tone];
  return (
    <span
      className={
        'mono inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.14em] ' +
        cls
      }
      style={{ fontFamily: 'var(--font-tech)' }}
    >
      {tone === 'loading' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet" />
        </span>
      )}
      {tone === 'ready' && <span className="text-emerald-400">✓</span>}
      {tone === 'err' && <span>✕</span>}
      {label}
    </span>
  );
}
