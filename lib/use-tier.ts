'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { withRetry } from '@/lib/retry';
import { emailUnlocksPath, setSessionToolUnlocks } from '@/lib/tool-unlocks';

export type Tier = 'free' | 'basic' | 'pro' | 'admin';

/** Conjunto de ferramentas (paths) liberadas por tier. */
const TIER_PATHS: Record<Tier, ReadonlySet<string>> = {
  free: new Set([
    '/tools/decupagem',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/compressor',
    '/tools/historico',
  ]),
  // basic = plano PREMIUM (nome de exibição). Tier interno continua 'basic'
  // — Stripe e banco intocados.
  basic: new Set([
    '/tools/decupagem',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/calculadora',
    '/tools/copy-srt',
    '/tools/decupagem-copy',
    '/tools/lipsync',
    '/tools/historico',
    // ⚠ NÃO inclui as ferramentas de uso interno (admin-only): auto-broll,
    // heygen-auto, clickup-pilot, remover-elementos, normalizador,
    // separador-audio, ltx-video
  ]),
  // pro (legado, não vendido) = mesmo conjunto do Premium. As ferramentas de
  // automação interna (auto-broll, heygen-auto, clickup-pilot) são admin-only.
  pro: new Set([
    '/tools/decupagem',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/calculadora',
    '/tools/copy-srt',
    '/tools/decupagem-copy',
    '/tools/lipsync',
    '/tools/historico',
  ]),
  admin: new Set([]), // admin é tratado por bypass (allow tudo)
};

type RowShape = {
  tier?: string | null;
  is_admin?: boolean | null;
  is_active?: boolean | null;
  tool_unlocks?: string[] | null;
};

// ─── Cache de tier por sessão ───────────────────────────────────────────────
// memTier sobrevive à navegação SPA (módulo singleton no bundle do client) →
// trocar de ferramenta é INSTANTÂNEO, sem reabrir "Verificando acesso…".
// IMPORTANTE: só é escrito dentro de loadTier(), que só roda em efeito/cliente —
// nunca no SSR — então não há vazamento de tier entre usuários no servidor.
let memTier: Tier | null = null;
let inflight: Promise<Tier> | null = null;
const SS_KEY = 'autoedit:tier';

// Email da sessão — usado pelos desbloqueios pontuais (lib/tool-unlocks.ts).
// undefined = ainda não resolvido; null = deslogado/sem email.
let memEmail: string | null | undefined = undefined;
const SS_EMAIL_KEY = 'autoedit:email';

// Desbloqueios BETA PRO (profiles.tool_unlocks) — cache espelho do banco.
const SS_UNLOCKS_KEY = 'autoedit:unlocks';

function applyUnlocks(list: string[] | null) {
  setSessionToolUnlocks(list);
  try {
    if (list?.length) sessionStorage.setItem(SS_UNLOCKS_KEY, JSON.stringify(list));
    else sessionStorage.removeItem(SS_UNLOCKS_KEY);
  } catch {
    /* sessionStorage indisponível — segue só com o set em memória */
  }
}

function restoreUnlocksFromCache() {
  try {
    const raw = sessionStorage.getItem(SS_UNLOCKS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      setSessionToolUnlocks(list.filter((p): p is string => typeof p === 'string'));
    }
  } catch {
    /* cache inválido — ignora, a rede resolve */
  }
}

