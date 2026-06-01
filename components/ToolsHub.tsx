'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useTier, tierAllowsTool, tierCanAutomate } from '@/lib/use-tier';
import { isToolInMaintenance, canBypassMaintenance } from '@/lib/maintenance';
import { MaintenanceBadge } from '@/components/MaintenanceBadge';

/** 'blocked' = cliente sem acesso · 'admin' = admin acessa pra testar. */
type MaintMode = 'blocked' | 'admin' | undefined;
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
  IconLipsync,
  IconNormalizador,
  IconRemoverElementos,
  IconSeparadorAudio,
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
  /** Vídeo do card (roda só no hover). Em /public/cards/. */
  video?: string;
  /** Imagem 4K que fica como THUMB até o hover. Em /public/cards/. */
  poster?: string;
};

// DESTAQUES — 3 carros-chefe em cards de VÍDEO (estilo HeyGen): o vídeo só
// roda quando o mouse passa em cima, e aí revela a copy da ferramenta.
const FEATURED: ToolEntry[] = [
  {
    href: '/tools/lipsync',
    label: 'Criar um avatar',
    description: 'Sobe o rosto, sobe o áudio — e a boca fala exatamente o que você quiser. Avatar realista, lipsync perfeito, em minutos. Ilimitado.',
    icon: <IconHeyGenAuto size={28} />,
    hue: 'rgba(232, 121, 249, 0.45)',
    badge: 'IA',
    video: '/cards/criar-avatar.mp4',
    poster: '/cards/criar-avatar.jpg',
  },
  {
    href: '/tools/clickup-pilot',
    label: 'Seu fluxo automático',
    description: 'Conecta no seu ClickUp, lê os briefings e dispara os vídeos sozinho. Você só revisa — o estúdio entrega no automático.',
    icon: <IconAutoBroll size={28} />,
    hue: 'rgba(167, 139, 250, 0.45)',
    badge: 'IA',
    video: '/cards/fluxo-automatico.mp4',
    poster: '/cards/fluxo-automatico.jpg',
  },
  {
    href: '/tools/auto-broll',
    label: 'Tenha b-rolls infinitos',
    description: 'Cola o roteiro e a IA gera b-roll cinematográfico pra cada frase. Cortes prontos, no clima certo, enquanto você dorme.',
    icon: <IconAutoBroll size={28} />,
    hue: 'rgba(103, 232, 249, 0.45)',
    badge: 'IA',
    video: '/cards/b-rolls.mp4',
    poster: '/cards/b-rolls.jpg',
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
    description: 'Baixa vídeo, áudio e imagem do YouTube, TikTok, Insta e Pinterest.',
    icon: <IconDownloader size={26} />,
    hue: 'rgba(96, 165, 250, 0.4)',
  },
  {
    href: '/tools/compressor',
    label: 'Compressor',
    description: 'Reduz o peso do vídeo sem perder qualidade visível.',
    icon: <IconCompressor size={26} />,
    hue: 'rgba(129, 140, 248, 0.4)',
  },
  {
    href: '/tools/audio-split',
    label: 'Dividir áudios',
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
    href: '/tools/separador-audio',
    label: 'Separador de Áudio',
    description: 'Separa voz, instrumental e SFX em trilhas independentes.',
    icon: <IconSeparadorAudio size={26} />,
    hue: 'rgba(167, 139, 250, 0.45)',
  },
];

