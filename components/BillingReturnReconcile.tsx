'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Quando o cliente volta do checkout do Stripe (success_url
 * `/tools?upgraded=1`), reconcilia o acesso pago com o Stripe — rede de
 * segurança caso o webhook não tenha chegado/processado a tempo.
 *
 * Se o tier subiu, recarrega `/tools` LIMPO (sem o ?upgraded=1) pra UI e
 * middleware refletirem o plano novo. Roda uma única vez. Falha em silêncio.
 */
export function BillingReturnReconcile() {
  const params = useSearchParams();
  const ran = useRef(false);

  useEffect(() => {
    if (params.get('upgraded') !== '1' || ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const res = await fetch('/api/billing/reconcile', { method: 'POST' });
        const data = (await res.json().catch(() => null)) as
          | { applied?: boolean }
          | null;
        if (data?.applied) {
          // Recarrega sem o param pro tier novo aparecer (useTier refaz o
          // fetch) e não disparar de novo.
          window.location.replace('/tools');
        }
      } catch {
        /* silencioso — o webhook ou o botão admin cobrem o resto */
      }
    })();
  }, [params]);

  return null;
}
