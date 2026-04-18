import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Brand } from '@/components/Brand';
import { PublicPortfolioTabs } from './tabs';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

export default async function PublicPortfolio({ params }: Params) {
  const supabase = createClient();

  // Usa RPC security-definer (003_privacy_hardening.sql) em vez de ler
  // profiles direto. A funcao retorna apenas colunas seguras (sem email)
  // e so devolve row se portfolio_public = true.
  const { data: rpcData } = await supabase.rpc('get_public_profile_by_slug', {
    s: params.slug,
  });
  const profile =
    Array.isArray(rpcData) && rpcData.length > 0
      ? (rpcData[0] as {
          id: string;
          name: string | null;
          avatar_url: string | null;
          portfolio_slug: string;
          portfolio_public: boolean;
        })
      : null;

  if (!profile) notFound();

  const [{ data: items }, { data: proofs }] = await Promise.all([
    supabase
      .from('portfolio_items')
      .select('id, title, category, niche, video_url, thumbnail_url, "order"')
      .eq('user_id', profile.id)
      .order('order', { ascending: true }),
    supabase
      .from('social_proofs')
      .select('id, image_url, caption')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false }),
  ]);

  const videos = items ?? [];
  const results = proofs ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="container-app flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Brand href={`/p/${profile.portfolio_slug}`} />
            <span className="hidden text-xs uppercase tracking-widest text-text-muted md:inline">
              Portfolio
            </span>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold">
              {profile.name ?? 'Editor'}
            </div>
          </div>
        </div>
      </header>

      <main className="container-app flex-1 py-12">
        <div className="mb-10 animate-fade-in-up">
          <h1 className="text-3xl font-black tracking-tight md:text-5xl">
            {profile.name ?? 'Editor'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-text-muted">
            Portfolio profissional — trabalhos selecionados e resultados de clientes.
          </p>
        </div>

        <PublicPortfolioTabs videos={videos} proofs={results} />
      </main>

      <footer className="border-t border-line">
        <div className="container-app flex h-14 items-center justify-center text-xs text-text-muted">
          Feito com <span className="mx-1 text-lime">CASABLANCA</span>
        </div>
      </footer>
    </div>
  );
}
