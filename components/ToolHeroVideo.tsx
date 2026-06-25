'use client';

import { useEffect, useRef } from 'react';
import { HeroParticles } from '@/components/HeroParticles';

/**
 * ToolHeroVideo — HERO premium das ferramentas de IA. Banda cinematográfica
 * COMPACTA (altura limitada, não o vídeo gigante 16:9) com:
 *
 *   • o .mp4 do card como FUNDO (object-cover) com parallax sutil;
 *   • detalhes "vivos": bloom que respira + feixe de luz (mix-blend screen) +
 *     partículas pulsando + vinheta;
 *   • LETTERING 3D do nome da ferramenta (entrada kinetic-in, profundidade no
 *     tilt) + eyebrow + subtítulo;
 *   • TILT 3D no mousemove (perspective rotateX/rotateY), conteúdo com translateZ.
 *
 * `.dark-island` mantém o lettering branco legível sobre o vídeo escuro nos 2
 * temas. Só anima transform/opacity. Respeita prefers-reduced-motion.
 */
export type ToolHeroVideoProps = {
  /** .mp4 em /public/cards */
  src: string;
  poster?: string;
  /** Nome da ferramenta (lettering grande) */
  title: string;
  /** Rótulo curto acima do nome */
  eyebrow?: string;
  /** Linha curta abaixo do nome */
  subtitle?: string;
  /** Cor do glow/tint (rgba). Default fuchsia. */
  glow?: string;
};

export function ToolHeroVideo({
  src,
  poster,
  title,
  eyebrow,
  subtitle,
  glow = 'rgba(232,121,249,0.55)',
}: ToolHeroVideoProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Autoplay blindado
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };
    tryPlay();
    const t = setTimeout(tryPlay, 140);
    document.addEventListener('visibilitychange', tryPlay);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', tryPlay);
    };
  }, []);

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-py * 5).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * 5).toFixed(2)}deg`);
    el.style.setProperty('--px', `${(-px * 2.5).toFixed(2)}%`);
    el.style.setProperty('--py', `${(-py * 2.5).toFixed(2)}%`);
  };
  const onLeave = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--px', '0%');
    el.style.setProperty('--py', '0%');
  };

  return (
    <div className="hero-tool-perspective">
      <div
        ref={cardRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="hero-tool-card dark-island group relative w-full overflow-hidden rounded-[22px] border border-line/60 isolate h-[230px] sm:h-[290px] lg:h-[340px]"
        style={{ boxShadow: '0 40px 90px -40px rgba(0,0,0,0.8)' }}
      >
        {/* Vídeo de fundo com parallax sutil */}
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: 'center',
            transform: 'translate(var(--px, 0%), var(--py, 0%)) scale(1.08)',
            transition: 'transform 0.25s ease-out',
            willChange: 'transform',
          }}
        />

        {/* Detalhes vivos */}
        <div className="hero-bloom absolute inset-0" />
        <div className="hero-sweep-wrap absolute inset-0 overflow-hidden">
          <div className="hero-sweep" />
        </div>
        <HeroParticles count={16} />
        <div className="hero-vignette absolute inset-0" />

        {/* Scrim pra legibilidade do lettering (esquerda + base) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(4,4,8,0.86) 0%, rgba(4,4,8,0.38) 46%, transparent 74%), linear-gradient(to top, rgba(4,4,8,0.82), transparent 58%)',
          }}
        />

        {/* Conteúdo — lettering 3D com profundidade (translateZ) */}
        <div
          className="relative z-[2] flex h-full flex-col justify-end gap-2 p-6 md:p-9"
          style={{ transform: 'translateZ(45px)' }}
        >
          {eyebrow ? (
            <div
              className="hero-tool-eyebrow flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.24em] text-white/80"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full"
                style={{ background: '#fff', boxShadow: `0 0 12px ${glow}` }}
              />
              {eyebrow}
            </div>
          ) : null}

          <h1
            className="hero-tool-title text-[34px] font-extrabold leading-[0.95] tracking-tight md:text-[52px]"
            style={{
              fontFamily: 'var(--font-tech)',
              letterSpacing: '-0.03em',
              backgroundImage:
                'linear-gradient(135deg, #ffffff 0%, #f5e9ff 32%, #e879f9 68%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: `drop-shadow(0 3px 12px rgba(0,0,0,0.6)) drop-shadow(0 0 28px ${glow})`,
            }}
          >
            {title}
          </h1>

          {subtitle ? (
            <p className="max-w-[460px] text-[13px] leading-relaxed text-white/75 md:text-[14px]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