const AI: ToolEntry[] = [
  {
    href: '/tools/lipsync',
    label: 'Criar um Avatar',
    description: 'Sobe o rosto, sobe o áudio e a boca fala o que você quiser. Lipsync realista.',
    icon: <IconLipsync size={26} />,
    hue: 'rgba(232, 121, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/auto-broll',
    label: 'Auto B-roll',
    description: 'Gera B-rolls em massa pelo JSON.',
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
    description: 'Remove legenda e marca d’água.',
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
    label: 'Hey Auto',
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
  const [maintBypass, setMaintBypass] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        if (!cancelled) setMaintBypass(canBypassMaintenance(u.user?.email));
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

  // Manutenção: admin acessa (modo 'admin'); emails liberados (ex.: Elder)
  // acessam normal (undefined); o resto é bloqueado.
  const maintOf = (href: string): MaintMode => {
    if (!isToolInMaintenance(href)) return undefined;
    if (isAdmin) return 'admin';
    if (maintBypass) return undefined;
    return 'blocked';
  };

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
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5 xl:-mx-6 2xl:-mx-10">
          {featured.map((it, i) =>
            it.video ? (
              <FeaturedVideoCard
                key={it.href}
                entry={it}
                delay={140 + i * 60}
                locked={!tierAllowsTool(tier, it.href)}
                maint={maintOf(it.href)}
              />
            ) : (
              <FeaturedCard
                key={it.href}
                entry={it}
                delay={140 + i * 60}
                locked={!tierAllowsTool(tier, it.href)}
                maint={maintOf(it.href)}
              />
            ),
          )}
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
              maint={maintOf(it.href)}
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
              maint={maintOf(it.href)}
            />
          ))}
        </div>
      </section>

      {/* Rodapé editorial */}
      <section className="mt-20 mb-6 text-center">
        <p className="display-subtle text-lg md:text-xl">
          Ligue a fila e vá dormir.
        </p>
        <p className="mt-1 text-[13px] text-text-muted">
          Auto Edit · {new Date().getFullYear()}
        </p>
        <p
          className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-text-dim"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          DarkoCorporation
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
  const canStartAutomation = isAdmin || tierCanAutomate(tier);
  return (
    <PromoCarousel
      slides={[
        <PilotSlide key="pilot" canStartAutomation={canStartAutomation} />,
        <AutoBrollSlide key="broll" canStartAutomation={canStartAutomation} />,
      ]}
    />
  );
}

/* ────────── CAROUSEL WRAPPER ────────── */
function PromoCarousel({ slides }: { slides: React.ReactNode[] }) {
  const [idx, setIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  function go(n: number) {
    const safe = ((n % slides.length) + slides.length) % slides.length;
    setIdx(safe);
    const el = scrollerRef.current;
    if (el) {
      const w = el.clientWidth;
      el.scrollTo({ left: w * safe, behavior: 'smooth' });
    }
  }

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const i = Math.round(el.scrollLeft / w);
    if (i !== idx) setIdx(i);
  }

  return (
    <div className="relative fade-in-up" style={{ animationDelay: '80ms' }}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {slides.map((s, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            {s}
          </div>
        ))}
      </div>

      {/* Arrows */}
      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Anterior"
            onClick={() => go(idx - 1)}
            className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-white/60 hover:bg-black/80 md:flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Próximo"
            onClick={() => go(idx + 1)}
            className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-md transition-all hover:scale-110 hover:border-white/60 hover:bg-black/80 md:flex"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </>
      )}

      {/* Dots */}
      <div className="mt-3 flex items-center justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => go(i)}
            aria-label={`Ir pro card ${i + 1}`}
            className={
              'h-1.5 rounded-full transition-all duration-300 ' +
              (i === idx ? 'w-8 bg-lime shadow-[0_0_8px_rgba(200,232,124,0.6)]' : 'w-1.5 bg-white/30 hover:bg-white/60')
            }
          />
        ))}
      </div>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

