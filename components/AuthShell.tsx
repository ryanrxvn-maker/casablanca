import Link from 'next/link';
import { Brand } from './Brand';
import { SleepingRabbit } from './SleepingRabbit';
import { SpaceMockup } from './SpaceMockup';
import { SmokeText } from './SmokeText';

/**
 * AuthShell v5 — login cinematográfico com 2 animações:
 *   1. Coelho dormindo com "Zzz" subindo (SleepingRabbit)
 *   2. Mockup tipo Space gerando imagem (SpaceMockup)
 *
 * Tudo do lado esquerdo. Card do form à direita.
 * Copy nova: "Dormindo enquanto o Auto Edit trabalha".
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

      <section className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 md:py-16">
        <div className="grid w-full max-w-[1180px] grid-cols-1 items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          {/* LEFT — animação cinematográfica */}
          <div
            className="order-2 fade-in-up lg:order-1"
            style={{ animationDelay: '120ms' }}
          >
            <div
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet/35 bg-violet/10 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-violet"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.85)]" />
              ENQUANTO VOCÊ DORME
            </div>
            <h1
              className="hero-title"
              style={{
                fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
                lineHeight: 1.05,
              }}
            >
              <SmokeText text="Dormindo." className="block" />
              <span className="display-subtle block">
                <SmokeText text="O estúdio trabalha." />
              </span>
            </h1>

            {/* Cenas animadas em grid */}
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-[1.05fr_1fr]">
              <SleepingRabbit />
              <SpaceMockup />
            </div>

            <p className="mt-6 max-w-[480px] text-[14.5px] leading-relaxed text-text-muted">
              Você liga a automação, fecha o notebook e vai viver.
              <br />
              O Auto Edit cuida do resto — silencioso e fiel ao briefing.
            </p>
          </div>

          {/* RIGHT — card form */}
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
                  <p className="mt-2 text-[14.5px] text-text-muted">{subtitle}</p>
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
