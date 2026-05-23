import Link from 'next/link';
import { Brand } from './Brand';
import { DarkoLogo } from './DarkoLogo';
import { SmokeText } from './SmokeText';

/**
 * AuthShell v4 — login cinematográfico com SmokeText.
 *
 * Layout 2 colunas: narrativa à esquerda, card à direita.
 * Textos da narrativa todos com efeito smoke no hover.
 */
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
  return (
    <main className="relative flex min-h-screen flex-col">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(45% 35% at 18% 12%, rgba(167,139,250,0.15), transparent 65%),' +
            'radial-gradient(40% 30% at 84% 90%, rgba(244,114,182,0.10), transparent 65%)',
        }}
      />

      <header className="relative z-10 border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 md:px-8">
          <Brand href="/" />
          <Link href="/" className="btn-ghost">
            ← Voltar
          </Link>
        </div>
      </header>

      <section className="relative z-10 flex flex-1 items-center justify-center px-5 py-12 md:py-20">
        <div className="grid w-full max-w-[1100px] grid-cols-1 items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div
            className="order-2 fade-in-up lg:order-1"
            style={{ animationDelay: '120ms' }}
          >
            <div
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.85)]" />
              SUITE DE AUTOMAÇÃO
            </div>
            <h1
              className="hero-title"
              style={{ fontSize: 'clamp(2.25rem, 5vw, 3.75rem)', lineHeight: 1.05 }}
            >
              <SmokeText text="Liga a fila." className="block" />
              <SmokeText text="Vai dormir." className="block" />
            </h1>
            <p className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-text-muted">
              <SmokeText text="O estúdio fica acordado, editando por você." />
            </p>

            <div className="mt-12 hidden lg:block">
              <div className="relative w-fit">
                <div
                  aria-hidden
                  className="absolute inset-0 -m-8 rounded-full opacity-60 blur-3xl"
                  style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.4), transparent 65%)' }}
                />
                <div className="relative animate-float-y">
                  <DarkoLogo size={140} />
                </div>
              </div>
            </div>
          </div>

          <div
            className="order-1 lg:order-2 animate-fade-in-up"
            style={{ animationDelay: '60ms' }}
          >
            <div
              className="auth-card relative overflow-hidden rounded-[24px] border border-line/70 p-7 md:p-9"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, #15151a 0%, #0e0e10 100%)',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.06) inset, 0 36px 72px -24px rgba(0,0,0,0.95), 0 0 64px -16px rgba(167,139,250,0.22)',
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-50 blur-3xl"
                style={{ background: 'rgba(167,139,250,0.4)' }}
              />
              <div className="relative">
                <h2
                  className="text-[28px] font-extrabold tracking-tight md:text-[32px]"
                  style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-2 text-[14.5px] text-text-muted">
                    <SmokeText text={subtitle} />
                  </p>
                )}
                <div className="mt-6">{children}</div>
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
