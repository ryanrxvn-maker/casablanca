'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadHistory, currentMonthKey, type MonthHistory } from '@/lib/points-system';
import { createClient } from '@/lib/supabase/client';

/**
 * PointsButton v5 — só visível pra admin.
 *
 * Pontos é um sistema interno do admin. Usuários comuns nem veem o botão.
 */
export function PointsButton() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tierName, setTierName] = useState<string | null>(null);
  const [tierColor, setTierColor] = useState<string>('#fbbf24');

  // Detecta admin
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) {
          if (!cancelled) setIsAdmin(false);
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);

  // Se ainda não sabemos se é admin OU não é admin → não renderiza
  if (!isAdmin) return null;

  const active = !!tierName;

  return (
    <Link
      href="/tools/points"
      aria-label="Pontos"
      title={active ? `${tierName} este mês` : 'Pontos'}
      className="topbar-icon group"
      style={{
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
