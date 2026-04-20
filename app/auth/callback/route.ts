import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth / magic link callback.
 * Troca o `code` pela sessao, garante o profile e redireciona.
 *
 * Para login via Google, o Supabase ja valida o email pelo provider,
 * entao nao exigimos o codigo OTP adicional. Se o profile ainda nao
 * existir, cria com nome vindo do user_metadata.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/tools';

  if (code) {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.exchangeCodeForSession(code);
    const user = sessionData?.user;
    if (user) {
      // Garante o row em profiles pra novos usuarios OAuth.
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (!existing) {
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const name =
          (meta.full_name as string | undefined) ??
          (meta.name as string | undefined) ??
          (user.email ? user.email.split('@')[0] : 'Editor');
        const avatar =
          (meta.avatar_url as string | undefined) ??
          (meta.picture as string | undefined) ??
          null;
        const phone = (meta.phone as string | undefined) ?? null;
        await supabase.from('profiles').upsert({
          id: user.id,
          name,
          avatar_url: avatar,
          whatsapp: phone,
        });
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
