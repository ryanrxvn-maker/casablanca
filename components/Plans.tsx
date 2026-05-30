'use client';

import Link from 'next/link';
import {
  type MouseEvent as ReactMouseEvent,
  useMemo,
  useState,
} from 'react';
import { Brand } from './Brand';
import { SmokeText } from './SmokeText';

/**
 * Plans v3 — vitrine pública /planos.
 *
 * Novidades v3:
 *  • Toggle MENSAL/ANUAL com -20% no anual
 *  • Pro com OFERTA -15% (sale neon aceso, preço riscado + novo)
 *  • Lista de features em duas camadas:
 *      ▼ FEATURED 3D — ClickUp Pilot, HeyGen Auto, Auto B-roll
 *        (mini-cards com tilt no mouse + glow + sparkle)
 *      ▼ Resto — linhas simples como antes
 *  • Coelho com aura progressiva (Free → Basic → Pro)
 *  • Nomes 100% PT-BR (sem Smart Remover, sem SRT Generator)
 */

/* ─────────────────────── Dados ─────────────────────── */

type Featured = 'pilot' | 'heygen' | 'broll';

type Tool = {
  key: string;
  label: string;
  /** Se for `featured`, ganha mini-card 3D no topo da lista do plano */
  featured?: Featured;
  /** Subtítulo curto exibido só nos featured cards */
  featuredHint?: string;
  /** Cor de destaque dos featured cards */
  featuredHue?: string;
};

/** Lista única de TODAS as ferramentas. Os 3 featured aparecem
 * primeiro em CADA card de plano, em forma de mini-card 3D animado;
 * o resto vira lista simples abaixo. Nomes 100% em português. */
const ALL_TOOLS: Tool[] = [
  // ─── FEATURED (sempre no topo, cards 3D) ───
  {
    key: 'clickup-pilot',
    label: 'ClickUp Pilot',
    featured: 'pilot',
    featuredHint: 'Mapeia as tasks e dispara o lipsync de todas',
    featuredHue: 'rgba(200,255,0,0.55)',
  },
  {
    key: 'heygen-auto',
    label: 'HeyGen Auto',
    featured: 'heygen',
    featuredHint: 'Dispara todos os lipsyncs em lote',
    featuredHue: 'rgba(103,232,249,0.55)',
  },
  {
    key: 'auto-broll',
    label: 'Auto B-roll',
    featured: 'broll',
    featuredHint: 'Gera B-rolls do JSON enquanto você dorme',
    featuredHue: 'rgba(240,171,252,0.55)',
  },
  // ─── Lista comum ───
  { key: 'downloader', label: 'Downloader' },
  { key: 'decupagem-audio', label: 'Decupagem de áudio' },
  { key: 'decupagem-video', label: 'Decupagem de vídeo' },
  { key: 'removedor-legenda', label: 'Removedor de Legenda/Marca d’Água' },
  { key: 'gerador-srt', label: 'Gerador de SRT' },
  { key: 'mixer-velocidade', label: 'Mixer de Velocidade' },
  { key: 'normalizador', label: 'Normalizador de Volume' },
  { key: 'separar-audios', label: 'Dividir áudios' },
  { key: 'compressor', label: 'Compressor' },
  { key: 'camuflagem', label: 'Camuflagem' },
  { key: 'troca-produto', label: 'Troca de produto' },
  { key: 'decupagem-inteligente', label: 'Decupagem Inteligente' },
  { key: 'separador-audio', label: 'Separador de Áudio (voz/SFX/inst)' },
];

/** Quais ferramentas cada plano libera (por `key` da ALL_TOOLS). */
const UNLOCKED: Record<'free' | 'basic' | 'pro', Set<string>> = {
  free: new Set(['downloader', 'decupagem-audio']),
  basic: new Set([
    'downloader',
    'decupagem-audio',
    'decupagem-video',
    'removedor-legenda',
    'gerador-srt',
    'mixer-velocidade',
    'normalizador',
    'separar-audios',
    'compressor',
    'camuflagem',
  ]),
  pro: new Set(ALL_TOOLS.map((t) => t.key)),
};

type Billing = 'monthly' | 'annual';

type Plan = {
  id: 'free' | 'basic' | 'pro';
  name: string;
  cta: string;
  borderHue: string;
  rabbitHue: string;
  glowHue: string;
  bulletHue: string;
  highlight?: boolean;
  /** Tier visual da aura do coelho — quanto maior, mais elaborada */
  rabbitTier: 0 | 1 | 2;
  /** Pricing por billing */
  pricing: Record<Billing, { price: number; original?: number }>;
};

/**
 * Pricing:
 *  • Free: sempre R$ 0
 *  • Basic: 57 mensal → 45 anual (-20%)
 *  • Pro:   137 (riscado) → 116 mensal (-15% sale) → 92 anual (-15% + -20%)
 */
const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Plano Free',
    cta: 'Começar grátis',
    borderHue: 'rgba(167,139,250,0.55)',
    rabbitHue: '#c084fc',
    glowHue: 'rgba(167,139,250,0.45)',
    bulletHue: '#a78bfa',
    rabbitTier: 0,
    pricing: {
      monthly: { price: 0 },
      annual: { price: 0 },
    },
  },
  {
    id: 'basic',
    name: 'Plano Basic',
    cta: 'Quero o Basic',
    borderHue: 'rgba(244,114,182,0.7)',
    rabbitHue: '#f472b6',
    glowHue: 'rgba(244,114,182,0.55)',
    bulletHue: '#f472b6',
    highlight: true,
    rabbitTier: 1,
    pricing: {
      monthly: { price: 57 },
      annual: { price: 45 },
    },
  },
  {
    id: 'pro',
    name: 'Plano Pro',
    cta: 'Quero o Pro',
    borderHue: 'rgba(192,132,252,0.75)',
    rabbitHue: '#d8b4fe',
    glowHue: 'rgba(192,132,252,0.6)',
    bulletHue: '#c084fc',
    rabbitTier: 2,
    pricing: {
      monthly: { price: 116, original: 137 },
      annual: { price: 92, original: 137 },
    },
  },
];

const ANNUAL_DISCOUNT_PCT = 20;
const PRO_SALE_PCT = 15;

/* ─────────────────────── Página ─────────────────────── */

