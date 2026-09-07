import Link from 'next/link';
import { Brand } from '@/components/Brand';

/**
 * 404 — pagina nao encontrada.
 *
 * Mantém a estética DARKO LAB com o coelho e wordmark, e oferece
 * um caminho de volta pras ferramentas (ou login se nao autenticado).
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="container-app flex h-16 items-center justify-between">
          <Brand href="/" />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="fade-in-up w-full max-w-md text-center">
          <div className="mono text-[10rem] font-bold leading-none text-lime/20 select-none">
            404
          </div>
          <h1 className="section-title mt-2">Pagina perdida no tempo</h1>
          <p className="mt-3 text-sm text-text-muted">
            Esse endereço nao existe — ou o coelho ja levou pra outra
            dimensao. Volte pras ferramentas e siga o fluxo.
          </p>

          <div className="mt-8 flex justify-center gap-3">
            <Link href="/tools" className="btn-primary">
              Ir para as ferramentas
            </Link>
            <Link href="/login" className="btn-secondary">
              Entrar
            </Link>
          </div>

          <div className="mono mt-10 text-[10px] uppercase tracking-widest text-text-dim">
            DARKO_LAB · err · 404 · path_not_found
          </div>
        </div>
      </section>
    </main>
  );
}
