'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type Tier = 'free' | 'beta' | 'admin';

/**
 * Hook que retorna o tier da conta logada.
 *
 * Retorna `null` enquanto carrega. Se não conseguir resolver, retorna 'free'
 * por segurança (UI conservadora) — o bloqueio REAL é no middleware/server.
 */
export function useTier(): Tier | null {
  const [tier, setTier] = useState<Tier | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) {
          if (!cancelled) setTier('free');
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('tier, is_admin, is_active')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled) return;
        // Tier direto da coluna; fallback derivado pra retrocompat
        const resolved: Tier =
          (data?.tier as Tier | undefined) ??
          (data?.is_admin
            ? 'admin'
            : data?.is_active
              ? 'beta'
              : 'free');
        setTier(resolved);
      } catch {
        if (!cancelled) setTier('free');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return tier;
}

export function tierAllowsTool(tier: Tier | null, toolHref: string): boolean {
  if (!tier) return false;
  if (tier === 'admin' || tier === 'beta') {
    // Beta acessa tudo exceto admin-only (filtrado em outro lugar)
    return true;
  }
  // Free acessa Decupagem (áudio) e Downloader
  const allowed = ['/tools/decupagem', '/tools/downloader'];
  return allowed.some((p) => toolHref === p || toolHref.startsWith(p + '/'));
}
