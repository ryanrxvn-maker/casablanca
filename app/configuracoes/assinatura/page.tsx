'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CardUpdate } from '@/components/CardUpdate';

/**
 * /configuracoes/assinatura — gestão de assinatura 100% nativa (sem portal
 * externo / sem marca de terceiros). Mostra plano, valor, próxima cobrança,
 * cartão, status e histórico de faturas; cancela/reativa direto na nossa API.
 */

type Sub = {
  id: string;
  status: string;
  plan: string | null;
  billing: string | null;
  amount: number | null;
  currency: string;
  interval: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
};
type Invoice = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string | null;
  url: string | null;
};
type Data = { subscription: Sub | null; invoices?: Invoice[]; tier: string };

const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

const PLAN_HUE: Record<string, string> = {
  pro: '#c084fc',
  basic: '#f472b6',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativa',
  trialing: 'Em teste',
  past_due: 'Pagamento pendente',
  unpaid: 'Pagamento em atraso',
  canceled: 'Cancelada',
  admin_grant: 'Cortesia',
};

export default function AssinaturaPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editCard, setEditCard] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/subscription', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const j = (await res.json()) as Data;
      setData(j);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: u }) => {
      if (!u.user) {
        router.replace('/login');
        return;
      }
      load();
    });
  }, [load, router]);

  async function act(action: 'cancel' | 'reactivate') {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(j.error || 'Falha na operação.');
        return;
      }
      setConfirmCancel(false);
      setToast(
        action === 'cancel'
          ? 'Assinatura cancelada. Você mantém o acesso até o fim do período pago.'
          : 'Assinatura reativada. Sua renovação volta ao normal.',
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const sub = data?.subscription ?? null;
  const hue = sub?.plan ? PLAN_HUE[sub.plan] ?? '#a78bfa' : '#a78bfa';

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 md:px-8">
      <div className="animate-fade-in-up mb-8">
        <Link href="/configuracoes" className="text-[12px] text-text-muted hover:text-white">
          ← Configurações
        </Link>
        <h1 className="section-title mt-2">Minha assinatura</h1>
        <p className="mt-2 text-sm text-text-muted">
          Seu plano, cobranças e cancelamento — tudo aqui.
        </p>
      </div>

      {loading ? (
        <div className="rounded-[16px] border border-line bg-bg-soft/60 p-8 text-center text-sm text-text-muted">
          <span className="loading-dots">Carregando</span>
        </div>
      ) : !sub ? (
        <div
          className="rounded-[18px] border border-line/70 p-8 text-center"
          style={{ background: 'linear-gradient(180deg,rgb(var(--bg-softer)),#0b0b0e)' }}
        >
          <div className="text-[16px] font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
            {data?.tier && data.tier !== 'free'
              ? `Você está no plano ${data.tier.toUpperCase()} (cortesia)`
              : 'Você ainda não tem uma assinatura'}
          </div>
          <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] text-text-muted">
            {data?.tier && data.tier !== 'free'
              ? 'Seu acesso foi liberado manualmente pela equipe — não há cobrança recorrente.'
              : 'Escolha um plano pra desbloquear as ferramentas premium.'}
          </p>
          <Link href="/planos" className="btn-primary mt-5 inline-block">
            Ver planos
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Card do plano */}
          <div
            className="relative overflow-hidden rounded-[20px] border p-6 md:p-7"
            style={{
              borderColor: hue + '66',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.2)), linear-gradient(180deg,rgb(var(--bg-softer)),#0b0b0e)',
              boxShadow: `0 0 40px -22px ${hue}`,
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-40 blur-2xl"
              style={{ background: hue }}
            />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div
                  className="text-[11px] font-bold uppercase tracking-[0.2em]"
                  style={{ fontFamily: 'var(--font-tech)', color: hue }}
                >
                  Plano {sub.plan ?? ''}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span
                    className="text-[34px] font-extrabold tracking-tight text-white"
                    style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
                  >
                    {sub.amount != null ? brl(sub.amount) : '—'}
                  </span>
                  <span className="text-[14px] text-text-muted">
                    /{sub.interval === 'year' ? 'ano' : 'mês'}
                  </span>
                </div>
              </div>
              <StatusBadge sub={sub} hue={hue} />
            </div>

            {/* Próxima cobrança / cancelamento */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoRow
                label={sub.cancel_at_period_end ? 'Acesso até' : 'Próxima cobrança'}
                value={sub.current_period_end ? dateFmt(sub.current_period_end) : '—'}
              />
              <InfoRow
                label="Forma de pagamento"
                value={
                  sub.card
                    ? `${sub.card.brand.toUpperCase()} •••• ${sub.card.last4} · ${String(
                        sub.card.exp_month,
                      ).padStart(2, '0')}/${sub.card.exp_year}`
                    : '—'
                }
              />
            </div>

            {/* Atualizar cartão (nativo, Elements) */}
            <div className="mt-4">
              {editCard ? (
                <div className="rounded-[14px] border border-line/60 bg-black/20 p-4">
                  <CardUpdate
                    onDone={() => {
                      setEditCard(false);
                      setToast('Cartão atualizado com sucesso.');
                      load();
                    }}
                    onCancel={() => setEditCard(false)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditCard(true)}
                  className="text-[13px] text-violet hover:text-white"
                >
                  Atualizar cartão →
                </button>
              )}
            </div>

            {sub.cancel_at_period_end ? (
              <div className="mt-5 rounded-[12px] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-200">
                Cancelamento agendado. Você continua com acesso até{' '}
                <strong>{sub.current_period_end ? dateFmt(sub.current_period_end) : 'o fim do período'}</strong>.
                Mudou de ideia?
              </div>
            ) : null}

            {/* Ações */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {sub.cancel_at_period_end ? (
                <button
                  type="button"
                  onClick={() => act('reactivate')}
                  disabled={busy}
                  className="btn-primary"
                >
                  {busy ? 'Reativando…' : 'Reativar assinatura'}
                </button>
              ) : !confirmCancel ? (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="btn-ghost"
                >
                  Cancelar assinatura
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-rose-400/40 bg-rose-500/10 px-3 py-2">
                  <span className="text-[13px] text-rose-100">
                    Cancelar mesmo? Você mantém o acesso até o fim do período pago.
                  </span>
                  <button
                    type="button"
                    onClick={() => act('cancel')}
                    disabled={busy}
                    className="rounded-full bg-rose-500 px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-rose-600"
                  >
                    {busy ? 'Cancelando…' : 'Sim, cancelar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    className="text-[12.5px] text-text-muted hover:text-white"
                  >
                    Voltar
                  </button>
                </div>
              )}
              <Link href="/planos" className="text-[13px] text-violet hover:text-white">
                Trocar de plano
              </Link>
            </div>
          </div>

          {toast ? (
            <div className="rounded-[12px] border border-lime/40 bg-lime/10 px-4 py-3 text-[13px] text-lime">
              {toast}
            </div>
          ) : null}

          {/* Histórico de faturas */}
          <div
            className="rounded-[18px] border border-line/70 p-5 md:p-6"
            style={{ background: 'linear-gradient(180deg,#131318,#0b0b0e)' }}
          >
            <h2
              className="mb-4 text-[12px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Histórico de faturas
            </h2>
            {data?.invoices && data.invoices.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line/40">
                {data.invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="text-text-muted">
                      {new Date(inv.created * 1000).toLocaleDateString('pt-BR')}
                    </span>
                    <span className="font-bold text-white">{brl(inv.amount)}</span>
                    <span className="text-[11px] uppercase text-text-dim">
                      {inv.status === 'paid' ? 'pago' : inv.status ?? ''}
                    </span>
                    {inv.url ? (
                      <a
                        href={inv.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-violet hover:underline"
                      >
                        comprovante →
                      </a>
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-[13px] text-text-dim">
                Nenhuma fatura ainda.
              </p>
            )}
          </div>

          <PoweredByStripe />

          <p className="text-center text-[12px] text-text-dim">
            Ao cancelar, seguimos a{' '}
            <Link href="/politica" className="text-violet hover:text-white">
              Política de Cancelamento
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

/** Selo de confiança "Pagamento seguro · Stripe" — marca Stripe no roxo
 *  oficial (#635BFF) pra transmitir segurança, dentro do nosso layout. */
function PoweredByStripe() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[14px] border border-line/60 bg-black/20 px-4 py-3">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9c9ca6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 018 0v4" />
      </svg>
      <span className="text-[12.5px] text-text-muted">Pagamento seguro · processado por</span>
      {/* Wordmark Stripe (roxo oficial) */}
      <svg height="17" viewBox="0 0 60 25" fill="#635BFF" aria-label="Stripe" role="img">
        <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.14v5.86zm-4.91.7c0 2.72-2.16 4.26-5.3 4.26a10.5 10.5 0 0 1-4.12-.86v-3.94c1.3.71 2.95 1.23 4.12 1.23.79 0 1.35-.21 1.35-.86 0-1.68-5.6-1.05-5.6-5.13 0-2.68 2.05-4.28 5.11-4.28 1.31 0 2.62.2 3.93.73v3.89a8.5 8.5 0 0 0-3.93-1.02c-.74 0-1.2.21-1.2.76 0 1.58 5.64.83 5.64 5.13z" />
      </svg>
    </div>
  );
}

function StatusBadge({ sub, hue }: { sub: Sub; hue: string }) {
  const canceling = sub.cancel_at_period_end;
  const label = canceling ? 'Cancela em breve' : STATUS_LABEL[sub.status] ?? sub.status;
  const color = canceling ? '#fbbf24' : sub.status === 'active' ? '#c8ff00' : hue;
  return (
    <span
      className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ color, border: `1px solid ${color}66`, background: `${color}1a` }}
    >
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line/50 bg-black/20 px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div className="mt-1 text-[14px] font-semibold text-white">{value}</div>
    </div>
  );
}
