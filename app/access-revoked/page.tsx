import Link from 'next/link';
import { Brand } from '@/components/Brand';

export const metadata = {
  title: 'Acesso revogado · DARKO LAB',
};

export default function AccessRevokedPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="container-app flex h-16 items-center justify-between">
          <Brand href="/" />
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="fade-in-up w-full max-w-md text-center">
          <div className="mono text-[6rem] font-bold leading-none text-red-300/30 select-none">
            403
          </div>
          <h1 className="section-title mt-2">Acesso indisponível</h1>
          <p className="mt-3 text-sm text-text-muted">
            Sua conta nao tem permissao ativa pra acessar esta beta. Se voce
            acredita que isso e um engano, entre em contato com o
            administrador.
          </p>

          <div className="mt-8 flex justify-center">
            <Link href="/login" className="btn-secondary">
              Voltar para o login
            </Link>
          </div>

          <div className="mono mt-10 text-[10px] uppercase tracking-widest text-text-dim">
            DARKO_LAB · err · 403 · access_not_granted
          </div>
        </div>
      </section>
    </main>
  );
}
