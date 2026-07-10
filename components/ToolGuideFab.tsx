'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { GUIDE_PATHS } from '@/components/tool-guides/routes';

/**
 * FAB 3D "Como usar" — flutua acima do WhatsAppFab em toda ferramenta que
 * tem guia registrado. Abre o card flutuante com o passo a passo visual.
 *
 * O conteúdo dos guias (GuidePanel + guides.tsx) é lazy: só entra no bundle
 * quando o usuário clica.
 */
const GuidePanel = dynamic(
  () => import('@/components/tool-guides/GuidePanel').then((m) => m.GuidePanel),
  { ssr: false },
);

export function ToolGuideFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Fecha ao trocar de ferramenta.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!pathname || !GUIDE_PATHS.has(pathname)) return null;

  return (
    <>
      <div
        className={
          'guide-fab fixed bottom-[168px] right-6 z-[54] flex flex-col items-center gap-2 transition-opacity duration-500 ' +
          (mounted ? 'opacity-100' : 'opacity-0')
        }
      >
        <button
          type="button"
          className="guide-fab__btn group"
          aria-label="Como usar esta ferramenta"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {/* Livro aberto */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 6.4C10.7 5.1 8.9 4.5 6.9 4.5c-1.1 0-2.2.2-3.1.6v13.1c.9-.4 2-.6 3.1-.6 2 0 3.8.6 5.1 1.9 1.3-1.3 3.1-1.9 5.1-1.9 1.1 0 2.2.2 3.1.6V5.1c-.9-.4-2-.6-3.1-.6-2 0-3.8.6-5.1 1.9Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path
              d="M12 6.4v13.1"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          <span className="guide-fab__dot" aria-hidden>
            ?
          </span>
        </button>

        {/* Lettering premium embaixo do botão */}
        <span className="guide-fab__label" aria-hidden>
          Como usar
        </span>
      </div>

      {open ? <GuidePanel path={pathname} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
