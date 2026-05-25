import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LipSyncTool from '@/components/tools/LipSyncTool';

/**
 * /tools/lipsync — Ferramenta admin-only.
 *
 * Usa o mesmo check que o resto do projeto: profiles.is_admin = true.
 * Qualquer outro user (incluindo Pro) eh redirecionado pra home das tools.
 * Nao aparece no ToolsHub — so quem souber a URL acessa.
 */

export const dynamic = 'force-dynamic';

async function isAdmin(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, is_active')
      .eq('id', user.id)
      .maybeSingle();

    return Boolean(profile?.is_admin && profile?.is_active);
  } catch {
    return false;
  }
}

export default async function LipSyncPage() {
  const admin = await isAdmin();
  if (!admin) {
    redirect('/tools');
  }

  return (
    <main className="min-h-screen bg-bg py-8">
      <LipSyncTool />
    </main>
  );
}
