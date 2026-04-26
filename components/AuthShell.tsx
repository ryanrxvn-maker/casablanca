import { Brand } from './Brand';
import { Tilt3D } from './Tilt3D';

/**
 * Shell visual compartilhado entre login, registro e recuperar senha.
 * Centraliza o card em tela cheia com fundo estilo Ora. O card tem tilt 3D
 * sutil (4 graus) que responde ao mouse — da sensacao de presenca fisica
 * sem atrapalhar o preenchimento do form.
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
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md animate-fade-in-up">
          <Tilt3D max={4} scale={false}>
            <div className="card-3d card-pad tech-frame">
              <h1 className="section-title">{title}</h1>
              {subtitle && (
                <p className="mt-2 text-sm text-text-muted">{subtitle}</p>
              )}
              <div className="mt-6">{children}</div>
            </div>
          </Tilt3D>
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
