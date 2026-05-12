'use client';

import { useState } from 'react';
import type { PointsTier } from '@/lib/points-system';
import { fmtBRL } from '@/lib/points-system';

/**
 * MedalCard — 4 designs SVG detalhados pra match a imagem de referencia.
 * NOTA HONESTA: SVG nao consegue 100% fotorrealismo (textura carbon fiber
 * real, brilho 3D de metal polido, refracao de diamante). Se ficar muito
 * abaixo do esperado, melhor solucao = exportar 4 PNGs da imagem original
 * e usar <img src> dos PNGs em vez de SVG inline.
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

  const baseSize = 110 + tier.sizeLevel * 14;
  const isLegend = tier.englishName === 'LEGEND';
  const isRookie = tier.englishName === 'ROOKIE';
  const isElite = tier.englishName === 'ELITE';
  const isChampion = tier.englishName === 'CHAMPION';

  const lockedFilter = achieved ? 'none' : 'grayscale(0.7) brightness(0.65) contrast(0.95)';
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
          width: baseSize + (isLegend ? 70 : 35),
          height: baseSize + (isLegend ? 70 : 35),
          background: achieved
            ? `radial-gradient(circle, ${tier.primaryColor}77, transparent 70%)`
            : 'transparent',
          filter: achieved ? 'blur(14px)' : 'none',
          top: isLegend ? -22 : -8,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      <div
        className="relative z-10 flex items-center justify-center transition-all duration-300"
        style={{
          width: isLegend ? baseSize + 50 : baseSize,
          height: isLegend ? baseSize + 20 : baseSize,
          transform: hover && achieved ? 'translateY(-4px) scale(1.05)' : undefined,
          filter: lockedFilter,
          opacity: lockedOpacity,
        }}
      >
        {isRookie && <RookieMedal size={baseSize} />}
        {isElite && <EliteMedal size={baseSize} />}
        {isChampion && <ChampionMedal size={baseSize} />}
        {isLegend && <LegendMedal size={baseSize + 40} />}
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
          const isNextTarget = [60, 90, 120, 150].find(p => p > currentPoints) === tier.minPoints;
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

/* ====================== DESIGNS POR TIER ====================== */
/* Pra cada medal: SVG inline com muito mais detalhe que antes. */

/** ROOKIE — Black carbon-fiber badge hexagonal/octagonal com X-cross */
function RookieMedal({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))' }}>
      <defs>
        <radialGradient id="r-bg" cx="0.4" cy="0.3" r="0.9">
          <stop offset="0%" stopColor="#52525B" />
          <stop offset="40%" stopColor="#27272A" />
          <stop offset="100%" stopColor="#09090B" />
        </radialGradient>
        <linearGradient id="r-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#71717A" />
          <stop offset="50%" stopColor="#3F3F46" />
          <stop offset="100%" stopColor="#18181B" />
        </linearGradient>
        <pattern id="r-carbon" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#27272A" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#3F3F46" strokeWidth="1" />
          <line x1="4" y1="0" x2="4" y2="8" stroke="#18181B" strokeWidth="1" />
        </pattern>
        <radialGradient id="r-shine" cx="0.5" cy="0.2" r="0.4">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Octagon outer rim (chanfrado) */}
      <polygon
        points="100,8 142,25 175,58 192,100 175,142 142,175 100,192 58,175 25,142 8,100 25,58 58,25"
        fill="url(#r-rim)"
        stroke="#18181B"
        strokeWidth="2"
      />
      {/* Inner octagon — carbon pattern */}
      <polygon
        points="100,22 134,34 162,62 178,100 162,138 134,166 100,178 66,166 38,138 22,100 38,62 66,34"
        fill="url(#r-carbon)"
      />
      {/* Soft inner background */}
      <polygon
        points="100,22 134,34 162,62 178,100 162,138 134,166 100,178 66,166 38,138 22,100 38,62 66,34"
        fill="url(#r-bg)"
        opacity="0.6"
      />

      {/* Inner double ring metal */}
      <circle cx="100" cy="100" r="62" fill="none" stroke="#52525B" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="58" fill="none" stroke="#27272A" strokeWidth="0.8" />

      {/* Decorative studs around */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * 45 + 22.5) * Math.PI / 180;
        return <circle key={i} cx={100 + Math.cos(a) * 76} cy={100 + Math.sin(a) * 76} r="2.5" fill="#71717A" />;
      })}

      {/* X-cross emblem central — multi-layer */}
      <g transform="translate(100 100)">
        {/* Outer X shape */}
        <path
          d="M -36,-36 L -14,-14 L 0,-38 L 14,-14 L 36,-36 L 14,0 L 36,36 L 14,14 L 0,38 L -14,14 L -36,36 L -14,0 Z"
          fill="#71717A"
          stroke="#A1A1AA"
          strokeWidth="0.8"
        />
        {/* Inner X */}
        <path
          d="M -20,-20 L -8,-8 L 0,-22 L 8,-8 L 20,-20 L 8,0 L 20,20 L 8,8 L 0,22 L -8,8 L -20,20 L -8,0 Z"
          fill="#27272A"
          stroke="#52525B"
          strokeWidth="0.5"
        />
        {/* Central diamond */}
        <polygon points="0,-6 5,0 0,6 -5,0" fill="#3F3F46" stroke="#71717A" strokeWidth="0.5" />
      </g>

      {/* Top reflection */}
      <ellipse cx="100" cy="50" rx="65" ry="20" fill="url(#r-shine)" />
    </svg>
  );
}

