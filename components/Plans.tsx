'use client';

import Link from 'next/link';
import { Brand } from './Brand';
import { SmokeText } from './SmokeText';

/**
 * Plans v2 — vitrine pública /planos.
 *
 * Mudanças vs v1:
 *  • Lista ÚNICA de ferramentas em todos os 3 cards — só muda quais
 *    estão bloqueadas (cadeado + line-through) por plano
 *  • Preços: Free R$0, Basic R$57, Pro R$137
 *  • TODOS os CTAs apontam pro WhatsApp do time
 *  • Selo "MAIS POPULAR" agora fica DENTRO do card no topo, sem ser
 *    cortado pelo overflow
 *  • Animações 3D mais ricas: tilt no mouse, glow respirando, sparkles
 *  • Seção "Conheça cada ferramenta" abaixo dos cards com descrição
 *    de cada e a vantagem chave
 */

const WHATSAPP = 'https://wa.me/5531991262437';

/** Lista única de TODAS as ferramentas (mesma ordem nos 3 cards). */
const ALL_TOOLS: Array<{ key: string; label: string }> = [
  { key: 'downloader', label: 'Downloader' },
  { key: 'decupagem-audio', label: 'Decupagem de áudio' },
  { key: 'decupagem-video', label: 'Decupagem de vídeo' },
  { key: 'remover-legenda', label: 'Remover legenda' },
  { key: 'srt-generator', label: 'SRT Generator' },
  { key: 'mixer-velocidade', label: 'Mixer de Velocidade' },
  { key: 'normalizador', label: 'Normalizador de Volume' },
  { key: 'separar-audios', label: 'Separar áudios' },
  { key: 'separar-takes', label: 'Separar takes' },
  { key: 'compressor', label: 'Compressor' },
  { key: 'camuflagem', label: 'Camuflagem' },
  { key: 'auto-broll', label: 'Auto B-roll' },
  { key: 'troca-produto', label: 'Troca de produto' },
  { key: 'heygen-auto', label: 'HeyGen Auto' },
  { key: 'smart-decup', label: 'Smart Decup' },
  { key: 'smart-remover', label: 'Smart Remover' },
  { key: 'clickup-pilot', label: 'ClickUp Pilot' },
];

/**
 * Quais ferramentas cada plano libera (por `key` da ALL_TOOLS).
 * As que não estiverem aqui aparecem bloqueadas no card daquele plano.
 */
const UNLOCKED: Record<'free' | 'basic' | 'pro', Set<string>> = {
  free: new Set(['downloader', 'decupagem-audio']),
  basic: new Set([
    'downloader',
    'decupagem-audio',
    'decupagem-video',
    'remover-legenda',
    'srt-generator',
    'mixer-velocidade',
    'normalizador',
    'separar-audios',
    'separar-takes',
    'compressor',
    'camuflagem',
  ]),
  pro: new Set(ALL_TOOLS.map((t) => t.key)),
};

type Plan = {
  id: 'free' | 'basic' | 'pro';
  name: string;
  price: string;
  period?: string;
  cta: string;
  borderHue: string;
  rabbitHue: string;
  glowHue: string;
  bulletHue: string;
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Plano Free',
    price: 'R$ 0',
    period: '/sempre',
    cta: 'Começar grátis',
    borderHue: 'rgba(167,139,250,0.55)',
    rabbitHue: '#c084fc',
    glowHue: 'rgba(167,139,250,0.45)',
    bulletHue: '#a78bfa',
  },
  {
    id: 'basic',
    name: 'Plano Basic',
    price: 'R$ 57',
    period: '/mês',
    cta: 'Quero o Basic',
    borderHue: 'rgba(244,114,182,0.7)',
    rabbitHue: '#f472b6',
    glowHue: 'rgba(244,114,182,0.55)',
    bulletHue: '#f472b6',
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Plano Pro',
    price: 'R$ 137',
    period: '/mês',
    cta: 'Quero o Pro',
    borderHue: 'rgba(192,132,252,0.75)',
    rabbitHue: '#d8b4fe',
    glowHue: 'rgba(192,132,252,0.6)',
    bulletHue: '#c084fc',
  },
];

