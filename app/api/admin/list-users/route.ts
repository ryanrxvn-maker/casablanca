import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { isPaidExpired } from '@/lib/plan-prices';
import { staticUnlocksForEmail } from '@/lib/tool-unlocks';

/**
 * GET /api/admin/list-users
 *
 * Retorna so os USUARIOS (is_admin=false). Admins (incluindo o proprio
 * caller) sao filtrados — admin nao precisa se ver na lista.
 *
 * Cada usuário vem com a classificação pronta pro painel:
 *   • plan: 'premium' | 'free' — plano EFETIVO (considera expiração; tier
 *     legado pro/beta conta como premium)
 *   • access: 'paid' | 'granted' | 'anomaly' | 'free'
 *       paid    → pagou de verdade (Stripe: active/trialing/paid, não vencido)
 *       granted → você liberou na mão (admin_grant — não expira)
 *       anomaly → tier pago sem pagamento e sem grant (investigar)
 *   • tool_unlocks: ferramentas BETA PRO liberadas via painel (banco)
 *   • static_unlocks: desbloqueios fixos por email (código/env — não
 *     removíveis pelo painel)
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Row = Record<string, unknown> & {
  id: string;
  email: string | null;
  tier?: string | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  current_period_end?: string | null;
  tool_unlocks?: string[] | null;
};

const FULL_SELECT =
  'id, name, email, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at, tier, phone, phone_verified, phone_verified_at, legacy_no_phone, subscription_status, subscription_plan, current_period_end, traffic_source, tool_unlocks';

// Sem tool_unlocks (migration 028 pendente) e sem billing (schemas antigos).
const MID_SELECT =
  'id, name, email, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at, tier, phone, phone_verified, phone_verified_at, legacy_no_phone, subscription_status, subscription_plan, current_period_end';

const BASIC_SELECT =
  'id, name, email, is_admin, is_active, activated_at, created_at, must_change_password, last_seen_at, last_ip, last_tool, last_tool_at';

function classify(p: Row): {
  plan: 'premium' | 'free';
  access: 'paid' | 'granted' | 'pending' | 'anomaly' | 'free';
} {
  const tier = (p.tier ?? '').toString();
  const isPaidTier = tier === 'basic' || tier === 'pro' || tier === 'beta';
  const expired = isPaidExpired(p.subscription_status, p.current_period_end);
  if (!isPaidTier || expired) return { plan: 'free', access: 'free' };
  const s = p.subscription_status ?? '';
  if (s === 'active' || s === 'trialing' || s === 'paid')
    return { plan: 'premium', access: 'paid' };
  if (s === 'admin_grant') return { plan: 'premium', access: 'granted' };
  // Renovação tentada e NÃO paga → acesso SUSPENSO pelos gates (política
  // 13.08). Assinatura segue viva no Stripe; o cliente resolve na tela de
  // assinatura (retry/troca de cartão). Plano EFETIVO agora é free.
  if (s === 'past_due' || s === 'unpaid') return { plan: 'free', access: 'pending' };
  return { plan: 'premium', access: 'anomaly' };
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const svc = serviceClient();

    // Cascata de selects: completo → sem tool_unlocks → legado.
    let profiles: Row[] | null = null;
    for (const sel of [FULL_SELECT, MID_SELECT, BASIC_SELECT]) {
      const res = await svc
        .from('profiles')
        .select(sel)
        .eq('is_admin', false)
        .order('created_at', { ascending: false });
      if (!res.error) {
        profiles = (res.data ?? []) as unknown as Row[];
        break;
      }
      if (sel === BASIC_SELECT) {
        return jsonError('Falha ao listar usuarios.', 500, res.error.message);
      }
    }

    // Último comprovante (Stripe receipt) por usuário — botão direto no card.
    const receiptByUser: Record<string, { url: string; at: string | null }> = {};
    try {
      const { data: pays } = await svc
        .from('payments')
        .select('user_id, receipt_url, created_at')
        .not('receipt_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      for (const pay of (pays ?? []) as Array<{
        user_id: string | null;
        receipt_url: string | null;
        created_at: string | null;
      }>) {
        if (pay.user_id && pay.receipt_url && !receiptByUser[pay.user_id]) {
          receiptByUser[pay.user_id] = { url: pay.receipt_url, at: pay.created_at };
        }
      }
    } catch {
      /* tabela payments ausente (schema antigo) — segue sem comprovantes */
    }

    const enriched = (profiles ?? []).map((p) => {
      const { plan, access } = classify(p);
      return {
        ...p,
        email: p.email ?? null,
        plan,
        access,
        tool_unlocks: Array.isArray(p.tool_unlocks) ? p.tool_unlocks : [],
        static_unlocks: staticUnlocksForEmail(p.email),
        receipt_url: receiptByUser[p.id]?.url ?? null,
        last_payment_at: receiptByUser[p.id]?.at ?? null,
      };
    });

    return NextResponse.json({ users: enriched });
  } catch (e) {
    console.error('[admin list-users]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
