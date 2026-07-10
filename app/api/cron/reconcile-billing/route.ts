import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { notifyOwner } from '@/lib/notify';
import { reconcileUserBilling } from '@/lib/billing-reconcile';

/**
 * GET /api/cron/reconcile-billing  (Vercel Cron, diário)
 *
 * Rede de segurança FINAL, independente do webhook E do redirect de retorno.
 * Varre os profiles que estão 'free' MAS têm stripe_customer_id (ou seja,
 * iniciaram checkout) e reconcilia cada um com o estado real do Stripe.
 * reconcileUserBilling SÓ concede (nunca rebaixa) e é idempotente — seguro
 * rodar todo dia. Pega TODO cenário de borda onde o webhook escapou e o cliente
 * não voltou por /tools?upgraded=1 (aba fechada, outro device, pgto assíncrono).
 *
 * Proteção: exige Authorization: Bearer <CRON_SECRET> (a Vercel injeta esse
 * header automaticamente no cron). Em produção FALHA FECHADO se CRON_SECRET
 * não estiver setado — senão a rota ficaria aberta e qualquer anônimo
 * dispararia uma varredura de até 1000 perfis × 2-3 chamadas Stripe cada.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Sem secret em produção: não roda aberto. Configure CRON_SECRET nas
    // Environment Variables da Vercel pra reativar a varredura.
    return NextResponse.json(
      { error: 'CRON_SECRET não configurado.' },
      { status: 401 },
    );
  }

  const svc = serviceClient();
  const { data, error } = await svc
    .from('profiles')
    .select('id')
    .eq('tier', 'free')
    .not('stripe_customer_id', 'is', null)
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as Array<{ id: string }> | null) ?? [];
  let granted = 0;
  const upgraded: string[] = [];
  for (const row of rows) {
    try {
      const r = await reconcileUserBilling(row.id);
      if (r.applied) {
        granted++;
        upgraded.push(`${row.id} → ${r.tier}`);
      }
    } catch {
      /* best-effort por usuário — não derruba a varredura toda */
    }
  }

  if (granted > 0) {
    await notifyOwner(
      `🛟 Cron reconciliou ${granted} conta(s) paga(s) que estavam free`,
      `<p>A varredura diária encontrou e corrigiu ${granted} de ${rows.length} ` +
        `profiles free-com-customer:</p><pre>${upgraded.join('\n')}</pre>`,
    ).catch(() => {});
  }

  return NextResponse.json({ checked: rows.length, granted });
}