/** ELITE — Silver ornate medallion com starburst + filigree pesada */
function EliteMedal({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))' }}>
      <defs>
        <radialGradient id="e-bg" cx="0.5" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="#FAFAFA" />
          <stop offset="40%" stopColor="#D4D4D8" />
          <stop offset="75%" stopColor="#71717A" />
          <stop offset="100%" stopColor="#3F3F46" />
        </radialGradient>
        <linearGradient id="e-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="40%" stopColor="#E5E7EB" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#52525B" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="e-spike" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9FAFB" />
          <stop offset="50%" stopColor="#9CA3AF" />
          <stop offset="100%" stopColor="#4B5563" />
        </linearGradient>
      </defs>

      {/* 16-point starburst BIG */}
      <g transform="translate(100 100)">
        {Array.from({ length: 16 }).map((_, i) => {
          const a = (i * 22.5 - 90) * Math.PI / 180;
          const a1 = ((i * 22.5 + 11.25) - 90) * Math.PI / 180;
          const a2 = ((i * 22.5 - 11.25) - 90) * Math.PI / 180;
          const longR = i % 2 === 0 ? 92 : 76;
          const shortR = 55;
          return (
            <polygon
              key={i}
              points={`${Math.cos(a) * longR},${Math.sin(a) * longR} ${Math.cos(a1) * shortR},${Math.sin(a1) * shortR} ${Math.cos(a2) * shortR},${Math.sin(a2) * shortR}`}
              fill="url(#e-spike)"
              stroke="#6B7280"
              strokeWidth="0.6"
            />
          );
        })}
      </g>

      {/* Inner large ornate circle */}
      <circle cx="100" cy="100" r="55" fill="url(#e-bg)" stroke="#4B5563" strokeWidth="2" />

      {/* Filigree dotted ring */}
      <g transform="translate(100 100)">
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10) * Math.PI / 180;
          return <circle key={i} cx={Math.cos(a) * 50} cy={Math.sin(a) * 50} r="1.2" fill="#374151" />;
        })}
      </g>

      {/* Concentric filigree lines */}
      <circle cx="100" cy="100" r="47" fill="none" stroke="#9CA3AF" strokeWidth="0.4" />
      <circle cx="100" cy="100" r="43" fill="none" stroke="#374151" strokeWidth="0.8" />

      {/* Inner medallion bg */}
      <circle cx="100" cy="100" r="40" fill="url(#e-bg)" stroke="#4B5563" strokeWidth="1" />

      {/* Decorative inner pattern — 8 small leaves */}
      <g transform="translate(100 100)">
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * 45) * Math.PI / 180;
          const x = Math.cos(a) * 32;
          const y = Math.sin(a) * 32;
          return (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="4"
              ry="2"
              transform={`rotate(${i * 45} ${x} ${y})`}
              fill="#4B5563"
              opacity="0.5"
            />
          );
        })}
      </g>

      {/* X-cross emblem central */}
      <g transform="translate(100 100)">
        <path
          d="M -26,-26 L -10,-10 L 0,-28 L 10,-10 L 26,-26 L 10,0 L 26,26 L 10,10 L 0,28 L -10,10 L -26,26 L -10,0 Z"
          fill="#1F2937"
          stroke="#374151"
          strokeWidth="1"
        />
        {/* Inner X gradient */}
        <path
          d="M -14,-14 L -5,-5 L 0,-15 L 5,-5 L 14,-14 L 5,0 L 14,14 L 5,5 L 0,15 L -5,5 L -14,14 L -5,0 Z"
          fill="#9CA3AF"
        />
        {/* Center gem */}
        <circle r="5" fill="#FAFAFA" />
        <circle r="3" fill="#E5E7EB" />
      </g>

      {/* Top shine */}
      <ellipse cx="100" cy="55" rx="50" ry="15" fill="url(#e-shine)" />
    </svg>
  );
}

