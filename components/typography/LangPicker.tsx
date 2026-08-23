'use client';

/**
 * Seletor de idioma da fala — EXTRAÍDO de app/tools/tipografia/page.tsx
 * (22.08.2026). Mesmos props, mesmo visual, mesma lista de idiomas do
 * Whisper. O Auto Cortes reusa daqui.
 */

import { useCallback, useRef, useState } from 'react';
import { Popover } from '@/components/Popover';

export type Language = string; // ISO-639-1 ('pt', 'en'...) ou 'auto'

// botões com relevo 3D (hover levanta, clique afunda)
const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

// idiomas do Whisper (Groq) — os mais usados primeiro, resto alfabético
export const LANGS: Array<{ code: string; label: string }> = [
  { code: 'pt-br', label: 'Português (Brasil)' },
  { code: 'pt', label: 'Português (Portugal)' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'pl', label: 'Polonês' },
  { code: 'cs', label: 'Tcheco' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ar', label: 'Árabe' },
  { code: 'bg', label: 'Búlgaro' },
  { code: 'zh', label: 'Chinês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'hr', label: 'Croata' },
  { code: 'da', label: 'Dinamarquês' },
  { code: 'sk', label: 'Eslovaco' },
  { code: 'sl', label: 'Esloveno' },
  { code: 'fi', label: 'Finlandês' },
  { code: 'el', label: 'Grego' },
  { code: 'he', label: 'Hebraico' },
  { code: 'hi', label: 'Hindi' },
  { code: 'nl', label: 'Holandês' },
  { code: 'hu', label: 'Húngaro' },
  { code: 'id', label: 'Indonésio' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ms', label: 'Malaio' },
  { code: 'no', label: 'Norueguês' },
  { code: 'ro', label: 'Romeno' },
  { code: 'ru', label: 'Russo' },
  { code: 'sr', label: 'Sérvio' },
  { code: 'sv', label: 'Sueco' },
  { code: 'th', label: 'Tailandês' },
  { code: 'tl', label: 'Tagalo (Filipinas)' },
  { code: 'tr', label: 'Turco' },
  { code: 'uk', label: 'Ucraniano' },
  { code: 'ur', label: 'Urdu' },
  { code: 'vi', label: 'Vietnamita' },
];

export function langLabel(code: Language): string {
  if (code === 'auto') return 'Identificar automaticamente';
  return LANGS.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

export function LangPicker({
  value,
  onChange,
  disabled,
}: {
  value: Language;
  onChange: (v: Language) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // menu por PORTAL (components/Popover): o card do passo tem overflow-hidden
  // E ganha transform no hover — os dois cortam/deslocam popover ancorado
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const list = q.trim()
    ? LANGS.filter((l) => l.label.toLowerCase().includes(q.trim().toLowerCase()))
    : LANGS;
  return (
    <div className="inline-block">
      <div
        className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Idioma da fala
      </div>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={
          'flex min-w-[260px] items-center justify-between gap-3 rounded-[12px] border border-line bg-bg-soft px-3.5 py-2.5 text-[13px] font-semibold text-text hover:border-amber-400/50' +
          T3D
        }
      >
        <span className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-text-muted" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M3.5 12h17M12 3.2c2.6 2.4 3.9 5.4 3.9 8.8s-1.3 6.4-3.9 8.8c-2.6-2.4-3.9-5.4-3.9-8.8S9.4 5.6 12 3.2z" />
          </svg>
          {langLabel(value)}
        </span>
        <span className="text-text-muted">▾</span>
      </button>
      <Popover open={open} anchorRef={btnRef} onClose={closeMenu} width={300}>
        <div className="overflow-hidden rounded-[14px] border border-line-strong bg-bg-elev shadow-2xl">
          <button
            onClick={() => {
              onChange('auto');
              setOpen(false);
            }}
            className={
              'flex w-full items-center gap-2 border-b border-line px-3.5 py-2.5 text-left text-[12.5px] font-bold transition-colors ' +
              (value === 'auto'
                ? 'bg-amber-400/15 text-amber-600'
                : 'text-text hover:bg-black/5')
            }
          >
            ✨ Identificar automaticamente
          </button>
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar idioma..."
              className="w-full rounded-[9px] border border-line bg-bg px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-amber-400/50"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {list.map((l) => (
              <button
                key={l.code}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                  setQ('');
                }}
                className={
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-[12.5px] font-semibold transition-colors ' +
                  (value === l.code
                    ? 'bg-amber-400/15 text-amber-600'
                    : 'text-text-muted hover:bg-black/5 hover:text-text')
                }
              >
                {l.label}
                <span className="mono text-[10px] uppercase opacity-50">{l.code}</span>
              </button>
            ))}
            {list.length === 0 ? (
              <div className="px-3.5 py-3 text-[12px] text-text-muted">
                Nenhum idioma com esse nome.
              </div>
            ) : null}
          </div>
        </div>
      </Popover>
    </div>
  );
}
