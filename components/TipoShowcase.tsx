'use client';

/**
 * TipoShowcase — vitrine ANIMADA da Tipografia Automática pra cards de
 * destaque (hero do hub e da home). Um canvas roda o ENGINE REAL da
 * ferramenta ciclando modelos × frases de copy — o que o cliente vê no card
 * é literalmente o que a ferramenta produz (nada de vídeo gravado).
 *
 * Leve de propósito: só as fontes dos modelos do ciclo são baixadas
 * (ensureTypoFonts com subconjunto) e o rAF só roda com o card visível
 * (IntersectionObserver) e a aba ativa.
 */

import { useEffect, useRef } from 'react';
import { drawPresetDemo } from '@/lib/typography/engine';
import { TYPO_PRESETS } from '@/lib/typography/presets';
import { ensureTypoFonts, type FontKey } from '@/lib/typography/fonts';

// modelo × copy — pares curados pra mostrar a variedade real.
// HERO = os mais insanos (fumaça, ouro, 3D, glitch, neon) pro carrossel;
// CARD = ciclo diferente (mix viral, karaokê, linha) pro destaque menor.
const SHOW_HERO: Array<{ id: string; text: string }> = [
  { id: 'ouro-fumaca', text: 'FATUROU 20 MIL' },
  { id: 'verde-dinheiro', text: 'GANHE 500 POR DIA' },
  { id: 'fumaca', text: 'O SEGREDO DELES' },
  { id: 'glitch-viral', text: 'ISSO MUDA TUDO' },
  { id: 'davinci-3d', text: 'SEM EDITAR NADA' },
  { id: 'epico', text: 'VIRALIZA HOJE' },
  { id: 'neon-viral', text: 'PRESTA ATENCAO' },
  { id: 'extrude-slam', text: 'PRONTO PRA POSTAR' },
];
const SHOW_CARD: Array<{ id: string; text: string }> = [
  { id: 'titulo-viral', text: 'hoje voce vai LUCRAR' },
  { id: 'palavra-box', text: 'LEGENDA EM 1 CLIQUE' },
  { id: 'esmagado', text: 'DIRETO DO VIDEO' },
  { id: 'linha-destaque', text: 'SUA COPY VIVA' },
  { id: 'titulo-ouro', text: 'ESTILO DE AGENCIA' },
  { id: 'cyber', text: 'MODO TURBO' },
];
const STEP_MS = 2600; // mesmo ciclo da demo do engine

export function TipoShowcase({
  className,
  variant = 'hero',
}: {
  className?: string;
  variant?: 'hero' | 'card';
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const show = variant === 'card' ? SHOW_CARD : SHOW_HERO;
    const items = show.map((s) => ({
      preset: TYPO_PRESETS.find((p) => p.id === s.id),
      text: s.text,
    })).filter((x) => !!x.preset);
    if (items.length === 0) return;

    // só as fontes que o ciclo usa (nada de 150 woff2 na home)
    const fontKeys = new Set<FontKey>();
    for (const it of items) {
      fontKeys.add(it.preset!.font);
      if (it.preset!.mix) fontKeys.add(it.preset!.mix.font);
      if (it.preset!.highlightFont) fontKeys.add(it.preset!.highlightFont);
    }
    void ensureTypoFonts(Array.from(fontKeys));

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (es) => {
              for (const en of es) visRef.current = en.isIntersecting;
            },
            { rootMargin: '80px' },
          )
        : null;
    io?.observe(canvas);

    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visRef.current) return;
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
      const t = performance.now() - t0;
      const idx = Math.floor(t / STEP_MS) % items.length;
      const it = items[idx];
      ctx.clearRect(0, 0, W, H);
      drawPresetDemo(ctx, it.preset!, t % STEP_MS, W, H, it.text);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className ?? 'absolute inset-0 h-full w-full'}
    />
  );
}
