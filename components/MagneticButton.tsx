'use client';

import { useRef, useState } from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Distancia maxima (px) que o botao se desloca em direcao ao cursor. */
  strength?: number;
};

/**
 * Botao com efeito magnetico: quando o cursor se aproxima do retangulo do
 * botao, o botao translada uma fracao da distancia em direcao ao cursor.
 * Sai do normal quando o cursor sai.
 *
 * Respeita prefers-reduced-motion.
 */
export function MagneticButton({
  strength = 8,
  className = '',
  children,
  ...rest
}: Props) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  function onMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);

    setStyle({
      transform: `translate3d(${(dx * strength).toFixed(2)}px, ${(
        dy * strength
      ).toFixed(2)}px, 0)`,
      transition: 'transform 0.1s linear',
      willChange: 'transform',
    });
  }

  function onLeave() {
    setStyle({
      transform: 'translate3d(0,0,0)',
      transition: 'transform 0.4s cubic-bezier(.2,.8,.2,1)',
      willChange: 'transform',
    });
  }

  return (
    <button
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={style}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}
