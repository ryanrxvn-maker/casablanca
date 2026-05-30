import Link from 'next/link';
import type { Metadata } from 'next';
import { Brand } from '@/components/Brand';
import { PILLARS } from '@/lib/pillars';

const SITE_URL = 'https://www.darkoautoedit.com';

export const metadata: Metadata = {
  title: 'Recursos — automação de edição de vídeo',
  description:
    'Guias do Auto Edit: decupagem automática, remover legenda de vídeo, lipsync em lote e B-roll automático. Aprenda a editar no automático e em lote.',
  alternates: { canonical: '/recursos' },
  openGraph: {
    title: 'Recursos · Auto Edit',
    description:
      'Decupagem automática, remover legenda, lipsync em lote e B-roll automático — guias práticos.',
    url: `${SITE_URL}/recursos`,
  },
};

/**
 * /recursos — hub que linka todas as páginas-pilar (internal linking).
 * Distribui autoridade pras spokes e dá um ponto de entrada por tema.
 */
export default function RecursosHub() {
  return (
    <main className="relative min-h-screen">
      <header className="border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between px-5">
          <Brand href="/" />
          <Link href="/" className="btn-ghost">
            ← Início
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[960px] px-5 py-12 md:py-16">
        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Recursos
        </p>
        <h1 className="mb-3 text-[32px] font-extrabold tracking-tight text-white md:text-[44px]">
          Edição de vídeo no automático
        </h1>
        <p className="mb-10 max-w-[640px] text-[15px] leading-relaxed text-text-muted">
          Guias diretos de cada parte do fluxo que o Auto Edit automatiza — em
          lote e no navegador.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <Link
              key={p.slug}
              href={`/recursos/${p.slug}`}
              className="group rounded-[18px] border border-line/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-violet/40"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.022), rgba(0,0,0,0.16)), linear-gradient(180deg, #15151a, #0e0e10)',
              }}
            >
              <div
                className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-text-dim"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {p.kicker}
              </div>
              <h2
                className="text-[18px] font-bold tracking-tight text-white transition-colors group-hover:text-violet"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
              >
                {p.h1}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                {p.intro[0]}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
