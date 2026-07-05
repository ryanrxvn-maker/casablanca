'use client';

/**
 * FakePass — SELETOR DE EMOJI premium (todos os Apple, com busca e categorias).
 * Carrega a lista completa do emoji-datasource-apple pelo CDN (lazy + cache) e
 * mostra as imagens Apple. Fallback offline pra não quebrar nunca. Devolve o
 * caractere do emoji escolhido — o resto do app renderiza via emojify (Apple).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

const CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple';

export type Emo = { e: string; n: string; k: string; c: string; img: string };

const CATS: { id: string; label: string; icon: string }[] = [
  { id: 'Smileys & Emotion', label: 'Rostos', icon: '😀' },
  { id: 'People & Body', label: 'Pessoas', icon: '👋' },
  { id: 'Animals & Nature', label: 'Natureza', icon: '🐶' },
  { id: 'Food & Drink', label: 'Comida', icon: '🍔' },
  { id: 'Activities', label: 'Atividades', icon: '⚽' },
  { id: 'Travel & Places', label: 'Viagem', icon: '✈️' },
  { id: 'Objects', label: 'Objetos', icon: '💡' },
  { id: 'Symbols', label: 'Símbolos', icon: '❤️' },
  { id: 'Flags', label: 'Bandeiras', icon: '🏳️' },
];

const FALLBACK: Emo[] = [
  ['😀', '1f600.png'], ['😁', '1f601.png'], ['😂', '1f602.png'], ['🤣', '1f923.png'], ['😊', '1f60a.png'],
  ['😍', '1f60d.png'], ['🥰', '1f970.png'], ['😘', '1f618.png'], ['😎', '1f60e.png'], ['🤩', '1f929.png'],
  ['😅', '1f605.png'], ['😭', '1f62d.png'], ['😱', '1f631.png'], ['😡', '1f621.png'], ['🥵', '1f975.png'],
  ['🥺', '1f97a.png'], ['🤔', '1f914.png'], ['😴', '1f634.png'], ['🤯', '1f92f.png'], ['🥳', '1f973.png'],
  ['❤️', '2764-fe0f.png'], ['🧡', '1f9e1.png'], ['💛', '1f49b.png'], ['💚', '1f49a.png'], ['💙', '1f499.png'],
  ['💜', '1f49c.png'], ['🖤', '1f5a4.png'], ['💔', '1f494.png'], ['💯', '1f4af.png'], ['🔥', '1f525.png'],
  ['⭐', '2b50.png'], ['✨', '2728.png'], ['🎉', '1f389.png'], ['👏', '1f44f.png'], ['🙌', '1f64c.png'],
  ['👍', '1f44d.png'], ['👎', '1f44e.png'], ['🙏', '1f64f.png'], ['💪', '1f4aa.png'], ['👀', '1f440.png'],
].map(([e, img]) => ({ e, img, n: '', k: '', c: 'Smileys & Emotion' }));

let cache: Promise<Emo[]> | null = null;
function loadEmojis(): Promise<Emo[]> {
  if (cache) return cache;
  cache = fetch(`${CDN}/emoji.json`)
    .then((r) => r.json())
    .then((raw: any[]) =>
      raw
        .filter((x) => x && x.image && x.has_img_apple !== false)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((x) => ({
          e: String(x.unified)
            .split('-')
            .map((h: string) => String.fromCodePoint(parseInt(h, 16)))
            .join(''),
          n: String(x.name || '').toLowerCase(),
          k: [...(x.short_names || []), ...(x.texts || [])].join(' ').toLowerCase(),
          c: x.category || 'Symbols',
          img: x.image,
        })),
    )
    .catch(() => FALLBACK);
  return cache;
}

function EmoImg({ img, size = 26 }: { img: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${CDN}/img/apple/64/${img}`} alt="" width={size} height={size} loading="lazy" style={{ display: 'block' }} />
  );
}

/* ─────────────────────────── Popover ─────────────────────────── */

function Popover({ onPick, onClose, align = 'left' }: { onPick: (e: string) => void; onClose: () => void; align?: 'left' | 'right' }) {
  const [all, setAll] = useState<Emo[] | null>(null);
  const [cat, setCat] = useState('Smileys & Emotion');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    loadEmojis().then((list) => {
      if (alive) setAll(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    if (!all) return [];
    const query = q.trim().toLowerCase();
    if (query) {
      return all.filter((x) => x.e === query || x.n.includes(query) || x.k.includes(query)).slice(0, 160);
    }
    return all.filter((x) => x.c === cat);
  }, [all, cat, q]);

  return (
    <div
      className="absolute z-50 mt-2 w-[320px] rounded-[16px] border border-line-strong bg-[#141317] p-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)]"
      style={align === 'right' ? { right: 0, top: '100%' } : { left: 0, top: '100%' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-black/30 px-2.5 py-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar emoji…"
            className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-text-dim"
          />
        </div>
        <button type="button" onClick={onClose} className="rounded-[9px] border border-line-strong px-2 py-1.5 text-text-muted hover:text-white" aria-label="Fechar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      {!q ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              title={c.label}
              className={'flex h-7 w-7 items-center justify-center rounded-[8px] border text-[15px] transition ' + (cat === c.id ? 'border-violet/70 bg-violet/15' : 'border-transparent hover:border-line-strong')}
            >
              {c.icon}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-[240px] overflow-y-auto">
        {all === null ? (
          <p className="py-8 text-center text-[12px] text-text-dim">Carregando emojis…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-text-dim">Nenhum emoji encontrado.</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {list.map((em, i) => (
              <button
                key={em.img + i}
                type="button"
                onClick={() => onPick(em.e)}
                title={em.n}
                className="flex h-8 items-center justify-center rounded-[7px] transition hover:bg-white/10"
              >
                <EmoImg img={em.img} size={24} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Botão que abre o picker ─────────────── */

export function EmojiPickerButton({
  onPick,
  children,
  className,
  align = 'left',
}: {
  onPick: (e: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrap} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className={className}>
        {children}
      </button>
      {open ? (
        <Popover
          align={align}
          onPick={(e) => {
            onPick(e);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
