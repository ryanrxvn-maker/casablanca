'use client';

/**
 * Sino no topo, ao lado da calculadora (toda conta tem). Leva pro histórico
 * em /tools/notificacoes e mostra quantas não lidas. Quando chega aviso novo
 * com a página aberta, o sino balança UMA vez (nada em loop).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '@/lib/notifications-client';
import { AnnIcon } from './templates';

export function NotificationsButton() {
  const pathname = usePathname();
  const { unread, status } = useNotifications();
  const active = pathname?.startsWith('/tools/notificacoes') ?? false;
  const count = status === 'ready' ? unread : 0;

  // Balança só quando o número SOBE depois da primeira leitura.
  const prev = useRef<number | null>(null);
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (status !== 'ready') return;
    if (prev.current !== null && count > prev.current) setRing((n) => n + 1);
    prev.current = count;
  }, [count, status]);

  const label = count ? `Notificações: ${count} ${count === 1 ? 'não lida' : 'não lidas'}` : 'Notificações';

  return (
    <Link
      href="/tools/notificacoes"
      aria-label={label}
      title={label}
      data-active={active ? 'true' : undefined}
      className="topbar-icon group"
      style={{
        ['--ti-color' as string]: active || count ? '#c084fc' : '#9c9ca6',
        ['--ti-glow' as string]: active ? 'rgba(167,139,250,0.55)' : 'transparent',
      }}
    >
      <span key={ring} className={ring ? 'ann-bell-ring inline-flex' : 'inline-flex'}>
        <AnnIcon.bell size={17} />
      </span>
      {count ? (
        <span
          key={`b${count}`}
          className="topbar-icon-badge ann-badge-pop"
          style={{
            background: 'linear-gradient(135deg, #a78bfa 0%, #6366f1 100%)',
            borderColor: 'rgb(var(--bg-soft))',
            fontFamily: 'var(--font-label), var(--font-display), system-ui',
            fontSize: 10,
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
