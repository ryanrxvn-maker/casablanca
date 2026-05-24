'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useTier, tierAllowsTool, tierCanAutomate } from '@/lib/use-tier';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCamuflagem,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconNormalizador,
  IconRemoverElementos,
  IconTakeSplitter,
  IconTrocaProduto,
} from './ToolIcons';

/**
 * ToolsHub v3 — hub estilo HeyGen.
 *
 *  ▸ Banner promocional no topo com call-to-action
 *  ▸ Grid de cards principais com ícone colorido grande + título + descrição
 *  ▸ Categorias destacadas (Trabalho rápido / Inteligência artificial)
 *  ▸ Copy curta, profissional, em PT-BR perfeito
 *  ▸ Animações de entrada com stagger
 */

type ToolEntry = {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Cor do glow do ícone (deve casar com o gradient do icon) */
  hue: string;
  badge?: 'IA' | 'ADMIN';
  adminOnly?: boolean;
};

const FEATURED: ToolEntry[] = [
  {
    href: '/tools/auto-broll',
    label: 'B-roll automático no JSON',
    description: 'Cola o arquivo JSON, liga a automação e faz outra coisa. Os cortes saem prontos enquanto você dorme.',
    icon: <IconAutoBroll size={28} />,
    hue: 'rgba(240, 171, 252, 0.45)',
    badge: 'IA',
  },
  {
    href: '/tools/troca-produto',
    label: 'Troca o produto do áudio',
    description: 'Substitui o produto sem regravar. A voz original continua exatamente igual.',
    icon: <IconTrocaProduto size={28} />,
    hue: 'rgba(244, 114, 182, 0.45)',
    badge: 'IA',
  },
  {
    href: '/tools/heygen-auto',
    label: 'HeyGen Auto',
    description: 'Dispara todos os lipsyncs do dia com 1 clique. Vá dormir e acorde com tudo pronto.',
    icon: <IconHeyGenAuto size={28} />,
    hue: 'rgba(103, 232, 249, 0.45)',
    badge: 'IA',
  },
];

const BASE: ToolEntry[] = [
  {
    href: '/tools/decupagem',
    label: 'Decupagem',
    description: 'Corta os silêncios do vídeo ou áudio.',
    icon: <IconDecupagem size={26} />,
    hue: 'rgba(163, 230, 53, 0.4)',
  },
  {
    href: '/tools/camuflagem',
    label: 'Camuflagem',
    description: 'Disfarça o áudio pra escapar dos detectores.',
    icon: <IconCamuflagem size={26} />,
    hue: 'rgba(45, 212, 191, 0.4)',
  },
  {
    href: '/tools/downloader',
    label: 'Downloader',
    description: 'Baixa qualquer vídeo direto da internet.',
    icon: <IconDownloader size={26} />,
    hue: 'rgba(96, 165, 250, 0.4)',
  },
  {
    href: '/tools/compressor',
    label: 'Compressor',
    description: 'Reduz o peso do arquivo sem perder qualidade.',
    icon: <IconCompressor size={26} />,
    hue: 'rgba(129, 140, 248, 0.4)',
  },
  {
    href: '/tools/audio-split',
    label: 'Separar áudios',
    description: 'Divide o áudio em pedaços pelas pausas. Sem cortar falas.',
    icon: <IconAudioSplit size={26} />,
    hue: 'rgba(34, 211, 238, 0.4)',
  },
  {
    href: '/tools/acelerador',
    label: 'Mixer de Velocidade',
    description: 'Acelera ou desacelera sem ficar robótico.',
    icon: <IconAcelerador size={26} />,
    hue: 'rgba(251, 191, 36, 0.4)',
  },
  {
    href: '/tools/normalizador',
    label: 'Normalizador',
    description: 'Iguala o volume de vários arquivos.',
    icon: <IconNormalizador size={26} />,
    hue: 'rgba(94, 234, 212, 0.4)',
  },
  {
    href: '/tools/take-splitter',
    label: 'Separar takes',
    description: 'Quebra o vídeo em cada take automaticamente.',
    icon: <IconTakeSplitter size={26} />,
    hue: 'rgba(134, 239, 172, 0.4)',
  },
];

