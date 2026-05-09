'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Botao flutuante 3D pra Mind Ads Suite. Olho lime que segue o cursor.
 *
 * Acesso:
 *  - Admin: clica e vai pra /tools/mind-ads
 *  - Cliente: ve o botao com cadeado, mensagem "em breve"
 *
 * O olho rastreia o mouse com 3D parallax — pupila se move dentro da
 * iris, gradiente lime. Apareceu so em rotas /tools/* (nao no admin).
 */
export function MindAdsButton() {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pupilRef = useRef<SVGGElement | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setIsAdmin(false);
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const c = containerRef.current;
      const p = pupilRef.current;
      if (!c || !p) return;
      const rect = c.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const max = 6;
      const scale = Math.min(1, max / Math.max(1, dist));
      const px = (dx * scale * max) / max;
      const py = (dy * scale * max) / max;
      p.setAttribute('transform', `translate(${px}, ${py})`);
    }
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // So mostra em /tools/* e fora do proprio /tools/mind-ads
  if (!pathname?.startsWith('/tools/')) return null;
  if (pathname.startsWith('/tools/mind-ads')) return null;
  if (isAdmin === null) return null;

  const locked = !isAdmin;
  const href = locked ? '#' : '/tools/mind-ads';

  return (
    <Link
      href={href}
      onClick={(e) => {
        if (locked) e.preventDefault();
      }}
      title={
        locked
          ? 'Mind Ads Suite — em breve para usuarios'
          : 'Mind Ads Suite'
      }
      className="group fixed bottom-6 right-6 z-40 hidden md:block"
      aria-label="Mind Ads Suite"
    >
      <div
        ref={containerRef}
        className={
          'relative h-20 w-20 rounded-full border bg-bg-soft/90 p-0.5 backdrop-blur-md transition-all duration-300 ' +
          (locked
            ? 'border-yellow-500/50 shadow-[0_0_28px_-6px_rgba(250,204,21,0.55)] hover:scale-[1.06] hover:shadow-[0_0_36px_-4px_rgba(250,204,21,0.75)]'
            : 'border-lime/60 shadow-[0_0_28px_-6px_rgba(200,255,0,0.6)] hover:scale-[1.08] hover:shadow-[0_0_44px_-4px_rgba(200,255,0,0.85)]')
        }
        style={{
          background:
            'radial-gradient(ellipse at 30% 30%, rgba(200,255,0,0.18), rgba(10,10,10,0.95))',
        }}
      >
        <svg
          viewBox="0 0 80 80"
          className="h-full w-full"
          aria-hidden
        >
          {/* Iris ring lime */}
          <defs>
            <radialGradient id="mindads-iris" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#eaff00" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#3b6000" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="40" cy="40" r="32" fill="url(#mindads-iris)" />
          <circle
            cx="40"
            cy="40"
            r="22"
            fill="none"
            stroke="rgba(200,255,0,0.55)"
            strokeWidth="1.5"
          />
          {/* Pupila se move com mouse */}
          <g ref={pupilRef}>
            <circle cx="40" cy="40" r="9" fill="#0a0a0a" />
            <circle
              cx="40"
              cy="40"
              r="9"
              fill="none"
              stroke="rgba(200,255,0,0.85)"
              strokeWidth="0.8"
            />
            <circle cx="42" cy="38" r="2.4" fill="#eaff00" />
          </g>
        </svg>

        {locked ? (
          <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-yellow-500/60 bg-bg-soft shadow-[0_0_8px_rgba(250,204,21,0.55)]">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M3 5V3.5a3 3 0 016 0V5M2.5 5h7v5h-7z"
                stroke="rgb(250,204,21)"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : null}
      </div>

      {/* Tooltip lateral */}
      <div className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[10px] border border-line bg-bg-soft/95 px-3 py-2 text-[11px] uppercase tracking-widest text-white opacity-0 shadow-2xl backdrop-blur-md transition-all duration-200 group-hover:-translate-x-1 group-hover:opacity-100">
        <div className="flex items-center gap-2">
          <span
            className={
              locked
                ? 'mono text-yellow-300'
                : 'mono text-lime'
            }
          >
            {locked ? 'EM BREVE' : 'MIND ADS'}
          </span>
          <span className="text-text-muted">
            {locked ? 'beta admin' : 'a megazord'}
          </span>
        </div>
      </div>
    </Link>
  );
}
