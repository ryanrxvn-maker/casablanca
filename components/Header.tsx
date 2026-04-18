'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Brand } from './Brand';
import { createClient } from '@/lib/supabase/client';

/**
 * Header global — usado dentro das áreas logadas.
 * Mostra a brand, badge ONLINE e botão "Sair".
 */
export function Header() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="container-app flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Brand />
          <span className="badge-online hidden md:inline-flex">Online</span>
        </div>

        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden text-xs text-text-muted md:inline">
              {email}
            </span>
          )}
          <Link href="/portfolio" className="btn-ghost hidden md:inline-flex">
            Portfolio
          </Link>
          <button onClick={handleLogout} className="btn-secondary !py-2 !px-3 text-xs">
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
