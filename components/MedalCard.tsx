'use client';

import { useState } from 'react';
import type { PointsTier } from '@/lib/points-system';
import { fmtBRL } from '@/lib/points-system';

/**
 * MedalCard — visualizacao 3D de uma meta/medalha.
 * - Achieved: animacao pulse + glow forte + cores vivas
 * - Locked: cinza apagado
 * - Hover: holograma com slogan (frase em tipografia mono tipo codigo)
 */
export function MedalCard({
  tier,
  achieved,
  currentPoints,
}: {
  tier: PointsTier;
  achieved: boolean;
  currentPoints: number;
}) {
  const [hover, setHover] = useState(false);

  // Tamanho do circulo medal varia por sizeLevel (1=80px, 5=140px)
  const baseSize = 60 + tier.sizeLevel * 16;

  return (
    <div
      className="group relative flex flex-col items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Glow ring animado */}
      <div
        aria-hidden
        className={
          'absolute rounded-full transition-all duration-500 ' +
          (achieved ? 'animate-pulse' : '')
        }
        style={{
          width: baseSize + 24,
          height: baseSize + 24,
          background: achieved
            ? `radial-gradient(circle, ${tier.primaryColor}55, transparent 70%)`
            : 'radial-gradient(circle, rgba(100,100,100,0.15), transparent 70%)',
          filter: achieved ? `blur(8px)` : 'blur(4px)',
          top: 0,
        }}
      />

      {/* Medalha principal — circulo com gradiente conico */}
      <div
        className="relative z-10 rounded-full transition-all duration-300"
        style={{
          width: baseSize,
          height: baseSize,
          background: achieved
            ? `conic-gradient(from 220deg at 50% 50%, ${tier.primaryColor}, ${tier.secondaryColor}, ${tier.primaryColor})`
            : 'linear-gradient(135deg, #18181B 0%, #27272A 100%)',
          boxShadow: achieved
            ? `0 8px 32px -8px ${tier.primaryColor}, 0 0 0 2px ${tier.secondaryColor}, inset 0 4px 12px ${tier.primaryColor}88, inset 0 -4px 12px rgba(0,0,0,0.6)`
            : '0 4px 12px -6px rgba(0,0,0,0.6), 0 0 0 2px rgba(100,100,100,0.3), inset 0 2px 4px rgba(255,255,255,0.04), inset 0 -2px 4px rgba(0,0,0,0.4)',
          transform: hover && achieved ? 'translateY(-3px) rotate(-2deg)' : undefined,
        }}
      >
        {/* Brilho interno + numero da meta */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{
            textShadow: achieved
              ? `0 0 8px ${tier.primaryColor}, 0 2px 4px rgba(0,0,0,0.8)`
              : '0 2px 4px rgba(0,0,0,0.6)',
          }}
        >
          <div
            className="mono text-[9px] uppercase tracking-widest"
            style={{
              color: achieved ? '#000' : '#52525B',
              opacity: achieved ? 0.85 : 0.7,
            }}
          >
            {tier.minPoints} pts
          </div>
          <div
            className={achieved ? 'font-bold' : 'font-semibold'}
            style={{
              fontSize: 10 + tier.sizeLevel * 2,
              color: achieved ? '#000' : '#71717A',
              letterSpacing: '0.08em',
              lineHeight: 1,
            }}
          >
            {tier.englishName}
          </div>
          <div
            className="mono mt-0.5 text-[10px]"
            style={{
              color: achieved ? '#000' : '#52525B',
              opacity: achieved ? 0.9 : 0.6,
            }}
          >
            {fmtBRL(tier.bonusBRL)}
          </div>
        </div>

        {/* Highlight rim no topo da medalha */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.25), transparent 35%)',
          }}
        />
      </div>

      {/* Label embaixo */}
      <div className="relative z-10 mt-3 text-center">
        <div
          className={
            'mono text-[10px] uppercase tracking-widest ' +
            (achieved ? '' : 'text-text-muted')
          }
          style={{ color: achieved ? tier.primaryColor : undefined }}
        >
          {tier.englishName}
        </div>
        <div className="mono text-[9px] uppercase tracking-widest text-text-muted mt-0.5">
          {tier.minPoints} pts · {fmtBRL(tier.bonusBRL)}
        </div>
      </div>

      {/* Holograma de slogan — aparece em hover */}
      <div
        className={
          'absolute -bottom-2 left-1/2 -translate-x-1/2 translate-y-full z-20 pointer-events-none transition-all duration-300 ' +
          (hover ? 'opacity-100 translate-y-[calc(100%+8px)]' : 'opacity-0')
        }
        style={{ width: 220 }}
      >
        <div
          className="rounded-[8px] border bg-bg/95 backdrop-blur px-3 py-2 text-[10px] mono leading-relaxed text-center"
          style={{
            borderColor: tier.primaryColor + '60',
            color: achieved ? tier.primaryColor : '#A1A1AA',
            textShadow: `0 0 4px ${tier.primaryColor}40`,
            boxShadow: `0 4px 16px -4px ${tier.primaryColor}40`,
          }}
        >
          <div className="mb-1 uppercase tracking-widest opacity-60">// SYSTEM_MSG</div>
          {tier.slogan}
        </div>
      </div>

      {/* Progress mini quando essa eh a proxima */}
      {!achieved && currentPoints > 0 && currentPoints < tier.minPoints ? (
        (() => {
          // So mostra na PROXIMA meta — checar se eh
          const prevTier = [60, 90, 120, 150].find((p) => p < tier.minPoints && p > currentPoints);
          if (prevTier && prevTier !== tier.minPoints) return null;
          const pct = Math.round((currentPoints / tier.minPoints) * 100);
          return (
            <div className="mt-2 w-[80px]">
              <div className="h-1 rounded bg-bg/60 overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(to right, ${tier.primaryColor}, ${tier.secondaryColor})`,
                  }}
                />
              </div>
              <div className="mono mt-1 text-center text-[8px] uppercase tracking-widest text-text-muted">
                {currentPoints}/{tier.minPoints}
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
