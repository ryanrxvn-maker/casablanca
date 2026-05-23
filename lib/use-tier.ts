'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type Tier = 'free' | 'basic' | 'pro' | 'admin';

/** Conjunto de ferramentas (paths) liberadas por tier. */
const TIER_PATHS: Record<Tier, ReadonlySet<string>> = {
  free: new Set(['/tools/decupagem', '/tools/downloader']),
  basic: new Set([
    '/tools/decupagem',
    '/tools/downloader',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/normalizador',
    '/tools/take-splitter',
    '/tools/calculadora',
    '/tools/remover-elementos',
    '/tools/copy-srt',
    // ⚠ NÃO inclui: auto-broll, troca-produto, heygen-auto, decupagem-copy (smart decup), ltx-video, clickup-pilot
  ]),
  pro: new Set([
    // pro = tudo
    '/tools/decupagem',
    '/tools/downloader',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/normalizador',
    '/tools/take-splitter',
    '/tools/calculadora',
    '/tools/remover-elementos',
    '/tools/copy-srt',
    '/tools/auto-broll',
    '/tools/troca-produto',
    '/tools/heygen-auto',
    '/tools/decupagem-copy',
    '/tools/clickup-pilot',
  ]),
  admin: new Set([]), // admin é tratado por bypass (allow tudo)
};

/**
 * Hook que retorna o tier da conta logada.
 *
 * Retorna `null` enquanto carrega. Em erro retorna 'free' por segurança.
 * Aceita compat: tier='beta' no banco vira 'pro' na UI.
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
        const raw = (data?.tier ?? '').toString();
        let resolved: Tier;
        if (data?.is_admin) {
          resolved = 'admin';
        } else if (raw === 'pro' || raw === 'beta') {
          // 'beta' = legado, agora vira 'pro'
          resolved = 'pro';
        } else if (raw === 'basic') {
          resolved = 'basic';
        } else if (raw === 'free') {
          resolved = 'free';
        } else {
          // Sem tier explícito mas ativo? fallback pra free
          resolved = data?.is_active ? 'free' : 'free';
        }
        setTier(resolved);
      } catch {
        if (!cancelled) setTier('free');
      }
    })();
  }, []);

  return tier;
}

export function tierAllowsTool(tier: Tier | null, toolHref: string): boolean {
  if (!tier) return false;
  if (tier === 'admin') return true; // admin acessa tudo
  const set = TIER_PATHS[tier];
  return Array.from(set).some(
    (p) => toolHref === p || toolHref.startsWith(p + '/'),
  );
}

/** Admin / Pro podem disparar automação Pilot. */
export function tierCanAutomate(tier: Tier | null): boolean {
  return tier === 'admin' || tier === 'pro';
}

/** Cor de destaque do tier (pra moldura de avatar, badges, etc) */
export function tierAccent(tier: Tier | null): {
  primary: string;
  glow: string;
  label: string;
} {
  switch (tier) {
    case 'admin':
      return {
        primary: '#c8ff00',
        glow: 'rgba(200,255,0,0.6)',
        label: 'Admin',
      };
    case 'pro':
      return {
        primary: '#c084fc',
        glow: 'rgba(192,132,252,0.6)',
        label: 'Pro',
      };
    case 'basic':
      return {
        primary: '#f472b6',
        glow: 'rgba(244,114,182,0.55)',
        label: 'Basic',
      };
    case 'free':
    default:
      return {
        primary: '#8b8b96',
        glow: 'rgba(139,139,150,0.4)',
        label: 'Free',
      };
  }
}
