'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Re-gerando overlay (shimmer + spinner) — reutilizado nos estados ready E
 *  failed, pra dar feedback enquanto a parte re-renderiza (texto ou áudio). */
function RegenOverlay({ label = 'Re-gerando…' }: { label?: string }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="animate-spin text-cyan-300" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
        <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
        <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
      </svg>
      <span className="mono text-[9px] uppercase tracking-widest text-cyan-200">{label}</span>
    </div>
  );
}

/**
 * LipsyncPreviewCard — card de preview de UM take de lipsync (HeyGen),
 * espelhado no TakeCard do Auto B-roll.
 *
 * Estados:
 *  - LOADING (pending/processing): logo animado + skeleton + barra de progresso
 *  - READY (completed + videoUrl): <video> com play inline + expandir + download
 *  - FAILED: ícone de erro + mensagem
 *
 * Reutilizável por HeyGen Auto e ClickUp Pilot — recebe só os dados do take.
 */
export type LipsyncTake = {
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  videoUrl: string | null;
  error?: string | null;
};

export function LipsyncPreviewCard({
  take,
  position,
  total,
  percent = 0,
  fileBase = 'take',
  onEdit,
  onRetry,
  onUploadAudio,
  isRegenerating = false,
}: {
  take: LipsyncTake;
  position: number;
  total: number;
  /** Progresso global do disparo (0-100) — usado na barra de loading. */
  percent?: number;
  /** Prefixo do nome do arquivo no download. */
  fileBase?: string;
  /** Se fornecido, mostra botao EDIT no card pronto. Usa pra re-gerar so essa parte com novo script/voz. */
  onEdit?: () => void;
  /** Se fornecido e o card FALHOU, mostra "Tentar de novo" (re-roda o mesmo disparo). */
  onRetry?: () => void;
  /** Se fornecido, mostra "Usar áudio" no card FALHO — sobe um áudio e o avatar
   *  faz lipsync nele (contorna a falha de TTS do HeyGen naquela parte). */
  onUploadAudio?: (file: File) => void;
  /** Marca esse card como "re-gerando agora" — overlay shimmer + bloqueia clicks. */
  isRegenerating?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const ready = take.status === 'completed' && !!take.videoUrl;
  const failed = take.status === 'failed';
  const videoUrl = ready ? take.videoUrl : null;
  const tone: 'ready' | 'err' | 'loading' = ready ? 'ready' : failed ? 'err' : 'loading';

  const safeLabel = take.label.replace(/[^a-z0-9_-]/gi, '_');

  function openExpanded() {
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
      a.download = `${fileBase}_${safeLabel}.mp4`;
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

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current || !hovered) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    cardRef.current.style.setProperty('--rotX', (-y * 5).toFixed(2) + 'deg');
    cardRef.current.style.setProperty('--rotY', (x * 5).toFixed(2) + 'deg');
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
        'lipsync-card-3d group relative flex flex-col overflow-hidden rounded-[14px] border transition-all duration-300 ' +
        (tone === 'ready'
          ? 'border-emerald-500/40 bg-gradient-to-b from-emerald-600/[0.06] to-bg-soft/40 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.25)] hover:shadow-[0_20px_40px_-16px_rgba(16,185,129,0.45),0_0_36px_-12px_rgba(16,185,129,0.35)] hover:border-emerald-500/70'
          : tone === 'err'
          ? 'border-red-500/40 bg-gradient-to-b from-red-500/[0.05] to-bg-soft/40 shadow-[0_8px_24px_-12px_rgba(239,68,68,0.25)] hover:border-red-500/70'
          : 'border-violet/30 bg-gradient-to-b from-violet/[0.03] to-bg-soft/40 hover:border-violet/60 hover:shadow-[0_16px_32px_-16px_rgba(167,139,250,0.45)]')
      }
      style={{
        transform: 'perspective(1000px) rotateX(var(--rotX, 0deg)) rotateY(var(--rotY, 0deg)) translateZ(0)',
        transformStyle: 'preserve-3d',
      }}
    >
      {/* HEADER */}
      <div className="relative z-10 flex items-center justify-between px-3 py-2">
        <span className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
          <span className="text-lime">{take.label}</span>
          <span className="text-text-dim"> · {String(position).padStart(2, '0')}/{String(total).padStart(2, '0')}</span>
        </span>
      </div>

      {/* BODY 9:16 */}
      <div className="relative mx-3 mb-3 aspect-[9/16] overflow-hidden rounded-[10px] border border-line bg-black">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              preload="metadata"
              playsInline
              muted
              loop
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
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
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" className="text-white group-hover:text-black" style={{ marginLeft: 3 }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
            <div className="pointer-events-auto absolute right-1.5 top-1.5 z-20 flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openExpanded(); }}
                aria-label="Expandir"
                title="Expandir"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-white/70 hover:bg-black/85 active:scale-95"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
              {onEdit ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  aria-label="Editar script/voz e re-gerar"
                  title="Editar script/voz e re-gerar"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/70 bg-cyan-500/90 text-white shadow-[0_4px_14px_rgba(34,211,238,0.45)] transition-all hover:scale-110 hover:bg-cyan-400 active:scale-95"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); downloadOne(); }}
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
            {/* Overlay quando essa parte esta sendo re-gerada — bloqueia clicks e mostra status */}
            {isRegenerating ? <RegenOverlay /> : null}
          </>
        ) : failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
            <span className="text-2xl">⚠</span>
            <span className="label-tech text-[10px] font-bold uppercase tracking-widest text-red-300">Falha</span>
            <p className="line-clamp-2 text-[10px] leading-relaxed text-red-300/80">{take.error || 'erro na renderização'}</p>
            {/* Contorno da falha: o HeyGen não gerou essa parte. Dá 2 saídas pra
                completar o AD sem refazer tudo:
                 1) Editar o texto e re-gerar SÓ essa parte (mexe no script/voz)
                 2) Subir um áudio → o avatar faz lipsync nele (pula o TTS) */}
            {(onEdit || onUploadAudio) ? (
              <div className="mt-1 flex flex-col items-stretch gap-1.5">
                {onEdit ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    title="Editar o texto e re-gerar só essa parte"
                    className="label-tech inline-flex items-center justify-center gap-1.5 rounded-full border border-cyan-400/60 bg-cyan-500/15 px-3 py-1.5 text-[9px] uppercase tracking-widest text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-[1px] hover:border-cyan-400/80 hover:bg-cyan-500/25 active:scale-95"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                    Editar texto
                  </button>
                ) : null}
                {onUploadAudio ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); audioInputRef.current?.click(); }}
                      title="Subir um áudio — o avatar faz lipsync nele (sem TTS)"
                      className="label-tech inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 text-[9px] uppercase tracking-widest text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-[1px] hover:border-emerald-500/80 hover:bg-emerald-500/25 active:scale-95"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
                      </svg>
                      Usar áudio
                    </button>
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        // Limpa o value pra permitir re-selecionar o MESMO arquivo depois.
                        e.target.value = '';
                        if (f) onUploadAudio(f);
                      }}
                    />
                  </>
                ) : null}
                {onRetry ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRetry(); }}
                    className="label-tech rounded-full border border-violet/55 bg-violet/15 px-3 py-1 text-[9px] uppercase tracking-widest text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-[1px] hover:border-violet/75 hover:bg-violet/25 active:scale-95"
                  >
                    ↻ Tentar de novo
                  </button>
                ) : null}
              </div>
            ) : onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="label-tech mt-1 rounded-full border border-violet/55 bg-violet/15 px-3 py-1 text-[9px] uppercase tracking-widest text-violet-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:-translate-y-[1px] hover:border-violet/75 hover:bg-violet/25 active:scale-95"
              >
                ↻ Tentar de novo
              </button>
            ) : null}
            {/* Mesmo overlay de re-geração quando essa parte falha está re-rodando */}
            {isRegenerating ? <RegenOverlay /> : null}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet/[0.08] via-bg-soft to-bg">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" style={{ animation: 'lcShimmer 2.4s ease-in-out infinite' }} />
            </div>
            <div className="relative z-10 flex items-center justify-center">
              <div
                aria-hidden
                className="absolute h-24 w-24 rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.45), rgba(200,232,124,0.10) 50%, transparent 75%)', filter: 'blur(14px)', animation: 'lcAura 3s ease-in-out infinite' }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/auto-edit-logo@64.png"
                alt="Renderizando"
                width={48}
                height={48}
                className="relative z-10 drop-shadow-[0_0_18px_rgba(167,139,250,0.85)]"
                style={{ animation: 'lcHop 1.6s ease-in-out infinite' }}
              />
            </div>
            <span className="relative z-10 mono text-[9px] uppercase tracking-widest text-violet">
              {take.status === 'processing' ? 'Renderizando…' : 'Na fila…'}
            </span>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-line/40">
              <div
                className="h-full bg-gradient-to-r from-violet via-violet-deep to-cyan-400 transition-all duration-500"
                style={{ width: `${Math.max(percent, 5)}%`, boxShadow: '0 0 10px rgba(167,139,250,0.6)' }}
              />
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .lipsync-card-3d { will-change: transform; }
        @keyframes lcShimmer { 0%,100% { transform: translateX(-100%); } 50% { transform: translateX(100%); } }
        @keyframes lcHop {
          0%,100% { transform: translateY(0) scale(1) rotate(-3deg); }
          25% { transform: translateY(-6px) scale(1.04) rotate(0deg); }
          50% { transform: translateY(-10px) scale(1.08) rotate(3deg); }
          75% { transform: translateY(-6px) scale(1.04) rotate(0deg); }
        }
        @keyframes lcAura { 0%,100% { transform: scale(0.85); opacity: 0.7; } 50% { transform: scale(1.15); opacity: 1; } }
      `}</style>

      {expanded && videoUrl && typeof window !== 'undefined'
        ? createPortal(
            <ExpandedVideoModal
              videoUrl={videoUrl}
              label={take.label}
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

function ExpandedVideoModal({
  videoUrl,
  label,
  onClose,
  onDownload,
  downloading,
}: {
  videoUrl: string;
  label: string;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6 backdrop-blur-md" onClick={onClose} style={{ animation: 'lcModalIn 0.25s ease-out' }}>
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-3 px-6 py-4" onClick={(e) => e.stopPropagation()}>
        <span className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
          <span className="text-lime">{label}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="mono inline-flex items-center gap-2 rounded-full border border-lime/60 bg-lime/95 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black shadow-[0_8px_24px_-8px_rgba(200,232,124,0.5)] transition-all hover:scale-105 disabled:opacity-60"
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
      <video
        src={videoUrl}
        controls
        autoPlay
        playsInline
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-full rounded-[14px] shadow-[0_30px_80px_rgba(0,0,0,0.8)]"
        style={{ aspectRatio: '9/16' }}
      />
      <style jsx>{`
        @keyframes lcModalIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