export function Plans() {
  const [billing, setBilling] = useState<Billing>('monthly');
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background mesh */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(45% 35% at 18% 12%, rgba(167,139,250,0.18), transparent 65%),' +
            'radial-gradient(40% 30% at 84% 90%, rgba(244,114,182,0.12), transparent 65%),' +
            'radial-gradient(60% 40% at 50% 100%, rgba(103,232,249,0.06), transparent 70%)',
        }}
      />
      {/* Dots/stars */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.32]"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(192,132,252,0.5) 1.2px, transparent 1.4px)',
          backgroundSize: '46px 46px',
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Brand href="/" />
          <div className="flex items-center gap-2">
            <Link href="/" className="btn-ghost">
              ← Voltar
            </Link>
            <Link href="/login" className="btn-ghost">
              Entrar
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-5 pt-16 text-center md:px-8 md:pt-24">
        <div
          className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.9)]" />
          PLANOS
        </div>
        <h1 className="hero-title" style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}>
          <SmokeText text="Escolha seu plano." className="block" />
          <span className="display-subtle block">
            <SmokeText text="A automação te espera." />
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-relaxed text-text-muted">
          Comece grátis hoje. Quando estiver pronto pra automatizar o dia
          inteiro, sobe pro Basic ou Pro.
        </p>

        {/* Toggle Mensal/Anual */}
        <div className="mt-10 flex justify-center">
          <BillingToggle value={billing} onChange={setBilling} />
        </div>
      </section>

      {/* Cards */}
      <section className="relative z-10 mx-auto mt-16 max-w-[1280px] px-5 pb-16 md:px-8 md:pb-24">
        <div className="grid grid-cols-1 gap-7 md:grid-cols-3 md:gap-6 md:pt-6">
          {PLANS.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billing={billing}
              delay={i * 110}
            />
          ))}
        </div>

        <p className="mt-12 text-center text-[13px] text-text-muted">
          Todos os planos rodam no seu computador. Seus arquivos nunca saem
          da sua máquina.
        </p>
        <p className="mx-auto mt-3 max-w-[620px] text-center text-[12px] text-text-dim">
          <strong className="text-text-muted">Mensal:</strong> assinatura que renova
          automaticamente — cancele quando quiser sem multa.{' '}
          <strong className="text-text-muted">Anual:</strong> pagamento único,
          parcele em até 12× no cartão — acesso por 12 meses.{' '}
          <Link href="/politica" className="text-violet hover:text-white">
            Política de cancelamento e reembolso
          </Link>
          .
        </p>
      </section>

      {/* Lista de ferramentas */}
      <ToolsCatalog />

      {/* Footer */}
      <footer className="relative z-10 mx-auto max-w-[1280px] px-5 pb-12 md:px-8">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-line/60 pt-8 md:flex-row md:items-center">
          <Brand href="/" />
          <div className="flex items-center gap-4 text-[12.5px] text-text-muted">
            <Link href="/politica" className="hover:text-white">
              Política
            </Link>
            <span>Auto Edit · © {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ─────────────────────── BillingToggle ─────────────────────── */
/**
 * Toggle Mensal | Anual com pill deslizante e badge "-20%" no anual.
 * Quando o usuário clica "Anual", o badge ganha pulso de destaque.
 */
function BillingToggle({
  value,
  onChange,
}: {
  value: Billing;
  onChange: (v: Billing) => void;
}) {
  const annual = value === 'annual';
  return (
    <div className="relative inline-flex items-center">
      <div
        className="billing-toggle relative inline-flex items-center gap-1 rounded-full border border-line/70 bg-bg-soft/80 p-1 backdrop-blur-md"
        style={{
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 28px -16px rgba(0,0,0,0.7)',
        }}
      >
        {/* Pill deslizante */}
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full transition-all duration-450"
          style={{
            left: annual ? 'calc(50% + 2px)' : '4px',
            width: 'calc(50% - 6px)',
            background:
              annual
                ? 'linear-gradient(135deg, rgba(200,255,0,0.85) 0%, rgba(94,234,212,0.55) 100%)'
                : 'linear-gradient(135deg, rgba(167,139,250,0.65) 0%, rgba(192,132,252,0.45) 100%)',
            boxShadow:
              annual
                ? '0 0 24px -4px rgba(200,255,0,0.75), inset 0 1px 0 rgba(255,255,255,0.35)'
                : '0 0 22px -4px rgba(167,139,250,0.7), inset 0 1px 0 rgba(255,255,255,0.30)',
            transition: 'all 450ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
        <button
          type="button"
          onClick={() => onChange('monthly')}
          className={
            'relative z-10 inline-flex items-center justify-center rounded-full px-5 py-2 text-[12px] font-bold uppercase tracking-[0.18em] transition-colors duration-300 ' +
            (annual ? 'text-text-muted hover:text-white' : 'text-black')
          }
          style={{ fontFamily: 'var(--font-tech)', minWidth: 110 }}
        >
          Mensal
        </button>
        <button
          type="button"
          onClick={() => onChange('annual')}
          className={
            'relative z-10 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-[12px] font-bold uppercase tracking-[0.18em] transition-colors duration-300 ' +
            (annual ? 'text-black' : 'text-text-muted hover:text-white')
          }
          style={{ fontFamily: 'var(--font-tech)', minWidth: 110 }}
        >
          Anual
        </button>
      </div>

      {/* Badge -20% flutuante (sempre visível) — pulsa quando anual ativo */}
      <span
        aria-hidden
        className={
          'absolute -right-3 -top-3 inline-flex items-center gap-1 rounded-full border border-lime/65 bg-black/85 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-lime backdrop-blur-md ' +
          (annual ? 'billing-badge-pulse' : '')
        }
        style={{
          fontFamily: 'var(--font-tech)',
          boxShadow: '0 0 18px -2px rgba(200,255,0,0.85)',
          transform: 'rotate(8deg)',
        }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.95)]" />
        −{ANNUAL_DISCOUNT_PCT}%
      </span>

      <style jsx>{`
        @keyframes billing-badge-pulse {
          0%, 100% { transform: rotate(8deg) scale(1); }
          50%      { transform: rotate(8deg) scale(1.08); }
        }
        .billing-badge-pulse {
          animation: billing-badge-pulse 1.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────── PlanCard ─────────────────────── */

function PlanCard({
  plan,
  billing,
  delay,
}: {
  plan: Plan;
  billing: Billing;
  delay: number;
}) {
  const unlocked = UNLOCKED[plan.id];
  const pricing = plan.pricing[billing];
  const isFree = plan.id === 'free';
  const hasSale = !!pricing.original && plan.id === 'pro';

  // Separa as ferramentas: featured primeiro (cards 3D), resto como linhas
  const featuredTools = useMemo(
    () => ALL_TOOLS.filter((t) => t.featured),
    [],
  );
  const standardTools = useMemo(
    () => ALL_TOOLS.filter((t) => !t.featured),
    [],
  );

  return (
    <div
      className={
        'plan-card relative fade-in-up ' +
        (plan.highlight ? 'plan-highlight' : '')
      }
      style={{
        animationDelay: `${delay}ms`,
        perspective: '1200px',
      }}
    >
      <div
        className="plan-tilt relative h-full"
        onMouseMove={(e) => {
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width;
          const py = (e.clientY - rect.top) / rect.height;
          const rotY = (px - 0.5) * 6;
          const rotX = -(py - 0.5) * 5;
          el.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateZ(0)`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'rotateX(0) rotateY(0)';
        }}
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Borda gradient pulsante */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[28px]"
          style={{
            padding: '1.5px',
            background: `linear-gradient(180deg, ${plan.borderHue} 0%, rgba(255,255,255,0.05) 50%, ${plan.borderHue} 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        />
        {/* Glow externo */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-[32px] opacity-50 blur-2xl"
          style={{
            background: `radial-gradient(60% 100% at 50% 50%, ${plan.glowHue}, transparent 70%)`,
            animation: plan.highlight
              ? 'plan-glow-pulse 3.5s ease-in-out infinite'
              : 'plan-glow-pulse 5s ease-in-out infinite',
          }}
        />

        {/* Corpo */}
        <div
          className="relative flex h-full flex-col rounded-[28px] px-6 py-8 md:px-7 md:py-10"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0a0a0c)',
          }}
        >
          {/* Badges no topo — pode ter "MAIS POPULAR" + "OFERTA" */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {plan.highlight ? (
              <span
                className="-mt-3 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.22em] backdrop-blur-md"
                style={{
                  fontFamily: 'var(--font-tech)',
                  color: plan.rabbitHue,
                  boxShadow: `0 0 18px -4px ${plan.glowHue}`,
                }}
              >
                ★ MAIS POPULAR
              </span>
            ) : null}
            {hasSale ? <SaleBadge pct={PRO_SALE_PCT} /> : null}
          </div>

          {/* Nome + preço */}
          <div className="mt-3 text-center">
            <div
              className="text-[14px] font-bold uppercase tracking-[0.18em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color: plan.rabbitHue,
              }}
            >
              {plan.name}
            </div>

            {/* Preço — Mensal: R$ X/mês · Anual: R$ X*12/ano + "12x de R$ X"
                Pro com sale: original riscado em cima (também anualizado se anual).
                v3.1: sale e parcelado com muito mais peso visual. */}
            <div className="mt-3 flex flex-col items-center justify-center gap-1.5">
              {hasSale && pricing.original ? (
                <span
                  className="mono flex items-center gap-2 text-[18px] font-bold tracking-tight md:text-[20px]"
                  style={{
                    fontFamily: 'var(--font-tech)',
                    color: '#fca5a5',
                  }}
                >
                  <span
                    className="text-rose-300/70"
                    style={{
                      textDecoration: 'line-through',
                      textDecorationColor: 'rgba(244,63,94,0.95)',
                      textDecorationThickness: '2.5px',
                    }}
                  >
                    De R${' '}
                    {billing === 'annual'
                      ? (pricing.original * 12).toLocaleString('pt-BR')
                      : pricing.original}
                    {billing === 'annual' ? '/ano' : '/mês'}
                  </span>
                </span>
              ) : null}
              <div className="flex items-baseline justify-center gap-1">
                <span
                  className="text-[44px] font-extrabold tracking-tight text-white md:text-[52px]"
                  style={{
                    fontFamily: 'var(--font-tech)',
                    letterSpacing: '-0.03em',
                    background: hasSale
                      ? 'linear-gradient(135deg, #fff 0%, #d8b4fe 60%, #c084fc 100%)'
                      : undefined,
                    WebkitBackgroundClip: hasSale ? 'text' : undefined,
                    WebkitTextFillColor: hasSale ? 'transparent' : undefined,
                  }}
                >
                  {isFree
                    ? 'R$ 0'
                    : billing === 'annual'
                      ? `R$ ${(pricing.price * 12).toLocaleString('pt-BR')}`
                      : `R$ ${pricing.price}`}
                </span>
                {isFree ? (
                  <span className="text-[15px] text-text-muted">/sempre</span>
                ) : billing === 'annual' ? (
                  <span className="text-[15px] text-text-muted">/ano</span>
                ) : (
                  <span className="text-[15px] text-text-muted">/mês</span>
                )}
              </div>

              {/* Badge "VOCÊ ECONOMIZA R$ X" só quando tem sale — dá
                  peso REAL ao desconto, não só "−15%". */}
              {hasSale && pricing.original ? (
                <span
                  className="economy-badge inline-flex items-center gap-1.5 rounded-full border border-rose-400/65 bg-gradient-to-r from-rose-500/20 to-fuchsia-500/20 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-rose-100 backdrop-blur-sm"
                  style={{
                    fontFamily: 'var(--font-tech)',
                    boxShadow: '0 0 16px -3px rgba(244,63,94,0.55)',
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17l10-10M7 7h10v10" />
                  </svg>
                  Você economiza R${' '}
                  {billing === 'annual'
                    ? ((pricing.original - pricing.price) * 12).toLocaleString('pt-BR') + '/ano'
                    : (pricing.original - pricing.price) + '/mês'}
                </span>
              ) : null}

              {/* Subtitle no anual: equivalente mensal (cobrado 1x/ano). */}
              {!isFree && billing === 'annual' ? (
                <div className="mt-2 flex flex-col items-center gap-1.5">
                  <div
                    className="inline-flex items-center gap-2 rounded-[10px] border border-lime/35 bg-lime/[0.06] px-3 py-1.5"
                    style={{
                      boxShadow: '0 0 18px -6px rgba(200,255,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                  >
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.18em] text-lime/75"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      equivale a
                    </span>
                    <span
                      className="mono text-[16px] font-bold text-white"
                      style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
                    >
                      <span className="text-lime">R$ {pricing.price}</span>/mês
                    </span>
                  </div>
                  <span
                    className="mono inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/[0.06] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-lime"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    <span className="inline-block h-1 w-1 animate-pulse-soft rounded-full bg-lime" />
                    economiza −{ANNUAL_DISCOUNT_PCT}% no anual
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Coelho com aura tier */}
          <div className="mt-5 flex justify-center">
            <RabbitAura
              tier={plan.rabbitTier}
              hue={plan.rabbitHue}
              glow={plan.glowHue}
            />
          </div>

          {/* FEATURED — 3 mini-cards 3D destacados no topo da lista */}
          <div className="mt-7 flex flex-col gap-2.5">
            {featuredTools.map((t) => (
              <FeaturedToolMini
                key={t.key}
                tool={t}
                locked={!unlocked.has(t.key)}
                planHue={plan.glowHue}
              />
            ))}
          </div>

          {/* Divisor sutil */}
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line/60" />
            <span
              className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-text-dim"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              também inclui
            </span>
            <span className="h-px flex-1 bg-line/60" />
          </div>

          {/* Resto das ferramentas como linhas simples */}
          <ul className="flex flex-1 flex-col gap-2.5">
            {standardTools.map((tool) => {
              const isUnlocked = unlocked.has(tool.key);
              return (
                <li
                  key={tool.key}
                  className={
                    'flex items-start gap-2.5 text-[13.5px] transition-colors duration-300 ' +
                    (isUnlocked ? 'text-white' : 'text-text-dim')
                  }
                >
                  {isUnlocked ? (
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: plan.bulletHue,
                        boxShadow: `0 0 10px ${plan.glowHue}`,
                      }}
                      aria-hidden
                    >
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2.5 6.5l2.5 2.5 5-5.5"
                          stroke="#0a0a0c"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : (
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line/80 bg-black/30"
                      aria-hidden
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#5a5a64"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 018 0v4" />
                      </svg>
                    </span>
                  )}
                  <span className={isUnlocked ? '' : 'line-through opacity-65'}>
                    {tool.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* CTA — Free → cadastro · Basic/Pro → checkout Stripe */}
          <div className="mt-8">
            <PlanCTA plan={plan} billing={billing} />
          </div>
        </div>
      </div>

      <style jsx>{`
        .plan-card {
          will-change: transform;
        }
        @keyframes plan-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────── PlanCTA (botão de ação do plano) ─────────────────────── */
/**
 * Free → leva pro cadastro. Basic/Pro → dispara o checkout Stripe respeitando
 * o ciclo (mensal/anual) selecionado no toggle. Se não estiver logado, o
 * endpoint responde 401 e mandamos pro cadastro com retorno pra /planos.
 */
function PlanCTA({ plan, billing }: { plan: Plan; billing: Billing }) {
  const [loading, setLoading] = useState(false);

  const sharedClass =
    'plan-cta group/btn relative block w-full overflow-hidden rounded-full border px-5 py-3.5 text-center text-[13.5px] font-bold transition-all duration-300 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-80';
  const sharedStyle = {
    borderColor: plan.borderHue,
    color: '#fff',
    background:
      'linear-gradient(135deg, ' + plan.glowHue + ', transparent 70%), rgba(0,0,0,0.4)',
    boxShadow: `0 12px 28px -10px ${plan.glowHue}`,
  } as const;

  const sheen = (
    <span
      aria-hidden
      className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
    />
  );

  if (plan.id === 'free') {
    return (
      <Link href="/register" className={sharedClass} style={sharedStyle}>
        <span className="relative z-10">{plan.cta}</span>
        {sheen}
      </Link>
    );
  }

  const startCheckout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: plan.id, billing }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        need?: string;
      };
      if (res.status === 401 || data.need === 'login') {
        window.location.href = '/register?next=/planos';
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      alert(data.error || 'Não foi possível iniciar o checkout. Tente de novo.');
    } catch {
      alert('Falha de conexão ao iniciar o checkout.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={startCheckout}
      disabled={loading}
      className={sharedClass}
      style={sharedStyle}
    >
      <span className="relative z-10">
        {loading ? 'Redirecionando…' : plan.cta}
      </span>
      {sheen}
    </button>
  );
}

/* ─────────────────────── SaleBadge (cartaz neon) ─────────────────────── */

function SaleBadge({ pct }: { pct: number }) {
  return (
    <span
      className="sale-badge -mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-400/70 bg-gradient-to-r from-rose-500/35 via-fuchsia-500/30 to-violet/35 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.20em] text-rose-100 backdrop-blur-md"
      style={{
        fontFamily: 'var(--font-tech)',
        boxShadow:
          '0 0 22px -2px rgba(244,63,94,0.65), 0 0 38px -8px rgba(192,132,252,0.55), inset 0 1px 0 rgba(255,255,255,0.18)',
        textShadow: '0 0 8px rgba(244,63,94,0.55)',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"
          fill="#fda4af"
        />
      </svg>
      OFERTA −{pct}%
      <style jsx>{`
        .sale-badge {
          animation: sale-flicker 2.6s ease-in-out infinite;
        }
        @keyframes sale-flicker {
          0%, 100% {
            box-shadow:
              0 0 22px -2px rgba(244, 63, 94, 0.65),
              0 0 38px -8px rgba(192, 132, 252, 0.55),
              inset 0 1px 0 rgba(255, 255, 255, 0.18);
          }
          50% {
            box-shadow:
              0 0 32px 0px rgba(244, 63, 94, 0.85),
              0 0 56px -4px rgba(192, 132, 252, 0.75),
              inset 0 1px 0 rgba(255, 255, 255, 0.28);
          }
        }
      `}</style>
    </span>
  );
}

/* ─────────────────────── FeaturedToolMini (card 3D dentro do plano) ─────────────────────── */
/**
 * Mini-card 3D que destaca uma ferramenta premium dentro do PlanCard.
 *  • Tilt no mouse + spotlight + sheen sweep
 *  • Ícone gradient próprio
 *  • Lock overlay com cadeado quando bloqueado naquele plano
 *  • Clicável: scroll suave + highlight pulse na seção dedicada do catálogo
 */
function FeaturedToolMini({
  tool,
  locked,
  planHue: _planHue,
}: {
  tool: Tool;
  locked: boolean;
  /** Hue do plano — não usado no design final, mantido pra futuro */
  planHue: string;
}) {
  const hue = tool.featuredHue || 'rgba(167,139,250,0.55)';
  const handleMove = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    el.style.setProperty('--rx', `${(-(py - 0.5) * 8).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((px - 0.5) * 10).toFixed(2)}deg`);
  };
  const handleLeave = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  };

  // Clica → scrolla pra seção dedicada e dá highlight pulse nela.
  // Funciona MESMO quando bloqueado — assim o usuário sempre pode
  // entender a ferramenta antes de decidir o plano. Anchor: tool-<key>
  const handleClick = () => {
    const id = `tool-${tool.key}`;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('tool-info-highlight');
    setTimeout(() => target.classList.remove('tool-info-highlight'), 2200);
  };

  return (
    <div className="ftm-perspective" style={{ perspective: '700px' }}>
      <button
        type="button"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        aria-label={`Saiba mais sobre ${tool.label}`}
        className={
          'ftm group relative block w-full overflow-hidden rounded-[14px] border p-3 text-left ' +
          (locked ? 'ftm-locked' : '')
        }
        style={{
          borderColor: locked
            ? 'rgba(90,90,100,0.55)'
            : hue.replace('0.55', '0.45'),
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.25)), linear-gradient(180deg, #16161c, #0c0c10)',
          cursor: 'pointer',
        }}
      >
        {/* Sparkles flutuantes (só quando unlocked) */}
        {!locked ? (
          <>
            <span aria-hidden className="ftm-sparkle" style={{ top: 6, right: 36, animationDelay: '0ms' }} />
            <span aria-hidden className="ftm-sparkle" style={{ top: 14, right: 14, animationDelay: '700ms' }} />
            <span aria-hidden className="ftm-sparkle" style={{ bottom: 10, right: 60, animationDelay: '1400ms' }} />
          </>
        ) : null}

        {/* Spotlight radial */}
        {!locked ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[14px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: `radial-gradient(140px circle at var(--gx, 50%) var(--gy, 50%), ${hue}, transparent 60%)`,
            }}
          />
        ) : null}

        {/* Conic border giratório */}
        {!locked ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[14px] opacity-0 transition-opacity duration-400 group-hover:opacity-100"
            style={{
              padding: '1px',
              background: `conic-gradient(from var(--angle, 0deg), transparent 0%, ${hue} 25%, transparent 50%, ${hue} 75%, transparent 100%)`,
              WebkitMask:
                'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              animation: 'ftm-conic 4s linear infinite',
            }}
          />
        ) : null}

        {/* Sheen sweep */}
        {!locked ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-[120%] rounded-[14px] bg-gradient-to-r from-transparent via-white/22 to-transparent transition-transform duration-700 group-hover:translate-x-[120%]"
          />
        ) : null}

        {/* Lock overlay */}
        {locked ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-end pr-3"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line/70 bg-black/60 backdrop-blur-md">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9c9ca6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 018 0v4" />
              </svg>
            </span>
          </div>
        ) : null}

        <div
          className="relative flex items-center gap-3"
          style={{ opacity: locked ? 0.55 : 1 }}
        >
          <span
            className="ftm-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background: locked
                ? 'linear-gradient(135deg, rgba(70,70,80,0.5), rgba(40,40,50,0.5))'
                : `linear-gradient(135deg, ${hue}, transparent 70%), rgba(0,0,0,0.5)`,
              border: `1px solid ${locked ? 'rgba(90,90,100,0.5)' : hue}`,
              boxShadow: locked ? 'none' : `0 0 18px -4px ${hue}`,
            }}
          >
            <FeaturedIcon kind={tool.featured!} muted={locked} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate text-[13.5px] font-bold tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {tool.label}
              </span>
              {!locked ? (
                <span
                  className="shrink-0 rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0 text-[8px] font-bold uppercase tracking-[0.18em] text-lime"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  PREMIUM
                </span>
              ) : null}
            </div>
            {tool.featuredHint ? (
              <p className="mt-0.5 truncate text-[11.5px] leading-snug text-text-muted">
                {tool.featuredHint}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      <style jsx>{`
        .ftm {
          transform-style: preserve-3d;
          transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
          transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 280ms ease;
        }
        .ftm:hover {
          border-color: ${hue};
        }
        .ftm:active {
          transform: rotateX(0) rotateY(0) scale(0.97);
          transition-duration: 80ms;
        }
        .ftm-icon {
          transition: transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .ftm:hover .ftm-icon {
          transform: ${locked ? 'none' : 'rotate(-6deg) scale(1.08) translateZ(20px)'};
        }
        .ftm-sparkle {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #fff;
          opacity: 0;
          animation: ftm-sparkle 2.4s ease-in-out infinite;
          box-shadow: 0 0 8px rgba(255, 255, 255, 0.9);
        }
        @keyframes ftm-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes ftm-conic {
          to { --angle: 360deg; }
        }
      `}</style>
    </div>
  );
}