export function Plans() {
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
      </section>

      {/* Cards */}
      <section className="relative z-10 mx-auto mt-20 max-w-[1280px] px-5 pb-16 md:px-8 md:pb-24">
        <div className="grid grid-cols-1 gap-7 md:grid-cols-3 md:gap-6 md:pt-6">
          {PLANS.map((plan, i) => (
            <PlanCard key={plan.id} plan={plan} delay={i * 110} />
          ))}
        </div>

        <p className="mt-12 text-center text-[13px] text-text-muted">
          Todos os planos rodam no seu computador. Seus arquivos nunca saem
          da sua máquina.
        </p>
      </section>

      {/* Lista de ferramentas */}
      <ToolsCatalog />

      {/* Footer */}
      <footer className="relative z-10 mx-auto max-w-[1280px] px-5 pb-12 md:px-8">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-line/60 pt-8 md:flex-row md:items-center">
          <Brand href="/" />
          <p className="text-[12.5px] text-text-muted">
            Auto Edit · © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function PlanCard({ plan, delay }: { plan: Plan; delay: number }) {
  const unlocked = UNLOCKED[plan.id];
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
          {/* Selo MAIS POPULAR — interno (não corta) */}
          {plan.highlight ? (
            <div className="-mt-3 mb-3 flex justify-center">
              <span
                className="rounded-full border border-white/20 bg-black/70 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.22em] backdrop-blur-md"
                style={{
                  fontFamily: 'var(--font-tech)',
                  color: plan.rabbitHue,
                  boxShadow: `0 0 18px -4px ${plan.glowHue}`,
                }}
              >
                ★ MAIS POPULAR
              </span>
            </div>
          ) : null}

          {/* Nome + preço */}
          <div className="text-center">
            <div
              className="text-[14px] font-bold uppercase tracking-[0.18em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color: plan.rabbitHue,
              }}
            >
              {plan.name}
            </div>
            <div className="mt-3 flex items-baseline justify-center gap-1">
              <span
                className="text-[44px] font-extrabold tracking-tight text-white md:text-[52px]"
                style={{
                  fontFamily: 'var(--font-tech)',
                  letterSpacing: '-0.03em',
                }}
              >
                {plan.price}
              </span>
              {plan.period ? (
                <span className="text-[15px] text-text-muted">
                  {plan.period}
                </span>
              ) : null}
            </div>
          </div>

          {/* Coelho */}
          <div className="mt-5 flex justify-center">
            <div
              className="rabbit-img relative"
              style={{
                filter: `drop-shadow(0 0 32px ${plan.glowHue}) drop-shadow(0 0 14px ${plan.rabbitHue})`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/auto-edit-logo@256.png"
                alt=""
                aria-hidden
                width={110}
                height={110}
              />
            </div>
          </div>

          {/* Features — lista única */}
          <ul className="mt-7 flex flex-1 flex-col gap-2.5">
            {ALL_TOOLS.map((tool) => {
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
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
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

          {/* CTA → WhatsApp pra todos */}
          <div className="mt-8">
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="plan-cta group/btn relative block w-full overflow-hidden rounded-full border px-5 py-3.5 text-center text-[13.5px] font-bold transition-all duration-300 hover:-translate-y-[1px]"
              style={{
                borderColor: plan.borderHue,
                color: '#fff',
                background:
                  'linear-gradient(135deg, ' +
                  plan.glowHue +
                  ', transparent 70%), rgba(0,0,0,0.4)',
                boxShadow: `0 12px 28px -10px ${plan.glowHue}`,
              }}
            >
              <span className="relative z-10">{plan.cta}</span>
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
              />
            </a>
          </div>
        </div>
      </div>

      <style jsx>{`
        .plan-card {
          will-change: transform;
        }
        .rabbit-img {
          animation: rabbit-float 4.8s ease-in-out infinite;
        }
        @keyframes rabbit-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes plan-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
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
};

const TOOL_DETAILS: ToolInfo[] = [
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
    key: 'remover-legenda',
    name: 'Remover legenda',
    cat: 'IA',
    hue: 'rgba(244,114,182,0.55)',
    desc: 'Apaga legenda gravada e marca d’água de vídeos, sem deixar borrão.',
    win: 'A IA reconstrói o fundo. Resultado limpo, profissional.',
  },
  {
    key: 'srt-generator',
    name: 'SRT Generator',
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
    name: 'Separar áudios',
    cat: 'Áudio',
    hue: 'rgba(34,211,238,0.5)',
    desc: 'Divide um áudio longo em pedaços, sempre respeitando as pausas.',
    win: 'Cada fala vira um arquivo. Sem cortar palavra no meio.',
  },
  {
    key: 'separar-takes',
    name: 'Separar takes',
    cat: 'Vídeo',
    hue: 'rgba(134,239,172,0.5)',
    desc: 'Quebra um vídeo bruto em todas as takes individualmente.',
    win: 'Ideal pra documentário, VSL e brutos longos. Cada take, um arquivo.',
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
    key: 'auto-broll',
    name: 'Auto B-roll',
    cat: 'IA',
    hue: 'rgba(240,171,252,0.55)',
    desc: 'Recebe um JSON e gera todos os B-rolls da campanha, em segundo plano.',
    win: 'Liga a fila, vai dormir. Acorda com a pasta cheia de cortes prontos.',
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
    key: 'heygen-auto',
    name: 'HeyGen Auto',
    cat: 'IA',
    hue: 'rgba(103,232,249,0.55)',
    desc: 'Dispara todos os lipsyncs do dia no HeyGen com um clique.',
    win: 'Operação em escala. O time só revisa o que já está pronto.',
  },
  {
    key: 'smart-decup',
    name: 'Smart Decup',
    cat: 'IA',
    hue: 'rgba(232,121,249,0.55)',
    desc: 'A IA decupa o vídeo seguindo a copy do roteiro com precisão.',
    win: 'Diz o que tem que ser dito, a IA escolhe a melhor take e monta.',
  },
  {
    key: 'smart-remover',
    name: 'Smart Remover',
    cat: 'IA',
    hue: 'rgba(244,114,182,0.55)',
    desc: 'Versão mais agressiva da Remover legenda — limpa em lote sem revisão.',
    win: 'Batch de centenas de vídeos. A IA limpa todos, você só recebe pronto.',
  },
  {
    key: 'clickup-pilot',
    name: 'ClickUp Pilot',
    cat: 'Automação',
    hue: 'rgba(200,255,0,0.55)',
    desc: 'Conecta no seu ClickUp, lê os briefings e dispara os avatares sozinho.',
    win: 'Saia do escritório. O Pilot continua editando. Você só revisa.',
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
  return (
    <div
      className="tool-info-card group fade-in-up relative overflow-hidden rounded-[18px] border border-line/60 p-5 transition-all duration-300 hover:-translate-y-[2px] hover:border-violet/40"
      style={{
        animationDelay: `${delay}ms`,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.20)), linear-gradient(180deg, #15151a, #0c0c10)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: tool.hue }}
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-[16px] font-bold tracking-tight text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {tool.name}
          </h3>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.16em]"
            style={{
              fontFamily: 'var(--font-tech)',
              color: tool.hue.replace('0.55', '1').replace('0.5', '1'),
              borderColor: tool.hue,
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            {tool.cat}
          </span>
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
      </div>
    </div>
  );
}
