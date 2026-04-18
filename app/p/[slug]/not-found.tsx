import Link from 'next/link';
import { Brand } from '@/components/Brand';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="container-app flex h-16 items-center">
          <Brand href="/" />
        </div>
      </header>
      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="text-center">
          <div className="mono mb-4 text-xs uppercase tracking-widest text-text-muted">
            404
          </div>
          <h1 className="section-title">Portfolio não encontrado</h1>
          <p className="mt-3 max-w-sm text-sm text-text-muted">
            O link pode estar errado ou o portfolio foi definido como privado pelo editor.
          </p>
          <Link href="/" className="btn-secondary mt-6 inline-flex">
            Voltar
          </Link>
        </div>
      </section>
    </main>
  );
}
