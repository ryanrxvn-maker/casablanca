import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * GET /api/admin/user-search?q=<nome ou email>
 *
 * Admin-only. Busca usuários por nome/email e retorna, pra cada um:
 *  - tier + origem do acesso (paid | comp(admin) | anomaly | free)
 *  - pagamentos com link do comprovante (receipt_url)
 *
 * accessSource:
 *  • paid   → status active/trialing/paid (pagou de verdade)
 *  • comp   → status admin_grant (você liberou na mão)
 *  • anomaly→ tier pago SEM pagamento e SEM grant (não deveria existir — alerta)
 *  • free   → plano gratuito
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Profile = {
  id: string;
  name: string | null;
  tier: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  current_period_end: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
};

function accessSource(p: Profile): 'paid' | 'comp' | 'anomaly' | 'free' {
  const tier = (p.tier ?? '').toString();
  if (tier !== 'basic' && tier !== 'pro') return 'free';
  const s = p.subscription_status ?? '';
  if (s === 'active' || s === 'trialing' || s === 'paid') return 'paid';
  if (s === 'admin_grant') return 'comp';
  return 'anomaly';
}

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase();
    const svc = serviceClient();

    const { data: profData, error } = await svc
      .from('profiles')
      .select(
        'id, name, tier, subscription_status, subscription_plan, current_period_end, created_at, last_seen_at, last_ip',
      )
      .eq('is_admin', false)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return jsonError('Falha ao buscar.', 500, error.message);
    const profiles = (profData ?? []) as Profile[];

    // Emails via auth.users
    const emails: Record<string, string> = {};
    const { data: usersList } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of usersList?.users ?? []) if (u.email) emails[u.id] = u.email;

    // Filtra por nome/email (se q vazio, traz os mais recentes)
    let matched = profiles;
    if (q) {
      matched = profiles.filter((p) => {
        const name = (p.name ?? '').toLowerCase();
        const email = (emails[p.id] ?? '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }
    matched = matched.slice(0, 25);

    // Pagamentos dos usuários encontrados
    const ids = matched.map((p) => p.id);
    const paymentsByUser: Record<string, Array<Record<string, unknown>>> = {};
    if (ids.length > 0) {
      const { data: pays } = await svc
        .from('payments')
        .select('user_id, amount, currency, plan, billing, status, receipt_url, created_at')
        .in('user_id', ids)
        .order('created_at', { ascending: false });
      for (const pay of (pays ?? []) as Array<{ user_id: string }>) {
        (paymentsByUser[pay.user_id] ||= []).push(pay);
      }
    }

    const users = matched.map((p) => ({
      id: p.id,
      name: p.name,
      email: emails[p.id] ?? null,
      tier: p.tier ?? 'free',
      subscription_status: p.subscription_status,
      access: accessSource(p),
      current_period_end: p.current_period_end,
      created_at: p.created_at,
      last_seen_at: p.last_seen_at,
      last_ip: p.last_ip,
      payments: paymentsByUser[p.id] ?? [],
    }));

    return NextResponse.json({ users, count: users.length });
  } catch (e) {
    return jsonError('Erro inesperado.', 500, e instanceof Error ? e.message : String(e));
  }
}
