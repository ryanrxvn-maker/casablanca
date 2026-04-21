import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PublicPortfolioLayout } from './layout-client';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

type PublicProfile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  portfolio_slug: string;
  portfolio_public: boolean;
  whatsapp: string | null;
};

export default async function PublicPortfolio({ params }: Params) {
  const supabase = createClient();

  const { data: rpcData } = await supabase.rpc('get_public_profile_by_slug', {
    s: params.slug,
  });
  const profile =
    Array.isArray(rpcData) && rpcData.length > 0
      ? (rpcData[0] as PublicProfile)
      : null;

  if (!profile) {
    notFound();
  }
  const p = profile as PublicProfile;

  const [{ data: items }, { data: proofs }] = await Promise.all([
    supabase
      .from('portfolio_items')
      .select('id, title, category, niche, video_url, thumbnail_url, "order"')
      .eq('user_id', p.id)
      .order('order', { ascending: true }),
    supabase
      .from('social_proofs')
      .select('id, image_url, caption')
      .eq('user_id', p.id)
      .order('created_at', { ascending: false }),
  ]);

  return (
    <PublicPortfolioLayout
      profile={{
        name: p.name,
        avatar_url: p.avatar_url,
        whatsapp: p.whatsapp,
      }}
      videos={items ?? []}
      proofs={proofs ?? []}
    />
  );
}
