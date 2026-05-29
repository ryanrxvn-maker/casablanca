'use client';

import { useState } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { getStripePromise } from '@/lib/stripe-client';

/**
 * Formulário NATIVO de atualização de cartão (Stripe Elements embutido).
 * O número do cartão vai direto do browser pro Stripe (caixa-forte deles);
 * nosso servidor nunca toca nele. Estilizado com a cara do app.
 */

const CARD_OPTIONS = {
  style: {
    base: {
      color: '#ffffff',
      fontSize: '15px',
      fontFamily: 'inherit',
      iconColor: '#c084fc',
      '::placeholder': { color: '#6b6b78' },
    },
    invalid: { color: '#fca5a5', iconColor: '#fca5a5' },
  },
};

function Inner({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/billing/setup-intent', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.clientSecret) {
        setErr(j.error || 'Falha ao iniciar.');
        return;
      }
      const card = elements.getElement(CardElement);
      if (!card) {
        setErr('Campo do cartão não carregou.');
        return;
      }
      const result = await stripe.confirmCardSetup(j.clientSecret, {
        payment_method: { card },
      });
      if (result.error) {
        setErr(result.error.message || 'Cartão recusado.');
        return;
      }
      const pmRaw = result.setupIntent?.payment_method;
      const pmId = typeof pmRaw === 'string' ? pmRaw : pmRaw?.id;
      if (!pmId) {
        setErr('Não foi possível salvar o cartão.');
        return;
      }
      const r2 = await fetch('/api/billing/set-default-card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentMethodId: pmId }),
      });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        setErr(j2.error || 'Falha ao definir o cartão.');
        return;
      }
      onDone();
    } catch {
      setErr('Erro inesperado ao salvar o cartão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-text-dim">
        Novo cartão
      </label>
      <div className="rounded-[12px] border border-line-strong bg-black/40 px-4 py-3.5 transition focus-within:border-violet">
        <CardElement options={CARD_OPTIONS} />
      </div>
      {err ? (
        <div className="rounded-[10px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-200">
          {err}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !stripe} className="btn-primary">
          {busy ? 'Salvando…' : 'Salvar cartão'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost" disabled={busy}>
          Cancelar
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-dim">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
          Seguro via
          <svg height="13" viewBox="0 0 60 25" fill="#635BFF" aria-label="Stripe" role="img">
            <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.14v5.86zm-4.91.7c0 2.72-2.16 4.26-5.3 4.26a10.5 10.5 0 0 1-4.12-.86v-3.94c1.3.71 2.95 1.23 4.12 1.23.79 0 1.35-.21 1.35-.86 0-1.68-5.6-1.05-5.6-5.13 0-2.68 2.05-4.28 5.11-4.28 1.31 0 2.62.2 3.93.73v3.89a8.5 8.5 0 0 0-3.93-1.02c-.74 0-1.2.21-1.2.76 0 1.58 5.64.83 5.64 5.13z" />
          </svg>
        </span>
      </div>
    </form>
  );
}

export function CardUpdate(props: { onDone: () => void; onCancel: () => void }) {
  return (
    <Elements stripe={getStripePromise()}>
      <Inner {...props} />
    </Elements>
  );
}
