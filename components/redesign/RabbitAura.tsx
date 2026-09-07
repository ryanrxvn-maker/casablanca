'use client';
import { useEffect, useRef } from 'react';

/** Original brand rabbit, aura, crown and particles, preserved from Plans. */
export function RabbitAura({
  tier,
  hue,
  glow,
}: {
  tier: 0 | 1 | 2;
  hue: string;
  glow: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let visible = false;
    const update = () => { node.dataset.motion = visible && document.visibilityState === 'visible' ? 'on' : 'off'; };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(node);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return (
    <div
      ref={ref}
      data-motion="off"
      aria-hidden="true"
      className="rabbit-aura relative flex items-center justify-center"
      style={{ width: 160, height: 160 }}
    >
      {/* Halo radial (todos os tiers) */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, ${glow}, transparent 70%)`,
          filter: 'blur(12px)',
          opacity: tier === 0 ? 0.6 : tier === 1 ? 0.85 : 1,
          animation: 'rabbit-halo 3.4s ease-in-out infinite',
        }}
      />

      {/* Ring conic (tier 1+) */}
      {tier >= 1 ? (
        <span
          aria-hidden
          className="absolute inset-3 rounded-full"
          style={{
            padding: '2px',
            background: `conic-gradient(from 0deg, ${hue}, transparent 30%, ${hue} 60%, transparent 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'rabbit-ring-spin 6s linear infinite',
            opacity: 0.85,
          }}
        />
      ) : null}

      {/* Ring extra cônico inverso (tier 2) — efeito de "núcleo de energia" */}
      {tier >= 2 ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            padding: '1.5px',
            background: `conic-gradient(from 180deg, transparent 0%, ${hue} 25%, transparent 50%, ${hue} 75%, transparent 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'rabbit-ring-spin-rev 8s linear infinite',
            opacity: 0.6,
          }}
        />
      ) : null}

      {/* Coroa neon (só Pro) */}
      {tier >= 2 ? (
        <span
          aria-hidden
          className="absolute"
          style={{
            top: 2,
            left: '50%',
            transform: 'translateX(-50%)',
            filter: `drop-shadow(0 0 10px ${hue}) drop-shadow(0 0 18px ${glow})`,
            animation: 'rabbit-crown-float 3.2s ease-in-out infinite',
          }}
        >
          <svg width="34" height="22" viewBox="0 0 34 22" fill="none">
            <path
              d="M3 19L5 4l7 7L17 0l5 11 7-7 2 15z"
              fill={hue}
              stroke="#fff"
              strokeOpacity="0.5"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
            <circle cx="17" cy="6" r="1.6" fill="#fff" />
            <circle cx="6" cy="10" r="1.1" fill="#fff" opacity="0.85" />
            <circle cx="28" cy="10" r="1.1" fill="#fff" opacity="0.85" />
          </svg>
        </span>
      ) : null}

      {/* Sparkles flutuantes — qtd cresce por tier */}
      {tier >= 1
        ? sparklePositions(tier as 1 | 2).map((pos, i) => (
            <RabbitSparkle key={i} {...pos} hue={hue} />
          ))
        : null}

      {/* Imagem do coelho */}
      <div
        className="rabbit-img relative z-10"
        style={{
          filter: `drop-shadow(0 0 ${24 + tier * 10}px ${glow}) drop-shadow(0 0 ${10 + tier * 4}px ${hue})`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auto-edit-logo@256.png"
          alt=""
          aria-hidden
          width={tier === 0 ? 100 : tier === 1 ? 110 : 118}
          height={tier === 0 ? 100 : tier === 1 ? 110 : 118}
        />
      </div>

      <style jsx global>{`
        .rabbit-img {
          animation: rabbit-float 4.8s ease-in-out infinite;
        }
        @keyframes rabbit-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes rabbit-halo {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.06); opacity: 0.95; }
        }
        @keyframes rabbit-ring-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes rabbit-ring-spin-rev {
          to { transform: rotate(-360deg); }
        }
        @keyframes rabbit-crown-float {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

/** Posições dos sparkles ao redor do coelho — quantidade cresce por tier */
function sparklePositions(tier: 1 | 2) {
  if (tier === 1) {
    return [
      { top: '20%', left: '12%', delay: 0 },
      { top: '75%', right: '14%', delay: 800 },
    ];
  }
  return [
    { top: '10%', left: '18%', delay: 0 },
    { top: '22%', right: '14%', delay: 500 },
    { top: '60%', left: '8%', delay: 1100 },
    { top: '70%', right: '10%', delay: 1700 },
    { top: '88%', left: '50%', delay: 2300 },
  ];
}

function RabbitSparkle({
  top,
  left,
  right,
  delay,
  hue,
}: {
  top?: string;
  left?: string;
  right?: string;
  delay: number;
  hue: string;
}) {
  return (
    <span
      aria-hidden
      className="rabbit-sparkle"
      style={{
        position: 'absolute',
        top,
        left,
        right,
        animationDelay: `${delay}ms`,
        filter: `drop-shadow(0 0 6px ${hue})`,
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
        <path d="M6 0l1.2 4.8L12 6l-4.8 1.2L6 12l-1.2-4.8L0 6l4.8-1.2L6 0z" fill={hue} />
      </svg>
      <style jsx global>{`
        .rabbit-sparkle {
          animation: rabbit-sparkle 2.4s ease-in-out infinite;
        }
        @keyframes rabbit-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.2) rotate(120deg); }
        }
      `}</style>
    </span>
  );
}