/** Ícone do mini-card por categoria featured. Cada um remete à
 * ferramenta — ClickUp = pilot pin, HeyGen = avatar, B-roll = clapper. */
function FeaturedIcon({ kind, muted }: { kind: Featured; muted: boolean }) {
  const stroke = muted ? '#9c9ca6' : '#0a0a0c';
  const fill = muted ? 'transparent' : '#fff';
  if (kind === 'pilot') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 6l5 5-3 1-1 3-5-5 4-4z" fill={fill} />
        <path d="M14 12l-8 8" />
        <rect x="3" y="4" width="9" height="14" rx="2" />
        <path d="M5.5 8h4M5.5 12h4" opacity="0.7" />
      </svg>
    );
  }
  if (kind === 'heygen') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 19v-1a4 4 0 014-4h4a4 4 0 014 4v1" />
        <path d="M16 7c1.5 1 1.5 6 0 7" />
        <path d="M19 5c2.5 1.5 2.5 8.5 0 10" opacity="0.6" />
        <path d="M21 3l0.4 1 1 0.4-1 0.4-0.4 1-0.4-1L20 4.4l1-0.4 0.4-1z" fill={fill} />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M3 11h18" />
      <path d="M6 7l-1.5 3M11 7l-1.5 3M16 7l-1.5 3" opacity="0.7" />
      <path d="M19 3l0.5 1.2 1.3 0.5-1.3 0.5L19 6.4l-0.5-1.2L17.2 4.7l1.3-0.5L19 3z" fill={fill} />
    </svg>
  );
}

