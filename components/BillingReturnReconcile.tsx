'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Quando o cliente volta do checkout do Stripe (success_url
 * `/tools?upgraded=1`), reconcilia o acesso pago com o Stripe — rede de
 * segurança caso o webhook não tenha chegado/processado a tempo.
 *
 * Re-tenta com backoff por ~30s enquanto `applied` for false: cobre o caso em
 * que a 1a fatura ainda está liquidando (sub 'incomplete') no instante do
 * retorno e vira 'active' segundos depois — sem depender só do webhook. Ao
 * aplicar, recarrega `/tools` LIMPO (sem ?upgraded=1) pra UI e middleware
 * refletirem o plano novo. Roda uma única vez. Falha em silêncio.
 */
const BACKOFF_MS = [0, 3000, 6000, 12000, 24000];

export function BillingReturnReconcile() {
  const params = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (params.get('upgraded') !== '1' || ran.current) return;
    ran.current = true;
    let cancelled = false;

    (async () => {
      for (const wait of BACKOFF_MS) {
        if (cancelled) return;
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          const res = await fetch('/api/billing/reconcile', { method: 'POST' });
          const data = (await res.json().catch(() => null)) as
            | { applied?: boolean }
            | null;
          if (data?.applied) {
            // Recarrega sem o param pro tier novo aparecer e não re-disparar.
            window.location.replace('/tools');
            return;
          }
        } catch {
          /* silencioso — o webhook, o cron e o botão admin cobrem o resto */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params]);

  return null;
}
