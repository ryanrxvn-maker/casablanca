'use client';

/**
 * legenda — o MOTOR REAL das Legendas Automáticas rodando na landing.
 *
 * Mesmo `drawCaptions` que a ferramenta usa no preview e no MP4: o que a
 * pessoa vê aqui é literalmente o que a ferramenta queima no vídeo. Leve de
 * propósito:
 *   • só as fontes dos modelos usados descem (subconjunto do ensureTypoFonts);
 *   • o canvas só anima visível, com a aba ativa e fora do modo descanso;
 *   • 30 quadros/s (a taxa do vídeo que a ferramenta exporta), nunca 60-144.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { drawCaptions, type Block, type StyleState, type TypoPreset } from '@/lib/typography/engine';
import { getPreset, TYPO_PRESETS } from '@/lib/typography/presets';
import { ensureTypoFonts, type FontKey } from '@/lib/typography/fonts';
import { isCalm } from './fx';

const FRAME_MS = 1000 / 30 - 4;

/** Blocos de legenda com as palavras distribuídas por igual dentro de cada bloco. */
export function makeBlocks(lines: string[], { start = 160, per = 1650 } = {}): Block[] {
  return lines.map((line, i) => {
    const words = line.split(' ');
    const b0 = start + i * per;
    const b1 = b0 + per;
    // as palavras entram na primeira metade do bloco e ficam até o fim dele
    const step = (per * 0.62) / words.length;
    return {
      id: `lp-${i}-${line}`,
      start: b0,
      end: b1,
      words: words.map((text, k) => ({
        text,
        start: Math.round(b0 + k * step),
        end: Math.round(b0 + (k + 1) * step),
      })),
    };
  });
}

/** Duração total de um roteiro de blocos (fim do último). */
export function blocksLength(blocks: Block[]): number {
  return blocks.length ? blocks[blocks.length - 1].end + 120 : 2000;
}

const fontCache = new Map<string, Promise<void>>();

/** Baixa (uma vez) as fontes que esses modelos usam. */
export function loadPresetFonts(ids: string[]): Promise<void> {
  const key = [...ids].sort().join('|');
  let p = fontCache.get(key);
  if (!p) {
    const keys = new Set<FontKey>();
    for (const id of ids) {
      const pr = TYPO_PRESETS.find((x) => x.id === id);
      if (!pr) continue;
      keys.add(pr.font);
      if (pr.mix) keys.add(pr.mix.font);
      if (pr.highlightFont) keys.add(pr.highlightFont);
    }
    p = ensureTypoFonts(Array.from(keys)).then(
      () => undefined,
      () => undefined,
    );
    fontCache.set(key, p);
  }
  return p;
}

export function styleFor(preset: TypoPreset, fontScale: number, posY: number, singleLine = false): StyleState {
  return {
    singleLine,
    presetId: preset.id,
    fontScale,
    posY,
    primary: null,
    accent: null,
    uppercase: null,
    highlights: {},
    autoEmphasis: true,
  };
}

export type LegendaProgram = {
  presetId: string;
  blocks: Block[];
  fontScale: number;
  posY: number;
  /** a mesma "Linha única" do painel da ferramenta */
  singleLine?: boolean;
};

/**
 * Pinta um programa de legenda num canvas. `programRef` pode mudar a qualquer
 * momento (troca de modelo) sem reiniciar o loop. Com `playing` falso (ou
 * reduced-motion / fora da tela / modo descanso) fica num quadro parado
 * `stillAt` ms — sempre legível.
 */
export function useLegendaCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  programRef: RefObject<LegendaProgram>,
  {
    playing,
    stillAt,
    fontIds,
    onLoop,
    once = false,
  }: {
    playing: boolean;
    stillAt: number;
    fontIds: string[];
    /** chamado quando o roteiro termina uma volta (pra trocar de modelo) */
    onLoop?: () => void;
    /** toca a entrada UMA vez e para em `stillAt` (cards: sem quadro vazio entre voltas) */
    once?: boolean;
  },
) {
  const playingRef = useRef(playing);
  const stillRef = useRef(stillAt);
  const fontIdsRef = useRef(fontIds);
  fontIdsRef.current = fontIds;
  stillRef.current = stillAt;

  const visRef = useRef(false);
  const t0Ref = useRef(0);
  const onLoopRef = useRef(onLoop);
  onLoopRef.current = onLoop;
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let cancelled = false;
    let loaded = false;
    let last = 0;
    let lastLoop = -1;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const paint = (t: number) => {
      const prog = programRef.current;
      if (!prog) return;
      const wrap = canvas.parentElement;
      if (!wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(wrap.clientWidth * dpr);
      const H = Math.round(wrap.clientHeight * dpr);
      if (W <= 0 || H <= 0) return;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const preset = getPreset(prog.presetId);
      try {
        drawCaptions(ctx, prog.blocks, preset, styleFor(preset, prog.fontScale, prog.posY, prog.singleLine), t, W, H);
      } catch {
        /* um quadro que estoure não pode matar o loop */
      }
    };

    const live = () =>
      playingRef.current && visRef.current && !reduced.matches && !isCalm();

    const tick = () => {
      raf = 0;
      if (cancelled || !loaded) return;
      if (!live()) {
        paint(stillRef.current);
        return;
      }
      const now = performance.now();
      if (now - last >= FRAME_MS) {
        last = now;
        const prog = programRef.current;
        const len = prog ? blocksLength(prog.blocks) : 2000;
        const el = now - t0Ref.current;
        if (once && el >= stillRef.current) {
          paint(stillRef.current);
          return;
        }
        const loop = Math.floor(el / len);
        if (lastLoop >= 0 && loop !== lastLoop) onLoopRef.current?.();
        lastLoop = loop;
        paint(el % len);
      }
      raf = requestAnimationFrame(tick);
    };
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!loaded || cancelled) return;
      if (live()) {
        t0Ref.current = performance.now();
        lastLoop = -1;
        raf = requestAnimationFrame(tick);
      } else {
        paint(stillRef.current);
      }
    };
    kickRef.current = update;

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              visRef.current = entries[0]?.isIntersecting ?? false;
              update();
            },
            { rootMargin: '120px' },
          )
        : null;
    if (io) io.observe(canvas);
    else visRef.current = true;
    const ro = new ResizeObserver(() => {
      if (!raf) update();
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    const onVis = () => update();
    document.addEventListener('visibilitychange', onVis);
    reduced.addEventListener('change', onVis);
    // o modo descanso só troca uma classe no <html>; um observer barato acorda o loop
    const mo = new MutationObserver(onVis);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    void loadPresetFonts(fontIdsRef.current).then(() => {
      loaded = true;
      update();
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      reduced.removeEventListener('change', onVis);
    };
    // o loop lê tudo por ref; montar uma vez basta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // play/pause e troca de modelo reiniciam o relógio do roteiro
  useEffect(() => {
    playingRef.current = playing;
    kickRef.current();
  }, [playing]);

  return {
    /** repinta já (depois de trocar o programa com o loop parado) */
    repaint: () => kickRef.current(),
  };
}
