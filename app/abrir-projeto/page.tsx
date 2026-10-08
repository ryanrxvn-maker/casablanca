import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { AbrirProjetoCliente } from './cliente';

/**
 * /abrir-projeto — o app Auto Edit Abrir (08.10). Público: o instalador abre
 * esta página no fim (`?instalado=1`) no navegador padrão, que pode nem estar
 * logado — e é ela que liga o "abrir direto" no Pilot deste navegador.
 */
export const metadata = {
  title: 'Auto Edit Abrir',
  description: 'Abra o projeto editável do Auto Edit direto no CapCut ou no Premiere, com 1 clique.',
  alternates: { canonical: '/abrir-projeto' },
  robots: { index: false },
};

export default function AbrirProjetoPage() {
  return (
    <main className="relative min-h-screen">
      <header className="border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[820px] items-center justify-between px-5">
          <Brand href="/" />
          <Link href="/tools/clickup-pilot" className="btn-ghost">
            Abrir o Pilot
          </Link>
        </div>
      </header>
      <AbrirProjetoCliente />
    </main>
  );
}
