'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DarkoLogo } from './DarkoLogo';

/**
 * RouteLoader — splash de transição entre rotas/ferramentas.
 *
 * Aparece por ~420ms quando o pathname muda. Logo no centro com
 * fade + scale, fundo escuro com blur. Estilo HeyGen.
 *
 * Comportamento:
 *  - Primeira renderização não dispara (evita flash no load inicial).
 *  - Mudanças subsequentes disparam o splash.
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
    const t = setTimeout(() => setShowing(false), 420);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!showing) return null;

  return (
    <div
      aria-hidden
      className="route-loader fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background:
          'radial-gradient(40% 40% at 50% 50%, rgba(167,139,250,0.10), rgba(7,7,8,0.92) 70%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="route-loader-mark">
        <DarkoLogo size={72} />
      </div>
      <style jsx>{`
        .route-loader {
          animation: route-loader-fade 420ms ease both;
        }
        .route-loader-mark {
          animation: route-loader-pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
          filter: drop-shadow(0 0 28px rgba(167, 139, 250, 0.55));
        }
        @keyframes route-loader-fade {
          0% { opacity: 0; }
          25% { opacity: 1; }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes route-loader-pop {
          0% { transform: scale(0.7) rotate(-8deg); opacity: 0; }
          30% { transform: scale(1.05) rotate(0); opacity: 1; }
          70% { transform: scale(1) rotate(0); opacity: 1; }
          100% { transform: scale(0.92) rotate(4deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
