import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { serviceClient } from '@/app/api/admin/_helpers';
import { isPaidExpired } from '@/lib/plan-prices';

/**
 * GET /api/admin/dashboard — métricas agregadas pro painel do dono.
 * Admin-only. Lê com service role pra ter contagem total (bypass RLS).
 *
 * Retorna: online agora, totais, distribuição de tiers, pagantes por plano,
 * MRR estimado, signups recentes, ranking de ferramentas e origem de tráfego.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRICE_MONTHLY: Record<string, number> = { basic: 57, pro: 116 };

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  tier: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  last_seen_at: string | null;
  last_tool: string | null;
  last_tool_at: string | null;
  last_ip: string | null;
  created_at: string | null;
  traffic_source: string | null;
  current_period_end: string | null;
};

function resolveTier(p: ProfileRow): 'free' | 'basic' | 'pro' | 'admin' {
  if (p.is_admin) return 'admin';
  // Acesso pago vencido conta como free.
  if (isPaidExpired(p.subscription_status, p.current_period_end)) return 'free';
  const t = (p.tier ?? '').toString();
  if (t === 'pro' || t === 'beta') return 'pro';
  if (t === 'basic') return 'basic';
  return 'free';
}

export async function GET() {
  const gate = await requireTier('admin');
  if (!gate.ok) return gate.response;

  const svc = serviceClient();

  const { data: profilesData, error: pErr } = await svc
    .from('profiles')
    .select(
      'id, name, email, tier, is_admin, is_active, subscription_plan, subscription_status, last_seen_at, last_tool, last_tool_at, last_ip, created_at, traffic_source, current_period_end',
    )
    .order('created_at', { ascending: false })
    .limit(2000);

  if (pErr) {
    return NextResponse.json(
      { error: 'Falha ao ler profiles.', detail: pErr.message.slice(0, 300) },
      { status: 500 },
    );
  }
  const profiles = (profilesData ?? []) as ProfileRow[];

  const nowMs = Date.now();
  const ONLINE_MS = 60_000;
  const TOOL_ACTIVE_MS = 90_000;

  // Contas ADMIN são da casa: entram só na contagem de tiers — ranking de
  // ferramentas, online, signups e tráfego mostram SÓ clientes.
  const adminIds = new Set(profiles.filter((p) => p.is_admin).map((p) => p.id));

  const tiers = { free: 0, basic: 0, pro: 0, admin: 0 };
  const paying = { basic: 0, pro: 0 };
  const sources: Record<string, number> = {};
  const onlineUsers: Array<{
    id: string;
    name: string | null;
    email: string | null;
    tier: string;
    last_ip: string | null;
    tool: string | null;
    usingTool: boolean;
  }> = [];

  for (const p of profiles) {
    const tier = resolveTier(p);
    tiers[tier] += 1;

    // Pagante ativo = assinatura recorrente (active/trialing) OU pagamento
    // único vigente ('paid'). Antes só contava 'paid' → MRR ficava R$ 0
    // mesmo com mensalistas ativos.
    const paidActive =
      (p.subscription_status === 'paid' ||
        p.subscription_status === 'active' ||
        p.subscription_status === 'trialing') &&
      !isPaidExpired(p.subscription_status, p.current_period_end);
    if (paidActive && (p.subscription_plan === 'basic' || p.subscription_plan === 'pro')) {
      paying[p.subscription_plan] += 1;
    }

    if (p.is_admin) continue; // métricas de comportamento = só clientes

    const src = (p.traffic_source || 'direct').toLowerCase();
    sources[src] = (sources[src] ?? 0) + 1;

    if (p.last_seen_at) {
      const age = nowMs - new Date(p.last_seen_at).getTime();
      if (age <= ONLINE_MS) {
        const toolAge = p.last_tool_at
          ? nowMs - new Date(p.last_tool_at).getTime()
          : Infinity;
        onlineUsers.push({
          id: p.id,
          name: p.name,
          email: p.email,
          tier,
          last_ip: p.last_ip,
          tool: p.last_tool,
          usingTool: toolAge <= TOOL_ACTIVE_MS,
        });
      }
    }
  }

  const total = profiles.length;
  const mrr =
    paying.basic * PRICE_MONTHLY.basic + paying.pro * PRICE_MONTHLY.pro;

  const recentSignups = profiles
    .filter((p) => !adminIds.has(p.id))
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      tier: resolveTier(p),
      traffic_source: p.traffic_source,
      created_at: p.created_at,
    }));

  // ─── Ranking de ferramentas (últimos 30 dias, SÓ clientes) ───
  const since = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: eventsData } = await svc
    .from('tool_events')
    .select('tool, user_id, created_at')
    .gte('created_at', since)
    .limit(20000);
  const toolCounts: Record<string, number> = {};
  for (const ev of (eventsData ?? []) as Array<{ tool: string; user_id: string }>) {
    if (adminIds.has(ev.user_id)) continue; // uso da casa não conta
    toolCounts[ev.tool] = (toolCounts[ev.tool] ?? 0) + 1;
  }
  const toolRanking = Object.entries(toolCounts)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  const trafficSources = Object.entries(sources)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // ─── Pagamentos (trilha de auditoria + comprovantes) ───
  const { data: paymentsData } = await svc
    .from('payments')
    .select('id, email, amount, currency, plan, billing, status, receipt_url, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  const payments = (paymentsData ?? []) as Array<{
    id: number;
    email: string | null;
    amount: number;
    currency: string;
    plan: string | null;
    billing: string | null;
    status: string;
    receipt_url: string | null;
    created_at: string | null;
  }>;
  // Líquido: linhas 'refunded'/'disputed' já foram devolvidas — não contam.
  const revenueTotal = payments.reduce(
    (s, p) => s + (p.status === 'paid' ? p.amount || 0 : 0),
    0,
  );
  const refundedTotal = payments.reduce(
    (s, p) => s + (p.status === 'refunded' || p.status === 'disputed' ? p.amount || 0 : 0),
    0,
  );

  return NextResponse.json({
    now: new Date(nowMs).toISOString(),
    totals: {
      users: total,
      online: onlineUsers.length,
      paying: paying.basic + paying.pro,
      mrr,
    },
    tiers: {
      counts: tiers,
      pct: {
        free: total ? Math.round((tiers.free / total) * 100) : 0,
        basic: total ? Math.round((tiers.basic / total) * 100) : 0,
        pro: total ? Math.round((tiers.pro / total) * 100) : 0,
        admin: total ? Math.round((tiers.admin / total) * 100) : 0,
      },
    },
    paying,
    onlineUsers,
    recentSignups,
    toolRanking,
    trafficSources,
    payments,
    revenueTotal,
    refundedTotal,
  });
}
