'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { withRetry } from '@/lib/retry';

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
    '/tools/calculadora',
    '/tools/copy-srt',
    // ⚠ NÃO inclui: auto-broll, heygen-auto, decupagem-copy (smart decup), remover-elementos (smart remover), ltx-video, clickup-pilot
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
    '/tools/calculadora',
    '/tools/remover-elementos',
    '/tools/copy-srt',
    '/tools/auto-broll',
    '/tools/heygen-auto',
    '/tools/decupagem-copy',
    '/tools/clickup-pilot',
    '/tools/separador-audio',
    '/tools/lipsync',
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

    type RowShape = {
      tier?: string | null;
      is_admin?: boolean | null;
      is_active?: boolean | null;
    };

    // Resolve o tier real. LANÇA em falha transitória (rede/cold-start) pra que
    // o withRetry re-tente — sem isso, a 1ª falha grudava a UI em free até F5.
    async function resolveTier(): Promise<Tier> {
      const supabase = createClient();
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const uid = u.user?.id;
      // Sem uid = genuinamente deslogado (não é erro) → free, sem re-tentar.
      if (!uid) return 'free';

      // Tenta select com tier; se a coluna faltar (compat schema antigo), cai
      // pro básico. Só LANÇA se o básico também falhar (erro real de rede).
      let data: RowShape | null = null;
      const full = await supabase
        .from('profiles')
        .select('tier, is_admin, is_active')
        .eq('id', uid)
        .maybeSingle();
      if (full.error) {
        const basic = await supabase
          .from('profiles')
          .select('is_admin, is_active')
          .eq('id', uid)
          .maybeSingle();
        if (basic.error) throw basic.error;
        data = (basic.data ?? null) as unknown as RowShape | null;
      } else {
        data = (full.data ?? null) as unknown as RowShape | null;
      }

      const raw = (data?.tier ?? '').toString();
      // PRIORIDADE: is_admin sempre ganha — mesmo se tier for outro
      if (data?.is_admin) return 'admin';
      if (raw === 'pro' || raw === 'beta') return 'pro';
      if (raw === 'basic') return 'basic';
      if (raw === 'free') return 'free';
      // Sem coluna tier: usuário com is_active=true e sem tier era beta
      // (legado fechado). Vira pro pra preservar acesso.
      return data?.is_active ? 'pro' : 'free';
    }

    function load() {
      withRetry(resolveTier, { tries: 4, baseMs: 400 })
        .then((resolved) => {
          if (!cancelled) setTier(resolved);
        })
        .catch(() => {
          // Esgotou as tentativas → free por segurança (fail-closed).
          if (!cancelled) setTier('free');
        });
    }

    load();

    // Recarrega quando o auth muda (login, refresh de token expirado) — cura o
    // caso em que o token estava vencendo e a 1ª resolução pegou free.
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      if (!cancelled) load();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
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
