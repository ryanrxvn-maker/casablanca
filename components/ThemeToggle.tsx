'use client';

import { useEffect, useState } from 'react';

/**
 * ThemeToggle — botão 3D que vira uma "moeda" entre LUA (modo escuro) e
 * SOL (modo claro). Só muda o visual: seta `data-theme` no <html> e salva
 * em localStorage. Não toca em nada do funcionamento.
 *
 * O modo é aplicado ANTES da pintura por um script inline no layout
 * (anti-flash). Aqui só sincronizamos o estado do botão.
 */
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        fill="currentColor"
      />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <path d="M12 2.6v2.3M12 19.1v2.3M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.6 12h2.3M19.1 12h2.3M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let t: 'dark' | 'light' = 'dark';
    try {
      if (localStorage.getItem('theme') === 'light') t = 'light';
    } catch {}
    setTheme(t);
    // espera 1 frame pra ativar a transição (evita flip animado no load)
    requestAnimationFrame(() => setReady(true));
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {}
    const el = document.documentElement;
    if (next === 'light') el.setAttribute('data-theme', 'light');
    else el.removeAttribute('data-theme');
  };

  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Ativar modo escuro' : 'Ativar modo claro'}
      title={isLight ? 'Modo escuro' : 'Modo claro'}
      className={'theme-toggle' + (ready ? ' ready' : '')}
      data-light={isLight}
    >
      <span className="tt-stage">
        <span className="tt-coin">
          <span className="tt-face tt-moon">
            <MoonIcon />
          </span>
          <span className="tt-face tt-sun">
            <SunIcon />
          </span>
        </span>
      </span>

      <style jsx>{`
        .theme-toggle {
          position: relative;
          height: 34px;
          width: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 11px;
          border: 1px solid rgb(var(--line-strong));
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.16)),
            rgb(var(--bg-soft));
          color: rgb(var(--text));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 4px 12px -6px rgba(0, 0, 0, 0.5);
          transition:
            transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
            border-color 0.3s ease,
            box-shadow 0.3s ease;
          overflow: hidden;
        }
        .theme-toggle:hover {
          transform: translateY(-1px);
          border-color: rgb(var(--violet));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.09),
            0 7px 18px -7px rgba(167, 139, 250, 0.55);
        }
        .theme-toggle:active {
          transform: translateY(0) scale(0.95);
        }
        .theme-toggle::after {
          content: '';
          position: absolute;
          inset: -45%;
          background: radial-gradient(
            circle at 50% 50%,
            rgba(167, 139, 250, 0.18),
            transparent 60%
          );
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
        }
        .theme-toggle:hover::after {
          opacity: 1;
        }
        .tt-stage {
          perspective: 220px;
          display: inline-flex;
        }
        .tt-coin {
          position: relative;
          width: 16px;
          height: 16px;
          transform-style: preserve-3d;
        }
        .theme-toggle.ready .tt-coin {
          transition: transform 0.55s cubic-bezier(0.6, 0.1, 0.2, 1);
        }
        .theme-toggle[data-light='true'] .tt-coin {
          transform: rotateY(180deg);
        }
        .tt-face {
          position: absolute;
          inset: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .tt-moon {
          color: #c9b8ff;
          transform: rotateY(0deg);
        }
        .tt-sun {
          color: #f5b73a;
          transform: rotateY(180deg);
        }
      `}</style>
    </button>
  );
}
