import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { bestPhone, classifyAccess } from '../_classify';
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
 *   • phone: o melhor telefone que a pessoa deixou (verificado ou do cadastro)
 *   • concurrent_30d / concurrent_last_at: episódios de ACESSO SIMULTÂNEO
 *     (dois aparelhos em uso ao mesmo tempo, migration 037) nos últimos 30
 *     dias. "Mesmo computador" (janela anônima/outro navegador) não conta.
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

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const svc = serviceClient();

    // Cascata de selects: completo → sem tool_unlocks → legado.
    // ⚠ NUNCA pôr coluna nova aqui sem ter certeza de que existe em produção:
    // uma coluna ausente derruba o select inteiro e a lista cai pro legado,
    // SEM plano nem assinatura (07.10: `whatsapp` fez os 457 aparecerem Free).
    // Coluna opcional vai numa consulta à parte (ver whatsapp abaixo). E se
    // cair de nível, o painel recebe `schema` e avisa em vez de mentir.
    let profiles: Row[] | null = null;
    let schema: 'full' | 'mid' | 'basic' = 'full';
    const levels: Array<['full' | 'mid' | 'basic', string]> = [
      ['full', FULL_SELECT],
      ['mid', MID_SELECT],
      ['basic', BASIC_SELECT],
    ];
    for (const [level, sel] of levels) {
      const res = await svc
        .from('profiles')
        .select(sel)
        .eq('is_admin', false)
        .order('created_at', { ascending: false });
      if (!res.error) {
        profiles = (res.data ?? []) as unknown as Row[];
        schema = level;
        break;
      }
      console.error(`[admin list-users] select ${level} falhou:`, res.error.message);
      if (level === 'basic') {
        return jsonError('Falha ao listar usuarios.', 500, res.error.message);
      }
    }

    // Número do cadastro (coluna `whatsapp`, migration 004): pode não existir
    // em produção, então vem à parte e só complementa o `phone`.
    const whatsappByUser: Record<string, string> = {};
    try {
      const { data: wa, error: waErr } = await svc
        .from('profiles')
        .select('id, whatsapp')
        .eq('is_admin', false)
        .not('whatsapp', 'is', null);
      if (!waErr) {
        for (const r of (wa ?? []) as Array<{ id: string; whatsapp: string | null }>) {
          if (r.whatsapp) whatsappByUser[r.id] = r.whatsapp;
        }
      }
    } catch {
      /* coluna ausente: segue só com `phone` */
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

    // Acesso simultâneo (037) — 30 dias. Sem a migration, segue sem o selo.
    const concurrentByUser: Record<string, { n: number; last: string }> = {};
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: evs, error: evErr } = await svc
        .from('access_concurrency')
        .select('user_id, ended_at')
        .eq('same_machine', false)
        .gte('ended_at', since)
        .order('ended_at', { ascending: false })
        .limit(5000);
      if (!evErr) {
        for (const ev of (evs ?? []) as Array<{ user_id: string; ended_at: string }>) {
          const cur = concurrentByUser[ev.user_id];
          if (cur) cur.n += 1;
          else concurrentByUser[ev.user_id] = { n: 1, last: ev.ended_at };
        }
      }
    } catch {
      /* tabela ainda não existe */
    }

    const enriched = (profiles ?? []).map((p) => {
      const { plan, access } = classifyAccess(p);
      return {
        ...p,
        email: p.email ?? null,
        phone: bestPhone({ phone: p.phone, whatsapp: whatsappByUser[p.id] }),
        plan,
        access,
        tool_unlocks: Array.isArray(p.tool_unlocks) ? p.tool_unlocks : [],
        static_unlocks: staticUnlocksForEmail(p.email),
        receipt_url: receiptByUser[p.id]?.url ?? null,
        last_payment_at: receiptByUser[p.id]?.at ?? null,
        concurrent_30d: concurrentByUser[p.id]?.n ?? 0,
        concurrent_last_at: concurrentByUser[p.id]?.last ?? null,
      };
    });

    return NextResponse.json({ users: enriched, schema });
  } catch (e) {
    console.error('[admin list-users]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
