'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DarkoLogo } from './DarkoLogo';

/**
 * RouteLoader v2 — splash profissional entre rotas.
 *
 * Camadas (de fora pra dentro):
 *  • Backdrop com gradient radial violet + blur
 *  • Anel rotativo conic (loading spinner real)
 *  • Anel pulsante de luz violet
 *  • Sparkles flutuantes em volta
 *  • Logo central com float + breathing scale
 *  • Barra de progresso indeterminada fina embaixo
 *
 * Dura ~560ms — tempo de cobrir a transição sem irritar.
 */
export function RouteLoader() {
  const pathname = usePathname();
  const first = useRef(true);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShowing(true);
    const t = setTimeout(() => setShowing(false), 560);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!showing) return null;

  return (
    <div
      aria-hidden
      className="route-loader fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background:
          'radial-gradient(40% 50% at 50% 50%, rgba(167,139,250,0.15), rgba(7,7,8,0.95) 75%)',
        backdropFilter: 'blur(28px) saturate(160%)',
        WebkitBackdropFilter: 'blur(28px) saturate(160%)',
      }}
    >
      {/* Container central com a logo + anéis */}
      <div className="route-loader-stage relative flex items-center justify-center">
        {/* Anel rotativo conic — spinner real */}
        <div
          className="route-loader-ring absolute"
          style={{
            width: 160,
            height: 160,
            borderRadius: '50%',
            background:
              'conic-gradient(from 0deg, transparent 0%, transparent 60%, #c084fc 80%, #a78bfa 95%, transparent 100%)',
            WebkitMask:
              'radial-gradient(circle at center, transparent 62%, black 63%, black 72%, transparent 73%)',
            mask:
              'radial-gradient(circle at center, transparent 62%, black 63%, black 72%, transparent 73%)',
            filter: 'drop-shadow(0 0 18px rgba(167,139,250,0.7))',
          }}
        />

        {/* Anel pulsante de luz */}
        <div
          className="route-loader-pulse absolute"
          style={{
            width: 140,
            height: 140,
            borderRadius: '50%',
            border: '1px solid rgba(167,139,250,0.4)',
            boxShadow:
              '0 0 30px rgba(167,139,250,0.35), inset 0 0 30px rgba(167,139,250,0.15)',
          }}
        />

        {/* Sparkles orbitando */}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="route-loader-spark absolute"
            style={
              {
                ['--i' as string]: i,
                ['--total' as string]: 6,
              } as React.CSSProperties
            }
          />
        ))}

        {/* Logo central */}
        <div className="route-loader-mark relative">
          <DarkoLogo size={86} />
        </div>
      </div>

      {/* Barra de progresso indeterminada — embaixo */}
      <div
        className="route-loader-bar absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.03)' }}
      >
        <span
          className="route-loader-bar-fill block h-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, #c084fc 35%, #f0abfc 50%, #c084fc 65%, transparent 100%)',
            boxShadow: '0 0 14px rgba(192,132,252,0.6)',
          }}
        />
      </div>

      <style jsx>{`
        .route-loader {
          animation: route-loader-fade 560ms ease both;
        }
        .route-loader-stage {
          animation: route-loader-stage-in 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .route-loader-mark {
          animation: route-loader-float 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .route-loader-ring {
          animation: route-loader-ring-spin 1.2s linear infinite;
        }
        .route-loader-pulse {
          animation: route-loader-pulse-anim 1.4s ease-in-out infinite;
        }
        .route-loader-bar-fill {
          width: 30%;
          animation: route-loader-bar-anim 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .route-loader-spark {
          width: 4px;
          height: 4px;
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 0 10px #fff, 0 0 18px #c084fc;
          /* Posição inicial em círculo, raio 95px */
          transform-origin: 0 0;
          animation: route-loader-orbit 2.4s linear infinite;
          animation-delay: calc(var(--i) * -0.4s);
        }
        @keyframes route-loader-fade {
          0% { opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes route-loader-stage-in {
          0% { transform: scale(0.6); opacity: 0; }
          30% { transform: scale(1.04); opacity: 1; }
          70% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0; }
        }
        @keyframes route-loader-float {
          0%, 100% { transform: translateY(0); filter: drop-shadow(0 0 18px rgba(192,132,252,0.55)); }
          50% { transform: translateY(-4px); filter: drop-shadow(0 0 28px rgba(192,132,252,0.85)); }
        }
        @keyframes route-loader-ring-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes route-loader-pulse-anim {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes route-loader-bar-anim {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes route-loader-orbit {
          from {
            transform: rotate(0deg) translateX(95px) rotate(0deg);
          }
          to {
            transform: rotate(360deg) translateX(95px) rotate(-360deg);
          }
        }
      `}</style>
    </div>
  );
}
