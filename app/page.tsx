import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Landing } from '@/components/Landing';

/**
 * `/` — quando logado: vai pro hub. Quando não: landing pública.
 */
export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/tools');
  }
  return <Landing />;
}