function ssReadEmail(): string | null {
  try {
    return sessionStorage.getItem(SS_EMAIL_KEY);
  } catch {
    return null;
  }
}
function ssWriteEmail(e: string | null) {
  try {
    if (e) sessionStorage.setItem(SS_EMAIL_KEY, e);
    else sessionStorage.removeItem(SS_EMAIL_KEY);
  } catch {
    /* sessionStorage indisponível — segue sem cache */
  }
}

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
  let email: string | null = sess.data.session?.user?.email ?? null;
  if (!uid) {
    const u = await withTimeout(supabase.auth.getUser(), 6000);
    if (u.error) throw u.error;
    uid = u.data.user?.id;
    email = u.data.user?.email ?? email;
  }
  // Aquece o cache de email (desbloqueios por email na UI).
  memEmail = uid ? email : null;
  ssWriteEmail(memEmail);
  // Sem uid = genuinamente deslogado (não é erro) → free, sem re-tentar.
  if (!uid) return 'free';

  // Tenta select com tier; se a coluna faltar (compat schema antigo), cai pro
  // básico. Só LANÇA se o básico também falhar (erro real de rede).
  let data: RowShape | null = null;
  const full = await withTimeout(
    supabase
      .from('profiles')
      .select('tier, is_admin, is_active, tool_unlocks')
      .eq('id', uid)
      .maybeSingle(),
    6000,
  );
  if (full.error) {
    // tool_unlocks ausente (migration 028 não rodou) → tenta sem ela.
    const noUnlocks = await withTimeout(
      supabase
        .from('profiles')
        .select('tier, is_admin, is_active')
        .eq('id', uid)
        .maybeSingle(),
      6000,
    );
    if (noUnlocks.error) {
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
      data = (noUnlocks.data ?? null) as unknown as RowShape | null;
    }
  } else {
    data = (full.data ?? null) as unknown as RowShape | null;
  }

  // Injeta os desbloqueios BETA PRO na sessão da UI (hub, sidebars, TierGate).
  applyUnlocks(Array.isArray(data?.tool_unlocks) ? data!.tool_unlocks! : null);

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
    // Restaura o email junto (desbloqueios por email pintam sem esperar rede).
    if (memEmail === undefined) {
      const cachedEmail = ssReadEmail();
      if (cachedEmail) memEmail = cachedEmail;
    }
    // Restaura os desbloqueios BETA PRO do cache (a rede revalida em seguida).
    restoreUnlocksFromCache();

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
        memEmail = null;
        ssClear();
        ssWriteEmail(null);
        applyUnlocks(null);
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
  if (emailUnlocksPath(memEmail, toolHref)) return true; // desbloqueio pontual
  if (!tier) return false;
  if (tier === 'admin') return true; // admin acessa tudo
  const set = TIER_PATHS[tier];
  return Array.from(set).some(
    (p) => toolHref === p || toolHref.startsWith(p + '/'),
  );
}

/**
 * Só admin dispara automação Pilot (ferramenta de uso interno) — ou email
 * com desbloqueio pontual do Pilot (lib/tool-unlocks.ts).
 */
export function tierCanAutomate(tier: Tier | null): boolean {
  if (emailUnlocksPath(memEmail, '/tools/clickup-pilot')) return true;
  return tier === 'admin';
}

/**
 * Hook: email da sessão logada, com cache (memória + sessionStorage).
 * undefined = ainda resolvendo · null = deslogado/sem email.
 * Use junto com emailUnlocksPath() pra UI de desbloqueios pontuais.
 */
export function useUserEmail(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(memEmail);

  useEffect(() => {
    let cancelled = false;
    if (memEmail !== undefined) {
      setEmail(memEmail);
    } else {
      const cached = ssReadEmail();
      if (cached) {
        memEmail = cached;
        setEmail(cached);
      }
    }

    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        let e: string | null = data.session?.user?.email ?? null;
        if (!e && data.session?.user?.id) {
          const u = await supabase.auth.getUser().catch(() => null);
          e = u?.data.user?.email ?? null;
        }
        memEmail = e;
        ssWriteEmail(e);
        if (!cancelled) setEmail(e);
      })
      .catch(() => {
        // Falha de rede: mantém o cache; sem cache, marca como deslogado
        // pra UI não ficar pendurada em "resolvendo" pra sempre.
        if (!cancelled && memEmail === undefined) setEmail(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return email;
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
        label: 'Premium',
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
