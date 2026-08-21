'use client';
import { famousHeyGratis, famousHeyDiasRestantes } from '@/lib/famous-hey-trial';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useTier, tierAllowsTool, tierCanAutomate } from '@/lib/use-tier';
import { emailUnlocksPath } from '@/lib/tool-unlocks';
import { isToolInMaintenance, canBypassMaintenance } from '@/lib/maintenance';
import { MaintenanceBadge } from '@/components/MaintenanceBadge';
import { HeroSlideBg } from './HeroSlideBg';
import { TipoShowcase } from './TipoShowcase';

/** 'blocked' = cliente sem acesso · 'admin' = admin acessa pra testar. */
type MaintMode = 'blocked' | 'admin' | undefined;
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconFakePass,
  IconCamuflagem,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconTipografia,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconFamousHey,
  IconLipsync,
  IconNormalizador,
  IconRemoverElementos,
  IconSeparadorAudio,
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
  badge?: 'IA' | 'ADMIN' | 'GRÁTIS';
  adminOnly?: boolean;
  /** Vídeo do card (roda só no hover). Em /public/cards/. */
  video?: string;
  /** Imagem 4K que fica como THUMB até o hover. Em /public/cards/. */
  poster?: string;
};

// DESTAQUES — 3 carros-chefe em cards de VÍDEO (estilo HeyGen): o vídeo só
// roda quando o mouse passa em cima, e aí revela a copy da ferramenta.
// ⚠ Só ferramentas acessíveis a CLIENTE aqui — nada de uso interno.
const FEATURED: ToolEntry[] = [
  {
    href: '/tools/lipsync',
    label: 'Lipsync Video to Video',
    description: 'Suba o rosto, suba o áudio e o lipsync sai pronto — o avatar falando exatamente a copy que você quiser, em minutos.',
    icon: <IconHeyGenAuto size={28} />,
    hue: 'rgba(232, 121, 249, 0.45)',
    badge: 'IA',
    video: '/cards/criar-avatar.mp4',
    poster: '/cards/criar-avatar.jpg',
  },
  {
    href: '/tools/copy-srt',
    label: 'Gerador de SRT',
    description: 'Cole a copy, suba o áudio e a legenda sai alinhada palavra por palavra — pronta pra importar no editor.',
    icon: <IconCopySRT size={28} />,
    hue: 'rgba(196, 181, 253, 0.45)',
    badge: 'IA',
    video: '/cards/gerador-srt.mp4',
    poster: '/cards/gerador-srt.jpg',
  },
];