/* ─────────────────────── RabbitAura (coelho com aura tier) ─────────────────────── */

/**
 * Mesmo coelho (PNG) com camadas extras crescentes por tier:
 *  ▸ tier 0 (Free)  — coelho com glow base
 *  ▸ tier 1 (Basic) — adiciona ring rotativo rosa + 2 sparkles
 *  ▸ tier 2 (Pro)   — ring duplo (cônico + halo), 5 sparkles, coroa neon, particles flutuantes
 */
function RabbitAura({
  tier,
  hue,
  glow,
}: {
  tier: 0 | 1 | 2;
  hue: string;
  glow: string;
}) {
  return (
    <div
      className="rabbit-aura relative flex items-center justify-center"
      style={{ width: 160, height: 160 }}
    >
      {/* Halo radial (todos os tiers) */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, ${glow}, transparent 70%)`,
          filter: 'blur(12px)',
          opacity: tier === 0 ? 0.6 : tier === 1 ? 0.85 : 1,
          animation: 'rabbit-halo 3.4s ease-in-out infinite',
        }}
      />

      {/* Ring conic (tier 1+) */}
      {tier >= 1 ? (
        <span
          aria-hidden
          className="absolute inset-3 rounded-full"
          style={{
            padding: '2px',
            background: `conic-gradient(from 0deg, ${hue}, transparent 30%, ${hue} 60%, transparent 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'rabbit-ring-spin 6s linear infinite',
            opacity: 0.85,
          }}
        />
      ) : null}

      {/* Ring extra cônico inverso (tier 2) — efeito de "núcleo de energia" */}
      {tier >= 2 ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            padding: '1.5px',
            background: `conic-gradient(from 180deg, transparent 0%, ${hue} 25%, transparent 50%, ${hue} 75%, transparent 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'rabbit-ring-spin-rev 8s linear infinite',
            opacity: 0.6,
          }}
        />
      ) : null}

      {/* Coroa neon (só Pro) */}
      {tier >= 2 ? (
        <span
          aria-hidden
          className="absolute"
          style={{
            top: 2,
            left: '50%',
            transform: 'translateX(-50%)',
            filter: `drop-shadow(0 0 10px ${hue}) drop-shadow(0 0 18px ${glow})`,
            animation: 'rabbit-crown-float 3.2s ease-in-out infinite',
          }}
        >
          <svg width="34" height="22" viewBox="0 0 34 22" fill="none">
            <path
              d="M3 19L5 4l7 7L17 0l5 11 7-7 2 15z"
              fill={hue}
              stroke="#fff"
              strokeOpacity="0.5"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
            <circle cx="17" cy="6" r="1.6" fill="#fff" />
            <circle cx="6" cy="10" r="1.1" fill="#fff" opacity="0.85" />
            <circle cx="28" cy="10" r="1.1" fill="#fff" opacity="0.85" />
          </svg>
        </span>
      ) : null}

      {/* Sparkles flutuantes — qtd cresce por tier */}
      {tier >= 1
        ? sparklePositions(tier as 1 | 2).map((pos, i) => (
            <RabbitSparkle key={i} {...pos} hue={hue} />
          ))
        : null}

      {/* Imagem do coelho */}
      <div
        className="rabbit-img relative z-10"
        style={{
          filter: `drop-shadow(0 0 ${24 + tier * 10}px ${glow}) drop-shadow(0 0 ${10 + tier * 4}px ${hue})`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auto-edit-logo@256.png"
          alt=""
          aria-hidden
          width={tier === 0 ? 100 : tier === 1 ? 110 : 118}
          height={tier === 0 ? 100 : tier === 1 ? 110 : 118}
        />
      </div>

      <style jsx>{`
        .rabbit-img {
          animation: rabbit-float 4.8s ease-in-out infinite;
        }
        @keyframes rabbit-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes rabbit-halo {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.06); opacity: 0.95; }
        }
        @keyframes rabbit-ring-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes rabbit-ring-spin-rev {
          to { transform: rotate(-360deg); }
        }
        @keyframes rabbit-crown-float {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

/** Posições dos sparkles ao redor do coelho — quantidade cresce por tier */
function sparklePositions(tier: 1 | 2) {
  if (tier === 1) {
    return [
      { top: '20%', left: '12%', delay: 0 },
      { top: '75%', right: '14%', delay: 800 },
    ];
  }
  return [
    { top: '10%', left: '18%', delay: 0 },
    { top: '22%', right: '14%', delay: 500 },
    { top: '60%', left: '8%', delay: 1100 },
    { top: '70%', right: '10%', delay: 1700 },
    { top: '88%', left: '50%', delay: 2300 },
  ];
}

function RabbitSparkle({
  top,
  left,
  right,
  delay,
  hue,
}: {
  top?: string;
  left?: string;
  right?: string;
  delay: number;
  hue: string;
}) {
  return (
    <span
      aria-hidden
      className="rabbit-sparkle"
      style={{
        position: 'absolute',
        top,
        left,
        right,
        animationDelay: `${delay}ms`,
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
        <path d="M6 0l1.2 4.8L12 6l-4.8 1.2L6 12l-1.2-4.8L0 6l4.8-1.2L6 0z" fill={hue} />
      </svg>
      <style jsx>{`
        .rabbit-sparkle {
          animation: rabbit-sparkle 2.4s ease-in-out infinite;
          filter: drop-shadow(0 0 6px ${hue});
        }
        @keyframes rabbit-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.2) rotate(120deg); }
        }
      `}</style>
    </span>
  );
}

/* ─────────────────── Catálogo de ferramentas ─────────────────── */

type ToolInfo = {
  key: string;
  name: string;
  desc: string;
  win: string;
  cat: 'Vídeo' | 'Áudio' | 'IA' | 'Web' | 'Automação';
  hue: string;
  /** Featured cards visualmente turbinados */
  featured?: boolean;
  /** Seção "Como funciona" — só aparece em featured. Lista de passos
   * ordenados pra explicar o fluxo da ferramenta de forma direta. */
  howItWorks?: { step: string; detail: string }[];
  /** Bullets de benefícios concretos pra featured */
  highlights?: string[];
};

const TOOL_DETAILS: ToolInfo[] = [
  // ─── FEATURED no topo ───
  {
    key: 'clickup-pilot',
    name: 'ClickUp Pilot',
    cat: 'Automação',
    hue: 'rgba(200,255,0,0.55)',
    desc: 'Conecta no seu ClickUp, lê os briefings e dispara os avatares sozinho.',
    win: 'Saia do escritório. O Pilot continua editando. Você só revisa.',
    featured: true,
    howItWorks: [
      {
        step: 'Conecta no ClickUp',
        detail: 'Você cola o token da API ClickUp uma vez. O Pilot passa a ler todas as suas tasks com briefing.',
      },
      {
        step: 'Lê o briefing',
        detail: 'Cada task com a tag certa vira um job. O Pilot extrai roteiro, avatar, voz, idioma — sem você abrir nada.',
      },
      {
        step: 'Dispara o avatar',
        detail: 'O HeyGen entra automaticamente, gera o lipsync e devolve o link do vídeo direto na task — tudo logado.',
      },
      {
        step: 'Você só revisa',
        detail: 'Quando volta no ClickUp, as tasks já estão prontas pra publicar. Sem editor humano no meio.',
      },
    ],
    highlights: [
      'Pra equipe que entrega 20+ vídeos por dia',
      'Roda 24/7 — disparos noturnos, finais de semana',
      'Cada vídeo nasce com o briefing exato do cliente',
    ],
  },
  {
    key: 'heygen-auto',
    name: 'HeyGen Auto',
    cat: 'IA',
    hue: 'rgba(103,232,249,0.55)',
    desc: 'Dispara todos os lipsyncs do dia no HeyGen com um clique.',
    win: 'Operação em escala. O time só revisa o que já está pronto.',
    featured: true,
    howItWorks: [
      {
        step: 'Cola a lista de roteiros',
        detail: 'Um por linha ou em CSV. Cada linha vira um job de avatar com voz, idioma e cenário definidos no preset.',
      },
      {
        step: 'Escolhe avatar e voz',
        detail: 'Avatares clonados ficam na memória — clique e seleciona em segundos. Vozes premium incluídas.',
      },
      {
        step: 'Dispara em fila',
        detail: 'Roda em paralelo até o limite da sua conta HeyGen. Pode fechar o navegador — segue no background.',
      },
      {
        step: 'Baixa em ZIP',
        detail: 'Quando termina, você recebe tudo num único pacote pronto pra revisar e publicar.',
      },
    ],
    highlights: [
      '50 vídeos saem em 1h de trabalho zero seu',
      'Pode dormir e acordar com tudo entregue',
      'Histórico completo — qualquer vídeo refeito em 1 clique',
    ],
  },
  {
    key: 'auto-broll',
    name: 'Auto B-roll',
    cat: 'IA',
    hue: 'rgba(240,171,252,0.55)',
    desc: 'Recebe um JSON e gera todos os B-rolls da campanha, em segundo plano.',
    win: 'Liga a fila, vai dormir. Acorda com a pasta cheia de cortes prontos.',
    featured: true,
    howItWorks: [
      {
        step: 'Cola o JSON com os prompts',
        detail: 'Lista de cenas — descrição visual de cada B-roll. Cada linha vira um clipe gerado em paralelo.',
      },
      {
        step: 'Conecta a extensão Magnific',
        detail: 'Usa SUA conta Premium+ — gera sem gastar crédito de API. A extensão controla o Magnific direto do navegador.',
      },
      {
        step: 'Roda enquanto você faz outra coisa',
        detail: 'Cada job dispara num Space próprio. Pode mandar 30 cenas e o backend distribui pra rodarem em série.',
      },
      {
        step: 'Recebe a pasta pronta',
        detail: 'Tudo zipado, nomeado pela cena, no formato e duração que você definiu no preset global.',
      },
    ],
    highlights: [
      'Funciona com Premium+ — zero custo extra de geração',
      'Suporta lotes de 50+ cenas sem travamento',
      'Cada cena vira um arquivo nomeado e pronto pra timeline',
    ],
  },
  // ─── Demais ───
  {
    key: 'downloader',
    name: 'Downloader',
    cat: 'Web',
    hue: 'rgba(96,165,250,0.5)',
    desc: 'Baixa vídeos e áudios do YouTube, Instagram, TikTok e Pinterest direto no seu computador.',
    win: 'Cola o link, recebe o arquivo. Sem código, sem servidor.',
  },
  {
    key: 'decupagem-audio',
    name: 'Decupagem de áudio',
    cat: 'Áudio',
    hue: 'rgba(34,211,238,0.5)',
    desc: 'Remove silêncios do áudio mantendo o ritmo natural da fala.',
    win: 'O que demorava 1h vira 30 segundos. Direto.',
  },
  {
    key: 'decupagem-video',
    name: 'Decupagem de vídeo',
    cat: 'Vídeo',
    hue: 'rgba(163,230,53,0.5)',
    desc: 'Mesma decupagem, agora cortando o vídeo junto com o áudio.',
    win: 'Vídeo já sai pronto pra entrar na linha do tempo.',
  },
  {
    key: 'removedor-legenda',
    name: 'Removedor de Legenda/Marca d’Água',
    cat: 'IA',
    hue: 'rgba(244,114,182,0.55)',
    desc: 'Apaga legenda gravada e marca d’água de vídeos.',
    win: 'A IA reconstrói o fundo. Resultado limpo, profissional.',
  },
  {
    key: 'gerador-srt',
    name: 'Gerador de SRT',
    cat: 'IA',
    hue: 'rgba(196,181,253,0.55)',
    desc: 'Gera arquivo .srt no tempo exato do seu áudio a partir da sua copy.',
    win: 'Texto exato que você quer, tempos exatos do áudio. Importa no editor e fecha o trampo.',
  },
  {
    key: 'mixer-velocidade',
    name: 'Mixer de Velocidade',
    cat: 'Vídeo',
    hue: 'rgba(251,191,36,0.5)',
    desc: 'Acelera ou desacelera vídeo e áudio sem ficar com voz robotizada.',
    win: 'Mantém o tom natural mesmo em 1.5×. O ouvido nem percebe.',
  },
  {
    key: 'normalizador',
    name: 'Normalizador de Volume',
    cat: 'Áudio',
    hue: 'rgba(94,234,212,0.5)',
    desc: 'Iguala o volume de vários arquivos em um nível confortável.',
    win: 'Cliente nunca mais reclama de "tá baixo". Tudo sai padronizado.',
  },
  {
    key: 'separar-audios',
    name: 'Dividir áudios',
    cat: 'Áudio',
    hue: 'rgba(34,211,238,0.5)',
    desc: 'Divide um áudio longo em pedaços, sempre respeitando as pausas.',
    win: 'Cada fala vira um arquivo. Sem cortar palavra no meio.',
  },
  {
    key: 'compressor',
    name: 'Compressor',
    cat: 'Vídeo',
    hue: 'rgba(129,140,248,0.5)',
    desc: 'Reduz o peso dos vídeos sem perder qualidade visível.',
    win: 'Vídeo pesado vira leve em um clique. Sobem rápido em qualquer lugar.',
  },
  {
    key: 'camuflagem',
    name: 'Camuflagem',
    cat: 'Áudio',
    hue: 'rgba(45,212,191,0.5)',
    desc: 'Disfarça o áudio pra dificultar detecção automática de plataformas.',
    win: 'Mais segurança pro seu conteúdo. Sem perder qualidade audível.',
  },
  {
    key: 'troca-produto',
    name: 'Troca de produto',
    cat: 'IA',
    hue: 'rgba(244,114,182,0.55)',
    desc: 'Substitui o nome do produto no áudio sem regravar a voz original.',
    win: 'Trocou de cliente ou marca? Troca no áudio em segundos.',
  },
  {
    key: 'decupagem-inteligente',
    name: 'Decupagem Inteligente',
    cat: 'IA',
    hue: 'rgba(232,121,249,0.55)',
    desc: 'A IA decupa o vídeo seguindo a copy do roteiro com precisão.',
    win: 'Diz o que tem que ser dito, a IA escolhe a melhor take e monta.',
  },
  {
    key: 'separador-audio',
    name: 'Separador de Áudio',
    cat: 'IA',
    hue: 'rgba(167,139,250,0.55)',
    desc: 'Separa voz, instrumental e SFX em 3 trilhas com modelo Demucs v4.',
    win: 'Refaz mixagem, reusa só a voz, isola o beat. Qualidade absurda.',
  },
];

function ToolsCatalog() {
  return (
    <section
      id="ferramentas"
      className="relative z-10 mx-auto mt-8 max-w-[1280px] px-5 pb-20 md:px-8"
    >
      {/* Header da seção */}
      <div className="mb-12 max-w-[760px]">
        <div
          className="mb-3 inline-flex items-baseline gap-3 text-white/35"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span className="text-[10.5px] tracking-[0.32em]">003</span>
          <span className="h-px w-10 bg-white/25" />
          <span
            className="text-[10.5px] uppercase tracking-[0.28em] text-violet"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            CATÁLOGO COMPLETO
          </span>
        </div>
        <h2
          className="section-title text-[36px] md:text-[48px]"
          style={{ lineHeight: 1.05 }}
        >
          <SmokeText text="Conheça cada ferramenta." className="block" />
          <span className="display-subtle block">
            <SmokeText text="O que faz, e o que você ganha." />
          </span>
        </h2>
      </div>

      {/* Grid de ferramentas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TOOL_DETAILS.map((t, i) => (
          <ToolInfoCard key={t.key} tool={t} delay={i * 45} />
        ))}
      </div>
    </section>
  );
}

function ToolInfoCard({ tool, delay }: { tool: ToolInfo; delay: number }) {
  const accent = tool.hue.replace('0.55', '1').replace('0.5', '1');
  // Featured ocupa span maior no grid quando tem howItWorks expandido.
  const expanded = tool.featured && (tool.howItWorks?.length ?? 0) > 0;
  return (
    <div
      id={`tool-${tool.key}`}
      className={
        'tool-info-card group fade-in-up relative overflow-hidden rounded-[18px] border p-5 transition-all duration-300 hover:-translate-y-[2px] ' +
        (expanded ? 'md:col-span-2 lg:col-span-3 ' : '') +
        (tool.featured
          ? 'tool-info-featured border-violet/45 hover:border-violet/65'
          : 'border-line/60 hover:border-violet/40')
      }
      style={{
        animationDelay: `${delay}ms`,
        background: tool.featured
          ? `linear-gradient(180deg, rgba(255,255,255,0.045), rgba(0,0,0,0.25)), linear-gradient(180deg, #181820, #0c0c10)`
          : 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0c0c10)',
        boxShadow: tool.featured
          ? `0 0 32px -16px ${tool.hue}, inset 0 1px 0 rgba(255,255,255,0.05)`
          : undefined,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: tool.hue }}
      />
      {tool.featured ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[18px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            padding: '1px',
            background: `conic-gradient(from var(--angle, 0deg), transparent 0%, ${tool.hue} 22%, transparent 50%, ${tool.hue} 78%, transparent 100%)`,
            WebkitMask:
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'tool-info-conic 6s linear infinite',
          }}
        />
      ) : null}
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-[16px] font-bold tracking-tight text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {tool.name}
          </h3>
          <div className="flex items-center gap-1.5">
            {tool.featured ? (
              <span
                className="shrink-0 rounded-full border border-lime/45 bg-lime/10 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.16em] text-lime"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                PREMIUM
              </span>
            ) : null}
            <span
              className="shrink-0 rounded-full border px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.16em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color: accent,
                borderColor: tool.hue,
                background: 'rgba(0,0,0,0.4)',
              }}
            >
              {tool.cat}
            </span>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
          {tool.desc}
        </p>
        <div
          className="mt-3 flex items-start gap-2 border-t border-line/60 pt-3 text-[12.5px] leading-snug text-white/85"
        >
          <span
            className="mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full"
            style={{
              background: tool.hue,
              boxShadow: `0 0 8px ${tool.hue}`,
            }}
            aria-hidden
          />
          <span>{tool.win}</span>
        </div>

        {/* Seção "Como funciona" + Highlights — só featured */}
        {expanded ? (
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div
                className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ fontFamily: 'var(--font-tech)', color: accent }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
                />
                Como funciona
              </div>
              <ol className="flex flex-col gap-2.5">
                {tool.howItWorks!.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-[12px] border border-line/50 bg-bg-soft/40 px-3.5 py-3"
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums"
                      style={{
                        fontFamily: 'var(--font-tech)',
                        color: '#fff',
                        borderColor: tool.hue,
                        background: `linear-gradient(135deg, ${tool.hue}, transparent 70%), rgba(0,0,0,0.5)`,
                        boxShadow: `0 0 14px -4px ${tool.hue}`,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div
                        className="text-[13.5px] font-bold tracking-tight text-white"
                        style={{ fontFamily: 'var(--font-tech)' }}
                      >
                        {s.step}
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
                        {s.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {tool.highlights?.length ? (
              <div>
                <div
                  className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-lime"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                  Por que vale
                </div>
                <ul className="flex flex-col gap-2">
                  {tool.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 rounded-[10px] border border-lime/25 bg-lime/[0.04] px-3 py-2.5 text-[13px] leading-snug text-white/95"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        className="mt-1 shrink-0"
                      >
                        <path
                          d="M2.5 6.5l2.5 2.5 5-5.5"
                          stroke="#c8ff00"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <style jsx>{`
        @keyframes tool-info-conic {
          to { --angle: 360deg; }
        }
      `}</style>
    </div>
  );
}

