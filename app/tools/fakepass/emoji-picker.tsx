'use client';

/**
 * FakePass — SELETOR DE EMOJI.
 *
 *  • estilo iPhone ⇄ Android: vale pro PRINT inteiro (emoji-style.ts), não só aqui;
 *  • busca em português E inglês, sem acento ("coracao", "kkk", "fire");
 *  • tom de pele (✋🏻…✋🏿) aplicado a todo emoji que tem variação;
 *  • recentes, abas por categoria com rolagem contínua, prévia grande do emoji;
 *  • fica aberto pra inserir vários seguidos (Esc / clique fora fecham) e insere
 *    onde está o cursor do campo (useCaretInsert).
 *
 * Dados: emoji.json do emoji-datasource (imagens Apple/Google, categorias, tons)
 * + nomes/palavras-chave em PT do emojibase-data. Tudo lazy e em cache; sem rede,
 * cai numa lista curta embutida. Imagem só das seções perto da área visível.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEmojiSet, setEmojiSet, EMOJI_SET_LABEL, type EmojiSet } from './emoji-style';

const DATASOURCE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/emoji.json';
const PT_NAMES = 'https://cdn.jsdelivr.net/npm/emojibase-data@16/pt/compact.json';
const imgUrl = (set: EmojiSet, file: string) =>
  `https://cdn.jsdelivr.net/npm/emoji-datasource-${set}/img/${set}/64/${file}`;

/* ─────────────────────────── Dados ─────────────────────────── */

type Variant = { e: string; img: string; apple: boolean; google: boolean };
type Item = Variant & { name: string; search: string; cat: string; tones?: Record<string, Variant> };

export const TONES = ['', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'] as const;
type Tone = (typeof TONES)[number];

const CATS: { id: string; label: string }[] = [
  { id: 'Smileys & Emotion', label: 'Carinhas e emoções' },
  { id: 'People & Body', label: 'Pessoas e gestos' },
  { id: 'Animals & Nature', label: 'Animais e natureza' },
  { id: 'Food & Drink', label: 'Comidas e bebidas' },
  { id: 'Activities', label: 'Atividades' },
  { id: 'Travel & Places', label: 'Viagens e lugares' },
  { id: 'Objects', label: 'Objetos' },
  { id: 'Symbols', label: 'Símbolos' },
  { id: 'Flags', label: 'Bandeiras' },
];
const RECENT = '__recent';

const fromUnified = (u: string) =>
  String(u)
    .split('-')
    .map((h) => String.fromCodePoint(parseInt(h, 16)))
    .join('');
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const FALLBACK: Item[] = [
  ['😂', '1f602', 'Rosto chorando de rir'], ['😍', '1f60d', 'Rosto sorridente com olhos de coração'],
  ['🥰', '1f970', 'Rosto sorridente com corações'], ['😅', '1f605', 'Rosto sorridente com suor'],
  ['😭', '1f62d', 'Rosto chorando muito'], ['🥺', '1f97a', 'Rosto suplicante'], ['😱', '1f631', 'Rosto gritando de medo'],
  ['🤔', '1f914', 'Rosto pensativo'], ['🙏', '1f64f', 'Mãos juntas'], ['👏', '1f44f', 'Mãos aplaudindo'],
  ['🙌', '1f64c', 'Mãos para cima'], ['👍', '1f44d', 'Polegar para cima'], ['💪', '1f4aa', 'Bíceps'],
  ['❤️', '2764-fe0f', 'Coração vermelho'], ['🔥', '1f525', 'Fogo'], ['✨', '2728', 'Brilhos'], ['💯', '1f4af', 'Cem pontos'],
  ['🎉', '1f389', 'Confete'], ['👀', '1f440', 'Olhos'], ['🚀', '1f680', 'Foguete'],
].map(([e, u, name]) => ({ e, img: `${u}.png`, apple: true, google: true, name, search: fold(name), cat: 'Smileys & Emotion' }));

let cache: Promise<Item[]> | null = null;
function loadItems(): Promise<Item[]> {
  if (cache) return cache;
  const pt = fetch(PT_NAMES)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []) as Promise<Array<{ hexcode: string; label?: string; tags?: string[] }>>;
  cache = Promise.all([fetch(DATASOURCE).then((r) => r.json()), pt])
    .then(([raw, ptList]: [any[], Array<{ hexcode: string; label?: string; tags?: string[] }>]) => {
      // emojibase guarda o código SEM o VS16 (FE0F) — chaveia igual
      const key = (u: string) => u.toUpperCase().split('-').filter((h) => h !== 'FE0F').join('-');
      const ptBy = new Map<string, { label?: string; tags?: string[] }>();
      for (const p of ptList) if (p && p.hexcode) ptBy.set(key(p.hexcode), p);
      return raw
        .filter((x) => x && x.image && !x.obsoleted_by && x.category !== 'Component' && (x.has_img_apple || x.has_img_google))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((x): Item => {
          const p = ptBy.get(key(x.unified));
          const en = String(x.name || '').toLowerCase();
          const tones: Record<string, Variant> = {};
          for (const [t, v] of Object.entries<any>(x.skin_variations || {})) {
            if (t.includes('-') || !v || !v.image) continue; // só o tom único (sem combinações de 2 pessoas)
            tones[t] = { e: fromUnified(v.unified), img: v.image, apple: v.has_img_apple !== false, google: v.has_img_google !== false };
          }
          return {
            e: fromUnified(x.unified),
            img: x.image,
            apple: x.has_img_apple !== false,
            google: x.has_img_google !== false,
            name: capital(p?.label || en),
            search: fold([p?.label, ...(p?.tags || []), en, ...(x.short_names || [])].filter(Boolean).join(' ')),
            cat: x.category,
            tones: Object.keys(tones).length ? tones : undefined,
          };
        });
    })
    .catch(() => FALLBACK);
  return cache;
}

