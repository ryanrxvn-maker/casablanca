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

    // Só limpa a flag se a senha foi REALMENTE trocada agora. O /trocar-senha
    // chama supabase.auth.updateUser({password}) (que atualiza user.updated_at)
    // e logo em seguida bate aqui — então updated_at recente = troca acabou de
    // ocorrer. Sem isso, um usuário podia zerar a flag e seguir na senha
    // provisória pra sempre, furando a rotação forçada.
    const updatedAt = user.updated_at ? new Date(user.updated_at).getTime() : 0;
    const FRESH_MS = 30 * 60_000; // 30 min de folga pra fluxos lentos
    if (!updatedAt || Date.now() - updatedAt > FRESH_MS) {
      return NextResponse.json(
        { error: 'Troque a senha antes de continuar.' },
        { status: 409 },
      );
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
