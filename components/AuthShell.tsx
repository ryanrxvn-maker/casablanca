import { Brand } from './Brand';
import { Tilt3D } from './Tilt3D';

/**
 * AuthShell v2 — login com profundidade cinematica.
 *
 * Layout em duas colunas no desktop:
 *  - Esquerda  → identidade da marca + frase editorial (Instrument Serif italic)
 *  - Direita   → card com form, tilt 3D sutil, glow ambiente
 *
 * Mobile: stack vertical, card centralizado.
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
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-line/60 backdrop-blur-md">
        <div className="container-app flex h-16 items-center justify-between">
          <Brand href="/" />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12 md:py-16">
        <div className="grid w-full max-w-[1080px] grid-cols-1 items-center gap-12 lg:grid-cols-2">
          {/* COL ESQUERDA — narrativa */}
          <div className="order-2 lg:order-1 fade-in-up" style={{ animationDelay: '120ms' }}>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-bg-soft/60 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.20em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
              <span className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.7)]" />
              ACESSO RESTRITO
            </div>
            <h1 className="hero-title">
              Suite criativa<br />
              <span className="display-subtle">
                pra quem <span className="text-violet">edita.</span>
              </span>
            </h1>
            <p className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-text-muted">
              Corte, monte e entregue. Sem volta pra ferramenta antiga.
            </p>
          </div>

          {/* COL DIREITA — card */}
          <div className="order-1 lg:order-2 animate-fade-in-up">
            <Tilt3D max={5} scale={false}>
              <div className="card-3d card-pad tech-frame">
                <h2
                  className="text-2xl font-extrabold tracking-tight md:text-3xl"
                  style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-2 text-sm text-text-muted">{subtitle}</p>
                )}
                <div className="mt-6">{children}</div>
              </div>
            </Tilt3D>
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
