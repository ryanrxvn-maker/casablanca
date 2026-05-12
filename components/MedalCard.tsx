'use client';

import { useState } from 'react';
import type { PointsTier } from '@/lib/points-system';
import { fmtBRL } from '@/lib/points-system';

/**
 * MedalCard — 4 designs visuais distintos por tier (match com a imagem
 * de referencia do user):
 *   - ROOKIE   → carbon fiber escuro com X-emblem
 *   - ELITE    → prata polida ornate
 *   - CHAMPION → ouro polido ornate
 *   - LEGEND   → diamante rosa/iridescente + asas
 *
 * Locked: design apagado (grayscale + opacity reduzida)
 * Achieved: cores vivas + animacao pulse + glow
 * Hover: holograma com slogan
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

  // Tamanho base aumenta com sizeLevel (Rookie pequeno, Legend grande)
  const baseSize = 90 + tier.sizeLevel * 14;
  const isLegend = tier.englishName === 'LEGEND';
  const isRookie = tier.englishName === 'ROOKIE';
  const isElite = tier.englishName === 'ELITE';
  const isChampion = tier.englishName === 'CHAMPION';

  // Filtros pra estado locked
  const lockedFilter = achieved ? 'none' : 'grayscale(0.85) brightness(0.55) contrast(0.9)';
  const lockedOpacity = achieved ? 1 : 0.55;

  return (
    <div
      className="group relative flex flex-col items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Glow ring animado (so achieved) */}
      <div
        aria-hidden
        className={
          'absolute rounded-full transition-all duration-500 pointer-events-none ' +
          (achieved ? 'animate-pulse' : '')
        }
        style={{
          width: baseSize + (isLegend ? 60 : 30),
          height: baseSize + (isLegend ? 60 : 30),
          background: achieved
            ? `radial-gradient(circle, ${tier.primaryColor}66, transparent 70%)`
            : 'transparent',
          filter: achieved ? 'blur(12px)' : 'none',
          top: isLegend ? -16 : 0,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />

      {/* Container do design da medalha */}
      <div
        className="relative z-10 flex items-center justify-center transition-all duration-300"
        style={{
          width: isLegend ? baseSize + 40 : baseSize,
          height: isLegend ? baseSize + 20 : baseSize,
          transform: hover && achieved ? 'translateY(-4px) scale(1.04)' : undefined,
          filter: lockedFilter,
          opacity: lockedOpacity,
        }}
      >
        {isRookie && <RookieMedal size={baseSize} achieved={achieved} />}
        {isElite && <EliteMedal size={baseSize} achieved={achieved} />}
        {isChampion && <ChampionMedal size={baseSize} achieved={achieved} />}
        {isLegend && <LegendMedal size={baseSize + 30} achieved={achieved} />}
      </div>

      {/* Label */}
      <div className="relative z-10 mt-3 text-center">
        <div
          className="mono text-[11px] uppercase tracking-widest font-semibold"
          style={{
            color: achieved ? tier.primaryColor : '#71717A',
            textShadow: achieved ? `0 0 8px ${tier.primaryColor}80` : 'none',
          }}
        >
          {tier.englishName}
        </div>
        <div className="mono text-[10px] uppercase tracking-widest text-text-muted mt-0.5">
          {tier.minPoints} pts · {fmtBRL(tier.bonusBRL)}
        </div>
      </div>

      {/* Holograma slogan no hover */}
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

/* ============= DESIGNS POR TIER ============= */

/** ROOKIE — Carbon fiber escuro, hexagonal-style com cruz/X central */
function RookieMedal({ size, achieved }: { size: number; achieved: boolean }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <defs>
        <radialGradient id="rookieBg" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0%" stopColor="#52525B" />
          <stop offset="60%" stopColor="#27272A" />
          <stop offset="100%" stopColor="#0a0a0c" />
        </radialGradient>
        <pattern id="carbonPattern" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#27272A" />
          <path d="M0,3 L3,0 L6,3 L3,6 Z" fill="#3F3F46" opacity="0.4" />
        </pattern>
        <linearGradient id="rookieRim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#71717A" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#1f1f23" />
        </linearGradient>
      </defs>
      {/* Outer hex/badge shape */}
      <polygon points="60,5 95,22 105,55 95,88 60,115 25,88 15,55 25,22" fill="url(#rookieRim)" stroke="#3F3F46" strokeWidth="1.5" />
      <polygon points="60,12 88,26 96,55 88,84 60,108 32,84 24,55 32,26" fill="url(#carbonPattern)" />
      <polygon points="60,12 88,26 96,55 88,84 60,108 32,84 24,55 32,26" fill="url(#rookieBg)" opacity="0.5" />
      {/* X emblem central (DARKO LAB style cross) */}
      <g transform="translate(60 60)" opacity="0.9">
        <path d="M -22,-22 L -10,-10 L 0,-22 L 10,-10 L 22,-22 L 10,0 L 22,22 L 10,10 L 0,22 L -10,10 L -22,22 L -10,0 Z"
              fill="#71717A" stroke="#A1A1AA" strokeWidth="0.5" />
      </g>
      {/* Top highlight */}
      <polygon points="60,5 95,22 60,30 25,22" fill="rgba(255,255,255,0.08)" />
    </svg>
  );
}

/** ELITE — Prata polida ornate medallion com filigree */
function EliteMedal({ size, achieved }: { size: number; achieved: boolean }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <defs>
        <radialGradient id="silverBg" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0%" stopColor="#F3F4F6" />
          <stop offset="50%" stopColor="#D1D5DB" />
          <stop offset="100%" stopColor="#6B7280" />
        </radialGradient>
        <linearGradient id="silverShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#E5E7EB" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#9CA3AF" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {/* Outer star-burst ring (12 points) */}
      <g transform="translate(60 60)">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30) * Math.PI / 180;
          const x = Math.cos(a) * 56;
          const y = Math.sin(a) * 56;
          return <circle key={i} cx={x} cy={y} r="4" fill="#9CA3AF" />;
        })}
      </g>
      {/* Outer ornate circle */}
      <circle cx="60" cy="60" r="52" fill="url(#silverBg)" stroke="#6B7280" strokeWidth="1.5" />
      {/* Filigree ring */}
      <circle cx="60" cy="60" r="48" fill="none" stroke="#9CA3AF" strokeWidth="0.5" strokeDasharray="2,2" />
      {/* Inner medallion */}
      <circle cx="60" cy="60" r="38" fill="url(#silverBg)" stroke="#9CA3AF" strokeWidth="1" />
      {/* Cross emblem central */}
      <g transform="translate(60 60)">
        <path d="M -20,-20 L -8,-8 L 0,-20 L 8,-8 L 20,-20 L 8,0 L 20,20 L 8,8 L 0,20 L -8,8 L -20,20 L -8,0 Z"
              fill="#374151" stroke="#1F2937" strokeWidth="0.8" />
        {/* Inner gem highlight */}
        <circle r="4" fill="#E5E7EB" opacity="0.7" />
      </g>
      {/* Top shine overlay */}
      <ellipse cx="60" cy="35" rx="35" ry="12" fill="url(#silverShine)" />
    </svg>
  );
}