const AI: ToolEntry[] = [
  {
    href: '/tools/auto-broll',
    label: 'Auto B-roll',
    description: 'Insere cortes no ritmo da fala.',
    icon: <IconAutoBroll size={26} />,
    hue: 'rgba(240, 171, 252, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/troca-produto',
    label: 'Troca de produto',
    description: 'Substitui o produto do áudio.',
    icon: <IconTrocaProduto size={26} />,
    hue: 'rgba(244, 114, 182, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/remover-elementos',
    label: 'Remover Legenda/Marca d’Água',
    description: 'Remove legenda e marca d’água sem deixar borrão.',
    icon: <IconRemoverElementos size={26} />,
    hue: 'rgba(244, 114, 182, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/decupagem-copy',
    label: 'Decupagem Inteligente',
    description: 'Decupa o vídeo seguindo a sua copy.',
    icon: <IconDecupageCopy size={26} />,
    hue: 'rgba(232, 121, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/copy-srt',
    label: 'Gerador de SRT',
    description: 'Gera legendas prontas no tempo do seu áudio pra importar no editor.',
    icon: <IconCopySRT size={26} />,
    hue: 'rgba(196, 181, 253, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/heygen-auto',
    label: 'HeyGen Auto',
    description: 'Gera o vídeo do seu avatar falando o roteiro.',
    icon: <IconHeyGenAuto size={26} />,
    hue: 'rgba(103, 232, 249, 0.42)',
    badge: 'IA',
  },
];

export function ToolsHub() {
  const tier = useTier();
  const params = useSearchParams();
  const lockedFlash = params.get('locked') === '1';
  const lockedFrom = params.get('from') || '';
  const lockedNeed = (params.get('need') as 'basic' | 'pro' | 'admin' | null) || null;
  const [isAdmin, setIsAdmin] = useState(false);
  const [firstName, setFirstName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin, name')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) {
          setIsAdmin(!!data?.is_admin);
          if (data?.name) {
            setFirstName(String(data.name).split(' ')[0]);
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const base = BASE.filter((it) => !it.adminOnly || isAdmin);
  const ai = AI.filter((it) => !it.adminOnly || isAdmin);
  const featured = FEATURED.filter((it) => !it.adminOnly || isAdmin);

  const greeting = greetingFor(new Date(), firstName);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 md:px-8">
      {/* Flash de "ferramenta bloqueada" — mostra pra qualquer tier
          que tentou acessar algo que não pode. Inclui qual ferramenta
          foi bloqueada + qual plano libera. */}
      {lockedFlash ? (
        <LockedFlash from={lockedFrom} need={lockedNeed} tier={tier} />
      ) : null}

      {/* Saudação + descrição */}
      <section className="mb-8 animate-fade-in-up">
        <div
          className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.8)]" />
          <span>AUTO EDIT</span>
        </div>
        <h1 className="hero-title">
          {greeting}{firstName ? `, ${firstName}` : ''}.
          <br />
          <span className="display-subtle text-3xl md:text-5xl">
            O que vamos automatizar hoje?
          </span>
        </h1>
      </section>

      {/* Banner promocional / destaque (estilo HeyGen) */}
      <PromoBanner tier={tier} isAdmin={isAdmin} />

      {/* Bloco DESTAQUES — grandes, com gradiente */}
      <section className="mt-10">
        <div
          className="mb-5 flex items-end justify-between gap-4 fade-in-up"
          style={{ animationDelay: '120ms' }}
        >
          <div>
            <h2 className="section-title">Destaques</h2>
            <p className="mt-1 text-sm text-text-muted">
              As ferramentas mais usadas no estúdio.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((it, i) => (
            <FeaturedCard
              key={it.href}
              entry={it}
              delay={140 + i * 60}
              locked={!tierAllowsTool(tier, it.href)}
            />
          ))}
        </div>
      </section>

      {/* TRABALHO RÁPIDO (Base Suite) */}
      <section className="mt-14">
        <SectionTitle
          eyebrow="ESSENCIAIS"
          title="Trabalho rápido"
          sub="Cortes, ajustes e arquivos — sem espera."
          delay={300}
        />
        <div
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 fade-in-up"
          style={{ animationDelay: '340ms' }}
        >
          {base.map((it, i) => (
            <ToolCard
              key={it.href}
              entry={it}
              delay={i * 35}
              locked={!tierAllowsTool(tier, it.href)}
            />
          ))}
        </div>
      </section>

      {/* INTELIGÊNCIA (AI Suite) */}
      <section className="mt-14">
        <SectionTitle
          eyebrow="INTELIGÊNCIA"
          title="Com a IA"
          sub="Quando você quer um passo a menos no caminho."
          delay={420}
        />
        <div
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 fade-in-up"
          style={{ animationDelay: '460ms' }}
        >
          {ai.map((it, i) => (
            <ToolCard
              key={it.href}
              entry={it}
              delay={i * 35}
              locked={!tierAllowsTool(tier, it.href)}
            />
          ))}
        </div>
      </section>

      {/* Rodapé editorial */}
      <section className="mt-20 mb-6 text-center">
        <p className="display-subtle text-lg md:text-xl">
          Feito por quem edita.
        </p>
        <p className="mt-1 text-[13px] text-text-muted">
          Auto Edit · {new Date().getFullYear()}
        </p>
      </section>
    </div>
  );
}

