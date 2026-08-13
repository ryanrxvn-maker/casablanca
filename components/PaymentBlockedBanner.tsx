'use client';

import Link from 'next/link';
import { usePaymentBlocked } from '@/lib/use-tier';

/**
 * Aviso global (layout das ferramentas): a conta TEM assinatura, mas a
 * renovação não foi paga (past_due/unpaid) → o acesso Premium está SUSPENSO
 * pelos gates do servidor. O banner explica o porquê e leva direto pra tela
 * onde dá pra resolver (tentar cobrar de novo / trocar o cartão).
 *
 * Cores por TOKEN (--pink adapta claro/escuro sozinho — sem hex fixo).
 */
export function PaymentBlockedBanner() {
  const blocked = usePaymentBlocked();
  if (!blocked) return null;

  return (
    <div
      role="alert"
      className="mx-4 mt-4 overflow-hidden rounded-[14px] border md:mx-8"
      style={{
        borderColor: 'rgb(var(--pink) / 0.45)',
        background:
          'linear-gradient(90deg, rgb(var(--pink) / 0.14), rgb(var(--pink) / 0.05)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-5">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'rgb(var(--pink) / 0.15)',
            border: '1px solid rgb(var(--pink) / 0.4)',
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgb(var(--pink))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="text-[12px] font-bold uppercase tracking-[0.14em]"
            style={{ fontFamily: 'var(--font-tech)', color: 'rgb(var(--pink))' }}
          >
            Pagamento pendente — acesso Premium suspenso
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-text-muted">
            Tentamos cobrar a renovação e o pagamento não foi aprovado. Assim
            que ele entrar, tudo volta na hora.
          </p>
        </div>
        <Link
          href="/configuracoes/assinatura"
          className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold uppercase tracking-[0.1em] transition-transform hover:scale-[1.03] active:scale-[0.97]"
          style={{
            fontFamily: 'var(--font-tech)',
            color: 'rgb(var(--bg))',
            background: 'rgb(var(--pink))',
            boxShadow: '0 4px 16px -4px rgb(var(--pink) / 0.6)',
          }}
        >
          Resolver pagamento →
        </Link>
      </div>
    </div>
  );
}
