import { Brand } from './Brand';

/**
 * Shell visual compartilhado entre login, registro e recuperar senha.
 * Centraliza o card em tela cheia com fundo estilo Ora.
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
      <header className="border-b border-line">
        <div className="container-app flex h-16 items-center justify-between">
          <Brand href="/" />
          <span className="badge-online hidden sm:inline-flex">Online</span>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="card card-pad">
            <h1 className="section-title">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm text-text-muted">{subtitle}</p>
            )}
            <div className="mt-6">{children}</div>
          </div>
          {footer && (
            <div className="mt-6 text-center text-sm text-text-muted">
              {footer}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