/** CHAMPION — Gold ornate, mesma estrutura ELITE com tons quentes */
function ChampionMedal({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ filter: 'drop-shadow(0 4px 12px rgba(180,83,9,0.5))' }}>
      <defs>
        <radialGradient id="c-bg" cx="0.5" cy="0.35" r="0.7">
          <stop offset="0%" stopColor="#FEF3C7" />
          <stop offset="35%" stopColor="#FCD34D" />
          <stop offset="75%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#78350F" />
        </radialGradient>
        <linearGradient id="c-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFBEB" stopOpacity="0.8" />
          <stop offset="40%" stopColor="#FCD34D" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#92400E" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="c-spike" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FEF3C7" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#78350F" />
        </linearGradient>
      </defs>

      {/* Starburst 16 pontas */}
      <g transform="translate(100 100)">
        {Array.from({ length: 16 }).map((_, i) => {
          const a = (i * 22.5 - 90) * Math.PI / 180;
          const a1 = ((i * 22.5 + 11.25) - 90) * Math.PI / 180;
          const a2 = ((i * 22.5 - 11.25) - 90) * Math.PI / 180;
          const longR = i % 2 === 0 ? 92 : 76;
          const shortR = 55;
          return (
            <polygon
              key={i}
              points={`${Math.cos(a) * longR},${Math.sin(a) * longR} ${Math.cos(a1) * shortR},${Math.sin(a1) * shortR} ${Math.cos(a2) * shortR},${Math.sin(a2) * shortR}`}
              fill="url(#c-spike)"
              stroke="#92400E"
              strokeWidth="0.6"
            />
          );
        })}
      </g>

      <circle cx="100" cy="100" r="55" fill="url(#c-bg)" stroke="#92400E" strokeWidth="2" />

      {/* Filigree dots */}
      <g transform="translate(100 100)">
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10) * Math.PI / 180;
          return <circle key={i} cx={Math.cos(a) * 50} cy={Math.sin(a) * 50} r="1.2" fill="#78350F" />;
        })}
      </g>

      <circle cx="100" cy="100" r="47" fill="none" stroke="#FCD34D" strokeWidth="0.4" />
      <circle cx="100" cy="100" r="43" fill="none" stroke="#78350F" strokeWidth="0.8" />
      <circle cx="100" cy="100" r="40" fill="url(#c-bg)" stroke="#92400E" strokeWidth="1" />

      {/* Inner decorative leaves */}
      <g transform="translate(100 100)">
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * 45) * Math.PI / 180;
          const x = Math.cos(a) * 32;
          const y = Math.sin(a) * 32;
          return (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="4"
              ry="2"
              transform={`rotate(${i * 45} ${x} ${y})`}
              fill="#92400E"
              opacity="0.6"
            />
          );
        })}
      </g>

      {/* X-cross central */}
      <g transform="translate(100 100)">
        <path
          d="M -26,-26 L -10,-10 L 0,-28 L 10,-10 L 26,-26 L 10,0 L 26,26 L 10,10 L 0,28 L -10,10 L -26,26 L -10,0 Z"
          fill="#451A03"
          stroke="#78350F"
          strokeWidth="1"
        />
        <path
          d="M -14,-14 L -5,-5 L 0,-15 L 5,-5 L 14,-14 L 5,0 L 14,14 L 5,5 L 0,15 L -5,5 L -14,14 L -5,0 Z"
          fill="#FCD34D"
        />
        <circle r="5" fill="#FEF3C7" />
        <circle r="3" fill="#FCD34D" />
      </g>

      <ellipse cx="100" cy="55" rx="50" ry="15" fill="url(#c-shine)" />
    </svg>
  );
}

