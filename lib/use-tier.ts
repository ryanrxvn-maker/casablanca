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

type RowShape = {
  tier?: string | null;
  is_admin?: boolean | null;
  is_active?: boolean | null;
};

// ─── Cache de tier por sessão ───────────────────────────────────────────────
// memTier sobrevive à navegação SPA (módulo singleton no bundle do client) →
// trocar de ferramenta é INSTANTÂNEO, sem reabrir "Verificando acesso…".
// IMPORTANTE: só é escrito dentro de loadTier(), que só roda em efeito/cliente —
// nunca no SSR — então não há vazamento de tier entre usuários no servidor.
let memTier: Tier | null = null;
let inflight: Promise<Tier> | null = null;
const SS_KEY = 'autoedit:tier';

function ssRead(): Tier | null {
  try {
    const v = sessionStorage.getItem(SS_KEY);
    return v === 'free' || v === 'basic' || v === 'pro' || v === 'admin' ? v : null;
  } catch {
    return null;
  }
}
function ssWrite(t: Tier) {
  try {
    sessionStorage.setItem(SS_KEY, t);
  } catch {
    /* sessionStorage indisponível (modo privado/iframe) — segue sem cache */
  }
}
function ssClear() {
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* idem */
  }
}

/** Corre `p` contra um timeout — uma chamada pendurada vira erro re-tentável. */
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// Resolve o tier real. LANÇA em falha transitória (rede/cold-start/timeout) pra
// que o withRetry re-tente — sem isso, a 1ª falha grudava a UI em free até F5.
async function resolveTier(): Promise<Tier> {
  const supabase = createClient();

  // uid via SESSÃO LOCAL (instantâneo). getUser() faz round-trip de rede a cada
  // chamada e era a fonte da lentidão ("Verificando acesso…"). A autorização
  // real é server-side (require-tier + RLS), então ler o uid da sessão aqui é
  // seguro. Só cai pro getUser() (rede) se a sessão local não tiver uid.
  let uid: string | undefined;
  const sess = await withTimeout(supabase.auth.getSession(), 6000);
  uid = sess.data.session?.user?.id;
  if (!uid) {
    const u = await withTimeout(supabase.auth.getUser(), 6000);
    if (u.error) throw u.error;
    uid = u.data.user?.id;
  }
  // Sem uid = genuinamente deslogado (não é erro) → free, sem re-tentar.
  if (!uid) return 'free';

  // Tenta select com tier; se a coluna faltar (compat schema antigo), cai pro
  // básico. Só LANÇA se o básico também falhar (erro real de rede).
  let data: RowShape | null = null;
  const full = await withTimeout(
    supabase
      .from('profiles')
      .select('tier, is_admin, is_active')
      .eq('id', uid)
      .maybeSingle(),
    6000,
  );
  if (full.error) {
    const basic = await withTimeout(
      supabase
        .from('profiles')
        .select('is_admin, is_active')
        .eq('id', uid)
        .maybeSingle(),
      6000,
    );
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

/**
 * Carrega o tier com retry + dedupe. Quando `force=false` e já temos memTier,
 * devolve na hora (instantâneo). Várias telas chamando junto compartilham a
 * MESMA promessa via `inflight` (sem N queries simultâneas).
 */
function loadTier(force = false): Promise<Tier> {
  if (!force && memTier != null) return Promise.resolve(memTier);
  if (inflight) return inflight;
  inflight = withRetry(resolveTier, { tries: 4, baseMs: 400 })
    .then((t) => {
      memTier = t;
      ssWrite(t);
      return t;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Hook que retorna o tier da conta logada.
 *
 * 1ª resolução na sessão: `null` enquanto carrega (mostra "Verificando…").
 * Depois disso fica CACHEADO → toda navegação seguinte é instantânea.
 * Em erro persistente retorna 'free' por segurança. tier='beta' → 'pro'.
 */
export function useTier(): Tier | null {
  // Pinta já com o cache em memória (sobrevive à navegação SPA). No SSR/1º load
  // é null — bate com o servidor, sem hydration mismatch.
  const [tier, setTier] = useState<Tier | null>(memTier);

  useEffect(() => {
    let cancelled = false;
    const apply = (t: Tier) => {
      if (!cancelled) setTier(t);
    };

    // Paint imediato do cache: memória → sessionStorage (sobrevive a F5).
    if (memTier != null) {
      apply(memTier);
    } else {
      const cached = ssRead();
      if (cached) {
        memTier = cached;
        apply(cached);
      }
    }

    // Revalida sempre em background; com cache na tela, a lentidão fica
    // invisível. Só cai pra free se NUNCA houve cache (1º load de fato).
    loadTier(true)
      .then(apply)
      .catch(() => {
        if (memTier == null) apply('free');
      });

    // Reage a mudanças de auth (login, refresh de token, logout).
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        memTier = null;
        ssClear();
        apply('free');
        return;
      }
      loadTier(true)
        .then(apply)
        .catch(() => {});
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
