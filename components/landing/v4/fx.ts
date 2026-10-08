'use client';

/**
 * fx — primitivas de movimento da landing v4.
 *
 * Regra de performance do projeto (05.10, travada em scripts/test-perf-guards):
 * nada de variável no :root, nada de setState por movimento do mouse. Tudo que
 * segue o ponteiro escreve `transform` (ou variável CSS) direto no PRÓPRIO
 * elemento, dentro de um rAF que só roda enquanto há movimento pra assentar —
 * parado, nenhum quadro é desenhado.
 *
 * Toque (pointer: coarse) e prefers-reduced-motion desligam tudo: o conteúdo
 * fica na pose de repouso, legível e parado.
 */

import { useEffect, useState, type RefObject } from 'react';

/** Pode animar seguindo o ponteiro? (mouse fino e sem reduced-motion) */
export function pointerFxAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia;
  if (!mm) return false;
  if (mm('(prefers-reduced-motion: reduce)').matches) return false;
  return mm('(hover: hover) and (pointer: fine)').matches;
}

/** O site está em modo descanso (AmbientCalm)? Loops de JS decorativos pausam. */
export function isCalm(): boolean {
  return (
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('ae-calm') ||
      document.visibilityState !== 'visible')
  );
}

/**
 * Campo de ponteiro: acompanha a posição do mouse dentro de `zoneRef`
 * normalizada em -1..1 (centro = 0), com suavização. `onFrame` recebe o valor
 * suavizado e escreve transform nos elementos que quiser. Fora da zona, volta
 * ao repouso (0,0) e o loop para quando assenta.
 */
export function usePointerField(
  zoneRef: RefObject<HTMLElement | null>,
  onFrame: (x: number, y: number, inside: boolean) => void,
  { ease = 0.12, global = false }: { ease?: number; global?: boolean } = {},
) {
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone || !pointerFxAllowed()) return;

    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let inside = false;
    let raf = 0;

    const step = () => {
      raf = 0;
      x += (tx - x) * ease;
      y += (ty - y) * ease;
      const settled = Math.abs(tx - x) < 0.0008 && Math.abs(ty - y) < 0.0008;
      if (settled) {
        x = tx;
        y = ty;
      }
      onFrame(x, y, inside);
      if (!settled) raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = zone.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (global) {
        // campo da janela inteira, mas centrado na zona (parallax de herói)
        inside = true;
        tx = Math.max(-1.4, Math.min(1.4, nx));
        ty = Math.max(-1.4, Math.min(1.4, ny));
      } else {
        inside = nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
        tx = inside ? nx : 0;
        ty = inside ? ny : 0;
      }
      kick();
    };
    const onLeave = () => {
      inside = false;
      tx = 0;
      ty = 0;
      kick();
    };

    const target: HTMLElement | Window = global ? window : zone;
    target.addEventListener('pointermove', onMove as EventListener, { passive: true });
    if (global) document.documentElement.addEventListener('pointerleave', onLeave);
    else zone.addEventListener('pointerleave', onLeave);

    return () => {
      target.removeEventListener('pointermove', onMove as EventListener);
      if (global) document.documentElement.removeEventListener('pointerleave', onLeave);
      else zone.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
    // onFrame é estável por contrato (definido com useCallback ou fora do render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneRef, ease, global]);
}

/**
 * Botão magnético: puxa o próprio botão alguns pixels na direção do mouse
 * quando ele chega perto. Só transform, só no próprio elemento.
 */
export function useMagnetic(ref: RefObject<HTMLElement | null>, strength = 0.22) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !pointerFxAllowed()) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    const step = () => {
      raf = 0;
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      if (Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05) raf = requestAnimationFrame(step);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      tx = (e.clientX - cx) * strength;
      ty = (e.clientY - cy) * strength * 1.2;
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      el.style.translate = '';
    };
  }, [ref, strength]);
}

/**
 * Holofote de borda: grava a posição do mouse como variável no PRÓPRIO card
 * (`--sx/--sy`, em %), pra um ::before com radial-gradient acender a borda
 * embaixo do cursor. Recalcula só o card, nunca a página.
 */
export function useSpotlight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !pointerFxAllowed()) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const flush = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      el.style.setProperty('--sx', (((px - r.left) / r.width) * 100).toFixed(1) + '%');
      el.style.setProperty('--sy', (((py - r.top) / r.height) * 100).toFixed(1) + '%');
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/**
 * `true` enquanto o site está em modo descanso (AmbientCalm) ou com a aba
 * escondida. Vídeo decorativo pausa nesse estado — decodificar vídeo parado
 * na tela é o mesmo custo de uma animação infinita.
 */
export function useCalm(): boolean {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    const sync = () => setCalm(isCalm());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', sync);
    return () => {
      mo.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return calm;
}
