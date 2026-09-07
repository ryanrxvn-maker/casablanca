'use client';

/**
 * AuthShell v8 — o palco das ferramentas.
 *
 * Mesma direção da landing v3 (components/landing/v3): tarja de edição no topo,
 * cabeçalho de jornal e, do lado esquerdo, o SHOWCASE — um banner temático por
 * ferramenta (Legendas Automáticas, Decupagem, FakePrint, Camuflagem), cada um
 * com a cena animada real e a própria copy, trocando de 6 em 6 segundos. O
 * formulário fica à direita, com fio vermelho de retranca.
 *
 * A API é a mesma de sempre (title, subtitle, children, footer), então todas as
 * telas de auth — login, cadastro, recuperar senha, verificar email/telefone —
 * herdam o novo visual sem mudar uma linha.
 */

import Link from 'next/link';
import { DarkoLogo } from './DarkoLogo';
import { AuthShowcase } from './AuthShowcase';
import { useClock, useToday } from './landing/v3/kit';

const RED = '#e0483f';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const today = useToday();
  const clock = useClock();

  return (
    <main className="relative flex min-h-screen flex-col">
      {/* calor ambiente — mesmo da landing, bem sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(40% 32% at 12% 8%, rgba(224,72,63,0.06), transparent 65%),' +
            'radial-gradient(34% 30% at 86% 92%, rgba(167,139,250,0.07), transparent 65%)',
        }}
      />
      {/* tarja de edição */}
      <div className="border-b border-white/8 bg-black/30">
        <div
          className="mx-auto flex h-8 max-w-[1180px] items-center justify-between px-5 text-[9.5px] uppercase tracking-[0.22em] text-white/35 md:px-8"
          style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
        >
          <span className="truncate">{today || 'Edição digital'}</span>
          <span className="hidden md:inline">Acesso à suíte</span>
          <span className="num tracking-[0.16em]" style={{ fontFamily: 'var(--font-mono)' }}>
            {clock}
          </span>
        </div>
      </div>

      {/* cabeçalho */}
      <header className="border-b border-white/8">
        <div className="mx-auto flex h-[62px] max-w-[1180px] items-center justify-between px-5 md:px-8">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Auto Edit">
            <span className="transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
              <DarkoLogo size={30} />
            </span>
            <span
              className="text-[19px] leading-none text-white"
              style={{ fontFamily: 'var(--font-serif)', letterSpacing: '0.01em' }}
            >
              Auto Edit
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-[8px] px-3 py-2 text-[12.5px] font-semibold text-white/60 transition-colors hover:text-white"
          >
            ← Voltar
          </Link>
        </div>
      </header>

      <section className="relative flex flex-1 items-center justify-center px-5 py-10 md:px-8 md:py-14">
        <div className="grid w-full max-w-[1180px] grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_420px] lg:gap-16">
          {/* ESQUERDA — o palco das ferramentas */}
          <div className="order-2 lg:order-1">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="block h-[15px] w-[3px] rounded-[1px]"
                style={{ background: RED, boxShadow: `0 0 14px -2px ${RED}` }}
              />
              <span
                className="text-[10px] uppercase tracking-[0.26em] text-white/55"
                style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
              >
                A suíte do editor
              </span>
            </div>

            <h2
              className="mt-4 max-w-[560px] text-[24px] leading-[1.12] text-white md:text-[28px]"
              style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.005em' }}
            >
              Tudo que agiliza o seu dia de edição,{' '}
              <span className="text-white/60">num lugar só.</span>
            </h2>

            <div className="mt-6 max-w-[640px]">
              <AuthShowcase />
            </div>

            <div
              className="mt-8 flex max-w-[640px] flex-wrap items-center gap-x-6 gap-y-2.5 text-[10px] uppercase tracking-[0.16em] text-text-dim"
              style={{ fontFamily: 'var(--font-label)', fontWeight: 600 }}
            >
              <span className="flex items-center gap-2">
                <i
                  className="inline-block h-[5px] w-[5px] rounded-full"
                  style={{ background: 'rgb(var(--lime))', boxShadow: '0 0 8px rgb(var(--lime))' }}
                />
                Sem cartão pra começar
              </span>
              <span className="flex items-center gap-2">
                <i
                  className="inline-block h-[5px] w-[5px] rounded-full"
                  style={{ background: 'rgb(var(--violet))', boxShadow: '0 0 8px rgb(var(--violet))' }}
                />
                Roda no navegador
              </span>
              <span className="flex items-center gap-2">
                <i
                  className="inline-block h-[5px] w-[5px] rounded-full"
                  style={{ background: 'rgb(var(--cyan))', boxShadow: '0 0 8px rgb(var(--cyan))' }}
                />
                Cancela quando quiser
              </span>
            </div>
          </div>

          {/* DIREITA — formulário */}
          <div className="order-1 w-full lg:order-2">
            <div
              className="auth-card relative overflow-hidden rounded-[16px] border border-white/12 p-7 md:p-8"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.2)), linear-gradient(180deg, rgb(var(--bg-softer)) 0%, rgb(var(--bg-soft)) 100%)',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.06) inset, 0 40px 80px -30px rgba(0,0,0,0.95)',
              }}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[3px]"
                style={{ background: RED }}
              />
              <div className="relative">
                <h1
                  className="text-[30px] leading-[1.02] text-white md:text-[34px]"
                  style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.005em' }}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-2 text-[14px] leading-relaxed text-text-muted">{subtitle}</p>
                )}
                <div className="mt-7">{children}</div>
              </div>
            </div>

            {footer && (
              <div className="mt-5 text-center text-[13px] leading-relaxed text-text-muted">
                {footer}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
