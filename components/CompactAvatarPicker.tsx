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

  const PANEL_W = 760;  // largura desejada
  const PANEL_H = 560;  // altura desejada

  // Posicionamento "flip + shift" (estilo Popper): a biblioteca SEMPRE abre com
  // a altura cheia (maxH) e 100% visivel — nunca encolhe nem aparece cortada,
  // esteja a task no topo, meio ou fim da pagina.
  //  1) cabe inteira ABAIXO do gatilho?  abre abaixo.
  //  2) senao, cabe inteira ACIMA?        abre acima.
  //  3) senao (viewport apertado), escolhe o lado com mais espaco e DESLIZA
  //     (clamp) pra dentro das margens — fica inteira na tela, grid rola dentro.
  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 12;
    const SPACING = 8;
    const width = Math.min(PANEL_W, vw - MARGIN * 2);
    const maxH = Math.min(PANEL_H, vh - MARGIN * 2);

    const fitsBelow = vh - r.bottom - SPACING - MARGIN >= maxH;
    const fitsAbove = r.top - SPACING - MARGIN >= maxH;

    let top: number;
    let placement: 'below' | 'above';
    if (fitsBelow) {
      placement = 'below';
      top = r.bottom + SPACING;
    } else if (fitsAbove) {
      placement = 'above';
      top = r.top - SPACING - maxH;
    } else {
      placement = vh - r.bottom >= r.top ? 'below' : 'above';
      top = placement === 'below' ? r.bottom + SPACING : r.top - SPACING - maxH;
    }
    // clamp vertical — garante 100% dentro das margens em qualquer caso
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - MARGIN - maxH));

    let left = r.left + r.width / 2 - width / 2;
    if (left + width > vw - MARGIN) left = vw - MARGIN - width;
    if (left < MARGIN) left = MARGIN;
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
          'group flex w-full items-center gap-2 rounded-[12px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition-all duration-300 hover:border-lime hover:bg-lime/5 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_-12px_rgba(200,232,124,0.5)] disabled:opacity-50 ' +
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
            <div className="label-tech text-[8px] tracking-[0.16em] text-text-muted">
              padrao (global)
            </div>
          )}
        </div>
        <span className="label-tech shrink-0 rounded-full border border-line-strong bg-bg-soft/50 px-2 py-0.5 text-[8px] tracking-[0.16em] text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all group-hover:border-lime group-hover:text-lime group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_-6px_rgba(200,232,124,0.6)]">
          {open ? 'Fechar' : 'Trocar'}
        </span>
      </button>

      {open && pos && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popRef}
          className="glass-panel fixed z-[120] overflow-hidden rounded-[16px] border border-violet/30 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75),0_0_44px_-16px_rgba(167,139,250,0.5)]"
          // blur menor (6px vs 14px) = abertura/scroll bem mais fluidos; fade
          // PURO (sem scale) evita re-borrar o backdrop a cada frame da abertura.
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH, animation: 'av-fade 0.16s ease', backdropFilter: 'blur(6px) saturate(1.05)', WebkitBackdropFilter: 'blur(6px) saturate(1.05)' }}
        >
          {/* faixa gradiente no topo */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet/70 to-transparent" />
          <div className="flex items-center justify-between border-b border-line/40 bg-gradient-to-r from-violet/[0.08] via-bg-soft/40 to-cyan/[0.05] px-3 py-2.5">
            <div className="flex items-center gap-2">
              {/* mini pilha de avatares */}
              <span className="relative flex h-4 w-6 shrink-0 items-center">
                <span className="absolute left-0 h-4 w-4 rounded-full border border-violet/50 bg-violet/20" />
                <span className="absolute left-2 h-4 w-4 rounded-full border border-lime/50 bg-lime/20" />
              </span>
              <h3
                className="text-[11px] font-extrabold uppercase leading-none text-text"
                style={{ fontFamily: 'var(--font-tech), system-ui', letterSpacing: '0.16em' }}
              >
                {label ?? 'Escolher avatar'}
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              {selected ? (
                <button
                  type="button"
                  onClick={() => { setSelected(null); setOpen(false); }}
                  className="rounded-full border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted transition-all hover:border-red-500/60 hover:text-red-300"
                >
                  Voltar pro padrao
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-line-strong text-text-muted transition-all hover:rotate-90 hover:border-lime hover:text-lime"
                aria-label="Fechar"
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