/* ────────── SLIDE 1: PILOT ────────── */
function PilotSlide({ canStartAutomation }: { canStartAutomation: boolean }) {
  return (
    <div
      className="promo-banner group relative overflow-hidden rounded-[26px] border border-line/60"
      style={{
        background: 'var(--banner-bg)',
      }}
    >
      {/* Mesh gradient animado — duas manchas que pulsam fora de fase */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 90% at 0% 50%, rgba(200,232,124,0.28), transparent 60%)',
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
            'drop-shadow(0 0 36px rgba(200,232,124,0.42)) drop-shadow(0 0 18px rgba(167,139,250,0.38))',
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
              boxShadow: '0 0 22px -6px rgba(200,232,124,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-lime"
              style={{ boxShadow: '0 0 10px rgba(200,232,124,0.95), 0 0 20px rgba(200,232,124,0.5)' }}
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
                background: 'var(--hero-grad)',
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
              className="dark-island group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/20 bg-black/60 px-6 py-3 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/45 hover:bg-black/80"
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
                  background: 'var(--cta-lime)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.5), 0 12px 32px -8px rgba(200,232,124,0.55), 0 2px 6px rgba(0,0,0,0.4)',
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
                href="/planos?upgrade=1"
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

/* ────────── SLIDE 2: AUTO B-ROLL ────────── */
function AutoBrollSlide({ canStartAutomation }: { canStartAutomation: boolean }) {
  return (
    <div
      className="group relative overflow-hidden rounded-[26px] border border-violet/30"
      style={{
        background: 'var(--banner-bg-2)',
      }}
    >
      {/* Mesh pulses */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 90% at 0% 50%, rgba(167,139,250,0.32), transparent 60%)',
          animation: 'promo-pulse-1 6s ease-in-out infinite',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 90% at 100% 50%, rgba(200,232,124,0.22), transparent 60%)',
          animation: 'promo-pulse-2 7s ease-in-out infinite',
        }}
      />
      {/* Grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Sparkles */}
      <Sparkle className="absolute top-6 right-[30%]" delay={0} />
      <Sparkle className="absolute top-[60%] right-[18%]" delay={800} />
      <Sparkle className="absolute top-[28%] right-[8%]" delay={1600} />

      {/* Mini take cards animados à direita — simula B-rolls sendo gerados */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 lg:block"
      >
        <BrollMiniGrid />
      </div>

      <div className="relative flex flex-col items-start gap-6 px-7 py-10 md:flex-row md:items-center md:justify-between md:px-12 md:py-14">
        <div className="max-w-[600px]">
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet/55 bg-black/50 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em] text-violet backdrop-blur-md"
            style={{
              fontFamily: 'var(--font-tech)',
              boxShadow:
                '0 0 22px -6px rgba(167,139,250,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse-soft rounded-full bg-violet"
              style={{
                boxShadow: '0 0 10px rgba(167,139,250,0.95), 0 0 20px rgba(167,139,250,0.5)',
              }}
            />
            Auto B-Roll · em série
          </div>
          <h3
            className="text-[28px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[40px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.025em' }}
          >
            B-rolls saem prontos<br />
            <span
              style={{
                background: 'linear-gradient(135deg, #a78bfa 0%, #c2cf86 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              enquanto você dorme.
            </span>
          </h3>
          <p className="mt-3 max-w-[480px] text-[14.5px] leading-relaxed text-white/80">
            Cole a lista de prompts e aperte o play. Qualidade Magnific
            travada, zero crédito gasto, ZIP cai pronto.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/tools/auto-broll"
              className="dark-island group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/20 bg-black/60 px-6 py-3 text-[13.5px] font-bold text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-[1px] hover:border-white/45 hover:bg-black/80"
              style={{
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px -10px rgba(0,0,0,0.7)',
              }}
            >
              <span className="relative z-10">Conhecer Auto B-roll</span>
              <span className="relative z-10 transition-transform duration-300 group-hover/btn:translate-x-1">
                →
              </span>
            </Link>

            {canStartAutomation ? (
              <Link
                href="/tools/auto-broll"
                className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full px-6 py-3 text-[13.5px] font-bold text-white"
                style={{
                  background:
                    'linear-gradient(135deg, #a78bfa 0%, #6d4ee8 60%, #4f3ddb 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.4), 0 12px 32px -8px rgba(167,139,250,0.6), 0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                <span className="relative z-10">Disparar agora</span>
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
                href="/planos?upgrade=1"
                title="Disponível só no plano Pro"
                className="group/btn relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-violet/35 bg-violet/5 px-6 py-3 text-[13.5px] font-bold text-violet/70 backdrop-blur-md transition-all duration-300 hover:border-violet/55 hover:text-violet"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 018 0v4" />
                </svg>
                <span className="relative z-10">Disparar agora</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mini grid 3x2 simulando B-rolls em geração — animação ambient pro card */
function BrollMiniGrid() {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      style={{ width: 260 }}
    >
      {Array.from({ length: 6 }).map((_, i) => {
        const ready = [1, 3, 4].includes(i); // simula alguns prontos
        return (
          <div
            key={i}
            className="relative overflow-hidden rounded-[8px] border"
            style={{
              aspectRatio: '9/16',
              borderColor: ready ? 'rgba(200,232,124,0.45)' : 'rgba(167,139,250,0.35)',
              background: ready
                ? 'linear-gradient(135deg, rgba(200,232,124,0.15), rgba(0,0,0,0.6))'
                : 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(0,0,0,0.7))',
              boxShadow: ready
                ? '0 4px 16px -6px rgba(200,232,124,0.4)'
                : '0 4px 16px -6px rgba(167,139,250,0.35)',
              animation: `brollPop 0.6s ease-out ${i * 0.15}s backwards`,
            }}
          >
            {/* Bunny mini (loading state) ou check (ready) */}
            <div className="absolute inset-0 flex items-center justify-center">
              {ready ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c2cf86" strokeWidth="3">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <div
                  className="h-2.5 w-2.5 rounded-full bg-violet"
                  style={{ animation: 'brollDot 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }}
                />
              )}
            </div>
            {/* Progress bar bottom for loading */}
            {!ready && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-line/40">
                <div
                  className="h-full bg-gradient-to-r from-violet via-violet-deep to-cyan-400"
                  style={{ animation: `brollProgress 3s ease-in-out infinite`, animationDelay: `${i * 0.3}s` }}
                />
              </div>
            )}
          </div>
        );
      })}
      <style jsx>{`
        @keyframes brollPop {
          from { opacity: 0; transform: scale(0.85) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes brollDot {
          0%, 100% { opacity: 0.4; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes brollProgress {
          0% { width: 5%; }
          70% { width: 85%; }
          100% { width: 95%; }
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
/* ───────────────────── FeaturedVideoCard ─────────────────────
 * Card estilo HeyGen: o VÍDEO só roda quando o mouse passa em cima, e aí
 * revela a copy da ferramenta + o CTA. O vídeo fica em /public/cards/.
 * Antes do vídeo existir, mostra um gradiente bonito (fallback).
 */
function FeaturedVideoCard({
  entry,
  delay,
  locked = false,
  maint,
}: {
  entry: ToolEntry;
  delay: number;
  locked?: boolean;
  maint?: MaintMode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isBlocked = maint === 'blocked';
  const nonClickable = locked || isBlocked;

  function play() {
    const v = videoRef.current;
    if (!v) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try { v.currentTime = 0; } catch { /* ignore */ }
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  function stop() {
    const v = videoRef.current;
    if (v) {
      try { v.pause(); v.currentTime = 0; } catch { /* ignore */ }
    }
  }

  const inner = (
    <>
      {/* ÁREA DO VÍDEO — primeiro frame fica como THUMB o tempo todo; dá play no hover */}
      <div className="relative aspect-video w-full overflow-hidden">
        {/* Fallback (só aparece se o vídeo não carregar) */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(130% 80% at 50% 8%, ${entry.hue}, transparent 60%), linear-gradient(180deg, rgb(var(--bg-softer)), #050507)` }}
        />
        {/* VÍDEO — roda no hover. Ken Burns sutil. */}
        <video
          ref={videoRef}
          src={entry.video}
          poster={entry.poster}
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.05]"
        />
        {/* THUMB 4K — imagem fica como capa o tempo todo; some no hover (revela o vídeo) */}
        {entry.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.poster}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover transition-all duration-500 ease-out group-hover:scale-[1.05] group-hover:opacity-0"
          />
        ) : null}
        {/* Máscara escura embaixo (legibilidade do título sobre o vídeo) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(4,4,6,0.88) 2%, rgba(4,4,6,0.18) 38%, transparent 62%)' }}
        />

        {/* Ícone + badge no topo */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3.5">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/12 bg-black/45 backdrop-blur-md transition-transform duration-500 group-hover:scale-110"
            style={{ boxShadow: `0 0 26px -4px ${entry.hue}` }}
          >
            {entry.icon}
          </span>
          {entry.badge ? (
            <span
              className="rounded-full border border-violet/35 bg-black/45 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-violet backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {entry.badge}
            </span>
          ) : null}
        </div>

        {/* Título — sempre sobre o vídeo, estilo HeyGen */}
        <h3
          className="absolute bottom-0 left-0 z-10 p-4 text-[19px] font-bold leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] transition-transform duration-300 group-hover:-translate-y-0.5"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
        >
          {entry.label}
        </h3>

        {/* Cadeado se bloqueado */}
        {locked ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[2px]"
            style={{ background: 'rgba(7,7,8,0.5)' }}
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur-md"
              style={{ boxShadow: '0 0 24px -6px rgba(167,139,250,0.55)' }}
            >
              <LockIcon />
            </span>
          </div>
        ) : null}
      </div>

      {/* PAINEL — abre ABAIXO do vídeo no hover (copy + botão animado).
          Fundo SEMPRE escuro (igual HeyGen) pra o texto branco ser legível
          nos dois temas — no light o texto preto sumia. */}
      <div
        className="max-h-0 overflow-hidden opacity-0 transition-all duration-500 ease-out group-hover:max-h-[260px] group-hover:opacity-100"
        style={{ background: '#0b0b0f' }}
      >
        <div className="px-4 pb-4 pt-3.5">
          <p className="text-[12.5px] leading-relaxed text-white/80">
            {entry.description}
          </p>
          <span
            className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-all duration-300 group-hover:border-violet/45 group-hover:bg-white/[0.12] group-hover:shadow-[0_0_24px_-6px_rgba(167,139,250,0.7)]"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {isBlocked ? 'Em manutenção' : locked ? 'Bloqueado' : 'Abrir ferramenta'}
            <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
          </span>
        </div>
      </div>

      {/* Borda conic acende no hover (cobre o card todo, já expandido) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          padding: '1px',
          background: 'conic-gradient(from var(--angle, 0deg), transparent 0%, ' + entry.hue + ' 22%, transparent 50%, ' + entry.hue + ' 78%, transparent 100%)',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: 'card-border-spin 6s linear infinite',
        }}
      />
    </>
  );

  return (
    <div
      className="dark-island featured-card-wrap fade-in-up relative z-0 hover:z-20"
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={nonClickable ? undefined : play}
      onMouseLeave={stop}
    >
      {nonClickable ? (
        <div
          className="group relative block cursor-not-allowed overflow-hidden rounded-[20px] border border-line/70"
          aria-disabled
          title={isBlocked ? 'Em manutenção' : 'Disponível só pra contas Beta'}
        >
          {inner}
        </div>
      ) : (
        <Link
          href={entry.href}
          className="group relative block overflow-hidden rounded-[20px] border border-line/70 transition-all duration-300 hover:border-violet/45 hover:shadow-[0_30px_70px_-26px_rgba(0,0,0,0.95)]"
        >
          {inner}
        </Link>
      )}
      {maint ? <MaintenanceBadge mode={maint} className="right-4 top-4" /> : null}
    </div>
  );
}

function FeaturedCard({
  entry,
  delay,
  locked = false,
  maint,
}: {
  entry: ToolEntry;
  delay: number;
  locked?: boolean;
  maint?: MaintMode;
}) {
  const isBlocked = maint === 'blocked';
  const nonClickable = locked || isBlocked;
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
    (nonClickable ? ' cursor-not-allowed' : '');
  const cardStyle: React.CSSProperties = {
    background: 'var(--card-face)',
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
        className="hub-glow pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full opacity-70 blur-3xl transition-all duration-500 group-hover:opacity-100"
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

      <div className={'relative ' + (nonClickable ? 'opacity-50' : '')}>
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
          <span>{isBlocked ? 'Em manutenção' : locked ? 'Bloqueado' : 'Abrir'}</span>
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
      className="featured-card-wrap fade-in-up relative"
      style={{ animationDelay: `${delay}ms`, perspective: '1100px' }}
    >
      {nonClickable ? (
        <div
          className={cardClass}
          style={cardStyle}
          aria-disabled
          title={isBlocked ? 'Em manutenção' : 'Disponível só pra contas Beta'}
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
      {/* Selo de manutenção FORA do card (overflow-hidden cortaria o mini-card). */}
      {maint ? <MaintenanceBadge mode={maint} className="right-4 top-4" /> : null}
    </div>
  );
}

function ToolCard({
  entry,
  delay,
  locked = false,
  maint,
}: {
  entry: ToolEntry;
  delay: number;
  locked?: boolean;
  maint?: MaintMode;
}) {
  const isBlocked = maint === 'blocked';
  const nonClickable = locked || isBlocked;
  const cls =
    'tool-card group relative block overflow-hidden rounded-[16px] border border-line/70 p-4 transition-all duration-300 md:p-5 ' +
    (nonClickable
      ? 'cursor-not-allowed'
      : 'hover:-translate-y-[2px] hover:border-violet/45');
  const style: React.CSSProperties = {
    animationDelay: `${delay}ms`,
    background: 'linear-gradient(180deg, rgb(var(--bg-softer)) 0%, rgb(var(--bg-soft)) 100%)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
  };
  const body = (
    <>
      <div
        aria-hidden
        className="hub-glow pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-80"
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

      <div className={'relative flex items-start gap-3 ' + (nonClickable ? 'opacity-45' : '')}>
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

  const card = nonClickable ? (
    <div
      className={cls}
      style={style}
      aria-disabled
      title={isBlocked ? 'Em manutenção' : 'Disponível só pra contas Beta'}
    >
      {body}
    </div>
  ) : (
    <Link href={entry.href} className={cls} style={style}>
      {body}
    </Link>
  );

  if (!maint) return card;
  // Card tem overflow-hidden → o mini-card seria cortado. Por isso o selo
  // fica FORA do card, num wrapper relative.
  return (
    <div className="relative">
      {card}
      <MaintenanceBadge mode={maint} className="right-3 top-3" />
    </div>
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
// "Hey Auto requer Pro" em vez de "/tools/heygen-auto requer Pro".
const TOOL_LABELS: Record<string, string> = {
  '/tools/auto-broll': 'Auto B-roll',
  '/tools/troca-produto': 'Troca de produto',
  '/tools/heygen-auto': 'Hey Auto',
  '/tools/decupagem-copy': 'Decupagem Inteligente',
  '/tools/clickup-pilot': 'ClickUp Pilot',
  '/tools/remover-elementos': 'Remover Legenda/Marca d’Água',
  '/tools/camuflagem': 'Camuflagem',
  '/tools/compressor': 'Compressor',
  '/tools/audio-split': 'Dividir áudios',
  '/tools/acelerador': 'Mixer de Velocidade',
  '/tools/normalizador': 'Normalizador',
  '/tools/separador-audio': 'Separador de Áudio',
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
      ? 'rgba(200,232,124,0.45)'
      : need === 'pro'
        ? 'rgba(217,70,239,0.45)'
        : 'rgba(192,132,252,0.45)';

  return (
    <div
      role="alert"
      className="fade-in-up mb-6 flex items-start gap-3 rounded-[14px] border px-5 py-4"
      style={{
        borderColor: accent,
        background: 'var(--card-face)',
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
            href="/planos?upgrade=1"
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
            href="https://wa.me/5534991262437"
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
