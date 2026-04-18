'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type Tab = {
  label: string;
  href: string;
};

/**
 * Navegação por tabs com underline lime no tab ativo.
 * Scroll horizontal em mobile.
 */
export function TabNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line">
      <div className="container-app -mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'tab-link',
                active && 'tab-link-active'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
