'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadHistory, currentMonthKey, type MonthHistory } from '@/lib/points-system';

/**
 * PointsButton v4 — ícone-only no top-bar.
 *
 * Mostra o tier atual como cor do ícone. Sem texto, só tooltip — toolbar
 * fica limpa. Pequeno glow respira quando há tier conquistado no mês.
 */
export function PointsButton() {
  const [tierName, setTierName] = useState<string | null>(null);
  const [tierColor, setTierColor] = useState<string>('#fbbf24');

  useEffect(() => {
    function check() {
      const history = loadHistory();
      const cur = currentMonthKey();
      const monthEntry = history.find((h: MonthHistory) => h.monthKey === cur);
      if (monthEntry?.tier) {
        setTierName(monthEntry.tier.englishName);
        setTierColor(monthEntry.tier.primaryColor);
      } else {
        setTierName(null);
      }
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const active = !!tierName;

  return (
    <Link
      href="/tools/points"
      aria-label="Pontos"
      title={active ? `${tierName} este mês` : 'Pontos'}
      className="topbar-icon group"
      style={{
        // CSS vars consumidas pelo .topbar-icon (definido em globals.css)
        ['--ti-color' as string]: active ? tierColor : '#9c9ca6',
        ['--ti-glow' as string]: active ? tierColor + '70' : 'transparent',
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
        <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
      </svg>
      {active ? (
        <span
          aria-hidden
          className="topbar-icon-dot"
          style={{ background: tierColor, boxShadow: `0 0 8px ${tierColor}` }}
        />
      ) : null}
    </Link>
  );
}
