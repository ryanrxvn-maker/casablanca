import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { PILLARS, PILLAR_SLUGS, getPillar } from '@/lib/pillars';

const SITE_URL = 'https://www.darkoautoedit.com';

/** Gera as páginas-pilar estaticamente (rápido + 100% crawlável). */
export function generateStaticParams() {
  return PILLAR_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const p = getPillar(params.slug);
  if (!p) return {};
  const url = `${SITE_URL}/recursos/${p.slug}`;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: `/recursos/${p.slug}` },
    openGraph: {
      type: 'article',
      title: p.title,
      description: p.description,
      url,
    },
    twitter: {
      card: 'summary_large_image',
      title: p.title,
      description: p.description,
    },
  };
}

/**
 * /recursos/[slug] — página-pilar de SEO.
 *
 * Server component: todo o conteúdo (intro, seções, FAQ) vai no HTML do
 * servidor, então Googlebot E crawlers de IA leem tudo sem rodar JS.
 * JSON-LD: BreadcrumbList + FAQPage (citação em IA). CTA pra /register.
 */
export default function PillarPage({ params }: { params: { slug: string } }) {
  const p = getPillar(params.slug);
  if (!p) notFound();

  const url = `${SITE_URL}/recursos/${p.slug}`;

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Recursos', item: `${SITE_URL}/recursos` },
      { '@type': 'ListItem', position: 3, name: p.kicker, item: url },
    ],
  };

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: p.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <main className="relative min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <header className="border-b border-line/50 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[820px] items-center justify-between px-5">
          <Brand href="/" />
          <Link href="/recursos" className="btn-ghost">
            ← Recursos
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-[820px] px-5 py-12 md:py-16">
        {/* Breadcrumb visível */}
        <nav className="mb-6 text-[12px] text-text-dim" aria-label="Trilha">
          <Link href="/" className="hover:text-white">
            Início
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/recursos" className="hover:text-white">
            Recursos
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-text-muted">{p.kicker}</span>
        </nav>

        <p
          className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {p.kicker}
        </p>
        <h1 className="mb-6 text-[32px] font-extrabold leading-[1.08] tracking-tight text-white md:text-[44px]">
          {p.h1}
        </h1>

        <div className="flex flex-col gap-4 text-[16px] leading-relaxed text-text-muted">
          {p.intro.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        {/* CTA topo */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/register" className="btn-primary">
            Começar grátis
          </Link>
          <Link href="/planos" className="btn-ghost">
            Ver planos
          </Link>
        </div>

        {/* Seções */}
        <div className="mt-12 flex flex-col gap-10">
          {p.blocks.map((b, i) => (
            <section key={i}>
              <h2 className="mb-3 text-[22px] font-bold tracking-tight text-white md:text-[26px]">
                {b.h2}
              </h2>
              <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-text-muted">
                {b.body.map((para, j) => (
                  <p key={j}>{para}</p>
                ))}
              </div>
              {b.list && (
                <ul className="mt-4 flex flex-col gap-2">
                  {b.list.map((li, k) => (
                    <li
                      key={k}
                      className="flex items-start gap-2.5 text-[15px] text-text-muted"
                    >
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
                      {li}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* FAQ */}
        <section className="mt-14">
          <h2 className="mb-5 text-[22px] font-bold tracking-tight text-white md:text-[26px]">
            Perguntas frequentes
          </h2>
          <div className="flex flex-col gap-3">
            {p.faq.map((item, i) => (
              <details
                key={i}
                className="group overflow-hidden rounded-[14px] border border-line/60"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.16))',
                }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                  <h3 className="text-[15px] font-semibold text-white">{item.q}</h3>
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-text-muted transition-transform duration-300 group-open:rotate-45"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="px-5 pb-5 text-[14px] leading-relaxed text-text-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Links internos relacionados */}
        <section className="mt-14 border-t border-line/50 pt-8">
          <p
            className="mb-4 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-text-dim"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Continue explorando
          </p>
          <div className="flex flex-wrap gap-3">
            {p.related.map((r) => (
              <Link
                key={r.slug}
                href={`/recursos/${r.slug}`}
                className="rounded-full border border-line/60 px-4 py-2 text-[13.5px] text-text-muted transition-colors hover:border-violet/40 hover:text-white"
              >
                {r.label} →
              </Link>
            ))}
          </div>
        </section>

        {/* CTA final */}
        <section className="mt-14 rounded-[20px] border border-line/60 p-7 text-center md:p-9">
          <h2 className="text-[22px] font-bold tracking-tight text-white md:text-[28px]">
            Liga a fila e vá dormir.
          </h2>
          <p className="mx-auto mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-text-muted">
            {p.keyword.charAt(0).toUpperCase() + p.keyword.slice(1)} e o resto do
            fluxo — decupagem, B-roll, lipsync e legendas — no automático.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="btn-primary">
              Começar grátis
            </Link>
            <Link href="/planos" className="btn-ghost">
              Ver planos
            </Link>
          </div>
        </section>
      </article>
    </main>
  );
}
