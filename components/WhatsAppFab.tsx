'use client';

import { useEffect, useState } from 'react';

const WA_LINK = 'https://wa.me/5534991262437';

/**
 * Floating Action Button do WhatsApp.
 *
 * Visual: pílula com gradient verde-WhatsApp + sombra violet pra casar com
 * a identidade do site. Tooltip "Fale com a gente" aparece no hover.
 * Pulso sutil de respiração quando ocioso.
 *
 * Aparece em todas as páginas (importado no layout root).
 */
export function WhatsAppFab() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Evita flash no SSR
    const t = setTimeout(() => setMounted(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <a
      href={WA_LINK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Fale no WhatsApp"
      className={
        'wa-fab fixed bottom-5 right-5 z-[55] group flex items-center gap-2 select-none ' +
        (mounted ? 'wa-fab-in' : 'opacity-0')
      }
    >
      {/* Tooltip */}
      <span
        className="wa-tip pointer-events-none absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[10px] border border-line bg-bg-soft/95 px-3 py-1.5 text-[11.5px] font-semibold text-white opacity-0 backdrop-blur-md transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
        style={{
          fontFamily: 'var(--font-tech)',
          letterSpacing: '0.04em',
          transform: 'translateX(6px) translateY(-50%)',
          boxShadow: '0 8px 24px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        Fale com a gente
      </span>

      {/* Botão */}
      <span
        className="wa-pill relative flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 group-hover:scale-[1.06] group-active:scale-[0.96]"
        style={{
          background:
            'linear-gradient(135deg, #25d366 0%, #128c7e 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 28px -8px rgba(37,211,102,0.55), 0 0 0 1px rgba(167,139,250,0.15), 0 0 28px -6px rgba(167,139,250,0.4)',
        }}
      >
        {/* Pulso de respiração */}
        <span
          aria-hidden
          className="wa-pulse absolute inset-0 rounded-full"
          style={{
            border: '2px solid rgba(37,211,102,0.55)',
          }}
        />
        {/* Glow violet */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(60% 60% at 50% 50%, rgba(167,139,250,0.4), transparent 70%)',
          }}
        />

        {/* Ícone WhatsApp */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="white"
          aria-hidden="true"
          className="relative z-10 transition-transform duration-300 group-hover:rotate-[-8deg]"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))' }}
        >
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.16 1.6 5.96L2 22l4.27-1.12a9.9 9.9 0 004.77 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0012.04 2zm0 18.15h-.01a8.21 8.21 0 01-4.18-1.14l-.3-.18-3.1.81.83-3.02-.2-.31a8.18 8.18 0 01-1.25-4.4c0-4.54 3.69-8.23 8.23-8.23 2.2 0 4.27.86 5.82 2.41a8.16 8.16 0 012.41 5.82c0 4.54-3.69 8.24-8.25 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.16.25-.65.81-.79.97-.15.17-.29.18-.54.06a6.74 6.74 0 01-1.98-1.22 7.45 7.45 0 01-1.37-1.71c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.84-.86 2.04 0 1.2.88 2.37 1 2.53.12.17 1.74 2.65 4.2 3.72.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.1-.22-.16-.47-.28z" />
        </svg>
      </span>

      <style jsx>{`
        .wa-fab-in {
          animation: wa-pop 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes wa-pop {
          0% { opacity: 0; transform: translateY(20px) scale(0.7); }
          60% { opacity: 1; transform: translateY(-4px) scale(1.05); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .wa-pulse {
          animation: wa-breath 2.6s ease-in-out infinite;
        }
        @keyframes wa-breath {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0; transform: scale(1.35); }
        }
      `}</style>
    </a>
  );
}
