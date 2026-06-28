'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type VoiceOption = { id: string; name: string; gender?: string | null; language?: string | null; custom?: boolean };

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
  const [allVoices, setAllVoices] = useState<VoiceOption[]>([]);
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

  // Carrega as vozes da CONTA ATIVA (sessão), 1x ao abrir. Custom (@username/
  // clones) vêm da biblioteca de avatares (look.voiceId/voiceName); stock vem
  // de /v1/voice.list pela sessão. NUNCA do /api/heygen/voices (API key fixa =
  // conta errada quando o user troca de conta no HeyGen). Filtro é client-side.
  useEffect(() => {
    if (!open || allVoices.length > 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const list: VoiceOption[] = [];
      const seen = new Set<string>();
      // 1) CUSTOM (conta ativa) — vozes anexadas aos avatares da biblioteca
      try {
        const { getLibrarySnapshot, reloadLibrary } = await import('@/lib/heygen-library-cache');
        let snap = getLibrarySnapshot();
        if (!snap.groups.length) { await reloadLibrary(false); snap = getLibrarySnapshot(); }
        for (const g of snap.groups) {
          for (const l of g.looks) {
            const vid = (l as any).voiceId as string | undefined;
            const vn = (l as any).voiceName as string | undefined;
            if (vid && vn && !seen.has(vid)) { seen.add(vid); list.push({ id: vid, name: vn, custom: true }); }
          }
        }
      } catch {}
      // 2) STOCK (conta ativa) — catálogo HeyGen via sessão
      try {
        const { listStockVoices } = await import('@/lib/heygen-api-direct');
        for (const v of await listStockVoices()) {
          if (!seen.has(v.id)) { seen.add(v.id); list.push({ id: v.id, name: v.name, gender: v.gender, language: v.language }); }
        }
      } catch {}
      if (!cancelled) { setAllVoices(list); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, allVoices.length]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? allVoices.filter((v) => v.name.toLowerCase().includes(q)) : allVoices;
    return base.slice(0, 120);
  }, [query, allVoices]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          'group flex w-full max-w-[400px] items-center gap-2 rounded-[12px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition-all duration-300 hover:border-lime hover:bg-lime/5 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_-12px_rgba(200,232,124,0.5)] ' +
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
            <div className="label-tech text-[8px] tracking-[0.16em] text-text-muted">
              click pra escolher voz custom
            </div>
          ) : null}
        </div>
        <span className="label-tech shrink-0 rounded-full border border-line-strong bg-bg-soft/50 px-2 py-0.5 text-[8px] tracking-[0.16em] text-text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all group-hover:border-lime group-hover:text-lime group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_16px_-6px_rgba(200,232,124,0.6)]">
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
            <h3 className="label-tech text-[10px] tracking-[0.18em] text-lime">Escolher voz custom</h3>
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
              placeholder="Buscar voz da sua conta HeyGen ativa..."
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
                    {v.custom ? <span className="ml-2 mono text-[9px] uppercase tracking-widest text-lime">· sua voz</span> : null}
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
        </div>,
        document.body,
      ) : null}
    </>
  );
}
