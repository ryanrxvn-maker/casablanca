'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type VoiceOption = { id: string; name: string; gender?: string | null; language?: string | null };

/**
 * Picker de voz compacto — abre como DROPDOWN ancorado no botao
 * (segue o scroll). Default null = usar voz padrao do avatar.
 *
 * Reusa /api/heygen/voices que ja existe no projeto.
 */
export function CompactVoiceSelector({
  selected,
  setSelected,
}: {
  selected: { id: string; name: string } | null;
  setSelected: (v: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const PANEL_W = 480;
  const PANEL_H = 460;

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
    if (spaceBelow >= 280 || spaceBelow >= spaceAbove) {
      maxH = Math.min(targetH, spaceBelow);
      top = r.bottom + SPACING;
    } else {
      maxH = Math.min(targetH, spaceAbove);
      top = r.top - maxH - SPACING;
    }
    if (top < 12) top = 12;
    let left = r.left + r.width / 2 - width / 2;
    if (left + width > vw - 12) left = vw - width - 12;
    if (left < 12) left = 12;
    setPos({ top, left, width, maxH });
  };

  useLayoutEffect(() => { if (open) computePos(); }, [open]);

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/heygen/voices?q=${encodeURIComponent(query.trim())}&lang=pt`);
        const j = await r.json();
        if (r.ok && Array.isArray(j.voices)) setResults(j.voices);
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          'group flex w-full max-w-[400px] items-center gap-2 rounded-[10px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition hover:border-lime hover:bg-lime/5 ' +
          (selected ? 'border-lime/40 ' : '') +
          (open ? 'border-lime' : '')
        }
        title={selected?.name ?? 'Voz padrao do avatar'}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg text-[10px] font-bold text-text-muted">
          🎤
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">
            {selected ? selected.name : <span className="text-text-muted">Voz padrao do avatar</span>}
          </div>
          {!selected ? (
            <div className="mono text-[8px] uppercase tracking-widest text-text-muted">
              click pra escolher voz custom
            </div>
          ) : null}
        </div>
        <span className="mono shrink-0 rounded-full border border-line-strong px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-text-muted group-hover:border-lime group-hover:text-lime">
          {open ? 'Fechar' : 'Trocar'}
        </span>
      </button>

      {open && pos ? (
        <div
          ref={popRef}
          className="fixed z-[60] overflow-hidden rounded-[14px] border border-lime/40 bg-bg shadow-[0_12px_40px_-6px_rgba(0,0,0,0.6),0_0_28px_-12px_rgba(200,255,0,0.4)]"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
        >
          <div className="flex items-center justify-between border-b border-line/40 bg-bg-soft/40 px-3 py-2">
            <h3 className="mono text-[10px] uppercase tracking-widest text-lime">Escolher voz custom</h3>
            <div className="flex items-center gap-1.5">
              {selected ? (
                <button
                  type="button"
                  onClick={() => { setSelected(null); setOpen(false); }}
                  className="rounded-md border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                >
                  Voltar pra padrao
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
          <div className="p-3 overflow-y-auto" style={{ maxHeight: pos.maxH - 44 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar voz HeyGen (pt-BR)..."
              className="input-field"
              autoFocus
            />
            {loading ? (
              <div className="mt-2 text-[11px] text-lime">Buscando...</div>
            ) : null}
            <div className="mt-3 grid gap-1">
              {results.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { setSelected({ id: v.id, name: v.name }); setOpen(false); }}
                  className={
                    'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ' +
                    (selected?.id === v.id ? 'border-lime bg-lime/10' : 'border-line bg-bg-soft/40 hover:border-lime/60')
                  }
                >
                  <span>
                    <span className="text-white">{v.name}</span>
                    {v.gender ? <span className="ml-2 mono text-[10px] uppercase text-text-muted">· {v.gender}</span> : null}
                  </span>
                  {v.language ? <span className="mono text-[10px] uppercase text-text-muted">{v.language}</span> : null}
                </button>
              ))}
              {!loading && results.length === 0 && query ? (
                <div className="text-[11px] text-text-muted">Nenhuma voz encontrada pra &quot;{query}&quot;.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
