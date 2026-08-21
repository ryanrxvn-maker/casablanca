'use client';

/**
 * TipoShowcase — vitrine ANIMADA das Legendas Automáticas pra cards de
 * destaque (hero do hub, home e login). Um canvas roda o ENGINE REAL da
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

// modelo × copy — pares curados: cada frase fala do que a FERRAMENTA faz,
// escrita como a legenda que ela mesma produziria. Sem acento de propósito
// (mesma convenção das demos do engine).
//
// Os MODELOS são os favoritos do Silas (21.08), renderizados com fidelidade
// máxima pelo engine: Vermelho Sangue, Título Ouro, Glitch Viral, Verde
// Dinheiro, Empilhado e Extensão Script. HERO e CARD usam os mesmos seis,
// em ordem e com frases diferentes.
const SHOW_HERO: Array<{ id: string; text: string }> = [
  { id: 'vermelho-sangue', text: 'SUA FALA VIRA LEGENDA' },
  { id: 'titulo-ouro', text: 'PALAVRA POR PALAVRA' },
  { id: 'glitch-viral', text: 'SEM DIGITAR NADA' },
  { id: 'verde-dinheiro', text: 'NO TEMPO DO AUDIO' },
  { id: 'empilhado', text: 'VOCE EDITA NO PREVIEW' },
  { id: 'extensao-script', text: 'DIRETO NO MP4' },
];
const SHOW_CARD: Array<{ id: string; text: string }> = [
  { id: 'titulo-ouro', text: 'LEGENDA EM UM CLIQUE' },
  { id: 'vermelho-sangue', text: 'DIRETO DO VIDEO' },
  { id: 'verde-dinheiro', text: 'NO TEMPO DA FALA' },
  { id: 'empilhado', text: 'PALAVRA POR PALAVRA' },
  { id: 'glitch-viral', text: 'SUA COPY VIVA' },
  { id: 'extensao-script', text: 'SEM DIGITAR NADA' },
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
    let cancelled = false;
    let t0 = 0;
    const tick = () => {
      if (cancelled) return;
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
    // Espera as fontes ANTES do primeiro frame: o ctx.fillText rasteriza com o
    // que estiver ativo no document.fonts na hora — desenhar antes do load
    // fazia os primeiros ciclos saírem em sans-serif genérica (fonte "errada").
    void ensureTypoFonts(Array.from(fontKeys)).then(() => {
      if (cancelled) return;
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
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
