'use client';

/**
 * Galeria de modelos de lettering — EXTRAÍDA de app/tools/tipografia/page.tsx
 * (22.08.2026) pra ser reusada pelo Auto Cortes sem duplicar código.
 *
 * O comportamento da Tipografia é o mesmo de antes, byte a byte no que
 * importa: categorias na ordem de TYPO_CATEGORIES, aba ⭐ Favoritos, um
 * canvas por card com rAF único, IntersectionObserver com rootMargin 160px,
 * prepaint de no máximo 3 cards por tick e estrela roxa de favoritar.
 *
 * O que é NOVO (tudo opcional — sem passar nada, nada muda):
 *  - `presets`: mostrar só um subconjunto (galeria de headline);
 *  - `demoText`: texto desenhado nas demos;
 *  - `allowNone`: um card "Sem legenda"/"Sem headline" como 1ª opção;
 *  - `compact`: caixa de rolagem menor (cabe dentro de um passo do fluxo).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { drawPresetDemo, type TypoPreset } from '@/lib/typography/engine';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import { TYPO_CATEGORIES, TYPO_PRESETS } from '@/lib/typography/presets';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';

// botões com relevo 3D (hover levanta, clique afunda) — mesmo do editor
const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

export const FAV_CAT = '⭐ Favoritos';
/** Aba extra que só existe quando a galeria roda com um subconjunto. */
export const ALL_CAT = 'Todos';

export type PresetGalleryProps = {
  presetId: string;
  onPick: (id: string) => void;
  favs: string[];
  onToggleFav: (id: string) => void;
  disabled?: boolean;
  /** Subconjunto de modelos (default: os 491 da Tipografia). */
  presets?: TypoPreset[];
  /** Texto desenhado na demo de cada card. */
  demoText?: string;
  /** Card "Sem legenda"/"Sem headline" na frente da grade. */
  allowNone?: { label: string; selected: boolean; onPick: () => void };
  /** Caixa de rolagem menor + grade de 2 colunas. */
  compact?: boolean;
  /**
   * Conteudo extra na fileira de abas, logo depois do chip de ⭐ Favoritos.
   * A Tipografia manda o chip de Templates e o botao do roteiro de legenda;
   * quem nao passa nada (Auto Cortes) fica exatamente como era.
   */
  extra?: ReactNode;
};

