import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPaidExpired } from '@/lib/plan-prices';
import { isToolInMaintenance, canBypassMaintenance } from '@/lib/maintenance';
import { cliMachineIdentity } from '@/lib/cli-auth';

/**
 * Guard de tier server-side pra route handlers (/api/*).
 *
 * O middleware bloqueia o ACESSO ÀS PÁGINAS por tier, mas rotas /api/* são
 * públicas no matcher. Sem este guard, um usuário free autenticado consegue
 * chamar endpoints de tools PRO direto (DevTools/curl com o cookie de sessão)
 * e burlar o plano. Toda rota de tool paga deve chamar requireTier() no início.
 *
 * Uso:
 *   const gate = await requireTier('pro');
 *   if (!gate.ok) return gate.response;
 *   // gate.userId, gate.tier, gate.isAdmin disponíveis
 */

export type Tier = 'free' | 'basic' | 'pro' | 'admin';

const RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2, admin: 3 };

const NEED_LABEL: Record<Tier, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  admin: 'Admin',
};

export type TierGate =
  | { ok: true; userId: string; email: string | null; tier: Tier; isAdmin: boolean }
  | { ok: false; response: NextResponse };

export async function requireTier(min: Tier): Promise<TierGate> {
  // Auth de máquina (CLI/MCP): atalho server-to-server. Concede tier admin —
  // passa qualquer `min`. Inerte se AUTOEDIT_CLI_KEY não estiver setada.
  const machine = cliMachineIdentity();
  if (machine) {
    return { ok: true, userId: machine.userId, email: machine.email, tier: 'admin', isAdmin: true };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }),
      };
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('is_admin, is_active, tier, subscription_status, current_period_end')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Falha ao validar plano.', detail: error.message.slice(0, 300) },
          { status: 500 },
        ),
      };
    }

    if (!profile?.is_active) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Conta inativa.' }, { status: 403 }),
      };
    }

    const p = profile as {
      tier?: string | null;
      subscription_status?: string | null;
      current_period_end?: string | null;
    } | null;
    const isAdmin = profile?.is_admin === true;
    const raw = (p?.tier ?? '').toString();
    let tier: Tier;
    if (isAdmin) tier = 'admin';
    else if (raw === 'pro' || raw === 'beta') tier = 'pro';
    else if (raw === 'basic') tier = 'basic';
    else tier = 'free';

    // Acesso pago vencido → cai pra free (admin nunca expira).
    if (!isAdmin && isPaidExpired(p?.subscription_status, p?.current_period_end)) {
      tier = 'free';
    }

    if (RANK[tier] < RANK[min]) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Recurso disponível só pra contas ${NEED_LABEL[min]}. Faça upgrade em /planos.`,
            need: min,
            have: tier,
          },
          { status: 403 },
        ),
      };
    }

    return { ok: true, userId: user.id, email: user.email ?? null, tier, isAdmin };
  } catch (e) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Erro ao validar plano.',
          detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
        },
        { status: 500 },
      ),
    };
  }
}

/**
 * Gate de acesso a uma ferramenta gated POR TIER + MANUTENÇÃO, server-side
 * (sem furo: vale pra páginas E pra rotas /api). Use no início dos handlers.
 *
 *   const gate = await requireToolAccess('/tools/lipsync', 'pro');
 *   if (!gate.ok) return gate.response;
 *   // gate.userId, gate.email, gate.tier, gate.isAdmin disponíveis
 *
 * Regras:
 *   1. Exige o tier mínimo (Free/Basic em tool Pro → 403 "faça upgrade").
 *   2. Se a tool está em manutenção: só admin + allowlist (ex.: Elder) passam;
 *      o resto recebe 503.
 */
export async function requireToolAccess(
  toolPath: string,
  min: Tier,
): Promise<TierGate> {
  const gate = await requireTier(min);
  if (!gate.ok) return gate;
  if (
    isToolInMaintenance(toolPath) &&
    !gate.isAdmin &&
    !canBypassMaintenance(gate.email)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Ferramenta em manutenção. Acesso liberado em breve.', code: 'maintenance' },
        { status: 503 },
      ),
    };
  }
  return gate;
}
