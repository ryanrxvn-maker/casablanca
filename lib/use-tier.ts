'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { withRetry } from '@/lib/retry';
import { isPaidExpired, isPaymentBlocked } from '@/lib/plan-prices';
import { emailUnlocksPath, setSessionToolUnlocks } from '@/lib/tool-unlocks';

export type Tier = 'free' | 'basic' | 'pro' | 'admin';

/** Conjunto de ferramentas (paths) liberadas por tier. */
const TIER_PATHS: Record<Tier, ReadonlySet<string>> = {
  free: new Set([
    '/tools/decupagem',
    '/tools/tipografia',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/compressor',
    '/tools/normalizador', // liberado pra TODOS em 14.08.2026 (roda no navegador, custo zero)
    '/tools/historico',
  ]),
  // basic = plano PREMIUM (nome de exibição). Tier interno continua 'basic'
  // — Stripe e banco intocados.
  basic: new Set([
    '/tools/decupagem',
    '/tools/tipografia',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/normalizador',
    '/tools/calculadora',
    '/tools/copy-srt',
    '/tools/decupagem-copy',
    '/tools/lipsync',
    '/tools/historico',
    // ⚠ NÃO inclui as ferramentas de uso interno (admin-only): auto-broll,
    // heygen-auto, clickup-pilot, remover-elementos, separador-audio,
    // ltx-video
  ]),
  // pro (legado, não vendido) = mesmo conjunto do Premium. As ferramentas de
  // automação interna (auto-broll, heygen-auto, clickup-pilot) são admin-only.
  pro: new Set([
    '/tools/decupagem',
    '/tools/tipografia',
    '/tools/downloader',
    '/tools/caixinha-pergunta',
    '/tools/fakepass',
    '/tools/camuflagem',
    '/tools/compressor',
    '/tools/audio-split',
    '/tools/acelerador',
    '/tools/normalizador',
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
  subscription_status?: string | null;
  current_period_end?: string | null;
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

// ── Suspensão por pagamento pendente (past_due/unpaid) ─────────────────────
// true = a conta TEM assinatura mas a renovação não foi paga → o servidor já
// está negando o acesso; aqui só guardamos o estado pra UI pintar o aviso
// (banner nas ferramentas) sem precisar de outra query. Mesmo padrão de cache
// do tier: memória (SPA) + sessionStorage (F5).
let memPayBlocked = false;
const SS_PAYBLOCK_KEY = 'autoedit:payblock';
const payBlockListeners = new Set<(b: boolean) => void>();

function setPayBlocked(b: boolean) {
  memPayBlocked = b;
  try {
    if (b) sessionStorage.setItem(SS_PAYBLOCK_KEY, '1');
    else sessionStorage.removeItem(SS_PAYBLOCK_KEY);
  } catch {
    /* sessionStorage indisponível — segue só em memória */
  }
  payBlockListeners.forEach((fn) => fn(b));
}

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
      .select('tier, is_admin, is_active, tool_unlocks, subscription_status, current_period_end')
      .eq('id', uid)
      .maybeSingle(),
    6000,
  );
  if (full.error) {
    // tool_unlocks ausente (migration 028 não rodou) → tenta sem ela.
    const noUnlocks = await withTimeout(
      supabase
        .from('profiles')
        .select('tier, is_admin, is_active, subscription_status, current_period_end')
        .eq('id', uid)
        .maybeSingle(),
      6000,
    );
    if (noUnlocks.error) {
      // Colunas de billing ausentes (schema antigo) → tenta SÓ o tier, pra
      // nunca perder a resolução do plano por causa do status de assinatura.
      const noBilling = await withTimeout(
        supabase
          .from('profiles')
          .select('tier, is_admin, is_active')
          .eq('id', uid)
          .maybeSingle(),
        6000,
      );
      if (noBilling.error) {
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
        data = (noBilling.data ?? null) as unknown as RowShape | null;
      }
    } else {
      data = (noUnlocks.data ?? null) as unknown as RowShape | null;
    }
  } else {
    data = (full.data ?? null) as unknown as RowShape | null;
  }

  // Injeta os desbloqueios BETA PRO na sessão da UI (hub, sidebars, TierGate).
  applyUnlocks(Array.isArray(data?.tool_unlocks) ? data!.tool_unlocks! : null);

  const raw = (data?.tier ?? '').toString();
  const isAdmin = data?.is_admin === true;
  const paidRaw = raw === 'basic' || raw === 'pro' || raw === 'beta';

  // Mesma política do servidor (require-tier/middleware): renovação NÃO paga
  // (past_due/unpaid) suspende o acesso na hora; período pago vencido expira.
  // O servidor é quem BLOQUEIA de verdade — aqui é só o paint honesto da UI.
  const blocked =
    !isAdmin && paidRaw && isPaymentBlocked(data?.subscription_status);
  setPayBlocked(blocked);
  const expired =
    !isAdmin &&
    paidRaw &&
    isPaidExpired(data?.subscription_status, data?.current_period_end);

  // PRIORIDADE: is_admin sempre ganha — mesmo se tier for outro
  if (isAdmin) return 'admin';
  if (blocked || expired) return 'free';
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
        setPayBlocked(false);
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

/**
 * Hook: true quando a conta está com o acesso pago SUSPENSO por pagamento
 * pendente (renovação falhou — past_due/unpaid). Alimenta o aviso global nas
 * ferramentas. Pinta do cache (sessionStorage) e revalida junto do tier.
 */
export function usePaymentBlocked(): boolean {
  const [blocked, setBlocked] = useState<boolean>(memPayBlocked);

  useEffect(() => {
    let cancelled = false;
    // Paint imediato do cache (F5 não pisca o aviso).
    if (!memPayBlocked) {
      try {
        if (sessionStorage.getItem(SS_PAYBLOCK_KEY) === '1') {
          memPayBlocked = true;
          setBlocked(true);
        }
      } catch {
        /* sem cache — a revalidação resolve */
      }
    } else {
      setBlocked(true);
    }
    const listener = (b: boolean) => {
      if (!cancelled) setBlocked(b);
    };
    payBlockListeners.add(listener);
    // Garante uma revalidação (dedupe via inflight — sem query extra se o
    // useTier da tela já disparou).
    loadTier(true).catch(() => {});
    return () => {
      cancelled = true;
      payBlockListeners.delete(listener);
    };
  }, []);

  return blocked;
}

/**
 * Zera o cache de tier/suspensão e re-resolve na hora. Chame depois de um
 * evento que MUDA o plano no servidor (ex.: pagamento pendente aprovado no
 * retry) — sem isso a UI seguiria pintando o estado antigo até o próximo F5.
 */
export function refreshTier(): Promise<Tier> {
  memTier = null;
  ssClear();
  return loadTier(true);
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