/** Variante que aparece/entra no texto: com o tom escolhido (se houver no estilo). */
function shown(it: Item, tone: Tone, set: EmojiSet): Variant {
  const v = tone && it.tones?.[tone];
  if (v && v[set]) return v;
  return it;
}

/* ─────────────────────────── Recentes / tom ─────────────────────────── */

const RECENT_KEY = 'fakepass:emojiRecent';
const TONE_KEY = 'fakepass:emojiTone';
const readLS = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    // sem storage: só não lembra
  }
};
function readRecent(): string[] {
  try {
    const v = JSON.parse(readLS(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 32) : [];
  } catch {
    return [];
  }
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function TabIcon({ id }: { id: string }) {
  const p = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case RECENT:
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
    case 'Smileys & Emotion':
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" /></svg>;
    case 'People & Body':
      return <svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case 'Animals & Nature':
      return <svg {...p}><circle cx="7" cy="7" r="2" /><circle cx="17" cy="7" r="2" /><path d="M6 13a6 6 0 0 0 12 0v-1a6 6 0 0 0-12 0z" /><path d="M10 13h.01M14 13h.01" strokeWidth="2.4" /></svg>;
    case 'Food & Drink':
      return <svg {...p}><path d="M4.5 11h15a7.5 7.5 0 0 0-15 0z" /><path d="M4 14.5h16" /><path d="M5 18h14a1 1 0 0 0 1-1v-.5H4v.5a1 1 0 0 0 1 1z" /></svg>;
    case 'Activities':
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5l3.8 2.8-1.4 4.4H9.6L8.2 10.3z" /></svg>;
    case 'Travel & Places':
      return <svg {...p}><path d="M5 16v-4l1.6-4.2A2 2 0 0 1 8.5 6.5h7a2 2 0 0 1 1.9 1.3L19 12v4" /><path d="M4 12h16v4H4z" /><path d="M6.5 19v-3M17.5 19v-3" /></svg>;
    case 'Objects':
      return <svg {...p}><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></svg>;
    case 'Symbols':
      return <svg {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>;
    default:
      return <svg {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></svg>;
  }
}

/* ─────────────────────────── Peças ─────────────────────────── */

function EmojiPic({ set, file, size }: { set: EmojiSet; file: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- PNG do CDN de emoji
    <img src={imgUrl(set, file)} alt="" width={size} height={size} draggable={false} style={{ display: 'block' }} />
  );
}

/** Seção do grid: só pinta as imagens quando chega perto da área visível. */
function Section({
  id,
  title,
  items,
  set,
  tone,
  root,
  onPick,
  onHover,
}: {
  id: string;
  title: string;
  items: Item[];
  set: EmojiSet;
  tone: Tone;
  root: HTMLDivElement | null;
  onPick: (v: Variant, it: Item) => void;
  onHover: (it: Item | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((ents) => ents.some((e) => e.isIntersecting) && setNear(true), {
      root,
      rootMargin: '320px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root, near]);
  return (
    <div ref={ref} data-sec={id}>
      <p className="sticky top-0 z-[1] bg-bg-elev/95 px-1 pb-1.5 pt-2 text-[12px] font-medium text-text-muted backdrop-blur-sm">{title}</p>
      <div className="grid grid-cols-8">
        {items.map((it) => {
          const v = shown(it, tone, set);
          return (
            <button
              key={it.img}
              type="button"
              onClick={() => onPick(v, it)}
              onMouseEnter={() => onHover(it)}
              onFocus={() => onHover(it)}
              aria-label={it.name}
              className="group flex h-9 items-center justify-center rounded-[9px] outline-none transition-colors hover:bg-text/[0.08] focus-visible:bg-text/[0.1]"
            >
              <span className="transition-transform duration-150 group-hover:scale-[1.14]">
                {near ? <EmojiPic set={set} file={v.img} size={26} /> : <span className="block h-[26px] w-[26px]" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Popover ─────────────────────────── */

function Popover({
  onPick,
  onClose,
  align,
  up,
}: {
  onPick: (e: string) => void;
  onClose: () => void;
  align: 'left' | 'right';
  up: boolean;
}) {
  const set = useEmojiSet();
  const [all, setAll] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [tone, setToneState] = useState<Tone>(() => {
    const t = readLS(TONE_KEY) || '';
    return (TONES as readonly string[]).includes(t) ? (t as Tone) : '';
  });
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [active, setActive] = useState<string>(() => (readRecent().length ? RECENT : CATS[0].id));
  const [hover, setHover] = useState<Item | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadItems().then((list) => alive && setAll(list));
    searchRef.current?.focus({ preventScroll: true });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setTone = (t: Tone) => {
    setToneState(t);
    writeLS(TONE_KEY, t);
  };

  const usable = useMemo(() => (all || []).filter((it) => it[set] || it.apple), [all, set]);

  const sections = useMemo(() => {
    const byCat = new Map<string, Item[]>();
    for (const it of usable) {
      const arr = byCat.get(it.cat);
      if (arr) arr.push(it);
      else byCat.set(it.cat, [it]);
    }
    const out: { id: string; title: string; items: Item[] }[] = [];
    if (recent.length && usable.length) {
      // recentes guardam o caractere inserido (com tom): acha o emoji de volta
      const byChar = new Map<string, Item>();
      for (const it of usable) {
        byChar.set(it.e, it);
        if (it.tones) for (const v of Object.values(it.tones)) byChar.set(v.e, { ...it, ...v, tones: undefined });
      }
      const items = recent.map((c) => byChar.get(c)).filter((x): x is Item => !!x);
      if (items.length) out.push({ id: RECENT, title: 'Usados recentemente', items });
    }
    for (const c of CATS) {
      const items = byCat.get(c.id);
      if (items?.length) out.push({ id: c.id, title: c.label, items });
    }
    return out;
  }, [usable, recent]);

  const results = useMemo(() => {
    const query = fold(q.trim());
    if (!query) return null;
    const words = query.split(/\s+/);
    return usable.filter((it) => it.e === q.trim() || words.every((w) => it.search.includes(w))).slice(0, 200);
  }, [usable, q]);

  const pick = useCallback(
    (v: Variant, it: Item) => {
      onPick(v.e);
      setHover(it);
      setRecent((prev) => {
        const next = [v.e, ...prev.filter((x) => x !== v.e)].slice(0, 32);
        writeLS(RECENT_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onPick],
  );

  // aba ativa acompanha a rolagem
  const onScroll = () => {
    if (!scroller || results) return;
    const top = scroller.scrollTop + 8;
    let cur: string | undefined = sections[0]?.id;
    scroller.querySelectorAll<HTMLElement>('[data-sec]').forEach((el) => {
      if (el.offsetTop <= top && el.dataset.sec) cur = el.dataset.sec;
    });
    if (cur && cur !== active) setActive(cur);
  };

  const jump = (id: string) => {
    setQ('');
    setActive(id);
    requestAnimationFrame(() => {
      const el = scroller?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
      if (scroller && el) scroller.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
    });
  };

  const tabs = [...(recent.length ? [{ id: RECENT, label: 'Recentes' }] : []), ...CATS];
  const handSample = all?.find((it) => it.e === '✋') || null;

  return (
    <div
      role="dialog"
      aria-label="Escolher emoji"
      className="absolute z-50 w-[344px] overflow-hidden rounded-[18px] border border-line-strong bg-bg-elev shadow-[0_24px_60px_-16px_rgba(0,0,0,0.8),0_0_0_1px_rgba(0,0,0,0.4)]"
      style={{
        maxWidth: 'calc(100vw - 24px)', // celular: nunca vaza da tela
        ...(align === 'right' ? { right: 0 } : { left: 0 }),
        ...(up ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-[11px] bg-text/[0.06] px-3 ring-1 ring-inset ring-text/[0.06] focus-within:ring-violet/50">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-dim" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results?.[0]) {
                  e.preventDefault();
                  pick(shown(results[0], tone, set), results[0]);
                }
              }}
              placeholder="Buscar: coração, kkk, fogo…"
              className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim"
              // o anel de foco é o da caixa (focus-within); o global de acessibilidade
              // (.ae-refined-controls :focus-visible) desenhava outro por dentro dela
              style={{ outline: 'none' }}
            />
            {q ? (
              <button type="button" onClick={() => setQ('')} className="shrink-0 text-text-dim hover:text-text" aria-label="Limpar busca">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-text-muted transition hover:bg-text/[0.07] hover:text-text"
            aria-label="Fechar"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {/* estilo do emoji — vale pro print inteiro */}
          <div className="flex rounded-[10px] bg-text/[0.06] p-[3px]" role="radiogroup" aria-label="Estilo do emoji">
            {(['apple', 'google'] as EmojiSet[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={set === k}
                onClick={() => setEmojiSet(k)}
                className={
                  'flex h-[26px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition ' +
                  (set === k ? 'bg-text/[0.13] text-text shadow-[0_1px_2px_rgba(0,0,0,0.4)]' : 'text-text-muted hover:text-text')
                }
              >
                <EmojiPic set={k} file="1f600.png" size={15} />
                {EMOJI_SET_LABEL[k]}
              </button>
            ))}
          </div>
          {/* tom de pele */}
          <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Tom de pele">
            {TONES.map((t) => {
              const v = handSample ? shown(handSample, t, set) : null;
              return (
                <button
                  key={t || 'padrao'}
                  type="button"
                  role="radio"
                  aria-checked={tone === t}
                  aria-label={t ? `Tom de pele ${TONES.indexOf(t)}` : 'Tom padrão'}
                  onClick={() => setTone(t)}
                  className={
                    'flex h-[26px] w-[26px] items-center justify-center rounded-full transition ' +
                    (tone === t ? 'bg-text/[0.14] ring-1 ring-violet/60' : 'hover:bg-text/[0.07]')
                  }
                >
                  {v ? <EmojiPic set={set} file={v.img} size={17} /> : <span className="block h-[17px] w-[17px]" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!results ? (
        <div className="flex items-center justify-between border-b border-text/[0.06] px-2.5 pb-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => jump(t.id)}
              title={t.label}
              aria-label={t.label}
              className={
                'relative flex h-8 w-8 items-center justify-center rounded-[9px] transition ' +
                (active === t.id ? 'bg-text/[0.08] text-text' : 'text-text-dim hover:text-text-muted')
              }
            >
              <TabIcon id={t.id} />
            </button>
          ))}
        </div>
      ) : null}

      <div ref={setScroller} onScroll={onScroll} className="relative h-[268px] overflow-y-auto overscroll-contain px-2.5 pb-2">
        {all === null ? (
          <div className="flex h-full items-center justify-center text-[12px] text-text-dim">Carregando emojis…</div>
        ) : results ? (
          results.length ? (
            <Section id="busca" title={`${results.length} resultado${results.length > 1 ? 's' : ''}`} items={results} set={set} tone={tone} root={scroller} onPick={pick} onHover={setHover} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="text-[13px] text-text-muted">Nada encontrado pra “{q.trim()}”</p>
              <p className="text-[12px] text-text-dim">Tente outra palavra, em português ou inglês.</p>
            </div>
          )
        ) : (
          sections.map((s) => (
            <Section key={s.id} id={s.id} title={s.title} items={s.items} set={set} tone={tone} root={scroller} onPick={pick} onHover={setHover} />
          ))
        )}
      </div>

      <div className="flex h-12 items-center gap-2.5 border-t border-text/[0.06] px-3.5">
        {hover ? (
          <>
            <EmojiPic set={set} file={shown(hover, tone, set).img} size={28} />
            <span className="min-w-0 truncate text-[12.5px] text-text">{hover.name}</span>
          </>
        ) : (
          <span className="text-[12px] text-text-dim">Clique pra inserir — dá pra escolher vários seguidos.</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Botão que abre o seletor ─────────────── */

export function EmojiPickerButton({
  onPick,
  children,
  className,
  align = 'left',
  closeOnPick = false,
}: {
  onPick: (e: string) => void;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  /** escolha única (ex.: o emoji do slider): fecha depois do clique */
  closeOnPick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = () => {
    if (!open && wrap.current) {
      // sem espaço embaixo (campo no fim da tela) → abre pra cima
      const r = wrap.current.getBoundingClientRect();
      setUp(window.innerHeight - r.bottom < 460 && r.top > window.innerHeight - r.bottom);
    }
    setOpen((v) => !v);
  };
  const close = useCallback(() => setOpen(false), []);

  return (
    <div ref={wrap} className="relative inline-block">
      <button type="button" onClick={toggle} className={className} aria-label="Inserir emoji" aria-expanded={open}>
        {children}
      </button>
      {open ? (
        <Popover
          align={align}
          up={up}
          onPick={(e) => {
            onPick(e);
            if (closeOnPick) setOpen(false);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/* ─────────────── Inserir onde está o cursor ─────────────── */

/**
 * Liga um campo de texto ao seletor: guarda a posição do cursor (onSelect) e
 * insere o emoji ALI — não só no fim. Escolhas seguidas entram em sequência,
 * e o limite de caracteres do campo é respeitado.
 */
export function useCaretInsert(value: string, onChange: (v: string) => void, maxLength?: number) {
  const caret = useRef<[number, number] | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const track = useCallback((el: HTMLInputElement | HTMLTextAreaElement) => {
    caret.current = [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length];
  }, []);
  const insert = useCallback(
    (emo: string) => {
      const v = latest.current;
      const [a, b] = caret.current ?? [v.length, v.length];
      const s = Math.min(a, v.length);
      const e = Math.min(Math.max(b, s), v.length);
      const next = v.slice(0, s) + emo + v.slice(e);
      if (maxLength != null && next.length > maxLength) return;
      caret.current = [s + emo.length, s + emo.length];
      latest.current = next;
      onChange(next);
    },
    [onChange, maxLength],
  );
  return { track, insert };
}
