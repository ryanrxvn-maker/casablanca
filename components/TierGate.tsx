'use client';

import { ReactNode } from 'react';
import { useTier, type Tier } from '@/lib/use-tier';
import { ToolShell } from '@/components/ToolShell';

/**
 * TierGate — defesa em profundidade pro acesso de ferramentas.
 *
 * O middleware (lib/supabase/middleware.ts) JÁ bloqueia server-side
 * via PRO_ONLY_TOOLS / ADMIN_ONLY_PREFIXES (redirect 307 pra /tools).
 * Esse component existe SÓ pra cobrir 2 cenários onde middleware
 * pode não pegar:
 *  - SSR cache stale (Vercel edge cache devolvendo página antiga)
 *  - Bug raro em soft-navigation (next/link sem revalidate)
 *
 * Uso:
 *   export default function Page() {
 *     return (
 *       <TierGate require="pro" toolName="HeyGen Auto">
 *         <RealPageContent />
 *       </TierGate>
 *     );
 *   }
 *
 * Hierarquia de acesso:
 *   admin > pro > basic > free
 *   require='pro'   → libera pro+admin
 *   require='basic' → libera basic+pro+admin
 *   require='admin' → libera só admin
 */

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  admin: 3,
};

const TIER_LABEL: Record<Exclude<Tier, 'free'>, string> = {
  basic: 'Basic',
  pro: 'Pro',
  admin: 'Admin',
};

const TIER_HUE: Record<Exclude<Tier, 'free'>, string> = {
  basic: 'rgba(192,132,252,0.45)',
  pro: 'rgba(217,70,239,0.45)',
  admin: 'rgba(200,255,0,0.45)',
};

export function TierGate({
  require,
  toolName,
  children,
}: {
  require: 'basic' | 'pro' | 'admin';
  toolName: string;
  children: ReactNode;
}) {
  const tier = useTier();

  // Loading: spinner discreto enquanto tier não chega
  if (tier === null) {
    return (
      <ToolShell title={toolName} description="Verificando acesso…" hue={TIER_HUE[require]}>
        <div
          className="mono text-[11px] uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Carregando…
        </div>
      </ToolShell>
    );
  }

  // Tem acesso? Renderiza o conteúdo real
  if (TIER_RANK[tier] >= TIER_RANK[require]) {
    return <>{children}</>;
  }

  // Bloqueado — UI consistente com /auth/error e /planos
  const needLabel = TIER_LABEL[require];
  const hue = TIER_HUE[require];

  return (
    <ToolShell
      title={toolName}
      eyebrow="ACESSO RESTRITO"
      description={`Disponível só pra contas ${needLabel}.`}
      hue={hue}
    >
      <div
        className="relative overflow-hidden rounded-[18px] border p-6 md:p-8"
        style={{
          borderColor: hue,
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), #0c0c10)',
        }}
      >
        {/* glow ambient */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-60 blur-3xl"
          style={{ background: hue }}
        />
        <div className="relative flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border text-2xl"
              style={{
                borderColor: hue,
                background: `linear-gradient(135deg, ${hue}, transparent 70%), rgba(0,0,0,0.5)`,
                boxShadow: `0 0 22px -6px ${hue}`,
              }}
            >
              🔒
            </span>
            <div className="flex-1">
              <div
                className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {toolName.toUpperCase()}
              </div>
              <h3
                className="mt-1 text-[22px] font-extrabold tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
              >
                Requer plano {needLabel}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
                Sua conta é{' '}
                <span
                  className="mono rounded-full border border-line-strong bg-bg-soft/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted"
                >
                  {tier === 'free' ? 'FREE' : tier === 'basic' ? 'BASIC' : tier.toUpperCase()}
                </span>{' '}
                · pra desbloquear o <span className="text-white">{toolName}</span> faça
                upgrade pra{' '}
                <span className="font-bold text-white">{needLabel}</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5 pt-2">
            <a
              href="/planos"
              className="group inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-[1px]"
              style={{
                fontFamily: 'var(--font-tech)',
                borderColor: hue,
                background: hue.replace('0.45', '0.18'),
                boxShadow: `0 0 22px -6px ${hue}`,
              }}
            >
              Ver planos
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </a>
            <a
              href="https://wa.me/5534991262437"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-bg-soft/60 px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.14em] text-text-muted transition hover:border-lime/60 hover:text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Falar no WhatsApp
            </a>
            <a
              href="/tools"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.14em] text-text-muted transition hover:border-white/40 hover:text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ← Voltar pras ferramentas
            </a>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
