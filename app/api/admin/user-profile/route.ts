import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { bestPhone, classifyAccess } from '../_classify';
import { staticUnlocksForEmail } from '@/lib/tool-unlocks';
import {
  summarizeAccess,
  summarizeUsage,
  type AccessDeviceRow,
  type AccessEventRow,
  type AccessSessionRow,
  type ToolEventRow,
} from '@/lib/admin-access-summary';

/**
 * GET /api/admin/user-profile?id=<uuid> — PERFIL COMPLETO de um cliente.
 *
 * Tudo que o painel sabe sobre a conta, numa chamada só: dados cadastrais
 * (telefone incluso), login, plano e pagamentos com comprovante, histórico
 * de plano, uso de ferramentas e o histórico de acesso (IPs, aparelhos,
 * cidade, acesso simultâneo — migration 037).
 *
 * Segredos da conta (chaves HeyGen/Replicate/Groq, OAuth) NUNCA saem daqui:
 * o profile é lido inteiro só no servidor e filtrado por lista branca.
 * Cada fonte é independente: se uma tabela não existir ainda, o perfil
 * chega sem aquela parte em vez de falhar inteiro.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_KEYS = [
  'id',
  'name',
  'email',
  'avatar_url',
  'is_admin',
  'is_active',
  'activated_at',
  'created_at',
  'must_change_password',
  'last_seen_at',
  'last_ip',
  'last_tool',
  'last_tool_at',
  'tier',
  'phone',
  'whatsapp',
  'phone_verified',
  'phone_verified_at',
  'legacy_no_phone',
  'subscription_status',
  'subscription_plan',
  'current_period_end',
  'stripe_customer_id',
  'stripe_subscription_id',
  'traffic_source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'first_touch_at',
  'tool_unlocks',
] as const;

type Payment = {
  id: number;
  email: string | null;
  amount: number;
  currency: string;
  plan: string | null;
  billing: string | null;
  status: string;
  receipt_url: string | null;
  created_at: string | null;
};

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return jsonError('Id inválido.', 400);

  let svc: ReturnType<typeof serviceClient>;
  try {
    svc = serviceClient();
  } catch (e) {
    return jsonError('Serviço indisponível.', 500, e instanceof Error ? e.message : String(e));
  }

  const { data: raw, error: pErr } = await svc.from('profiles').select('*').eq('id', id).maybeSingle();
  if (pErr) return jsonError('Falha ao ler o perfil.', 500, pErr.message);
  if (!raw) return jsonError('Usuário não encontrado.', 404);

  const row = raw as Record<string, unknown>;
  const profile: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) if (k in row) profile[k] = row[k];
  const email = typeof row.email === 'string' ? row.email : null;

  const since365 = new Date(Date.now() - 365 * 86_400_000).toISOString();

  const [authRes, paysById, paysByEmail, tierRes, toolRes, sessRes, devRes, evRes] = await Promise.all([
    svc.auth.admin.getUserById(id).catch(() => null),
    svc
      .from('payments')
      .select('id, email, amount, currency, plan, billing, status, receipt_url, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    email
      ? svc
          .from('payments')
          .select('id, email, amount, currency, plan, billing, status, receipt_url, created_at')
          // igualdade exata (ilike trataria o "_" do email como curinga e
          // puxaria pagamento de outra pessoa)
          .in('email', Array.from(new Set([email, email.toLowerCase()])))
          .order('created_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    svc
      .from('tier_changes')
      .select('id, admin_id, from_tier, to_tier, reason, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    svc
      .from('tool_events')
      .select('tool, created_at')
      .eq('user_id', id)
      .gte('created_at', since365)
      .order('created_at', { ascending: false })
      .limit(5000),
    svc
      .from('access_sessions')
      .select('id, device_id, ip, city, region, country, browser, os, device_kind, started_at, last_seen_at, pings, active_seconds')
      .eq('user_id', id)
      .order('last_seen_at', { ascending: false })
      .limit(500),
    svc
      .from('access_devices')
      .select('device_id, browser, os, device_kind, first_seen_at, last_seen_at, last_ip, last_place')
      .eq('user_id', id)
      .order('last_seen_at', { ascending: false })
      .limit(200),
    svc
      .from('access_concurrency')
      .select('id, device_a, device_b, ip_a, ip_b, place_a, place_b, label_a, label_b, same_network, same_machine, started_at, ended_at')
      .eq('user_id', id)
      .order('started_at', { ascending: false })
      .limit(300),
  ]);

  // ── Login (auth) ──
  const authUser = authRes && !authRes.error ? authRes.data.user : null;
  const meta = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
  const auth = authUser
    ? {
        created_at: authUser.created_at ?? null,
        last_sign_in_at: authUser.last_sign_in_at ?? null,
        email_confirmed_at: authUser.email_confirmed_at ?? null,
        provider: (authUser.app_metadata?.provider as string | undefined) ?? null,
        providers: Array.isArray(authUser.app_metadata?.providers)
          ? (authUser.app_metadata.providers as string[])
          : [],
      }
    : null;

  // ── Pagamentos (por conta OU pelo email do checkout) ──
  const payMap = new Map<number, Payment>();
  for (const res of [paysById, paysByEmail]) {
    if (res && !res.error) for (const p of (res.data ?? []) as Payment[]) payMap.set(p.id, p);
  }
  const payments = Array.from(payMap.values()).sort(
    (a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''),
  );
  const isPaid = (p: Payment) => p.status === 'paid' || p.status === 'succeeded';
  const isRefund = (p: Payment) => p.status === 'refunded' || p.status === 'disputed';
  const paidList = payments.filter(isPaid);
  const billing = {
    totalPaid: paidList.reduce((s, p) => s + (p.amount || 0), 0),
    refunded: payments.filter(isRefund).reduce((s, p) => s + (p.amount || 0), 0),
    count: paidList.length,
    firstAt: paidList.length ? paidList[paidList.length - 1].created_at : null,
    lastAt: paidList.length ? paidList[0].created_at : null,
  };

  // ── Histórico de plano (quem mudou, quando) ──
  type TierRow = { id: number; admin_id: string | null; from_tier: string | null; to_tier: string | null; reason: string | null; created_at: string };
  const tierRows = (tierRes && !tierRes.error ? (tierRes.data ?? []) : []) as TierRow[];
  const adminIds = Array.from(new Set(tierRows.map((t) => t.admin_id).filter((v): v is string => !!v)));
  const adminNames = new Map<string, string>();
  if (adminIds.length) {
    const { data: admins } = await svc.from('profiles').select('id, name, email').in('id', adminIds);
    for (const a of (admins ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
      adminNames.set(a.id, a.name || a.email || 'admin');
    }
  }
  const tierChanges = tierRows.map((t) => ({
    id: t.id,
    from_tier: t.from_tier,
    to_tier: t.to_tier,
    reason: t.reason,
    created_at: t.created_at,
    by: t.admin_id ? (adminNames.get(t.admin_id) ?? 'admin') : null,
  }));

  // ── Uso + acesso ──
  const toolEvents = (toolRes && !toolRes.error ? (toolRes.data ?? []) : []) as ToolEventRow[];
  const accessEnabled = !!sessRes && !sessRes.error;
  const sessions = (accessEnabled ? (sessRes.data ?? []) : []) as AccessSessionRow[];
  const devices = (devRes && !devRes.error ? (devRes.data ?? []) : []) as AccessDeviceRow[];
  const events = (evRes && !evRes.error ? (evRes.data ?? []) : []) as AccessEventRow[];

  const { plan, access } = classifyAccess(row);

  return NextResponse.json({
    user: {
      ...profile,
      // phone_verified = true só quando o SMS confirmou; aí `phone` (o
      // primeiro da lista em bestPhone) é exatamente o número verificado.
      phone: bestPhone(row, meta.phone),
      tool_unlocks: Array.isArray(row.tool_unlocks) ? row.tool_unlocks : [],
      static_unlocks: staticUnlocksForEmail(email),
      plan,
      access,
    },
    auth,
    payments,
    billing,
    tierChanges,
    usage: summarizeUsage(toolEvents, 30),
    access: {
      enabled: accessEnabled,
      sessions,
      events,
      ...summarizeAccess(sessions, devices, events, 30),
    },
  });
}
