import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { serviceClient } from '@/app/api/admin/_helpers';
import { notifyOwner, brlFromCents } from '@/lib/notify';
import { stripeSubPeriodEndISO } from '@/lib/billing-reconcile';
import {
  isPaidTier,
  isBilling,
  periodEndFrom,
  type PaidTier,
  type Billing,
} from '@/lib/plan-prices';

/**
 * POST /api/billing/webhook  (Stripe → servidor)
 *
 * Modelo ASSINATURA RECORRENTE (cartão). Roda com SERVICE_ROLE (bypassa o
 * trigger anti-escalada). Assinatura verificada via STRIPE_WEBHOOK_SECRET.
 *
 * Eventos:
 *  • checkout.session.completed       → 1a assinatura criada → concede acesso
 *  • invoice.paid                     → cobrança (1a + renovações) → renova + grava comprovante
 *  • customer.subscription.updated    → active/trialing=concede · terminal=free · transitório=preserva
 *  • customer.subscription.deleted    → free
 *
 * Garantias:
 *  - Falha de escrita no banco LANÇA → HTTP 500 → o Stripe re-tenta com backoff
 *    (~3 dias). Nada é engolido com 200 (era o bug intermitente: pagou e ficou free).
 *  - Status TRANSITÓRIO (incomplete/past_due/paused) NÃO derruba quem pagou — só
 *    estado TERMINAL (canceled/unpaid/incomplete_expired) ou subscription.deleted
 *    rebaixam pra free. Protege contra evento 'updated' fora de ordem (o Stripe não
 *    garante ordem de entrega). A expiração real fica por conta do isPaidExpired (grace).
 *  - Admin nunca é alterado (use-tier/middleware priorizam is_admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Folga p/ não ser cortado no meio (retrieve Stripe + update Supabase + notify).
// Se a função estourar o tempo, ela responde 5xx e o Stripe re-tenta (ok).
export const maxDuration = 30;

type SubLike = Stripe.Subscription & {
  current_period_end?: number;
  metadata: Record<string, string>;
};
type InvoiceLike = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  hosted_invoice_url?: string | null;
  // Shape novo (API 'dahlia'): a referência da assinatura saiu do top-level.
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null;
  } | null;
};

// CONCEDE acesso: assinatura paga e vigente.
const GRANT_STATUS = new Set(['active', 'trialing']);
// REBAIXA pra free: estados TERMINAIS (cobrança esgotada / cancelada de vez).
const TERMINAL_STATUS = new Set(['canceled', 'unpaid', 'incomplete_expired']);
// Qualquer outro (incomplete, past_due, paused, …) é TRANSITÓRIO: NÃO mexe no
// tier — preserva o acesso pago. Um 'updated' fora de ordem (o Stripe não
// garante ordem de entrega) ou um soluço momentâneo de cobrança JAMAIS pode
// derrubar quem pagou. A expiração real fica por conta de subscription.deleted
// + isPaidExpired (grace de 3 dias além do fim do período).

/** Resolve a referência da subscription numa invoice, cobrindo o shape antigo
 *  (invoice.subscription) e o novo da 'dahlia' (invoice.parent.subscription_details). */