/* ─────────────────────────── Subcomponentes ─────────────────────── */

function greetingFor(d: Date, _name: string) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function SectionTitle({
  eyebrow,
  title,
  sub,
  delay,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  delay: number;
}) {
  return (
    <div className="fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <div
        className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-text-dim"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {eyebrow}
      </div>
      <h2 className="section-title">{title}</h2>
      <p className="mt-1 text-sm text-text-muted">{sub}</p>
    </div>
  );
}

function PromoBanner({
  tier,
  isAdmin,
}: {
  tier: 'free' | 'basic' | 'pro' | 'admin' | null;
  isAdmin: boolean;
}) {
  // "Iniciar automação" só liberado pra Pro ou admin
  const canStartAutomation = isAdmin || tierCanAutomate(tier);
  return (
    <div
      className="promo-banner group relative overflow-hidden rounded-[26px] border border-line/60 fade-in-up"
      style={{
        animationDelay: '80ms',
        background:
          'linear-gradient(120deg, rgba(200,255,0,0.16) 0%, rgba(167,139,250,0.18) 50%, rgba(34,211,238,0.12) 100%), linear-gradient(180deg, #15151a, #0a0a0c)',
      }}
    >
      {/* Mesh gradient animado — duas manchas que pulsam fora de fase */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 90% at 0% 50%, rgba(200,255,0,0.28), transparent 60%)',
          animation: 'promo-pulse-1 6s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 90% at 100% 50%, rgba(167,139,250,0.32), transparent 60%)',
          animation: 'promo-pulse-2 7s ease-in-out infinite',
        }}
      />

      {/* Linhas tech decorativas no fundo (grid sutil) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Sparkles flutuantes */}
      <Sparkle className="absolute top-6 right-[30%]" delay={0} />
      <Sparkle className="absolute top-[60%] right-[18%]" delay={800} />
      <Sparkle className="absolute top-[28%] right-[8%]" delay={1600} />

      {/* Ícone piloto grande à direita, com motion 3D */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 md:block"
        style={{
          filter:
            'drop-shadow(0 0 36px rgba(200,255,0,0.42)) drop-shadow(0 0 18px rgba(167,139,250,0.38))',
          animation: 'promo-icon-float 5.5s ease-in-out infinite',
        }}
      >
        <div className="opacity-30 group-hover:opacity-45 transition-opacity duration-500">
          <IconClickUpPilot size={240} strokeWidth={1.2} />
        </div>
      </div>

      <div className="relative flex flex-col items-start gap-6 px-7 py-10 md:flex-row md:items-center md:justify-between md:px-12 md:py-14">
        <div className="max-w-[600px]">
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-lime/50 bg-black/50 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime backdrop-blur-md"
            style={{
              fontFamily: 'var(--font-tech)',
              boxShadow: '0 0 22px -6px rgba(200,255,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-lime"
              style={{ boxShadow: '0 0 10px rgba(200,255,0,0.95), 0 0 20px rgba(200,255,0,0.5)' }}
            />
            ClickUp Pilot · novo
          </div>
          <h3
            className="text-[28px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[40px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.025em' }}
          >
            Sua equipe edita<br />
            <span
              style={{
                background: 'linear-gradient(135deg, #c8ff00 0%, #a78bfa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              no automático.
            </span>
          </h3>
          <p className="mt-3 max-w-[480px] text-[14.5px] leading-relaxed text-white/80">
            Conecta no seu ClickUp, lê os briefings e dispara os avatares
            sozinho. Você só revisa.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* Botão 1: Conhecer o Pilot (preto, sempre disponível) */}
            <Link
              href="/pilot"
              className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/20 bg-black/60 px-6 py-3 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/45 hover:bg-black/80"
              style={{
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px -10px rgba(0,0,0,0.7)',
              }}
            >
              <span className="relative z-10">Conhecer o Pilot</span>
              <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                →
              </span>
            </Link>

            {/* Botão 2: Iniciar automação (verde, bloqueado pra free/basic) */}
            {canStartAutomation ? (
              <Link
                href="/tools/clickup-pilot"
                className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-6 py-3 text-[13.5px] font-bold text-black"
                style={{
                  background:
                    'linear-gradient(135deg, #c8ff00 0%, #a3e635 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.5), 0 12px 32px -8px rgba(200,255,0,0.55), 0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                <span className="relative z-10">Iniciar automação</span>
                <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                  →
                </span>
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover/btn:translate-x-[120%]"
                />
              </Link>
            ) : (
              <Link
                href="/planos"
                title="Disponível só no plano Pro"
                className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-lime/35 bg-lime/5 px-6 py-3 text-[13.5px] font-bold text-lime/70 backdrop-blur-md transition-all duration-300 hover:border-lime/55 hover:text-lime"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 018 0v4" />
                </svg>
                <span className="relative z-10">Iniciar automação</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes promo-pulse-1 {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.05); }
        }
        @keyframes promo-pulse-2 {
          0%, 100% { opacity: 0.55; transform: scale(1.03); }
          50% { opacity: 0.85; transform: scale(0.97); }
        }
        @keyframes promo-icon-float {
          0%, 100% { transform: translateY(-50%) translateX(0) rotate(0); }
          50% { transform: translateY(calc(-50% - 8px)) translateX(-4px) rotate(-3deg); }
        }
      `}</style>
    </div>
  );
}

function Sparkle({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <span
      aria-hidden
      className={'pointer-events-none ' + (className || '')}
      style={{ animation: `sparkle-twinkle 2.6s ease-in-out infinite`, animationDelay: `${delay}ms` }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 0l1.2 4.8L13 6l-4.8 1.2L7 12l-1.2-4.8L0 6l4.8-1.2L7 0z" fill="#fff" opacity="0.9" />
      </svg>
      <style jsx>{`
        @keyframes sparkle-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.6) rotate(0); }
          40% { opacity: 1; transform: scale(1) rotate(90deg); }
          60% { opacity: 1; transform: scale(1) rotate(120deg); }
        }
      `}</style>
    </span>
  );
}

/**
 * FeaturedCard — card 3D rico com tilt, spotlight, conic border.
 * Quando `locked=true`, vira <div> não-clicável + overlay de cadeado.
 */
function FeaturedCard({
  entry,
  delay,
  locked = false,
}: {
  entry: ToolEntry;
  delay: number;
  locked?: boolean;
}) {
  const handleMouseMove: React.MouseEventHandler<HTMLElement> = (e) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    const rotY = (px - 0.5) * 8;
    const rotX = -(py - 0.5) * 8;
    el.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  };
  const handleMouseLeave: React.MouseEventHandler<HTMLElement> = (e) => {
    e.currentTarget.style.transform = 'rotateX(0) rotateY(0)';
  };

  const cardClass =
    'featured-card group relative block overflow-hidden rounded-[20px] border border-line/70 p-5 md:p-6' +
    (locked ? ' cursor-not-allowed' : '');
  const cardStyle: React.CSSProperties = {
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.22)), linear-gradient(180deg, #16161c, #0c0c10)',
    transformStyle: 'preserve-3d',
    transition:
      'transform 0.35s cubic-bezier(.2,.8,.2,1), box-shadow 0.5s ease, border-color 0.4s ease',
    willChange: 'transform',
  };

  const body = (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(380px circle at var(--gx, 50%) var(--gy, 50%), ${entry.hue}, transparent 55%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full opacity-70 blur-3xl transition-all duration-500 group-hover:opacity-100"
        style={{ background: entry.hue }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          padding: '1px',
          background:
            'conic-gradient(from var(--angle, 0deg), transparent 0%, ' +
            entry.hue +
            ' 22%, transparent 50%, ' +
            entry.hue +
            ' 78%, transparent 100%)',
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: 'card-border-spin 6s linear infinite',
        }}
      />

      {locked ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center backdrop-blur-[2px]"
          style={{ background: 'rgba(7,7,8,0.55)' }}
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur-md"
            style={{ boxShadow: '0 0 24px -6px rgba(167,139,250,0.55)' }}
          >
            <LockIcon />
          </span>
        </div>
      ) : null}

      <div className={'relative ' + (locked ? 'opacity-50' : '')}>
        <div className="mb-5 flex items-center justify-between">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-[16px] border border-white/10 bg-black/40 backdrop-blur-md transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-110 group-hover:-rotate-[8deg]"
            style={{
              boxShadow: `0 0 32px -2px ${entry.hue}, inset 0 1px 0 rgba(255,255,255,0.12)`,
              transform: 'translateZ(30px)',
            }}
          >
            {entry.icon}
          </span>
          <div className="flex items-center gap-1.5">
            {locked ? (
              <span
                className="rounded-full border border-white/15 bg-black/40 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-white/70 backdrop-blur-md"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                BETA
              </span>
            ) : null}
            {entry.badge ? (
              <span
                className="rounded-full border border-violet/35 bg-violet/10 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-violet backdrop-blur-md transition-transform duration-300 group-hover:scale-105"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {entry.badge}
              </span>
            ) : null}
          </div>
        </div>
        <h3
          className="text-[18px] font-bold leading-snug tracking-tight text-white transition-transform duration-300 group-hover:-translate-y-0.5"
          style={{
            fontFamily: 'var(--font-tech)',
            letterSpacing: '-0.015em',
            transform: 'translateZ(20px)',
          }}
        >
          {entry.label}
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-muted">
          {entry.description}
        </p>
        <div
          className="mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-dim transition-all duration-300 group-hover:text-white"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span>{locked ? 'Bloqueado' : 'Abrir'}</span>
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 transition-all duration-300 group-hover:translate-x-1 group-hover:scale-110 group-hover:border-white/30"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            →
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="featured-card-wrap fade-in-up"
      style={{ animationDelay: `${delay}ms`, perspective: '1100px' }}
    >
      {locked ? (
        <div
          className={cardClass}
          style={cardStyle}
          aria-disabled
          title="Disponível só pra contas Beta"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {body}
        </div>
      ) : (
        <Link
          href={entry.href}
          className={cardClass}
          style={cardStyle}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {body}
        </Link>
      )}
    </div>
  );
}

function ToolCard({
  entry,
  delay,
  locked = false,
}: {
  entry: ToolEntry;
  delay: number;
  locked?: boolean;
}) {
  const cls =
    'tool-card group relative block overflow-hidden rounded-[16px] border border-line/70 p-4 transition-all duration-300 md:p-5 ' +
    (locked
      ? 'cursor-not-allowed'
      : 'hover:-translate-y-[2px] hover:border-violet/45');
  const style: React.CSSProperties = {
    animationDelay: `${delay}ms`,
    background: 'linear-gradient(180deg, #15151a 0%, #0e0e10 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
  };
  const body = (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-80"
        style={{ background: entry.hue }}
      />

      {locked ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center"
          style={{ background: 'rgba(7,7,8,0.55)' }}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur-md"
            style={{ boxShadow: '0 0 18px -6px rgba(167,139,250,0.55)' }}
          >
            <LockIcon size={14} />
          </span>
        </div>
      ) : null}

      <div className={'relative flex items-start gap-3 ' + (locked ? 'opacity-45' : '')}>
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-white/6 bg-black/30 transition-transform duration-300 group-hover:scale-110"
          style={{
            boxShadow: `0 0 22px -6px ${entry.hue}`,
          }}
        >
          {entry.icon}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate text-[14px] font-bold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {entry.label}
            </span>
            {entry.badge ? (
              <span
                className="shrink-0 rounded-full border border-violet/40 bg-violet/10 px-1.5 py-0 text-[8.5px] font-bold uppercase tracking-[0.18em] text-violet"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {entry.badge}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-text-muted">
            {entry.description}
          </p>
        </div>
      </div>
    </>
  );

  return locked ? (
    <div
      className={cls}
      style={style}
      aria-disabled
      title="Disponível só pra contas Beta"
    >
      {body}
    </div>
  ) : (
    <Link href={entry.href} className={cls} style={style}>
      {body}
    </Link>
  );
}

function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#c084fc"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

// Mapa de path → label legível (espelha TopBar). Usado pra mostrar
// "HeyGen Auto requer Pro" em vez de "/tools/heygen-auto requer Pro".
const TOOL_LABELS: Record<string, string> = {
  '/tools/auto-broll': 'Auto B-roll',
  '/tools/troca-produto': 'Troca de produto',
  '/tools/heygen-auto': 'HeyGen Auto',
  '/tools/decupagem-copy': 'Decupagem Inteligente',
  '/tools/clickup-pilot': 'ClickUp Pilot',
  '/tools/remover-elementos': 'Remover Legenda/Marca d’Água',
  '/tools/camuflagem': 'Camuflagem',
  '/tools/compressor': 'Compressor',
  '/tools/audio-split': 'Separar áudios',
  '/tools/acelerador': 'Mixer de Velocidade',
  '/tools/normalizador': 'Normalizador',
  '/tools/take-splitter': 'Separar takes',
  '/tools/copy-srt': 'Gerador de SRT',
  '/tools/calculadora': 'Calculadora',
  '/tools/ltx-video': 'LTX Video',
  '/tools/points': 'Pontos',
  '/tools/lipsync-history': 'Histórico',
  '/tools/background': 'Tarefas em background',
};

function LockedFlash({
  from,
  need,
  tier,
}: {
  from: string;
  need: 'basic' | 'pro' | 'admin' | null;
  tier: 'free' | 'basic' | 'pro' | 'admin' | null;
}) {
  const toolName = TOOL_LABELS[from] || 'Esta ferramenta';
  const needLabel =
    need === 'admin' ? 'Admin' : need === 'pro' ? 'Pro' : need === 'basic' ? 'Basic' : null;
  const tierLabel =
    tier === 'free' ? 'FREE' : tier === 'basic' ? 'BASIC' : tier === 'pro' ? 'PRO' : 'ADMIN';

  const accent =
    need === 'admin'
      ? 'rgba(200,255,0,0.45)'
      : need === 'pro'
        ? 'rgba(217,70,239,0.45)'
        : 'rgba(192,132,252,0.45)';

  return (
    <div
      role="alert"
      className="fade-in-up mb-6 flex items-start gap-3 rounded-[14px] border px-5 py-4"
      style={{
        borderColor: accent,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0c0c10)',
      }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
        style={{
          borderColor: accent,
          background: accent.replace('0.45', '0.15'),
          boxShadow: `0 0 18px -4px ${accent}`,
        }}
      >
        <LockIcon size={16} />
      </span>
      <div className="flex-1">
        <div
          className="text-[10.5px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: 'var(--font-tech)', color: accent.replace('0.45', '1') }}
        >
          Acesso bloqueado
        </div>
        <p className="mt-1 text-[13.5px] leading-relaxed text-white/90">
          <span className="font-bold text-white">{toolName}</span>{' '}
          {needLabel ? (
            <>
              requer plano <span className="font-bold text-white">{needLabel}</span>.
            </>
          ) : (
            <>não está disponível pro seu plano.</>
          )}{' '}
          <span className="mono text-[11px] text-text-muted">
            Seu plano:{' '}
            <span className="rounded-full border border-line-strong bg-bg-soft/60 px-2 py-0.5 text-[10px] uppercase tracking-widest">
              {tierLabel}
            </span>
          </span>
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <a
            href="/planos"
            className="rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white transition-all hover:-translate-y-[1px]"
            style={{
              fontFamily: 'var(--font-tech)',
              borderColor: accent,
              background: accent.replace('0.45', '0.18'),
            }}
          >
            Ver planos →
          </a>
          <a
            href="https://wa.me/5531991262437"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-line-strong px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-text-muted transition hover:border-lime/60 hover:text-lime"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Falar no WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