/** CHAMPION — Ouro polido ornate */
function ChampionMedal({ size, achieved }: { size: number; achieved: boolean }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <defs>
        <radialGradient id="goldBg" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0%" stopColor="#FEF3C7" />
          <stop offset="40%" stopColor="#FCD34D" />
          <stop offset="80%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#78350F" />
        </radialGradient>
        <linearGradient id="goldShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFBEB" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#FCD34D" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#92400E" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {/* Outer ornate star points (16 pontas, alternando size) */}
      <g transform="translate(60 60)">
        {Array.from({ length: 16 }).map((_, i) => {
          const a = (i * 22.5) * Math.PI / 180;
          const r = i % 2 === 0 ? 58 : 50;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          const x2 = Math.cos(a + 0.196) * 45;
          const y2 = Math.sin(a + 0.196) * 45;
          return <polygon key={i} points={`${x},${y} ${x2},${y2} 0,0`} fill="#B45309" opacity={i % 2 === 0 ? 1 : 0.7} />;
        })}
      </g>
      {/* Outer gold ring */}
      <circle cx="60" cy="60" r="48" fill="url(#goldBg)" stroke="#92400E" strokeWidth="1.5" />
      {/* Decorative filigree (small dots ring) */}
      <g transform="translate(60 60)">
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i * 15) * Math.PI / 180;
          return <circle key={i} cx={Math.cos(a) * 42} cy={Math.sin(a) * 42} r="1.2" fill="#78350F" />;
        })}
      </g>
      {/* Inner medallion */}
      <circle cx="60" cy="60" r="35" fill="url(#goldBg)" stroke="#92400E" strokeWidth="1" />
      {/* Cross emblem central */}
      <g transform="translate(60 60)">
        <path d="M -18,-18 L -7,-7 L 0,-18 L 7,-7 L 18,-18 L 7,0 L 18,18 L 7,7 L 0,18 L -7,7 L -18,18 L -7,0 Z"
              fill="#78350F" stroke="#451A03" strokeWidth="0.8" />
        <circle r="3.5" fill="#FCD34D" opacity="0.9" />
      </g>
      {/* Top shine */}
      <ellipse cx="60" cy="32" rx="32" ry="10" fill="url(#goldShine)" />
    </svg>
  );
}

