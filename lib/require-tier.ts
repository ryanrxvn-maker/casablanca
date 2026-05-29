import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
  | { ok: true; userId: string; tier: Tier; isAdmin: boolean }
  | { ok: false; response: NextResponse };

export async function requireTier(min: Tier): Promise<TierGate> {
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
      .select('is_admin, is_active, tier')
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

    const isAdmin = profile?.is_admin === true;
    const raw = ((profile as { tier?: string | null } | null)?.tier ?? '').toString();
    let tier: Tier;
    if (isAdmin) tier = 'admin';
    else if (raw === 'pro' || raw === 'beta') tier = 'pro';
    else if (raw === 'basic') tier = 'basic';
    else tier = 'free';

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

    return { ok: true, userId: user.id, tier, isAdmin };
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