export function PresetGallery({
  presetId,
  onPick,
  favs,
  onToggleFav,
  disabled,
  presets,
  demoText,
  allowNone,
  compact,
  extra,
}: PresetGalleryProps) {
  const all = presets ?? TYPO_PRESETS;
  const subset = presets != null;

  // Categorias: sem subconjunto é exatamente TYPO_CATEGORIES (Tipografia
  // inalterada). Com subconjunto, só as que existem nele + a aba "Todos".
  const cats = useMemo(() => {
    if (!subset) return TYPO_CATEGORIES;
    const presentes = new Set(all.map((p) => p.cat));
    const naOrdem = TYPO_CATEGORIES.filter((c) => presentes.has(c));
    const extras = Array.from(presentes).filter((c) => !TYPO_CATEGORIES.includes(c));
    return [ALL_CAT, ...naOrdem, ...extras];
  }, [subset, all]);

  const [cat, setCat] = useState<string>(() => (subset ? ALL_CAT : TYPO_CATEGORIES[0]));
  const canvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  // só os cards VISÍVEIS na rolagem animam (IntersectionObserver)
  const visRef = useRef(new Set<string>());
  const ioRef = useRef<IntersectionObserver | null>(null);
  // canvases que já receberam AO MENOS um frame (WeakSet: card remontado volta virgem)
  const drawnRef = useRef(new WeakSet<HTMLCanvasElement>());
  const fontsReadyRef = useRef(false);
  const favSet = useMemo(() => new Set(favs), [favs]);
  const list = useMemo(
    () =>
      cat === FAV_CAT
        ? all.filter((p) => favSet.has(p.id))
        : cat === ALL_CAT
          ? all
          : all.filter((p) => p.cat === cat),
    [cat, favSet, all],
  );

  useEffect(() => {
    visRef.current.clear();
    if (scrollBoxRef.current) scrollBoxRef.current.scrollTop = 0;
  }, [cat]);

  // Observer criado SOB DEMANDA: os refs dos cards disparam ANTES dos
  // useEffect no primeiro mount — criar o IO num effect deixava a galeria
  // inteira sem observação (cards pretos até um clique re-renderizar).
  const obtainIO = useCallback(() => {
    if (!ioRef.current && typeof IntersectionObserver !== 'undefined') {
      ioRef.current = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const id = (en.target as HTMLElement).dataset.pid;
            if (!id) continue;
            if (en.isIntersecting) visRef.current.add(id);
            else visRef.current.delete(id);
          }
        },
        // root = viewport: o IO já clipa pelo scroll-box ancestral
        { rootMargin: '160px' },
      );
    }
    return ioRef.current;
  }, []);

  useEffect(() => () => ioRef.current?.disconnect(), []);

  useEffect(() => {
    void ensureTypoFonts().then(() => {
      fontsReadyRef.current = true;
    });
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now() - t0;
      // cards fora da viewport ganham 1 frame estático (nunca preto ao rolar);
      // no máx 3 por tick e só com fontes prontas pra não carimbar fallback
      let prepaint = 3;
      for (const preset of list) {
        const c = canvasesRef.current.get(preset.id);
        if (!c) continue;
        const vis = ioRef.current ? visRef.current.has(preset.id) : true;
        if (!vis) {
          if (!fontsReadyRef.current || prepaint <= 0 || drawnRef.current.has(c))
            continue;
          prepaint--;
        }
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, c.width, c.height);
        // TODA demo mostra "SUA LEGENDA AQUI" (lineAccent quebra em 2 linhas
        // sozinho pro efeito de linha colorida aparecer) — salvo demoText
        drawPresetDemo(ctx, preset, now, c.width, c.height, demoText);
        drawnRef.current.add(c);
      }
    };
    // relógio COMPARTILHADO: a galeria não precisa de 60fps e não pode
    // roubar frame do player de vídeo (lib/typography/canvas-loop.ts)
    return registerCanvasJob(tick, { fps: 24, prio: 0, el: scrollBoxRef.current });
  }, [list, demoText]);

  return (
    <div>
      <div
        className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        Modelos — {all.length} letterings
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCat(FAV_CAT)}
          className={
            'rounded-full border px-3 py-1 text-[11px] font-bold transition-colors' +
            T3D +
            ' ' +
            (cat === FAV_CAT
              ? 'border-violet/70 bg-violet/20 text-violet'
              : 'border-violet/35 bg-violet/5 text-violet/80 hover:border-violet/60 hover:text-violet')
          }
          style={{ fontFamily: 'var(--font-tech)' }}
          title="Seus modelos favoritos (estrela roxa nos cards)"
        >
          ⭐ Favoritos
          <span className="ml-1 opacity-70">{favs.length}</span>
        </button>
        {extra}
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={
              'rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ' +
              (c === cat
                ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                : 'border-line text-text-muted hover:border-amber-400/40 hover:text-text')
            }
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {c}
            <span className="ml-1 opacity-60">
              {c === ALL_CAT ? all.length : all.filter((p) => p.cat === c).length}
            </span>
          </button>
        ))}
      </div>
      <div
        ref={scrollBoxRef}
        className={(compact ? 'max-h-[340px]' : 'max-h-[560px]') + ' overflow-y-auto pr-1.5'}
      >
      {cat === FAV_CAT && list.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-violet/40 bg-violet/5 px-4 py-8 text-center text-[12.5px] text-text-muted">
          Nenhum favorito ainda — clica na <span className="text-violet">estrela roxa</span> de
          qualquer modelo pra ele aparecer aqui.
        </div>
      ) : null}
      <div
        className={
          'grid grid-cols-1 gap-3 sm:grid-cols-2 ' + (compact ? '' : '2xl:grid-cols-3')
        }
      >
        {allowNone ? (
          <button
            type="button"
            disabled={disabled}
            onClick={allowNone.onPick}
            className={
              'group relative flex aspect-[520/240] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[12px] border-2 border-dashed text-center transition-all duration-200 active:scale-[0.97] ' +
              (allowNone.selected
                ? 'border-amber-400/70 bg-amber-400/10 shadow-[0_0_20px_-6px_rgba(255,159,10,0.5)]'
                : 'border-line-strong hover:-translate-y-[1px] hover:border-amber-400/40')
            }
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={allowNone.selected ? 'text-amber-300' : 'text-text-muted'} aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M5.6 5.6l12.8 12.8" />
            </svg>
            <span
              className={
                'text-[12px] font-bold ' +
                (allowNone.selected ? 'text-amber-200' : 'text-text-muted group-hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {allowNone.label}
            </span>
          </button>
        ) : null}
        {list.map((preset) => {
          const active = !allowNone?.selected && preset.id === presetId;
          const isFav = favSet.has(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              data-pid={preset.id}
              ref={(el) => {
                if (el) obtainIO()?.observe(el);
              }}
              onClick={() => onPick(preset.id)}
              className={
                'group relative overflow-hidden rounded-[12px] border text-left transition-all duration-200 active:scale-[0.97] ' +
                (active
                  ? 'border-amber-400/70 shadow-[0_0_20px_-6px_rgba(255,159,10,0.5)]'
                  : 'border-line-strong hover:-translate-y-[1px] hover:border-amber-400/40')
              }
            >
              <canvas
                width={520}
                height={240}
                ref={(el) => {
                  if (el) canvasesRef.current.set(preset.id, el);
                  else canvasesRef.current.delete(preset.id);
                }}
                className="block aspect-[520/240] w-full"
                style={{
                  background:
                    'linear-gradient(145deg, #17181d 0%, #101116 55%, #191a20 100%)',
                }}
              />
              {/* estrela roxa de favoritar (não seleciona o modelo) */}
              <span
                role="button"
                tabIndex={-1}
                title={isFav ? 'Tirar dos favoritos' : 'Favoritar'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFav(preset.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={
                  'absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200 hover:scale-110 ' +
                  (isFav
                    ? 'border-violet/70 bg-violet/25 opacity-100'
                    : 'border-white/20 bg-black/45 opacity-0 group-hover:opacity-100')
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={isFav ? '#a78bfa' : 'none'}
                  stroke={isFav ? '#a78bfa' : 'rgba(255,255,255,0.85)'}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z" />
                </svg>
              </span>
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span
                  className={
                    'text-[11px] font-bold ' + (active ? 'text-amber-200' : 'text-text-muted group-hover:text-text')
                  }
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  {preset.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {isFav ? (
                    <span className="text-[10px] text-violet" aria-hidden>
                      ★
                    </span>
                  ) : null}
                  {active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
                  ) : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
