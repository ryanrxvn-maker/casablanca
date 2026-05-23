'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCalculadora,
  IconCamuflagem,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconLtxVideo,
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
    label: 'Crie B-roll no ritmo do vídeo',
    description: 'A IA escuta seu vídeo e monta cortes que entram no tempo certo.',
    icon: <IconAutoBroll size={28} />,
    hue: 'rgba(240, 171, 252, 0.45)',
    badge: 'IA',
  },
  {
    href: '/tools/troca-produto',
    label: 'Troque o produto sem regravar',
    description: 'Mantém a cena, troca o que aparece nas mãos.',
    icon: <IconTrocaProduto size={28} />,
    hue: 'rgba(244, 114, 182, 0.45)',
    badge: 'IA',
  },
  {
    href: '/tools/heygen-auto',
    label: 'Avatar que fala pra você',
    description: 'Escreva o roteiro e receba o vídeo pronto com o seu avatar.',
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
    description: 'Divide o áudio em pedaços por pausas.',
    icon: <IconAudioSplit size={26} />,
    hue: 'rgba(34, 211, 238, 0.4)',
  },
  {
    href: '/tools/acelerador',
    label: 'Acelerador',
    description: 'Acelera o vídeo na velocidade que você quiser.',
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
  {
    href: '/tools/calculadora',
    label: 'Calculadora',
    description: 'Calcula prazos, entregas e métricas da edição.',
    icon: <IconCalculadora size={26} />,
    hue: 'rgba(148, 163, 184, 0.4)',
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
    description: 'Substitui o produto na cena.',
    icon: <IconTrocaProduto size={26} />,
    hue: 'rgba(244, 114, 182, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/remover-elementos',
    label: 'Remover legenda',
    description: 'Apaga a legenda gravada sem deixar marca.',
    icon: <IconRemoverElementos size={26} />,
    hue: 'rgba(244, 114, 182, 0.42)',
    badge: 'IA',
    adminOnly: true,
  },
  {
    href: '/tools/decupagem-copy',
    label: 'Decupagem por roteiro',
    description: 'Compara o que foi dito com o roteiro.',
    icon: <IconDecupageCopy size={26} />,
    hue: 'rgba(232, 121, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/copy-srt',
    label: 'Roteiro vira legenda',
    description: 'Transforma seu texto em legenda pronta.',
    icon: <IconCopySRT size={26} />,
    hue: 'rgba(196, 181, 253, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/heygen-auto',
    label: 'Avatar automático',
    description: 'Gera vídeo do seu avatar falando o roteiro.',
    icon: <IconHeyGenAuto size={26} />,
    hue: 'rgba(103, 232, 249, 0.42)',
    badge: 'IA',
  },
  {
    href: '/tools/ltx-video',
    label: 'Vídeo do zero',
    description: 'Cria um vídeo curto a partir de uma ideia.',
    icon: <IconLtxVideo size={26} />,
    hue: 'rgba(251, 191, 36, 0.42)',
    badge: 'IA',
    adminOnly: true,
  },
];

export function ToolsHub() {
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
      {/* Saudação + descrição */}
      <section className="mb-8 animate-fade-in-up">
        <div
          className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.8)]" />
          <span>DARKO LAB</span>
        </div>
        <h1 className="hero-title">
          {greeting}{firstName ? `, ${firstName}` : ''}.
          <br />
          <span className="display-subtle text-3xl md:text-5xl">
            O que vamos editar hoje?
          </span>
        </h1>
      </section>

      {/* Banner promocional / destaque (estilo HeyGen) */}
      <PromoBanner />

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
            <FeaturedCard key={it.href} entry={it} delay={140 + i * 60} />
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
            <ToolCard key={it.href} entry={it} delay={i * 35} />
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
            <ToolCard key={it.href} entry={it} delay={i * 35} />
          ))}
        </div>
      </section>

      {/* Rodapé editorial */}
      <section className="mt-20 mb-6 text-center">
        <p className="display-subtle text-lg md:text-xl">
          Feito por quem edita.
        </p>
        <p className="mt-1 text-[13px] text-text-muted">
          DARKO LAB · {new Date().getFullYear()}
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

function PromoBanner() {
  return (
    <div
      className="promo-banner relative overflow-hidden rounded-[20px] border border-line/60 fade-in-up"
      style={{
        animationDelay: '80ms',
        background:
          'linear-gradient(120deg, rgba(167,139,250,0.18) 0%, rgba(244,114,182,0.12) 45%, rgba(103,232,249,0.10) 100%), linear-gradient(180deg, #15151a, #0e0e10)',
      }}
    >
      <div className="absolute inset-0 opacity-50" style={{ background: 'radial-gradient(60% 80% at 0% 50%, rgba(167,139,250,0.3), transparent 60%)' }} />
      <div className="absolute inset-0 opacity-50" style={{ background: 'radial-gradient(60% 80% at 100% 50%, rgba(244,114,182,0.22), transparent 60%)' }} />
      <div className="relative flex flex-col items-start gap-4 px-6 py-7 md:flex-row md:items-center md:justify-between md:px-8">
        <div>
          <div
            className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-white" />
            Novo
          </div>
          <h3
            className="text-2xl font-extrabold tracking-tight text-white md:text-[28px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
          >
            Mais agilidade pro seu fluxo.
          </h3>
          <p className="mt-1 max-w-[520px] text-[13.5px] text-white/70">
            B-roll automático, troca de produto e avatar — tudo em um lugar.
          </p>
        </div>
        <Link
          href="/tools/auto-broll"
          className="btn-glass-light inline-flex items-center gap-2"
        >
          <span>Conhecer</span>
          <span className="text-base">→</span>
        </Link>
      </div>
    </div>
  );
}

function FeaturedCard({
  entry,
  delay,
}: {
  entry: ToolEntry;
  delay: number;
}) {
  return (
    <Link
      href={entry.href}
      className="featured-card fade-in-up group relative block overflow-hidden rounded-[18px] border border-line/70 p-5 md:p-6"
      style={{
        animationDelay: `${delay}ms`,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a, #0e0e10)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-70 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: entry.hue }}
      />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-white/8 bg-black/35 backdrop-blur-md transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-[6deg]"
            style={{
              boxShadow: `0 0 28px -4px ${entry.hue}, inset 0 1px 0 rgba(255,255,255,0.1)`,
            }}
          >
            {entry.icon}
          </span>
          {entry.badge ? (
            <span
              className="rounded-full border border-white/15 bg-black/30 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/85"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {entry.badge}
            </span>
          ) : null}
        </div>
        <h3
          className="text-[17px] font-bold leading-snug tracking-tight text-white"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
        >
          {entry.label}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
          {entry.description}
        </p>
        <div className="mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-dim transition-all duration-300 group-hover:text-white" style={{ fontFamily: 'var(--font-tech)' }}>
          <span>Abrir</span>
          <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </div>
      </div>
    </Link>
  );
}

function ToolCard({ entry, delay }: { entry: ToolEntry; delay: number }) {
  return (
    <Link
      href={entry.href}
      className="tool-card group relative block overflow-hidden rounded-[16px] border border-line/70 p-4 transition-all duration-300 hover:-translate-y-[2px] hover:border-violet/45 md:p-5"
      style={{
        animationDelay: `${delay}ms`,
        background: 'linear-gradient(180deg, #15151a 0%, #0e0e10 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-80"
        style={{ background: entry.hue }}
      />
      <div className="relative flex items-start gap-3">
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
    </Link>
  );
}