/** LEGEND — Diamante rosa/iridescente + asas (mais elaborado) */
function LegendMedal({ size, achieved }: { size: number; achieved: boolean }) {
  return (
    <svg viewBox="0 0 160 130" width={size} height={size * 130 / 160}>
      <defs>
        <linearGradient id="legendDiamond" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF1F2" />
          <stop offset="40%" stopColor="#FBCFE8" />
          <stop offset="70%" stopColor="#F472B6" />
          <stop offset="100%" stopColor="#DB2777" />
        </linearGradient>
        <linearGradient id="legendWing" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF1F2" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#FBCFE8" />
          <stop offset="100%" stopColor="#F9A8D4" stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id="legendGem" cx="0.5" cy="0.3" r="0.7">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#FBCFE8" />
          <stop offset="100%" stopColor="#EC4899" />
        </radialGradient>
        <filter id="legendGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* ASAS — esquerda + direita */}
      <g filter="url(#legendGlow)">
        {/* Asa esquerda — varias plumas */}
        <g transform="translate(80 65)">
          {[0, 12, 24, 36, 48].map((offset, i) => (
            <path
              key={'L' + i}
              d={`M -25,${-30 + i * 4} Q -${50 + offset * 0.3},${-25 + i * 6} -${65 + offset * 0.4},${-5 + i * 10} Q -${55 + offset * 0.3},${0 + i * 8} -25,${-15 + i * 4} Z`}
              fill="url(#legendWing)"
              opacity={0.8 - i * 0.1}
            />
          ))}
          {/* Asa direita (espelhada) */}
          {[0, 12, 24, 36, 48].map((offset, i) => (
            <path
              key={'R' + i}
              d={`M 25,${-30 + i * 4} Q ${50 + offset * 0.3},${-25 + i * 6} ${65 + offset * 0.4},${-5 + i * 10} Q ${55 + offset * 0.3},${0 + i * 8} 25,${-15 + i * 4} Z`}
              fill="url(#legendWing)"
              opacity={0.8 - i * 0.1}
            />
          ))}
        </g>
      </g>

      {/* Estrela de diamantes em volta */}
      <g transform="translate(80 65)">
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * 45 - 90) * Math.PI / 180;
          const x = Math.cos(a) * 38;
          const y = Math.sin(a) * 38;
          return (
            <g key={i} transform={`translate(${x} ${y}) rotate(${i * 45})`}>
              <polygon points="0,-5 4,0 0,5 -4,0" fill="url(#legendGem)" stroke="#EC4899" strokeWidth="0.4" />
            </g>
          );
        })}
      </g>

      {/* Diamante central (escudo facetado) */}
      <g transform="translate(80 65)">
        {/* Facets: triangulos formando diamante */}
        <polygon points="0,-30 24,-10 24,10 0,30 -24,10 -24,-10" fill="url(#legendDiamond)" stroke="#DB2777" strokeWidth="1" />
        <polygon points="0,-30 12,-15 -12,-15" fill="#FFF1F2" opacity="0.7" />
        <polygon points="12,-15 24,-10 12,5" fill="#FBCFE8" opacity="0.8" />
        <polygon points="-12,-15 -24,-10 -12,5" fill="#F472B6" opacity="0.6" />
        <polygon points="0,30 12,5 -12,5" fill="#DB2777" opacity="0.6" />
        <polygon points="12,5 24,10 0,30" fill="#EC4899" opacity="0.5" />
        <polygon points="-12,5 -24,10 0,30" fill="#BE185D" opacity="0.5" />
        {/* Cross emblem dentro do diamante */}
        <g opacity="0.85">
          <path d="M -10,-10 L -4,-4 L 0,-10 L 4,-4 L 10,-10 L 4,0 L 10,10 L 4,4 L 0,10 L -4,4 L -10,10 L -4,0 Z"
                fill="#FFFFFF" stroke="#FBCFE8" strokeWidth="0.5" />
        </g>
        {/* Reflexo top */}
        <ellipse cx="0" cy="-18" rx="14" ry="4" fill="rgba(255,255,255,0.6)" />
      </g>

      {/* Sparkles ao redor */}
      <g fill="#FFFFFF" opacity={achieved ? 0.9 : 0.3}>
        <circle cx="30" cy="40" r="1.5" />
        <circle cx="130" cy="45" r="1.5" />
        <circle cx="20" cy="80" r="1" />
        <circle cx="140" cy="85" r="1" />
        <circle cx="50" cy="20" r="0.8" />
        <circle cx="110" cy="25" r="0.8" />
      </g>
    </svg>
  );
}
