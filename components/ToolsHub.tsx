'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AI_SUITE, BASE_SUITE } from './ToolsNav';
import { IconSparkle, IconWrench } from './ToolIcons';
import { Tilt3D } from './Tilt3D';

/**
 * ToolsHub — landing /tools.
 *
 * Mostra todo o catalogo dividido em dois suites com cards 3D animados.
 * Copy ultra-minima: um verbo, uma frase italica de apoio. Sem termos
 * tecnicos.
 *
 * Animacao: cards entram com stagger (delay incremental), aplicam tilt 3D
 * no mouse, ganham conic-glow no hover.
 */
const COPY: Record<string, { headline: string; tag: string }> = {
  // Base
  '/tools/decupagem': { headline: 'Corta silêncios.', tag: 'Vídeo / Áudio' },
  '/tools/camuflagem': { headline: 'Burla detecção de IA.', tag: 'Áudio' },
  '/tools/downloader': { headline: 'Baixa qualquer vídeo.', tag: 'Web' },
  '/tools/compressor': { headline: 'Reduz o peso.', tag: 'Vídeo' },
  '/tools/audio-split': { headline: 'Separa as vozes.', tag: 'Áudio' },
  '/tools/acelerador': { headline: 'Acelera o corte.', tag: 'Vídeo' },
  '/tools/normalizador': { headline: 'Iguala o volume.', tag: 'Áudio' },
  '/tools/take-splitter': { headline: 'Divide as takes.', tag: 'Vídeo' },
  '/tools/calculadora': { headline: 'Calcula a entrega.', tag: 'Operacional' },
  // AI
  '/tools/auto-broll': { headline: 'B-roll no ritmo.', tag: 'Vídeo' },
  '/tools/troca-produto': { headline: 'Troca o produto.', tag: 'Vídeo' },
  '/tools/remover-elementos': { headline: 'Apaga a legenda.', tag: 'Vídeo' },
  '/tools/decupagem-copy': { headline: 'Decupa pelo texto.', tag: 'Vídeo' },
  '/tools/copy-srt': { headline: 'Texto vira legenda.', tag: 'Texto' },
  '/tools/heygen-auto': { headline: 'Avatar fala sozinho.', tag: 'Vídeo' },
  '/tools/ltx-video': { headline: 'Gera vídeo do zero.', tag: 'Vídeo' },
};

function copyFor(href: string) {
  return COPY[href] ?? { headline: '', tag: '' };
}

