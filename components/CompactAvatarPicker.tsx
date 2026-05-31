'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HeyGenAvatarPicker, type AvatarOption } from './HeyGenAvatarPicker';

/**
 * Picker compacto pra usar inline em listas (modo dinamico).
 *
 * Abre como DROPDOWN ancorado no botao trigger (NAO modal central).
 * Posicao calculada com getBoundingClientRect — se nao couber abaixo,
 * abre acima. Assim "segue o scroll" do user, aparecendo perto de onde
 * ele clicou independente de quao baixo na pagina ele estava.
 */
export function CompactAvatarPicker({
  selected,
  setSelected,
  fallback,
  disabled,
  label,
}: {
  selected: AvatarOption | null;
  setSelected: (a: AvatarOption | null) => void;
  /** Mostrado quando selected=null (ex: avatar global) */
  fallback?: AvatarOption | null;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; placement: 'below' | 'above' } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const display = selected ?? fallback ?? null;

  const PANEL_W = 720;  // largura desejada
  const PANEL_H = 540;  // altura desejada

  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PANEL_W, vw - 24);
    const SPACING = 8;
    const spaceBelow = vh - r.bottom - SPACING;
    const spaceAbove = r.top - SPACING;
    const targetH = Math.min(PANEL_H, vh - 40);
    let top: number;
    let maxH: number;
    let placement: 'below' | 'above';
    if (spaceBelow >= 320 || spaceBelow >= spaceAbove) {
      placement = 'below';
      maxH = Math.min(targetH, spaceBelow);
      top = r.bottom + SPACING;
    } else {
      placement = 'above';
      maxH = Math.min(targetH, spaceAbove);
      top = r.top - maxH - SPACING;
    }
    if (top < 12) top = 12;
    let left = r.left + r.width / 2 - width / 2;
    if (left + width > vw - 12) left = vw - width - 12;
    if (left < 12) left = 12;
    setPos({ top, left, width, maxH, placement });
  };

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => computePos();
    const onResize = () => computePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Fecha em click fora
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Atraso pra nao fechar imediato no proprio click que abriu
    const id = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={
          'group flex w-full items-center gap-2 rounded-[10px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition hover:border-lime hover:bg-lime/5 disabled:opacity-50 ' +
          (selected ? 'border-lime/40 ' : '') +
          (open ? 'border-lime' : '')
        }
        title={display?.name ?? 'Escolher avatar'}
      >
        {display?.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={display.thumb}
            alt={display.name}
            className="h-7 w-7 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg text-[10px] font-bold text-text-muted">
            {display?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">
            {display?.name ?? <span className="text-text-muted">Sem avatar</span>}
          </div>
          {selected ? null : (
            <div className="mono text-[8px] uppercase tracking-widest text-text-muted">
              padrao (global)
            </div>
          )}
        </div>
        <span className="mono shrink-0 rounded-full border border-line-strong px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-text-muted group-hover:border-lime group-hover:text-lime">
          {open ? 'Fechar' : 'Trocar'}
        </span>
      </button>

      {open && pos && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popRef}
          className="fixed z-[120] overflow-hidden rounded-[14px] border border-lime/40 bg-bg shadow-[0_12px_40px_-6px_rgba(0,0,0,0.6),0_0_28px_-12px_rgba(200,232,124,0.4)]"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
        >
          <div className="flex items-center justify-between border-b border-line/40 bg-bg-soft/40 px-3 py-2">
            <h3 className="mono text-[10px] uppercase tracking-widest text-lime">
              {label ?? 'Escolher avatar'}
            </h3>
            <div className="flex items-center gap-1.5">
              {selected ? (
                <button
                  type="button"
                  onClick={() => { setSelected(null); setOpen(false); }}
                  className="rounded-md border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                >
                  Voltar pro padrao
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="overflow-y-auto p-3" style={{ maxHeight: pos.maxH - 44 }}>
            <HeyGenAvatarPicker
              query={query}
              setQuery={setQuery}
              selected={selected}
              setSelected={(a) => { setSelected(a); setOpen(false); }}
              disabled={false}
              label="Biblioteca"
              inlineMode
            />
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
