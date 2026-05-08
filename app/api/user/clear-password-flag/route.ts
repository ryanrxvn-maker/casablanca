import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/user/clear-password-flag
 *
 * Marca must_change_password=false. Chamado pelo /trocar-senha apos o
 * user trocar a senha provisoria por uma propria.
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
    }

    const { error } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', user.id);

    if (error) {
      return NextResponse.json(
        { error: 'Falha ao salvar.', detail: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[clear-password-flag]', e);
    return NextResponse.json(
      { error: 'Erro inesperado.' },
      { status: 500 },
    );
  }
}