/** LEGEND — Pink diamond + wings + sparkles (mais elaborado) */
function LegendMedal({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 260 200" width={size} height={size * 200 / 260} style={{ filter: 'drop-shadow(0 6px 16px rgba(236,72,153,0.5))' }}>
      <defs>
        <linearGradient id="l-diamond" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#FBCFE8" />
          <stop offset="70%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#9D174D" />
        </linearGradient>
        <linearGradient id="l-wing" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="40%" stopColor="#FBCFE8" />
          <stop offset="80%" stopColor="#F472B6" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#EC4899" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id="l-gem" cx="0.35" cy="0.25" r="0.8">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#FBCFE8" />
          <stop offset="100%" stopColor="#EC4899" />
        </radialGradient>
        <radialGradient id="l-burst" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FBCFE8" stopOpacity="0" />
        </radialGradient>
        <filter id="l-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background burst */}
      <circle cx="130" cy="100" r="85" fill="url(#l-burst)" />

      {/* === ASAS === */}
      <g transform="translate(130 100)" filter="url(#l-glow)">
        {/* ASA ESQUERDA — 6 plumas */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const yBase = -35 + i * 8;
          const reach = 70 + i * 4;
          const droop = i * 4;
          return (
            <path
              key={'L' + i}
              d={`M -30,${yBase}
                  C -${50 + droop},${yBase - 8 + i * 2} -${reach},${yBase - 5 + i * 5} -${reach + 5},${yBase + 8 + i * 3}
                  C -${reach},${yBase + 10 + i * 4} -${50 + droop},${yBase + 5 + i * 4} -30,${yBase + 6}
                  Z`}
              fill="url(#l-wing)"
              opacity={0.95 - i * 0.05}
              stroke="#F9A8D4"
              strokeWidth="0.6"
            />
          );
        })}
        {/* ASA DIREITA — espelho */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const yBase = -35 + i * 8;
          const reach = 70 + i * 4;
          const droop = i * 4;
          return (
            <path
              key={'R' + i}
              d={`M 30,${yBase}
                  C ${50 + droop},${yBase - 8 + i * 2} ${reach},${yBase - 5 + i * 5} ${reach + 5},${yBase + 8 + i * 3}
                  C ${reach},${yBase + 10 + i * 4} ${50 + droop},${yBase + 5 + i * 4} 30,${yBase + 6}
                  Z`}
              fill="url(#l-wing)"
              opacity={0.95 - i * 0.05}
              stroke="#F9A8D4"
              strokeWidth="0.6"
            />
          );
        })}
      </g>

      {/* Diamantes orbitais ao redor (12) */}
      <g transform="translate(130 100)">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 - 90) * Math.PI / 180;
          const dist = 48;
          const x = Math.cos(a) * dist;
          const y = Math.sin(a) * dist;
          return (
            <g key={i} transform={`translate(${x} ${y}) rotate(${i * 30})`}>
              <polygon points="0,-5 4,0 0,5 -4,0" fill="url(#l-gem)" stroke="#EC4899" strokeWidth="0.5" />
              <polygon points="0,-5 2,-1 0,0 -2,-1" fill="#FFFFFF" opacity="0.8" />
            </g>
          );
        })}
      </g>

      {/* === DIAMANTE CENTRAL FACETADO === */}
      <g transform="translate(130 100)">
        {/* Outer diamond shape */}
        <polygon
          points="0,-42 28,-15 32,5 24,30 0,42 -24,30 -32,5 -28,-15"
          fill="url(#l-diamond)"
          stroke="#9D174D"
          strokeWidth="1.5"
        />
        {/* Faceting facets (multiplos triangulos) */}
        <polygon points="0,-42 14,-25 -14,-25" fill="#FFFFFF" opacity="0.8" />
        <polygon points="14,-25 28,-15 14,0" fill="#FBCFE8" opacity="0.7" />
        <polygon points="-14,-25 -28,-15 -14,0" fill="#F472B6" opacity="0.5" />
        <polygon points="14,0 28,-15 32,5 24,15" fill="#EC4899" opacity="0.6" />
        <polygon points="-14,0 -28,-15 -32,5 -24,15" fill="#BE185D" opacity="0.6" />
        <polygon points="14,0 -14,0 0,15" fill="#F472B6" opacity="0.5" />
        <polygon points="0,15 -14,0 -24,15 -24,30 0,42" fill="#BE185D" opacity="0.7" />
        <polygon points="0,15 14,0 24,15 24,30 0,42" fill="#9D174D" opacity="0.5" />

        {/* Inner X-cross emblem */}
        <g opacity="0.95">
          <path
            d="M -12,-12 L -5,-5 L 0,-13 L 5,-5 L 12,-12 L 5,0 L 12,12 L 5,5 L 0,13 L -5,5 L -12,12 L -5,0 Z"
            fill="#FFFFFF"
            stroke="#FBCFE8"
            strokeWidth="0.6"
          />
          <circle r="2.5" fill="#FBCFE8" />
        </g>

        {/* Top reflection on diamond */}
        <ellipse cx="0" cy="-24" rx="16" ry="5" fill="rgba(255,255,255,0.7)" />
        <ellipse cx="-6" cy="-30" rx="4" ry="2" fill="rgba(255,255,255,0.9)" />
      </g>

      {/* Sparkles ao redor */}
      <g fill="#FFFFFF">
        <g transform="translate(40 50)">
          <path d="M 0,-4 L 1,-1 L 4,0 L 1,1 L 0,4 L -1,1 L -4,0 L -1,-1 Z" />
        </g>
        <g transform="translate(220 60)">
          <path d="M 0,-3 L 1,-1 L 3,0 L 1,1 L 0,3 L -1,1 L -3,0 L -1,-1 Z" />
        </g>
        <g transform="translate(30 140)">
          <path d="M 0,-3 L 1,-1 L 3,0 L 1,1 L 0,3 L -1,1 L -3,0 L -1,-1 Z" />
        </g>
        <g transform="translate(230 150)">
          <path d="M 0,-4 L 1,-1 L 4,0 L 1,1 L 0,4 L -1,1 L -4,0 L -1,-1 Z" />
        </g>
        <circle cx="60" cy="30" r="1" opacity="0.8" />
        <circle cx="200" cy="35" r="1" opacity="0.8" />
        <circle cx="65" cy="175" r="0.8" opacity="0.6" />
        <circle cx="195" cy="175" r="0.8" opacity="0.6" />
      </g>
    </svg>
  );
}
