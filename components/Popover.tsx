'use client';

/**
 * Popover ancorado — renderizado por PORTAL no <body>.
 *
 * ⚠ Por que portal e não `absolute`/`fixed` dentro do card:
 *   • `absolute` é CORTADO por qualquer ancestral com `overflow: hidden`
 *     (os cards ToolStep têm).
 *   • `fixed` deixa de ser relativo à TELA quando um ancestral tem
 *     `transform`/`filter`/`will-change` — e os cards ganham
 *     `hover:-translate-y-[2px]` justamente enquanto o mouse está neles.
 *     Resultado: o menu ia parar fora da viewport e criava scroll
 *     horizontal (a página inteira "entortava").
 *   Com o portal no body nenhum ancestral interfere: a posição é sempre
 *   a da tela.
 *
 * Comportamento: acompanha scroll/resize, vira pra cima quando não cabe
 * embaixo, fecha no Esc e no clique fora (o clique DENTRO do menu não
 * fecha — senão o item nem chegaria a receber o clique).
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function Popover({
  open,
  anchorRef,
  onClose,
  width,
  children,
  align = 'start',
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  width: number;
  children: ReactNode;
  /** 'start' alinha pela esquerda do gatilho; 'end' pela direita */
  align?: 'start' | 'end';
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // Reposiciona a cada frame ENQUANTO aberto, em vez de ouvir scroll/resize:
    // o evento 'scroll' não chega ao window em todo contexto (validado no
    // harness: zero eventos capturados) e ainda existiriam containers
    // roláveis internos. O rAF cobre scroll de qualquer nível, resize e
    // mudança de layout — e só roda com o menu aberto. O setPos só dispara
    // quando a posição REALMENTE muda (sem re-render à toa).
    let raf = 0;
    let last = '';
    const place = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const h = menuRef.current?.offsetHeight ?? 320;
        const rawLeft = align === 'end' ? r.right - width : r.left;
        const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
        const below = r.bottom + 6;
        // não coube embaixo → abre pra cima (nunca sai da tela)
        const top =
          below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - 6 - h);
        const key = `${left}:${top}`;
        if (key !== last) {
          last = key;
          setPos({ left, top });
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    // reforço: em aba oculta o rAF congela — os listeners cobrem o retorno
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return; // o gatilho já faz o toggle
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !mounted) return null;
  return createPortal(
    <div
      ref={menuRef}
      style={{
        // posição no STYLE (não em classe): o menu não pode depender de
        // nenhum CSS externo pra ficar no lugar certo
        position: 'fixed',
        zIndex: 999,
        // enquanto a posição não foi medida, fica fora da tela (sem "pulo")
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
