'use client';

import { useRef, useState, useCallback } from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
  /** Max rotation in degrees. Default 8. */
  max?: number;
  /** Subtle 1.02 scale on hover. Default true. */
  scale?: boolean;
  /** Track spotlight position via --gx / --gy (card-3d glow). Default true. */
  glow?: boolean;
};

/**
 * Wrapper que da tilt 3D responsivo ao mouse.
 *
 * Usa perspective + rotateX/rotateY em torno do centro do elemento.
 * Respeita prefers-reduced-motion automaticamente (transform limpa quando
 * a flag esta ativa).
 *
 * Tambem atualiza as CSS vars --gx/--gy (em %) dentro do elemento, pra
 * casar com o radial-gradient do .card-3d no globals.css.
 */
export function Tilt3D({
  children,
  className = '',
  max = 8,
  scale = true,
  glow = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;

      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;

      const rotY = (px - 0.5) * 2 * max;
      const rotX = -(py - 0.5) * 2 * max;

      const s: React.CSSProperties = {
        transform: `perspective(1000px) rotateX(${rotX.toFixed(
          2,
        )}deg) rotateY(${rotY.toFixed(2)}deg)${
          scale ? ' scale3d(1.015,1.015,1.015)' : ''
        }`,
        transition: 'transform 0.08s linear',
        willChange: 'transform',
      };

      if (glow) {
        (s as Record<string, string>)['--gx'] = `${(px * 100).toFixed(1)}%`;
        (s as Record<string, string>)['--gy'] = `${(py * 100).toFixed(1)}%`;
      }

      setStyle(s);
    },
    [max, scale, glow],
  );

  const onLeave = useCallback(() => {
    setStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)',
      transition: 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
      willChange: 'transform',
    });
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={style}
      className={className}
    >
      {children}
    </div>
  );
}