function invoiceSubId(invoice: InvoiceLike): string | undefined {
  const ref =
    invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Escreve o patch no profile e GARANTE que pegou. Em erro de banco OU em
 * "0 linhas afetadas" (userId que não casa nenhum profile), LANÇA — o handler
 * responde 500 e o Stripe re-tenta. Antes, o erro era só logado e o POST
 * retornava 200 → o evento se perdia e o cliente ficava free em silêncio
 * (o bug intermitente do Fernando). Updates são idempotentes → retry é seguro.
 */
async function writeProfile(
  svc: ReturnType<typeof serviceClient>,
  userId: string,
  patch: Record<string, unknown>,
  ctx: string,
  ref: string,
) {
  const { data, error } = await svc
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id');

  if (error) {
    console.error(`[billing webhook] ${ctx}: update falhou`, error);
    await notifyOwner(
      '🚨 Falha ao aplicar plano (pago, mas NÃO subiu — Stripe vai re-tentar)',
      `<p>${ctx} — update do profile <b>${userId}</b> (${ref}) falhou: ` +
        `${error.message}.</p>`,
    ).catch(() => {});
    throw new Error(`profile update failed (${ctx}): ${error.message}`);
  }
  if (!data || data.length === 0) {
    console.error(`[billing webhook] ${ctx}: update afetou 0 linhas (userId=${userId})`);
    await notifyOwner(
      '🚨 Update afetou 0 linhas (pago, mas NÃO subiu)',
      `<p>${ctx} — nenhum profile com id <b>${userId}</b> (${ref}). ` +
        `Verifique o vínculo customer↔profile e reconcilie pelo painel.</p>`,
    ).catch(() => {});
    throw new Error(`profile update affected 0 rows (${ctx}) for user ${userId}`);
  }
}

/** Aplica no profile o estado atual da assinatura. */
async function applySubscription(sub: SubLike) {
  const planRaw = sub.metadata?.plan ?? '';
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const svc = serviceClient();

  // userId vem do metadata; se faltar (subscription criada sem metadata, ou
  // API antiga), acha o dono pelo customer salvo no checkout. Garante que o
  // cliente NUNCA fica sem upgrade por um metadata perdido.
  let userId: string | undefined = sub.metadata?.userId;
  if (!userId && customerId) {
    const { data } = await svc
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    userId = (data as { id?: string } | null)?.id ?? undefined;
  }

  if (!userId || !isPaidTier(planRaw)) {
    // NÃO lança: metadata ausente não conserta com retry (evita loop inútil de
    // re-tentativas do Stripe por 3 dias). Alerta e sai.
    console.error('[billing webhook] applySubscription: sem userId/plan', {
      subId: sub.id,
      customerId,
      metadata: sub.metadata,
    });
    await notifyOwner(
      '⚠️ Webhook sem metadata',
      `<p>Assinatura <b>${sub.id}</b> (customer ${customerId ?? '—'}) chegou sem ` +
        `userId/plan válidos. Cliente pode ter ficado sem upgrade — ` +
        `use "Sincronizar c/ Stripe" no painel.</p>`,
    ).catch(() => {});
    return;
  }
  const plan = planRaw as PaidTier;
  const status = sub.status;

  // Sempre espelha o vínculo + status + período. Mexe em tier/plano só nos
  // estados decididos (concede ou rebaixa-terminal). Transitório preserva.
  const patch: Record<string, unknown> = {
    stripe_customer_id: customerId ?? null,
    stripe_subscription_id: sub.id,
    subscription_status: status,
    current_period_end: stripeSubPeriodEndISO(sub),
  };
  if (GRANT_STATUS.has(status)) {
    patch.subscription_plan = plan;
    patch.tier = plan;
  } else if (TERMINAL_STATUS.has(status)) {
    patch.subscription_plan = null;
    patch.tier = 'free';
  }

  await writeProfile(svc, userId, patch, `applySubscription(${status})`, sub.id);
}

/** Grava o comprovante de uma cobrança (1a ou renovação). Idempotente por invoice. */
async function recordInvoice(invoice: InvoiceLike, sub: SubLike) {
  const userId = sub.metadata?.userId;
  if (!userId) return;
  const piId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id ?? null;

  await serviceClient()
    .from('payments')
    .upsert(
      {
        user_id: userId,
        email: invoice.customer_email ?? null,
        amount: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? 'brl',
        plan: (sub.metadata?.plan as PaidTier) ?? null,
        billing: sub.metadata?.billing ?? null,
        status: 'paid',
        stripe_payment_intent: piId,
        stripe_checkout_session: invoice.id, // chave única do registro
        receipt_url: invoice.hosted_invoice_url ?? null,
      },
      { onConflict: 'stripe_checkout_session' },
    );

  // Avisa o dono — só cobranças reais (ignora R$0 de cortesia/cupom).
  if ((invoice.amount_paid ?? 0) > 0) {
    await notifyOwner(
      `💰 Nova cobrança · ${brlFromCents(invoice.amount_paid ?? 0)}`,
      `<p><b>Plano:</b> ${sub.metadata?.plan ?? '—'} (${sub.metadata?.billing ?? '—'})<br>` +
        `<b>Valor:</b> ${brlFromCents(invoice.amount_paid ?? 0)}<br>` +
        `<b>Cliente:</b> ${invoice.customer_email ?? '—'}</p>`,
    );
  }
}

/** ANUAL = pagamento único: libera acesso por 1 ano (não renova). */
async function grantOneTime(session: Stripe.Checkout.Session) {
  const planRaw = session.metadata?.plan ?? '';
  const billing = session.metadata?.billing;
  const period: Billing = isBilling(billing ?? '') ? (billing as Billing) : 'annual';
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const svc = serviceClient();

  // Fallback de userId pelo customer (igual applySubscription).
  let userId = session.metadata?.userId;
  if (!userId && customerId) {
    const { data } = await svc
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    userId = (data as { id?: string } | null)?.id ?? undefined;
  }

  if (!userId || !isPaidTier(planRaw)) {
    console.error('[billing webhook] grantOneTime: sem userId/plan', {
      sessionId: session.id,
      customerId,
      metadata: session.metadata,
    });
    await notifyOwner(
      '⚠️ Pagamento único sem metadata',
      `<p>Sessão <b>${session.id}</b> (customer ${customerId ?? '—'}) sem ` +
        `userId/plan. Reconcilie pelo painel.</p>`,
    ).catch(() => {});
    return;
  }
  const plan = planRaw as PaidTier;

  await writeProfile(
    svc,
    userId,
    {
      stripe_customer_id: customerId ?? null,
      stripe_subscription_id: null, // não é assinatura
      subscription_status: 'paid', // expira em current_period_end (require-tier)
      subscription_plan: plan,
      tier: plan,
      current_period_end: periodEndFrom(period).toISOString(),
    },
    'grantOneTime',
    session.id,
  );
}

/** Grava o comprovante de um pagamento único (anual). Idempotente por session. */
async function recordOneTimePayment(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) return;
  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as { id: string } | null)?.id ?? null;

  let receiptUrl: string | null = null;
  if (piId) {
    try {
      const pi = await getStripe().paymentIntents.retrieve(piId, {
        expand: ['latest_charge'],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      receiptUrl = charge?.receipt_url ?? null;
    } catch {
      /* sem comprovante agora */
    }
  }

  await serviceClient()
    .from('payments')
    .upsert(
      {
        user_id: userId,
        email: session.customer_details?.email ?? session.customer_email ?? null,
        amount: session.amount_total ?? 0,
        currency: session.currency ?? 'brl',
        plan: (session.metadata?.plan as PaidTier) ?? null,
        billing: session.metadata?.billing ?? null,
        status: 'paid',
        stripe_payment_intent: piId,
        stripe_checkout_session: session.id,
        receipt_url: receiptUrl,
      },
      { onConflict: 'stripe_checkout_session' },
    );

  if ((session.amount_total ?? 0) > 0) {
    await notifyOwner(
      `💰 Nova venda (anual) · ${brlFromCents(session.amount_total ?? 0)}`,
      `<p><b>Plano:</b> ${session.metadata?.plan ?? '—'} (anual)<br>` +
        `<b>Valor:</b> ${brlFromCents(session.amount_total ?? 0)}<br>` +
        `<b>Cliente:</b> ${session.customer_details?.email ?? session.customer_email ?? '—'}</p>`,
    );
  }
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET não configurado.' },
      { status: 500 },
    );
  }
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Sem assinatura.' }, { status: 400 });

  const raw = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: 'Assinatura inválida.', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription') {
          // MENSAL recorrente
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id;
          if (subId) {
            const sub = (await stripe.subscriptions.retrieve(subId)) as SubLike;
            // Fallback: subscription recém-criada pode não ter metadata ainda;
            // a session sempre tem (checkout/route.ts envia em ambos os lugares).
            if (!sub.metadata?.userId && session.metadata?.userId) {
              sub.metadata = { ...session.metadata };
            }
            await applySubscription(sub);
          } else if (session.metadata?.userId && isPaidTier(session.metadata?.plan ?? '')) {
            // Sem subId resolvido mas a session tem metadata: NÃO escapa em
            // silêncio. Promove direto pela session (userId/plan bastam) — o
            // invoice.paid depois reconcilia o id/período da assinatura.
            await applySubscription({
              id: 'sess:' + session.id,
              status: 'active',
              customer: session.customer,
              metadata: { ...session.metadata },
            } as unknown as SubLike);
          } else {
            await notifyOwner(
              '⚠️ checkout.session.completed sem subscription id',
              `<p>Sessão <b>${session.id}</b> (assinatura) sem subscription id ` +
                `resolvível e sem metadata.userId. Reconcilie pelo painel.</p>`,
            ).catch(() => {});
          }
        } else if (session.mode === 'payment' && session.payment_status === 'paid') {
          // ANUAL pagamento único (parcelável) — libera 1 ano
          await grantOneTime(session);
          await recordOneTimePayment(session);
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as InvoiceLike;
        const subId = invoiceSubId(invoice);
        if (subId) {
          const sub = (await stripe.subscriptions.retrieve(subId)) as SubLike;
          await applySubscription(sub); // renova current_period_end
          await recordInvoice(invoice, sub);
        }
        break;
      }
      case 'customer.subscription.updated': {
        await applySubscription(event.data.object as SubLike);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as SubLike;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const userId = sub.metadata?.userId;
        const svc = serviceClient();
        const patch = {
          subscription_status: 'canceled',
          subscription_plan: null,
          tier: 'free',
        };
        const del = userId
          ? await svc.from('profiles').update(patch).eq('id', userId)
          : customerId
            ? await svc.from('profiles').update(patch).eq('stripe_customer_id', customerId)
            : { error: null };
        if (del.error) {
          // Falhou rebaixar → 500 pro Stripe re-tentar (idempotente).
          console.error('[billing webhook] downgrade (deleted) falhou', del.error);
          throw new Error(`downgrade failed: ${del.error.message}`);
        }

        await notifyOwner(
          '⚠️ Assinatura cancelada',
          `<p>Um cliente cancelou a assinatura.<br>` +
            `<b>Plano:</b> ${sub.metadata?.plan ?? '—'}<br>` +
            `<b>Customer:</b> ${customerId ?? '—'}</p>`,
        );
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // CRÍTICO: erro transitório (hiccup da API Stripe, timeout do Supabase,
    // cold start) NÃO pode ser engolido. Antes respondíamos 200 → o Stripe
    // dava o evento como entregue e NUNCA re-tentava → o cliente pagava e
    // ficava free pra sempre, em silêncio (era o bug intermitente). Agora
    // respondemos 500: o Stripe re-tenta com backoff por até ~3 dias. Os
    // handlers são idempotentes (update por id + upsert por chave única),
    // então re-tentar é seguro.
    console.error('[billing webhook] handler error → 500 p/ Stripe re-tentar', event.type, e);
    await notifyOwner(
      '🚨 Erro processando webhook (Stripe vai re-tentar)',
      `<p>Evento <b>${event.type}</b> falhou: ` +
        `${e instanceof Error ? e.message : String(e)}.<br>` +
        `O Stripe re-tenta automaticamente. Se persistir, reconcilie pelo painel.</p>`,
    ).catch(() => {});
    return NextResponse.json(
      { error: 'handler error', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
