'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  listMyElevenVoices,
  clearElevenVoicesCache,
  fetchVoiceOrb,
  type ElevenVoice,
} from '@/lib/elevenlabs-api-direct';

/**
 * Seletor de voz do ElevenLabs — espelho 1:1 da biblioteca da CONTA do user.
 *
 * A lista sai da sessão dele (via extensão), então é exatamente o que ele vê
 * em elevenlabs.io: as vozes que ele clonou/comprou primeiro, o catálogo
 * depois. Nada de chave de API, nada de conta errada.
 *
 * Dá pra OUVIR antes de escolher: o preview é o mesmo mp3 público que o
 * ElevenLabs serve na tela dele. Escolher voz de anúncio no nome é chute —
 * ouvir é o mínimo.
 */

export type ElevenVoiceChoice = { id: string; name: string };

const PANEL_W = 460;
const PANEL_H = 480;

export function ElevenVoicePicker({
  selected,
  setSelected,
  disabled = false,
  label,
}: {
  selected: ElevenVoiceChoice | null;
  setSelected: (v: ElevenVoiceChoice | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [voices, setVoices] = useState<ElevenVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [orbs, setOrbs] = useState<Record<string, string>>({});
  const [tocando, setTocando] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ── posicionamento (segue o scroll, igual ao picker de avatar) ── */
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
    if (spaceBelow >= 300 || spaceBelow >= spaceAbove) {
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

  useLayoutEffect(() => {
    if (open) computePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => computePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* ── para o preview ao fechar (áudio tocando com painel fechado é fantasma) ── */
  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setTocando(null);
  }, [open]);

  useEffect(() => () => audioRef.current?.pause(), []);

  /* ── carrega as vozes ── */
  async function carregar(force = false) {
    setLoading(true);
    setErro(null);
    if (force) clearElevenVoicesCache();
    const r = await listMyElevenVoices({ force });
    setVoices(r.voices);
    if (!r.ok) {
      setErro(
        r.error ||
          'Não consegui ler suas vozes. Deixe uma aba do elevenlabs.io aberta e logada e tente de novo.',
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!open || voices.length > 0 || loading) return;
    void carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) =>
      [v.name, v.category, v.gender, v.accent, v.language, v.description]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(q)),
    );
  }, [voices, query]);

  const minhas = filtradas.filter((v) => v.mine);
  const catalogo = filtradas.filter((v) => !v.mine);

  /* ── orbs: busca só do que está na tela (evita 200 requests de uma vez) ── */
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    const visiveis = [...minhas, ...catalogo].slice(0, 40).filter((v) => !orbs[v.id]);
    (async () => {
      for (const v of visiveis) {
        if (cancelado) return;
        const url = await fetchVoiceOrb(v.id, 64);
        if (cancelado) return;
        if (url) setOrbs((prev) => (prev[v.id] ? prev : { ...prev, [v.id]: url }));
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtradas.length, query]);

  function tocarPreview(v: ElevenVoice, e: React.MouseEvent) {
    e.stopPropagation();
    audioRef.current?.pause();
    if (tocando === v.id) {
      audioRef.current = null;
      setTocando(null);
      return;
    }
    if (!v.previewUrl) return;
    const a = new Audio(v.previewUrl);
    a.onended = () => setTocando(null);
    a.onerror = () => setTocando(null);
    audioRef.current = a;
    setTocando(v.id);
    void a.play().catch(() => setTocando(null));
  }

  /* Função, NÃO componente: como componente ela seria um tipo novo a cada
   * render e o React remontaria as ~200 linhas a cada tecla digitada na
   * busca — a lista engasgava. Chamada como função, o JSX entra inline. */
  const linha = (v: ElevenVoice) => {
    const ativa = selected?.id === v.id;
    return (
      <button
        key={v.id}
        type="button"
        onClick={() => {
          setSelected({ id: v.id, name: v.name });
          setOpen(false);
        }}
        className={
          'flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition ' +
          (ativa
            ? 'border-white/60 bg-white/[0.10]'
            : 'border-transparent hover:border-line-strong hover:bg-white/[0.04]')
        }
      >
        {orbs[v.id] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={orbs[v.id]} alt="" className="h-8 w-8 shrink-0 rounded-full" />
        ) : (
          <span className="h-8 w-8 shrink-0 rounded-full border border-line-strong bg-bg-soft" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-text">{v.name}</span>
            {v.mine ? (
              <span className="mono shrink-0 rounded-full border border-white/35 bg-white/10 px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-widest text-white/85">
                minha
              </span>
            ) : null}
          </span>
          <span className="mono block truncate text-[9.5px] uppercase tracking-widest text-text-muted">
            {[v.gender, v.accent, v.language].filter(Boolean).join(' · ') || v.category}
          </span>
        </span>
        {v.previewUrl ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => tocarPreview(v, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tocarPreview(v, e as unknown as React.MouseEvent);
              }
            }}
            title={tocando === v.id ? 'Parar' : 'Ouvir amostra'}
            className="shrink-0 rounded-full border border-line-strong p-1.5 text-text-muted transition hover:border-white/60 hover:text-white"
          >
            {tocando === v.id ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={label || 'Escolher a voz do ElevenLabs'}
        className={
          'flex w-full items-center gap-2 rounded-[11px] border px-3 py-2 text-left transition ' +
          (selected ? 'border-white/50 bg-white/[0.06]' : 'border-line-strong bg-bg-soft/60') +
          (disabled ? ' cursor-not-allowed opacity-50' : ' hover:border-white/60')
        }
      >
        {selected && orbs[selected.id] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={orbs[selected.id]} alt="" className="h-6 w-6 shrink-0 rounded-full" />
        ) : (
          <svg
            className="h-4 w-4 shrink-0 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
          </svg>
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {selected ? (
            <span className="font-semibold text-text">{selected.name}</span>
          ) : (
            <span className="text-text-muted">Escolher voz…</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-text-muted">▾</span>
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              className="fixed z-[9999] flex flex-col overflow-hidden rounded-[14px] border border-line-strong bg-bg shadow-2xl"
              style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
            >
              <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar voz…"
                  className="min-w-0 flex-1 rounded-[9px] border border-line-strong bg-bg-soft px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-white/50"
                />
                <button
                  type="button"
                  onClick={() => void carregar(true)}
                  disabled={loading}
                  title="Recarregar a lista de vozes da sua conta"
                  className="mono shrink-0 rounded-[9px] border border-line-strong px-2 py-1.5 text-[9px] uppercase tracking-widest text-text-muted transition hover:border-white/50 hover:text-white disabled:opacity-50"
                >
                  {loading ? '…' : '↻'}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loading && voices.length === 0 ? (
                  <div className="mono px-2 py-6 text-center text-[10px] uppercase tracking-widest text-text-muted">
                    Lendo as vozes da sua conta…
                  </div>
                ) : erro ? (
                  <div className="rounded-[10px] border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-200">
                    {erro}
                  </div>
                ) : filtradas.length === 0 ? (
                  <div className="mono px-2 py-6 text-center text-[10px] uppercase tracking-widest text-text-muted">
                    {query ? 'Nenhuma voz com esse nome.' : 'Nenhuma voz na conta.'}
                  </div>
                ) : (
                  <>
                    {minhas.length > 0 ? (
                      <>
                        <div className="mono px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/60">
                          Minhas vozes
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {minhas.map((v) => linha(v))}
                        </div>
                      </>
                    ) : null}
                    {catalogo.length > 0 ? (
                      <>
                        <div className="mono px-2 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-text-muted">
                          Catálogo
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {catalogo.map((v) => linha(v))}
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {selected ? (
                <div className="border-t border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setOpen(false);
                    }}
                    className="mono text-[9.5px] uppercase tracking-widest text-text-muted transition hover:text-red-300"
                  >
                    limpar escolha
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
