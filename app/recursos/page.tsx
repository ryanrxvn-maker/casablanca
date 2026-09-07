import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/redesign/SiteHeader';
import { SiteFooter } from '@/components/redesign/SiteFooter';
import { PILLARS } from '@/lib/pillars';

const SITE_URL = 'https://www.darkoautoedit.com';

export const metadata: Metadata = {
  title: 'Recursos — automação de edição de vídeo',
  description:
    'Guias do Auto Edit: decupagem automática, lipsync de avatar e legendas alinhadas à copy. Aprenda a editar no automático e em lote.',
  alternates: { canonical: '/recursos' },
  openGraph: {
    title: 'Recursos · Auto Edit',
    description:
      'Decupagem automática, lipsync de avatar e legendas alinhadas à copy — guias práticos.',
    url: `${SITE_URL}/recursos`,
  },
};

/**
 * /recursos — hub que linka todas as páginas-pilar (internal linking).
 * Distribui autoridade pras spokes e dá um ponto de entrada por tema.
 */
export default function RecursosHub() {
 return <main className="ae-resources"><SiteHeader/><section className="ae-container ae-section"><div className="ae-section-heading"><h1>Conheça melhor<br/><span>cada etapa da edição.</span></h1><p>Guias para aproveitar as ferramentas do Auto Edit no seu dia a dia.</p></div><div className="ae-resource-list">{PILLARS.map(p=><Link href={'/recursos/'+p.slug} key={p.slug}><span>{p.kicker}</span><div><h2>{p.h1}</h2><p>{p.intro[0]}</p></div><span aria-hidden>↗</span></Link>)}</div></section><SiteFooter/></main>;
}
