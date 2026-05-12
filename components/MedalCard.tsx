'use client';

import { useState } from 'react';
import type { PointsTier } from '@/lib/points-system';
import { fmtBRL } from '@/lib/points-system';

/**
 * MedalCard — usa os 4 PNGs em /public/medals/ (recortados da imagem
 * de referencia do user 2752x1536):
 *   ROOKIE   → carbon-fiber escuro octogonal
 *   ELITE    → prata ornate mandala
 *   CHAMPION → ouro ornate mandala
 *   LEGEND   → diamante rosa + asas + sparkles
 *
 * - Locked: grayscale + brightness reduzido + opacity 0.55 (apagado)
 * - Achieved: cores vivas + pulse glow + hover lift
 * - Hover: holograma com slogan
 */

const MEDAL_SRC: Record<string, { src: string; aspectRatio: string }> = {
  ROOKIE:   { src: '/medals/rookie.png',   aspectRatio: '441 / 377' },
  ELITE:    { src: '/medals/elite.png',    aspectRatio: '473 / 377' },
  CHAMPION: { src: '/medals/champion.png', aspectRatio: '515 / 377' },
  LEGEND:   { src: '/medals/legend.png',   aspectRatio: '795 / 569' },
};

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

  const baseWidth = 110 + tier.sizeLevel * 14;
  const isLegend = tier.englishName === 'LEGEND';
  const medalInfo = MEDAL_SRC[tier.englishName] || MEDAL_SRC.ROOKIE;

  const lockedFilter = achieved
    ? `drop-shadow(0 6px 20px ${tier.primaryColor}55)`
    : 'grayscale(0.85) brightness(0.55) contrast(0.95)';
  const lockedOpacity = achieved ? 1 : 0.55;

  return (
    <div
      className="group relative flex flex-col items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Glow ring achieved */}
      <div
        aria-hidden
        className={
          'absolute rounded-full transition-all duration-500 pointer-events-none ' +
          (achieved ? 'animate-pulse' : '')
        }
        style={{
          width: baseWidth + (isLegend ? 80 : 40),
          height: baseWidth + (isLegend ? 80 : 40),
          background: achieved
            ? `radial-gradient(circle, ${tier.primaryColor}66, transparent 70%)`
            : 'transparent',
          filter: achieved ? 'blur(16px)' : 'none',
          top: isLegend ? -24 : -10,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      <div
        className="relative z-10 flex items-center justify-center transition-all duration-300"
        style={{
          width: isLegend ? baseWidth + 50 : baseWidth,
          transform: hover && achieved ? 'translateY(-4px) scale(1.05)' : undefined,
          filter: lockedFilter,
          opacity: lockedOpacity,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={medalInfo.src}
          alt={tier.englishName}
          style={{
            width: '100%',
            height: 'auto',
            aspectRatio: medalInfo.aspectRatio,
            display: 'block',
            objectFit: 'contain',
          }}
          draggable={false}
        />
      </div>

      <div className="relative z-10 mt-3 text-center">
        <div
          className="mono text-[11px] uppercase tracking-widest font-bold"
          style={{
            color: achieved ? tier.primaryColor : '#71717A',
            textShadow: achieved ? `0 0 8px ${tier.primaryColor}88` : 'none',
          }}
        >
          {tier.englishName}
        </div>
        <div className="mono text-[10px] uppercase tracking-widest text-text-muted mt-0.5">
          {tier.minPoints} pts · {fmtBRL(tier.bonusBRL)}
        </div>
      </div>

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

      {!achieved && currentPoints > 0 && currentPoints < tier.minPoints ? (
        (() => {
          const isNextTarget = [60, 90, 120, 150].find((p) => p > currentPoints) === tier.minPoints;
          if (!isNextTarget) return null;
          const pct = Math.round((currentPoints / tier.minPoints) * 100);
          return (
            <div className="mt-2 w-[100px]">
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