export function ToolsHub() {
  const [isAdmin, setIsAdmin] = useState(false);

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
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {
        /* sem admin = sem itens admin */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const baseItems = BASE_SUITE.filter((it) => !it.adminOnly || isAdmin);
  const aiItems = AI_SUITE.filter((it) => !it.adminOnly || isAdmin);

  return (
    <div className="animate-fade-in-up">
      {/* HERO */}
      <section className="mb-12 md:mb-16">
        <div className="max-w-[760px]">
          <div className="mb-4 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_10px_rgba(167,139,250,0.8)]" />
            <span>DARKO LAB</span>
            <span className="text-text-dim">·</span>
            <span className="text-text-dim">Suite criativa</span>
          </div>
          <h1 className="hero-title">
            <span className="kinetic-text inline-block">
              <span style={{ animationDelay: '0ms' }}>Edita</span>
              <span style={{ animationDelay: '90ms' }}>&nbsp;</span>
              <span style={{ animationDelay: '120ms' }}>mais</span>
              <span style={{ animationDelay: '160ms' }}>&nbsp;</span>
              <span style={{ animationDelay: '200ms' }}>rápido,</span>
            </span>
            <br />
            <span className="display-subtle text-3xl md:text-5xl">
              <span className="kinetic-text inline-block" style={{ animationDelay: '320ms' }}>
                <span style={{ animationDelay: '320ms' }}>com mais </span>
                <span style={{ animationDelay: '380ms' }} className="text-violet">presença.</span>
              </span>
            </span>
          </h1>
          <p
            className="mt-5 max-w-[520px] text-[15px] leading-relaxed text-text-muted fade-in-up"
            style={{ animationDelay: '480ms' }}
          >
            Tudo o que você precisa pra cortar, montar e entregar. Em um só lugar.
          </p>
        </div>
      </section>

      {/* BASE SUITE */}
      <SectionHeader
        icon={<IconWrench size={18} />}
        label="BASE"
        title="Trabalho diário"
        sub="A base de qualquer entrega."
        accent="lime"
        count={baseItems.length}
      />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {baseItems.map((it, i) => (
          <ToolCard
            key={it.href}
            href={it.href}
            label={it.label}
            icon={it.icon}
            headline={copyFor(it.href).headline}
            tag={copyFor(it.href).tag}
            accent="lime"
            delay={i * 50}
          />
        ))}
      </div>

      {/* AI SUITE */}
      <div className="mt-16">
        <SectionHeader
          icon={<IconSparkle size={18} />}
          label="AI"
          title="Aceleração inteligente"
          sub="Pra quem quer ir além do manual."
          accent="violet"
          count={aiItems.length}
        />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {aiItems.map((it, i) => (
            <ToolCard
              key={it.href}
              href={it.href}
              label={it.label}
              icon={it.icon}
              headline={copyFor(it.href).headline}
              tag={copyFor(it.href).tag}
              accent="violet"
              delay={i * 50}
              isPremium
            />
          ))}
        </div>
      </div>

      <div className="mt-20 mb-4 flex items-center justify-center">
        <div className="text-center">
          <p className="display-subtle text-base md:text-lg">
            Feito por quem edita. Pra quem entrega.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────── components internos ────────────────── */

function SectionHeader({
  icon,
  label,
  title,
  sub,
  accent,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  sub: string;
  accent: 'lime' | 'violet';
  count: number;
}) {
  const accentColor = accent === 'lime' ? 'var(--lime)' : 'var(--violet)';
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div
          className="mb-2 inline-flex items-center gap-2 rounded-full border bg-bg-soft/60 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em]"
          style={{
            fontFamily: 'var(--font-tech)',
            color: accentColor,
            borderColor:
              accent === 'lime'
                ? 'rgba(200,255,0,0.32)'
                : 'rgba(167,139,250,0.32)',
            backgroundColor:
              accent === 'lime'
                ? 'rgba(200,255,0,0.06)'
                : 'rgba(167,139,250,0.06)',
          }}
        >
          <span style={{ color: accentColor }}>{icon}</span>
          {label}
        </div>
        <h2 className="section-title">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{sub}</p>
      </div>
      <div
        className="mono flex items-baseline gap-2 text-text-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        <span
          className="text-[28px] leading-none"
          style={{ color: accentColor }}
        >
          {String(count).padStart(2, '0')}
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em]">
          ferramentas
        </span>
      </div>
    </div>
  );
}

function ToolCard({
  href,
  label,
  icon,
  headline,
  tag,
  accent,
  delay,
  isPremium,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  headline: string;
  tag: string;
  accent: 'lime' | 'violet';
  delay: number;
  isPremium?: boolean;
}) {
  const accentColor = accent === 'lime' ? 'var(--lime)' : 'var(--violet)';
  return (
    <div
      className="fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Tilt3D max={5} scale={false}>
        <Link
          href={href}
          aria-label={label}
          className="card-tool group block h-full p-5 md:p-6"
        >
          <div className="flex items-start justify-between">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-[14px] border transition-all duration-300 group-hover:scale-110"
              style={{
                color: accentColor,
                borderColor:
                  accent === 'lime'
                    ? 'rgba(200,255,0,0.28)'
                    : 'rgba(167,139,250,0.32)',
                background:
                  accent === 'lime'
                    ? 'rgba(200,255,0,0.05)'
                    : 'rgba(167,139,250,0.06)',
                boxShadow:
                  accent === 'lime'
                    ? '0 0 18px -6px rgba(200,255,0,0.4)'
                    : '0 0 18px -6px rgba(167,139,250,0.45)',
              }}
            >
              <span className="[&>svg]:h-6 [&>svg]:w-6">{icon}</span>
            </span>
            <div className="flex items-center gap-1.5">
              {isPremium ? (
                <span className="pill-violet text-[9px]">AI</span>
              ) : null}
              <span
                className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-text-dim"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {tag}
              </span>
            </div>
          </div>

          <div className="mt-5">
            <div
              className="text-[17px] font-bold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {label}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              {headline}
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-line/60 pt-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim group-hover:text-white transition-colors duration-200" style={{ fontFamily: 'var(--font-tech)' }}>
              Abrir
            </span>
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-text-dim transition-all duration-300 group-hover:translate-x-0.5 group-hover:border-violet group-hover:text-violet"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              →
            </span>
          </div>
        </Link>
      </Tilt3D>
    </div>
  );
}