// Lista ÚNICA de ferramentas — sem divisão Base × IA (tudo é ferramenta).
// As de uso interno levam adminOnly (somem pra cliente).
const TOOLS: ToolEntry[] = [
  {
    href: '/tools/fakepass',
    label: 'FakePrint',
    description: 'Prints e stickers de redes sociais fiéis aos originais.',
    icon: <IconFakePass size={26} />,
    hue: 'rgba(167, 139, 250, 0.4)',
  },
  {
    href: '/tools/decupagem',
    label: 'Decupagem',
    description: 'Vídeo ou áudio: o silêncio some, a fala fica. Corte limpo.',
    icon: <IconDecupagem size={26} />,
    hue: 'rgba(163, 230, 53, 0.4)',
  },
  {
    href: '/tools/camuflagem',
    label: 'Camuflagem',
    description: 'O público ouve um áudio. A transcrição lê outro.',
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
    description: 'Iguala o volume da voz e limpa o chiado. Com relatório antes × depois.',
    icon: <IconNormalizador size={26} />,
    hue: 'rgba(94, 234, 212, 0.4)',
  },
  {
    href: '/tools/separador-audio',
    label: 'Separador de Áudio',
    description: 'Separa voz, instrumental e SFX em trilhas independentes.',
    icon: <IconSeparadorAudio size={26} />,
    hue: 'rgba(167, 139, 250, 0.45)',
    adminOnly: true,
  },
  {
    href: '/tools/lipsync',
    label: 'Lipsync Video to Video',
    description: 'Vídeo entra. Áudio encaixa. Boca fala.',
    icon: <IconLipsync size={26} />,
    hue: 'rgba(232, 121, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/auto-broll',
    label: 'Auto B-roll',
    description: 'Uma lista. Um clique. Dezenas de vídeos.',
    icon: <IconAutoBroll size={26} />,
    hue: 'rgba(240, 171, 252, 0.42)',
    badge: 'ADMIN',
    adminOnly: true,
  },
  {
    href: '/tools/remover-elementos',
    label: 'Remover Legenda/Marca d’Água',
    description: 'Legenda queimada. IA remove. MP4 limpo.',
    icon: <IconRemoverElementos size={26} />,
    hue: 'rgba(244, 114, 182, 0.42)',
    badge: 'IA',
    adminOnly: true,
  },
  {
    href: '/tools/decupagem-copy',
    label: 'Decupagem Inteligente',
    description: 'IA lê a copy. Escolhe o take certo.',
    icon: <IconDecupageCopy size={26} />,
    hue: 'rgba(232, 121, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/copy-srt',
    label: 'Gerador de SRT',
    description: 'Áudio + copy. Legenda alinhada palavra a palavra.',
    icon: <IconCopySRT size={26} />,
    hue: 'rgba(196, 181, 253, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/tipografia',
    label: 'Legendas Automáticas',
    description: 'A fala vira legenda animada, no tempo exato do áudio.',
    icon: <IconTipografia size={26} />,
    hue: 'rgba(251, 191, 36, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/heygen-auto',
    label: 'Hey Auto',
    description: 'Lipsync no HeyGen em lote, num clique — sem abrir o HeyGen.',
    icon: <IconHeyGenAuto size={26} />,
    hue: 'rgba(103, 232, 249, 0.42)',
    badge: 'ADMIN',
    adminOnly: true,
  },
  {
    href: '/tools/clickup-pilot',
    label: 'ClickUp Pilot',
    description: 'Lê o briefing de cada task e dispara os lipsyncs em fila.',
    icon: <IconClickUpPilot size={26} />,
    hue: 'rgba(167, 139, 250, 0.42)',
    badge: 'ADMIN',
    adminOnly: true,
  },
  {
    href: '/tools/famous-hey',
    label: 'Famous Hey',
    description: 'Anima uma foto no HeyGen. Uma foto vira take falando.',
    icon: <IconFamousHey size={26} />,
    hue: 'rgba(251, 191, 36, 0.42)',
    // Na janela grátis o selo anuncia a promoção e o card aparece pra TODOS;
    // fechada a janela, volta a ser ADMIN e some pra cliente sozinho.
    badge: famousHeyGratis() ? 'GRÁTIS' : 'ADMIN',
    adminOnly: !famousHeyGratis(),
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
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        if (!cancelled) {
          setMaintBypass(canBypassMaintenance(u.user?.email));
          setUserEmail(u.user?.email ?? null);
        }
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

  // adminOnly some pra cliente — exceto email com desbloqueio pontual
  // (lib/tool-unlocks.ts), que vê SÓ as ferramentas liberadas pra ele.
  const canSeeTool = (it: ToolEntry) =>
    !it.adminOnly || isAdmin || emailUnlocksPath(userEmail, it.href);
  const tools = TOOLS.filter(canSeeTool);
  const featured = FEATURED.filter(canSeeTool);

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

      {/* Banner-herói: FakePrint (manchete de telejornal) pra TODOS.
          Pilot e Auto B-roll entram como slides extras SÓ pra admin. */}
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
          <TipografiaFeaturedCard delay={120} />
          {featured.map((it, i) =>
            it.video ? (
              <FeaturedVideoCard
                key={it.href}
                entry={it}
                delay={140 + i * 60}
              />
            ) : (
              <FeaturedCard
                key={it.href}
                entry={it}
                delay={140 + i * 60}
                locked={
                  !tierAllowsTool(tier, it.href) &&
                  !emailUnlocksPath(userEmail, it.href)
                }
                maint={maintOf(it.href)}
              />
            ),
          )}
        </div>
      </section>

      {/* FERRAMENTAS — lista única, sem divisão Base × IA */}
      <section className="mt-14">
        <SectionTitle
          eyebrow="ESTÚDIO"
          title="Ferramentas"
          sub="Cortes, ajustes, arquivos e IA — sem espera."
          delay={300}
        />
        <div
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 fade-in-up"
          style={{ animationDelay: '340ms' }}
        >
          {tools.map((it, i) => (
            <ToolCard
              key={it.href}
              entry={it}
              delay={i * 35}
              locked={
                !tierAllowsTool(tier, it.href) &&
                !emailUnlocksPath(userEmail, it.href)
              }
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
  // FakePrint e Tipografia Automática são os heróis de TODOS (ferramentas
  // free) — arrastou o FakePrint pro lado, a Tipografia assume. As automações
  // internas (Pilot / Auto B-roll) só existem no carrossel do admin.
  const slides = [
    // Famous Hey abre o carrossel (pedido em 18.08). Fica atras do mesmo gate
    // do Pilot/Auto B-roll: e ferramenta interna, e herói que leva pra tela
    // bloqueada e pior que herói nenhum.
    // Na janela grátis o herói é pra todo mundo; fechada, volta a ser interno.
    ...(isAdmin || famousHeyGratis() ? [<FamousHeySlide key="famoushey" />] : []),
    <FakePrintSlide key="fakeprint" />,
    <TipografiaSlide key="tipografia" />,
    ...(isAdmin
      ? [
          <PilotSlide key="pilot" canStartAutomation={canStartAutomation} />,
          <AutoBrollSlide key="broll" canStartAutomation={canStartAutomation} />,
        ]
      : []),
  ];
  return <PromoCarousel slides={slides} />;
}

/**
 * CAIXA CANÔNICA DOS HERÓIS — medida ÚNICA de todos os slides do carrossel.
 *
 * O carrossel é um flex-row: a linha assume a altura do slide MAIS ALTO e os
 * outros ficam com sobra embaixo (aquela "borda" solta). Fixando a caixa aqui
 * (e mandando todo slide preencher com h-full via `[&>*]:h-full`), Pilot e
 * Auto B-roll passam a ter EXATAMENTE o tamanho do FakePrint/Tipografia — não
 * existe mais espaço órfão em nenhum dos quatro.
 *
 * O `min-h` é o piso pros heróis de TEXTO (Pilot / Auto B-roll), que empilham
 * título + copy + botões no mobile e não cabem num 16/10 magro.
 */
/** Estilo do selo do card. 'GRÁTIS' usa o vermelho de plantão em vez do violeta
 *  padrão: no meio de uma grade cheia de selos "IA" violeta, mais um violeta
 *  passava batido — e o ponto do selo é justamente ser notado. */
function seloClasse(badge: string): string {
  return badge === 'GRÁTIS'
    ? 'rounded-full border border-white/25 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-white backdrop-blur-md transition-transform duration-300 group-hover:scale-105 fh-selo'
    : 'rounded-full border border-violet/35 bg-violet/10 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-violet backdrop-blur-md transition-transform duration-300 group-hover:scale-105';
}

const HERO_BOX =
  'aspect-[16/10] min-h-[440px] max-h-[480px] sm:aspect-[16/8] sm:min-h-[400px] lg:aspect-[21/9] lg:min-h-0';

/* ────────── CAROUSEL WRAPPER ────────── */
function PromoCarousel({ slides }: { slides: React.ReactNode[] }) {
  const [idx, setIdx] = useState(0);
  const [pausado, setPausado] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /**
   * AVANÇO SOZINHO a cada 10s.
   *
   * O timer depende de `idx`: mexeu no carrossel (seta, bolinha ou arrastando),
   * a contagem RECOMEÇA. Sem isso, trocar de card na mão podia ser seguido de
   * um pulo automático meio segundo depois — parece que a página tem vontade
   * própria e briga com quem está usando.
   *
   * Pausa no hover e enquanto o dedo está na tela: ninguém quer o slide fugindo
   * enquanto lê ou arrasta. E `prefers-reduced-motion` desliga de vez.
   */
  useEffect(() => {
    if (slides.length < 2 || pausado) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      // Aba oculta: não adianta girar pra ninguém, e o Chrome estrangula o
      // timer de qualquer jeito — melhor esperar a volta.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const proximo = (idx + 1) % slides.length;
      setIdx(proximo);
      el.scrollTo({ left: el.clientWidth * proximo, behavior: 'smooth' });
    }, 10_000);
    return () => clearTimeout(t);
  }, [idx, pausado, slides.length]);

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
    <div
      className="relative fade-in-up"
      style={{ animationDelay: '80ms' }}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onPointerDown={() => setPausado(true)}
      onPointerUp={() => setPausado(false)}
      onPointerCancel={() => setPausado(false)}
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="hide-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {slides.map((s, i) => (
          <div
            key={i}
            className={`w-full shrink-0 snap-center [&>*]:h-full ${HERO_BOX}`}
          >
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

      {/* Dots — só quando há mais de um slide (senão fica um pontinho órfão) */}
      {slides.length > 1 ? (
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
      ) : null}

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

/* ────────── SLIDE HERÓI: TIPOGRAFIA AUTOMÁTICA (engine ao vivo) ────────── */
/**
 * O card roda o ENGINE REAL da ferramenta: um canvas cicla modelos de
 * lettering com frases de copy — o que aparece é exatamente o que a
 * ferramenta cospe no MP4. Mesmo tamanho/estrutura do slide do FakePrint.
 */
function TipografiaSlide() {
  const wrapRef = useRef<HTMLAnchorElement | null>(null);

  // fundo REAGE ao mouse: vars --mx/--my alimentam o holofote e o parallax
  function onMove(e: React.PointerEvent) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(2)}%`);
    el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(2)}%`);
    el.style.setProperty('--px', `${((e.clientX - r.left) / r.width - 0.5).toFixed(3)}`);
    el.style.setProperty('--py', `${((e.clientY - r.top) / r.height - 0.5).toFixed(3)}`);
  }

  return (
    <Link
      ref={wrapRef}
      href="/tools/tipografia"
      onPointerMove={onMove}
      className="dark-island hero-sombra group relative block overflow-hidden rounded-[26px] border border-line/60"
      style={
        {
          '--mx': '50%',
          '--my': '40%',
          '--px': '0',
          '--py': '0',
        } as React.CSSProperties
      }
    >
      {/* A medida vem da caixa canônica do carrossel (HERO_BOX) */}
      <div className="relative h-full w-full">
        {/* Fundo cinema profundo */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 18% 0%, rgba(109,78,232,0.3), transparent 55%), radial-gradient(110% 80% at 88% 100%, rgba(251,191,36,0.14), transparent 50%), linear-gradient(165deg, #0b0a12 0%, #060509 55%, #0d0a14 100%)',
          }}
        />
        {/* holofote que segue o mouse */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-60 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(34% 42% at var(--mx) var(--my), rgba(167,139,250,0.28), transparent 70%)',
          }}
        />
        {/* feixes de luz varrendo por trás dos letterings */}
        <div aria-hidden className="tgs-beams absolute inset-0" />
        <div aria-hidden className="tgs-blob tgs-blob-a" />
        <div aria-hidden className="tgs-blob tgs-blob-b" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        {/* O ENGINE ao vivo, com parallax sutil do mouse + zoom no hover */}
        <div
          className="absolute inset-0 transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
          style={{
            transform:
              'translate(calc(var(--px) * 14px), calc(var(--py) * 10px))',
          }}
        >
          <TipoShowcase variant="hero" />
        </div>

        {/* Vinheta de legibilidade (mais leve — os letterings são a estrela) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(2,2,6,0.72) 0%, rgba(2,2,6,0.16) 20%, transparent 38%), linear-gradient(to bottom, rgba(2,2,6,0.45) 0%, transparent 18%)',
          }}
        />

        {/* Topo: NOVO + nome + liberada pra todos */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 md:p-5">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-[5px] bg-[#6d4ee8] px-2 py-1 shadow-[0_4px_18px_-4px_rgba(109,78,232,0.9)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-80" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              <span
                className="text-[10px] font-black uppercase tracking-[0.18em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Novo
              </span>
            </span>
            <span
              className="hidden rounded-[5px] bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-sm sm:inline-flex"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Legendas Automáticas · 491 modelos
            </span>
          </div>
          <span
            className="rounded-full border border-violet/40 bg-black/55 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-violet backdrop-blur-sm"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Liberada pra todos
          </span>
        </div>

        {/* Só o CTA — os letterings falam por si */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-4 md:p-6">
          <span
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/45 px-6 py-3 text-[11.5px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-md transition-all duration-300 group-hover:-translate-y-0.5 group-hover:border-violet/70 group-hover:bg-black/60 group-hover:shadow-[0_0_34px_-6px_rgba(167,139,250,0.9)]"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Criar legendas agora
            <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
          </span>
        </div>
      </div>
      <style jsx>{`
        .tgs-blob {
          position: absolute;
          width: 46%;
          aspect-ratio: 1;
          border-radius: 9999px;
          filter: blur(70px);
          opacity: 0.5;
          pointer-events: none;
        }
        .tgs-blob-a {
          left: -8%;
          top: -20%;
          background: radial-gradient(circle, rgba(109, 78, 232, 0.55), transparent 65%);
          animation: tgs-float-a 9s ease-in-out infinite alternate;
          transform: translate(calc(var(--px) * -22px), calc(var(--py) * -16px));
        }
        .tgs-blob-b {
          right: -10%;
          bottom: -28%;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.32), transparent 65%);
          animation: tgs-float-b 11s ease-in-out infinite alternate;
          transform: translate(calc(var(--px) * 26px), calc(var(--py) * 18px));
        }
        .tgs-beams {
          pointer-events: none;
          opacity: 0.5;
          background:
            linear-gradient(115deg, transparent 42%, rgba(167, 139, 250, 0.16) 47%, rgba(255, 255, 255, 0.05) 50%, rgba(167, 139, 250, 0.16) 53%, transparent 58%),
            linear-gradient(115deg, transparent 68%, rgba(251, 191, 36, 0.1) 74%, transparent 80%);
          background-size: 260% 100%;
          animation: tgs-sweep 7.5s ease-in-out infinite;
        }
        @keyframes tgs-sweep {
          0% { background-position: 120% 0; }
          55% { background-position: -30% 0; }
          100% { background-position: -30% 0; }
        }
        @keyframes tgs-float-a {
          from { opacity: 0.4; }
          to { opacity: 0.65; }
        }
        @keyframes tgs-float-b {
          from { opacity: 0.35; }
          to { opacity: 0.6; }
        }
      `}</style>
    </Link>
  );
}

/* ────────── SLIDE HERÓI: FAKEPRINT (transmissão full-bleed) ────────── */
/**
 * O card INTEIRO é a transmissão: repórter na chuva (imagem em alta) que
 * vira VÍDEO no hover. Zero coluna de texto — toda a copy vive no chyron
 * estilo CNN (kicker vermelho + barra branca + sub-deck + ticker), com
 * entrada animada de telejornal. O card todo é clicável → /tools/fakepass.
 */
/**
 * HERÓI DO FAMOUS HEY — vídeo em loop + inclinação 3D que segue o mouse.
 *
 * Duas diferenças de propósito em relação ao slide do FakePrint:
 *  - o vídeo roda SEMPRE, não só no hover. Aqui o movimento é o produto: um
 *    cartaz parado não mostra que a foto ganha vida.
 *  - a inclinação segue o cursor de verdade (rotateX/rotateY por variável CSS).
 *    Um `scale` no hover é barato demais pro card de abertura da página.
 *
 * `prefers-reduced-motion` desliga a inclinação: quem pediu menos movimento não
 * pode justo receber o card que mais se mexe.
 */
function FamousHeySlide() {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [semVideo, setSemVideo] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // O catch existe porque política de autoplay varia por navegador — sem ele
    // o erro vaza no console de quem tem autoplay bloqueado.
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }, []);

  function mover(e: React.MouseEvent<HTMLElement>) {
    const el = caixaRef.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    // Teto de 6°: acima disso o texto sobre o vídeo escorrega e a leitura
    // sofre — o efeito serve o card, não rouba a cena.
    el.style.setProperty('--rx', `${(-py * 6).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * 6).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
  }

  function sair() {
    const el = caixaRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  return (
    <div
      ref={caixaRef}
      onMouseMove={mover}
      onMouseLeave={sair}
      className="group relative h-full [perspective:1400px]"
      style={{ ['--rx' as string]: '0deg', ['--ry' as string]: '0deg' }}
    >
      <Link
        href="/tools/famous-hey"
        className="dark-island hero-sombra relative block h-full overflow-hidden rounded-[26px] border border-line/60 transition-transform duration-300 ease-out will-change-transform"
        style={{
          transform: 'rotateX(var(--rx)) rotateY(var(--ry))',
          transformStyle: 'preserve-3d',
        }}
      >
        <div className="absolute inset-0 transition-transform duration-[1800ms] ease-out group-hover:scale-[1.06]">
          {!semVideo ? (
            <video
              ref={videoRef}
              src="/hero/famous-hey.mp4"
              poster="/hero/famous-hey.jpg"
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              onError={() => setSemVideo(true)}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            />
          ) : (
            /* Sem o arquivo, o card segue de pé com o pôster — hero quebrado na
               primeira dobra é pior que hero parado. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src="/hero/famous-hey.jpg"
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>

        {/* Brilho seguindo o cursor — sensação de superfície física */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(420px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.16), transparent 62%)',
          }}
        />

        {/* Vinheta: o texto tem que ficar legível sobre QUALQUER frame */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(3,2,8,0.92) 0%, rgba(3,2,8,0.55) 30%, rgba(3,2,8,0.12) 56%, transparent 74%), linear-gradient(105deg, rgba(3,2,8,0.72) 0%, transparent 58%)',
          }}
        />

        {/* CONTEÚDO — pouco texto, empurrado à frente no eixo Z */}
        <div
          className="absolute inset-0 z-10 flex flex-col justify-end p-5 md:p-8"
          style={{ transform: 'translateZ(38px)' }}
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {/* data-texto alimenta o halo do ::before (mesmo texto, borrado) */}
            <span
              className="fh-lettering block text-[34px] font-black leading-none tracking-[-0.03em] sm:text-[44px] lg:text-[54px]"
              data-texto="Famous Hey"
              style={{ fontFamily: 'var(--font-display), var(--font-tech), system-ui' }}
            >
              Famous Hey
            </span>

            {/* Vermelho de plantão: mesmo tom do AO VIVO do FakePrint — é o que
                o olho lê como urgente sem precisar de texto explicando. */}
            {famousHeyGratis() ? (
              <span
                className="fh-selo inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                <span className="fh-selo-pulso h-1.5 w-1.5 rounded-full bg-white" />
                <span className="text-[13px] font-black leading-none">
                  {famousHeyDiasRestantes()}
                </span>
                <span className="text-[9px] font-black uppercase leading-none tracking-[0.16em]">
                  dia{famousHeyDiasRestantes() === 1 ? '' : 's'} grátis
                </span>
              </span>
            ) : null}
          </div>

          {/* text-shadow no lugar de drop-shadow: o filtro criava região de
              recorte começando exatamente na borda do glifo e comia o
              antialiasing da primeira letra — o "U" de Use lia como "J". */}
          <h3
            className="max-w-[17ch] text-[24px] font-black leading-[1.05] tracking-tight text-white sm:text-[30px] lg:text-[36px]"
            style={{ textShadow: '0 4px 24px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.85)' }}
          >
            Use qualquer avatar
            <br />
            <span
              style={{
                background: 'linear-gradient(100deg,#fbbf24,#f472b6 60%,#a78bfa)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              no HeyGen
            </span>
          </h3>


          <span
            className="relative mt-4 inline-flex w-fit items-center gap-2 overflow-hidden rounded-full px-5 py-2.5 text-[13px] font-bold text-white transition-transform duration-300 group-hover:-translate-y-[2px]"
            style={{
              background: 'linear-gradient(140deg,#fbbf24 0%,#f472b6 55%,#a78bfa 100%)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -2px 0 rgba(0,0,0,0.2), 0 14px 34px -12px rgba(244,114,182,0.85)',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-[130%] bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[130%]"
            />
            <span className="relative">Clique agora</span>
            <svg
              className="relative transition-transform duration-300 group-hover:translate-x-1"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h13" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </div>
      </Link>
    </div>
  );
}

function FakePrintSlide() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // O pôster só sai quando o vídeo REALMENTE começou. Escondê-lo antes disso
  // mostrava um retângulo preto em quem tem autoplay bloqueado.
  const [rodando, setRodando] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }, []);

  return (
    <Link
      href="/tools/fakepass"
      className="dark-island hero-sombra group relative block overflow-hidden rounded-[26px] border border-line/60"
    >
      {/* A medida vem da caixa canônica do carrossel (HERO_BOX) */}
      <div className="relative h-full w-full">
        {/* MÍDIA full-bleed com zoom lento no hover */}
        <div
          className="absolute inset-0 transition-transform duration-[1600ms] ease-out group-hover:scale-[1.05]"
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        >
          <video
            ref={videoRef}
            src="/hero/fakeprint-reporter.mp4"
            poster="/hero/fakeprint-reporter.jpg"
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            onPlaying={() => setRodando(true)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: '50% 26%', transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
          />
          {/* Poster em alta por cima — some no hover revelando o vídeo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/fakeprint-reporter.jpg"
            alt=""
            aria-hidden
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out ${rodando ? 'opacity-0' : 'opacity-100'}`}
            style={{ objectPosition: '50% 26%', transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
          />
        </div>

        {/* Vinheta broadcast (legibilidade) + scanlines de transmissão */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgba(2,2,6,0.88) 0%, rgba(2,2,6,0.35) 26%, transparent 48%), linear-gradient(to bottom, rgba(2,2,6,0.45) 0%, transparent 22%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 1px, transparent 1px, transparent 3px)',
          }}
        />

        {/* Topo: AO VIVO + bug + relógio real */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 md:p-5">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-[5px] bg-[#cc0000] px-2 py-1 shadow-[0_4px_18px_-4px_rgba(204,0,0,0.8)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-80" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              <span
                className="text-[10px] font-black uppercase tracking-[0.18em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Ao vivo
              </span>
            </span>
            <span
              className="hidden rounded-[5px] bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-sm sm:inline-flex"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              FakePrint · Zona de Notícias
            </span>
          </div>
          <BroadcastClock />
        </div>

        {/* CHYRON — todo o texto do card vive aqui */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-3 md:p-6">
          <div className="fps-chyron">
            {/* Tag PLANTÃO piscando */}
            <span
              className="fps-plantao mb-1.5 hidden items-center gap-1.5 rounded-[4px] sm:inline-flex bg-[#cc0000] px-2 py-0.5 text-[9.5px] font-black uppercase tracking-[0.22em] text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Plantão
            </span>

            {/* Barra principal: kicker + manchete */}
            <div className="flex items-stretch overflow-hidden rounded-t-[6px] shadow-[0_18px_44px_-12px_rgba(0,0,0,0.95)]">
              <span
                className="fps-kicker relative flex shrink-0 items-center overflow-hidden bg-[#cc0000] px-3 text-[13px] font-black uppercase tracking-[0.06em] text-white md:px-4 md:text-[16px]"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                <span className="relative z-10">Agora</span>
                <span aria-hidden className="fps-kicker-sheen absolute inset-0" />
              </span>
              <span className="fps-headline-wrap relative flex-1 overflow-hidden bg-white">
                <span
                  className="fps-headline block px-3 py-2 text-[14px] font-black uppercase leading-[1.08] tracking-tight text-[#0b0b0f] md:px-4 md:py-2.5 md:text-[21px] xl:text-[24px]"
                  style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
                >
                  AutoEdit lança manchetes de telejornal prontas pra postar
                </span>
              </span>
            </div>

            {/* Sub-deck */}
            <div className="fps-subdeck hidden items-center overflow-hidden rounded-b-[6px] bg-black/70 backdrop-blur-sm sm:flex">
              <span
                className="truncate px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/85 md:px-4 md:text-[11.5px]"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Você escreve a notícia · o FakePrint monta o print fiel ao original
              </span>
            </div>

            {/* Ticker rolando */}
            <div className="fps-ticker-row mt-1.5 flex items-stretch overflow-hidden rounded-[5px]">
              <span
                className="flex shrink-0 items-center bg-[#cc0000] px-2.5 text-[9px] font-black uppercase tracking-[0.16em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Urgente
              </span>
              <div className="relative flex-1 overflow-hidden bg-[#0a0a0e]/90 py-1.5 backdrop-blur-sm">
                <div className="fps-ticker flex w-max items-center whitespace-nowrap">
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className="px-3 text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/80"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Manchetes de CNN, Globo, Record e + · fiéis ao que vai ao
                      ar · prontas em segundos · sem Photoshop · clique pra
                      criar a sua ·
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        /* Entrada de telejornal: o bloco sobe, o kicker estala, a barra
           branca abre da esquerda pra direita, decks entram em cascata. */
        .fps-chyron {
          animation: fps-rise 640ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes fps-rise {
          from { opacity: 0; transform: translateY(26px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fps-plantao {
          animation: fps-blink 2.2s steps(1) infinite;
        }
        @keyframes fps-blink {
          0%, 72%, 100% { opacity: 1; }
          78%, 88% { opacity: 0.35; }
        }
        .fps-kicker {
          animation: fps-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 180ms both;
          transform-origin: left center;
        }
        @keyframes fps-pop {
          from { transform: scaleX(0.4); opacity: 0; }
          to { transform: scaleX(1); opacity: 1; }
        }
        .fps-kicker-sheen {
          background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
          transform: translateX(-120%);
          animation: fps-sheen 4.2s ease-in-out 1.2s infinite;
        }
        @keyframes fps-sheen {
          0% { transform: translateX(-120%); }
          32%, 100% { transform: translateX(120%); }
        }
        .fps-headline-wrap {
          animation: fps-open 720ms cubic-bezier(0.22, 1, 0.36, 1) 260ms both;
        }
        @keyframes fps-open {
          from { clip-path: inset(0 100% 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
        .fps-subdeck {
          animation: fps-rise 560ms cubic-bezier(0.22, 1, 0.36, 1) 420ms both;
        }
        .fps-ticker-row {
          animation: fps-rise 560ms cubic-bezier(0.22, 1, 0.36, 1) 560ms both;
        }
        .fps-ticker {
          animation: fps-ticker-run 22s linear infinite;
        }
        @keyframes fps-ticker-run {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fps-chyron, .fps-plantao, .fps-kicker, .fps-kicker-sheen,
          .fps-headline-wrap, .fps-subdeck, .fps-ticker-row, .fps-ticker {
            animation: none !important;
            clip-path: none !important;
          }
        }
      `}</style>
    </Link>
  );
}

/** Relógio real da transmissão (HH:MM:SS ao vivo). */
function BroadcastClock() {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="num rounded-[5px] bg-black/60 px-2 py-1 text-[11px] font-bold tabular-nums text-white/90 backdrop-blur-sm"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {now || '--:--:--'}
    </span>
  );
}

/* ────────── SLIDE 1: PILOT ────────── */
function PilotSlide({ canStartAutomation }: { canStartAutomation: boolean }) {
  return (
    <div
      className="promo-banner group relative h-full overflow-hidden rounded-[26px] border border-line/60"
      style={{
        background: 'var(--banner-bg)',
      }}
    >
      {/* Fundo cinematográfico animado (imagem + parallax + partículas + vinheta) */}
      <HeroSlideBg image="/hero/pilot-bg.jpg" />

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

      {/* Sparkles flutuantes */}
      <Sparkle className="absolute top-6 right-[30%]" delay={0} />
      <Sparkle className="absolute top-[60%] right-[18%]" delay={800} />
      <Sparkle className="absolute top-[28%] right-[8%]" delay={1600} />

      {/* Ícone piloto grande à direita, com motion 3D.
          No lg ele dá lugar à mini fila (que conta a história melhor). */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 md:block lg:hidden"
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

      {/* Mini fila do Pilot — tasks do ClickUp virando lipsync (só lg+) */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 lg:block"
      >
        <PilotMiniQueue />
      </div>

      <div className="relative z-[2] flex h-full flex-col items-start justify-center gap-6 px-7 py-10 md:flex-row md:items-center md:justify-between md:px-12 md:py-14">
        <div className="max-w-[600px]">
          <h3
            className="text-[28px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[40px] lg:text-[44px]"
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
            Conecta no seu ClickUp, lê o briefing de cada task e dispara os
            lipsyncs em fila. Você só revisa.
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
                title="Disponível no plano Premium"
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
      className="group relative h-full overflow-hidden rounded-[26px] border border-violet/30"
      style={{
        background: 'var(--banner-bg-2)',
      }}
    >
      {/* Fundo cinematográfico animado (imagem + parallax + partículas + vinheta) */}
      <HeroSlideBg image="/hero/auto-broll-bg.jpg" />

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
      {/* Sparkles */}
      <Sparkle className="absolute top-6 right-[30%]" delay={0} />
      <Sparkle className="absolute top-[60%] right-[18%]" delay={800} />
      <Sparkle className="absolute top-[28%] right-[8%]" delay={1600} />

      {/* Mini take cards animados à direita — simula B-rolls sendo gerados */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-16 top-1/2 hidden -translate-y-1/2 lg:block"
      >
        <BrollMiniGrid />
      </div>

      <div className="relative z-[2] flex h-full flex-col items-start justify-center gap-6 px-7 py-10 md:flex-row md:items-center md:justify-between md:px-12 md:py-14">
        <div className="max-w-[600px]">
          <h3
            className="text-[28px] font-extrabold leading-[1.05] tracking-tight text-white md:text-[40px] lg:text-[44px]"
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
            Cole a lista de prompts e aperte o play: roda na sua conta
            Magnific no modo Unlimited, sem crédito extra, e o ZIP cai
            pronto com os b-rolls nomeados por palavra-chave.
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
                title="Disponível no plano Premium"
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

/**
 * Mini fila do Pilot — painel ambient que mostra o que a ferramenta faz:
 * task do ClickUp entra na esteira, vira lipsync e sai pronta. Decorativo
 * (aria-hidden), sem clique, e marcado como .dark-island pro painel escuro
 * continuar escuro (com texto claro) também no modo claro.
 */
function PilotMiniQueue() {
  const rows: { code: string; state: 'done' | 'run' | 'wait' }[] = [
    { code: 'PRPB · AD07', state: 'done' },
    { code: 'VRWA · AD12', state: 'done' },
    { code: 'MEPB · AD03', state: 'run' },
    { code: 'GTWA · AD09', state: 'wait' },
  ];
  const STATE_LABEL = { done: 'Pronto', run: 'Gerando', wait: 'Na fila' };

  return (
    <div
      className="dark-island w-[272px] rounded-[16px] border border-white/12 bg-black/45 p-3 backdrop-blur-md"
      style={{ boxShadow: '0 26px 60px -24px rgba(0,0,0,0.9)' }}
    >
      {/* Cabeçalho: ClickUp conectado + contagem */}
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
          </span>
          <span
            className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/75"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Fila do Pilot
          </span>
        </span>
        <span
          className="num text-[9.5px] font-bold tabular-nums text-white/45"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          2/4
        </span>
      </div>

      {/* Tasks */}
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div
            key={r.code}
            className="relative flex items-center gap-2.5 overflow-hidden rounded-[10px] border px-2.5 py-2"
            style={{
              borderColor:
                r.state === 'done'
                  ? 'rgba(200,232,124,0.34)'
                  : r.state === 'run'
                    ? 'rgba(167,139,250,0.4)'
                    : 'rgba(255,255,255,0.1)',
              background:
                r.state === 'done'
                  ? 'linear-gradient(100deg, rgba(200,232,124,0.14), rgba(0,0,0,0.35))'
                  : r.state === 'run'
                    ? 'linear-gradient(100deg, rgba(167,139,250,0.16), rgba(0,0,0,0.35))'
                    : 'rgba(255,255,255,0.03)',
              animation: `pilotRow 620ms cubic-bezier(0.22,1,0.36,1) ${240 + i * 130}ms backwards`,
            }}
          >
            {/* Glifo de status */}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {r.state === 'done' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8e87c" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : r.state === 'run' ? (
                <span
                  className="block h-3 w-3 rounded-full border-[2px] border-violet/35"
                  style={{
                    borderTopColor: 'rgba(167,139,250,0.95)',
                    animation: 'pilotSpin 900ms linear infinite',
                  }}
                />
              ) : (
                <span className="block h-1.5 w-1.5 rounded-full bg-white/30" />
              )}
            </span>

            <span
              className="num flex-1 truncate text-[10.5px] font-bold tracking-[0.08em] text-white/85"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {r.code}
            </span>

            <span
              className="shrink-0 text-[8.5px] font-bold uppercase tracking-[0.16em]"
              style={{
                fontFamily: 'var(--font-tech)',
                color:
                  r.state === 'done'
                    ? 'rgba(200,232,124,0.9)'
                    : r.state === 'run'
                      ? 'rgba(186,166,255,0.95)'
                      : 'rgba(255,255,255,0.4)',
              }}
            >
              {STATE_LABEL[r.state]}
            </span>

            {/* Barra de progresso só na task que está gerando */}
            {r.state === 'run' ? (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/8">
                <span
                  className="block h-full bg-gradient-to-r from-violet via-violet-deep to-lime"
                  style={{ animation: 'pilotProgress 3.4s ease-in-out infinite' }}
                />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes pilotRow {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes pilotSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes pilotProgress {
          0% { width: 8%; }
          70% { width: 78%; }
          100% { width: 92%; }
        }
        @media (prefers-reduced-motion: reduce) {
          div, span { animation: none !important; }
        }
      `}</style>
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
/**
 * Card de DESTAQUE da Tipografia Automática — em vez de vídeo gravado, o
 * card roda o engine real (canvas ciclando letterings com copy). Mesmo
 * visual dos FeaturedVideoCard: título sobre a mídia, painel no hover,
 * borda conic acesa.
 */
function TipografiaFeaturedCard({ delay }: { delay: number }) {
  return (
    <div
      className="dark-island featured-card-wrap fade-in-up relative z-0 hover:z-20"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        href="/tools/tipografia"
        className="group relative block overflow-hidden rounded-[20px] border border-line/60 bg-[#0b0b0f]"
      >
        <div className="relative aspect-video w-full overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(130% 90% at 20% 0%, rgba(109,78,232,0.35), transparent 55%), radial-gradient(120% 80% at 85% 100%, rgba(251,191,36,0.14), transparent 55%), linear-gradient(170deg, #0d0b14 0%, #060509 60%, #0b0912 100%)',
            }}
          />
          <TipoShowcase variant="card" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to top, rgba(4,4,6,0.88) 2%, rgba(4,4,6,0.18) 38%, transparent 62%)' }}
          />
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3.5">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/12 bg-black/45 backdrop-blur-md transition-transform duration-500 group-hover:scale-110"
              style={{ boxShadow: '0 0 26px -4px rgba(251,191,36,0.5)' }}
            >
              <IconTipografia size={28} />
            </span>
            <span
              className="rounded-full border border-violet/35 bg-black/45 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.20em] text-violet backdrop-blur-md"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Novo · IA
            </span>
          </div>
          <h3
            className="absolute bottom-0 left-0 z-10 p-4 text-[19px] font-bold leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] transition-transform duration-300 group-hover:-translate-y-0.5"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
          >
            Legendas Automáticas
          </h3>
        </div>
        <div
          className="max-h-0 overflow-hidden opacity-0 transition-all duration-500 ease-out group-hover:max-h-[260px] group-hover:opacity-100"
          style={{ background: '#0b0b0f' }}
        >
          <div className="px-4 pb-4 pt-3.5">
            <p className="text-[12.5px] leading-relaxed text-white/80">
              A fala do vídeo vira legenda animada — transcrição palavra por
              palavra, 491 modelos, editor estilo CapCut e o MP4 renderizado
              no seu navegador.
            </p>
            <span
              className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white transition-all duration-300 group-hover:border-violet/45 group-hover:bg-white/[0.12] group-hover:shadow-[0_0_24px_-6px_rgba(167,139,250,0.7)]"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Abrir ferramenta
              <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
            </span>
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            padding: '1px',
            background:
              'conic-gradient(from var(--angle, 0deg), transparent 0%, rgba(251,191,36,0.5) 22%, transparent 50%, rgba(167,139,250,0.55) 78%, transparent 100%)',
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'card-border-spin 6s linear infinite',
          }}
        />
      </Link>
    </div>
  );
}

function FeaturedVideoCard({
  entry,
  delay,
}: {
  entry: ToolEntry;
  delay: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
        {/* VÍDEO — roda no hover. SEM zoom/scale (era o que tremia); fica
            firme e em qualidade cheia. GPU layer pra não bruxulear.
            preload="none": o poster JÁ é a capa; o .mp4 (10-20MB cada) só
            baixa no hover (quando play() dispara). Antes ("auto") os 3
            destaques baixavam ~49MB juntos no LOAD da página, sufocando a
            banda e atrasando as thumbs de todos os cards. */}
        <video
          ref={videoRef}
          src={entry.video}
          poster={entry.poster}
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', willChange: 'opacity' }}
        />
        {/* THUMB — imagem fica como capa o tempo todo; some no hover (revela
            o vídeo). Só fade de opacidade (sem scale) → zero tremor. */}
        {entry.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.poster}
            alt=""
            aria-hidden
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-500 ease-out group-hover:opacity-0"
            style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', willChange: 'opacity' }}
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

        {/* SEM cadeado/bloqueio visual nos destaques: o card é sempre bonito e
            clicável pra TODOS. O gating real é server-side (middleware):
            Premium abre a ferramenta; Free cai direto em /planos. */}
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
            Abrir ferramenta
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
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      {/* Sempre clicável pra TODOS — sem estado visual de bloqueio. O acesso
          real é decidido server-side no clique (Premium abre; Free → /planos). */}
      <Link
        href={entry.href}
        className="group relative block overflow-hidden rounded-[20px] border border-line/70 transition-all duration-300 hover:border-violet/45 hover:shadow-[0_30px_70px_-26px_rgba(0,0,0,0.95)]"
      >
        {inner}
      </Link>
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
                className={seloClasse(entry.badge)}
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
          title={isBlocked ? 'Em manutenção' : 'Disponível no plano Premium'}
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Cards de vídeo: o .mp4 fica PARADO no poster e só roda enquanto o mouse
  // está em cima (igual aos cards de Destaque). Ao tirar, pausa e volta ao 1º
  // frame. Só o HERO da ferramenta roda em loop o tempo todo.
  function playCardVideo() {
    const v = videoRef.current;
    if (!v) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  function stopCardVideo() {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  // ───────── Variante VÍDEO (suíte IA) ─────────
  // `.dark-island` mantém as vars do tema escuro mesmo no modo claro → o texto
  // branco sobre o vídeo/rodapé escuro continua legível nos 2 temas (sem o
  // override global de .text-white deixar o texto escuro e sumir no escuro).
  if (entry.video) {
    const vcls =
      'tool-card dark-island group relative flex flex-col overflow-hidden rounded-[16px] border border-line/70 transition-all duration-300 ' +
      (nonClickable
        ? 'cursor-not-allowed'
        : 'hover:-translate-y-[2px] hover:border-violet/45');
    const vstyle: React.CSSProperties = {
      animationDelay: `${delay}ms`,
      // Fundo próprio (mesmo tom do painel de descrição): quando o grid estica
      // este card pra igualar a altura de um vizinho com descrição mais longa,
      // o vão que sobrava embaixo ficava TRANSPARENTE — a borda arredondada
      // contornava o vazio e parecia "quadrado incompleto". Agora fica sólido.
      background: '#0b0b0f',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
    };
    const vbody = (
      <>
        <div className="relative aspect-video w-full shrink-0 overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background: `radial-gradient(130% 80% at 50% 8%, ${entry.hue}, transparent 60%), linear-gradient(180deg, rgb(var(--bg-softer)), #050507)`,
            }}
          />
          {/* Vídeo — parado no poster; toca só no hover. preload="none": nem
              os metadados baixam no load (poster cobre a capa) → nada de mp4
              competindo com as thumbs. Baixa sob demanda quando play() roda. */}
          <video
            ref={videoRef}
            src={entry.video}
            poster={entry.poster}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
          />
          {/* Poster por cima — some no hover revelando o vídeo (sem flash preto).
              lazy+async: como estes cards ficam abaixo da dobra, a thumb só
              carrega quando chega perto da viewport → load inicial enxuto. */}
          {entry.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.poster}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-500 ease-out group-hover:opacity-0"
              style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
            />
          ) : null}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, rgba(4,4,6,0.92) 4%, rgba(4,4,6,0.25) 42%, transparent 66%)',
            }}
          />
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/12 bg-black/45 backdrop-blur-md transition-transform duration-500 group-hover:scale-110"
              style={{ boxShadow: `0 0 24px -4px ${entry.hue}` }}
            >
              {entry.icon}
            </span>
            {entry.badge ? (
              <span
                className={
                  entry.badge === 'GRÁTIS'
                    ? 'fh-selo rounded-full border border-white/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.20em] text-white backdrop-blur-md'
                    : 'rounded-full border border-violet/35 bg-black/45 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.20em] text-violet backdrop-blur-md'
                }
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {entry.badge}
              </span>
            ) : null}
          </div>
          <h3
            className="fade-in-up absolute bottom-0 left-0 z-10 px-4 pb-2.5 text-[20px] font-extrabold leading-tight tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] transition-transform duration-300 group-hover:-translate-y-0.5"
            style={{
              fontFamily: 'var(--font-label)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              animationDelay: `${delay + 120}ms`,
            }}
          >
            {entry.label}
          </h3>
        </div>

        <div className="relative px-4 pb-3.5 pt-2.5" style={{ background: '#0b0b0f' }}>
          <p className="text-[12.5px] leading-snug text-white/75">
            {entry.description}
          </p>
        </div>

        {locked ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[2px]"
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
      </>
    );

    const vcard = nonClickable ? (
      <div
        className={vcls}
        style={vstyle}
        aria-disabled
        title={isBlocked ? 'Em manutenção' : 'Disponível no plano Premium'}
        onMouseEnter={playCardVideo}
        onMouseLeave={stopCardVideo}
      >
        {vbody}
      </div>
    ) : (
      <Link
        href={entry.href}
        className={vcls}
        style={vstyle}
        onMouseEnter={playCardVideo}
        onMouseLeave={stopCardVideo}
      >
        {vbody}
      </Link>
    );

    if (!maint) return vcard;
    return (
      <div className="relative">
        {vcard}
        <MaintenanceBadge mode={maint} className="right-3 top-3" />
      </div>
    );
  }

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
      title={isBlocked ? 'Em manutenção' : 'Disponível no plano Premium'}
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

// Mapa de path → label legível (espelha TopBar). Usado no flash de bloqueio.
// ⚠ Ferramentas de uso interno (admin-only) NÃO entram aqui — o flash cai no
// genérico "Esta ferramenta" sem revelar o nome pra cliente.
const TOOL_LABELS: Record<string, string> = {
  '/tools/decupagem-copy': 'Decupagem Inteligente',
  '/tools/lipsync': 'Lipsync Video to Video',
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
  '/tools/lipsync-history': 'Histórico de avatares',
  '/tools/background': 'Tarefas em segundo plano',
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
    need === 'admin' ? 'Admin' : need === 'pro' || need === 'basic' ? 'Premium' : null;
  const tierLabel =
    tier === 'free' ? 'FREE' : tier === 'basic' ? 'PREMIUM' : tier === 'pro' ? 'PRO' : 'ADMIN';

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
