import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Landing } from '@/components/Landing';
import { FAQ } from '@/lib/faq';

/**
 * `/` — quando logado: vai pro hub. Quando não: landing pública.
 */

/**
 * FAQPage JSON-LD (server-rendered) — só na home.
 * Google não dá mais rich result de FAQ pra site comercial, mas o markup
 * AJUDA a citação em ChatGPT / Perplexity / AI Overviews (que leem o HTML
 * sem rodar JS). Conteúdo idêntico ao acordeão visível (lib/faq.ts).
 */
const FAQ_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/tools');
  }
  return (
    <>
      <script
        type="application/ld+json"
        // JSON estático (sem input de usuário) — seguro.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }}
      />
      <Landing />
    </>
  );
}
