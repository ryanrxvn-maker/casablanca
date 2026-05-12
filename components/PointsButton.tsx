'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tierAchieved, loadHistory, currentMonthKey, type MonthHistory } from '@/lib/points-system';

/**
 * Botão 3D pro Sistema de Pontos — top-bar.
 * Mostra tier atual se houver historico do mes corrente, senao animacao
 * de "earn" pulsando pra incentivar uso.
 */
export function PointsButton() {
  const [currentTierName, setCurrentTierName] = useState<string | null>(null);
  const [tierColor, setTierColor] = useState<string>('#FBBF24');

  useEffect(() => {
    function check() {
      const history = loadHistory();
      const cur = currentMonthKey();
      const monthEntry = history.find((h: MonthHistory) => h.monthKey === cur);
      if (monthEntry?.tier) {
        setCurrentTierName(monthEntry.tier.englishName);
        setTierColor(monthEntry.tier.primaryColor);
      } else {
        setCurrentTierName(null);
      }
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const active = !!currentTierName;

  return (
    <Link
      href="/tools/points"
      aria-label="Sistema de Pontos"
      title={active ? `${currentTierName} este mês` : 'Sistema de Pontos'}
      className="group relative inline-flex select-none items-center gap-2 rounded-full px-3 py-1.5 ring-1 transition-all duration-300 hover:scale-[1.04] active:scale-[0.96]"
      style={{
        background: active
          ? `linear-gradient(135deg, ${tierColor}20, transparent)`
          : 'linear-gradient(to right, rgba(251,191,36,0.08), rgba(168,85,247,0.08))',
        borderColor: active ? tierColor + '60' : 'transparent',
        boxShadow: active
          ? `0 0 16px -4px ${tierColor}80, inset 0 1px 0 rgba(255,255,255,0.06)`
          : '0 0 14px -6px rgba(251,191,36,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
        // @ts-expect-error css var
        '--tw-ring-color': active ? tierColor + '80' : 'rgba(82,82,91,0.4)',
      }}
    >
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center" style={{ color: active ? tierColor : '#A1A1AA' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
        </svg>
      </span>
      <span className="relative z-10 hidden text-[11px] font-bold uppercase tracking-widest md:inline" style={{ color: active ? tierColor : '#A1A1AA' }}>
        {active ? currentTierName : 'Pontos'}
      </span>
    </Link>
  );
}
