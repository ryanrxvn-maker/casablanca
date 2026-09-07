'use client';
import Link from 'next/link';
import { SmokeText } from './SmokeText';
import { RabbitAura } from './redesign/RabbitAura';
import { useState } from 'react';
import { SiteHeader } from './redesign/SiteHeader';
import { SiteFooter } from './redesign/SiteFooter';
type Tool = {
  key: string;
  label: string;
};

/** Lista única de TODAS as ferramentas visíveis ao cliente.
 * ⚠ SÓ ferramentas REAIS e acessíveis ao cliente. Espelha o acesso de
 * lib/use-tier.ts. NÃO listar admin-only (Separador de Áudio, Removedor de
 * Legenda, automações internas) nem tools inexistentes — isso vira
 * propaganda enganosa. */
const ALL_TOOLS: Tool[] = [
  { key: 'lipsync', label: 'Lipsync Video to Video' },
  { key: 'gerador-srt', label: 'Gerador de SRT' },
  { key: 'decupagem', label: 'Decupagem' },
  { key: 'camuflagem', label: 'Camuflagem' },
  { key: 'mixer-velocidade', label: 'Mixer de Velocidade' },
  { key: 'separar-audios', label: 'Dividir áudios' },
  { key: 'normalizador', label: 'Normalizador' },
  { key: 'tipografia', label: 'Legendas Automáticas' },
  { key: 'compressor', label: 'Compressor' },
  { key: 'downloader', label: 'Downloader' },
  { key: 'fakepass', label: 'FakePrint' },
];

/** Quais ferramentas cada plano libera (por `key` da ALL_TOOLS).
 *  Espelha EXATAMENTE o acesso real de lib/use-tier.ts (TIER_PATHS). */
const UNLOCKED: Record<'free' | 'basic', Set<string>> = {
  free: new Set(['decupagem', 'downloader', 'fakepass', 'compressor', 'normalizador', 'tipografia']),
  // basic = plano PREMIUM (nome de exibição) — libera a suíte inteira.
  basic: new Set(ALL_TOOLS.map((t) => t.key)),
};

type Billing = 'monthly' | 'annual';

type Plan = {
  id: 'free' | 'basic';
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
 *  • Premium: 57 mensal → 45 anual (-20%)
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
    name: 'Plano Premium',
    cta: 'Quero o Premium',
    borderHue: 'rgba(244,114,182,0.7)',
    rabbitHue: '#f472b6',
    glowHue: 'rgba(244,114,182,0.55)',
    bulletHue: '#f472b6',
    highlight: true,
    rabbitTier: 2,
    pricing: {
      monthly: { price: 57 },
      annual: { price: 45 },
    },
  },
];


export function Plans() {
 const [billing,setBilling]=useState<Billing>('monthly');
 return <main className="ae-plans"><SiteHeader /><section className="ae-container ae-plans-intro"><p className="ae-eyebrow">PLANOS AUTO EDIT</p><h1><SmokeText text="Mais tempo para editar." /><br /><span className="ae-headline-accent"><SmokeText text="Um plano para o seu ritmo." /></span></h1><p>Comece com as ferramentas gratuitas. Amplie seu fluxo com o Premium.</p><div className="ae-billing" role="group" aria-label="Período de cobrança"><button type="button" aria-pressed={billing==='monthly'} onClick={()=>setBilling('monthly')}>Mensal</button><button type="button" aria-pressed={billing==='annual'} onClick={()=>setBilling('annual')}>Anual <span>Economize R$ 144</span></button></div></section><section className="ae-container ae-plan-grid" aria-label="Comparação dos planos">{PLANS.map(plan=><article key={plan.id} id={'plan-'+plan.id} className={'ae-plan '+(plan.id==='basic'?'ae-plan-premium':'')}><div className="ae-plan-mascot"><RabbitAura tier={plan.rabbitTier} hue={plan.rabbitHue} glow={plan.glowHue} /></div><div className="ae-plan-heading"><h2>{plan.name}</h2><span>{plan.id==='free'?'Para começar':'Suíte completa'}</span></div><p className="ae-plan-description">{plan.id==='free'?'As ferramentas essenciais para sua próxima edição.':'Mais possibilidades para quem produz todos os dias.'}</p><div className="ae-plan-price" aria-live="polite"><strong>R$ {plan.id==='free'?0:billing==='annual'?540:57}</strong><span>{plan.id==='free'?'sem cartão':billing==='annual'?'/ano':'/mês'}</span></div><p className="ae-plan-billing-note">{plan.id==='free'?'Crie sua conta e comece a usar.':billing==='annual'?'12 meses de acesso por R$ 540, em até 12× no cartão. Equivale a R$ 45/mês. Sem renovação automática.':'Assinatura mensal com renovação automática. Cancele quando quiser.'}</p><PlanCTA plan={plan} billing={billing}/><div className="ae-plan-features"><h3>{plan.id==='free'?'Incluído no Free':'Tudo do Free, mais'}</h3><ul>{ALL_TOOLS.filter(tool=>plan.id==='free'?UNLOCKED.free.has(tool.key):!UNLOCKED.free.has(tool.key)).map(tool=><li key={tool.key}><span aria-hidden>✓</span>{tool.label}</li>)}</ul></div><p className="ae-plan-history">Histórico de entregas incluído</p></article>)}</section><div className="ae-container ae-plans-note"><p>O processamento de vídeo e áudio acontece no navegador. Quando uma ferramenta utiliza um serviço externo, isso é informado na própria tela.</p><Link href="/politica">Consultar regras de assinatura, cancelamento e reembolso ↗</Link></div><SiteFooter /></main>;
}
function PlanCTA({ plan, billing }: { plan: Plan; billing: Billing }) {
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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
    setCheckoutError(null);
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
      setCheckoutError(data.error || 'Não foi possível iniciar o checkout. Tente de novo.');
    } catch {
      setCheckoutError('Falha de conexão ao iniciar o checkout. Confira a internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
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
      {checkoutError ? (
        <div
          role="alert"
          className="mt-2 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-[12px] text-red-300"
        >
          {checkoutError}
        </div>
      ) : null}
    </>
  );
}

