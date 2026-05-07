import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * POST /api/admin/create-user
 * body: { email, password, name }
 *
 * So admin. Usa service role pra criar o usuario via Supabase Admin API
 * (sem precisar de email confirmation), entao upserta o profile com
 * is_active=true e created_by=admin.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    let body: { email?: string; password?: string; name?: string };
    try {
      body = await req.json();
    } catch (e) {
      return jsonError(
        'Body JSON invalido.',
        400,
        e instanceof Error ? e.message : String(e),
      );
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError('Email invalido.', 400);
    }
    if (password.length < 8) {
      return jsonError('Senha precisa ter no minimo 8 caracteres.', 400);
    }
    if (!name || name.length < 2) {
      return jsonError('Nome obrigatorio.', 400);
    }

    const svc = serviceClient();

    // 1. Cria o auth user (com email_confirm=true → pode logar direto)
    const { data: authData, error: authErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authErr || !authData?.user) {
      return jsonError(
        authErr?.message?.includes('already registered')
          ? 'Esse email ja tem conta.'
          : 'Falha ao criar usuario.',
        400,
        authErr?.message,
      );
    }

    const newUserId = authData.user.id;

    // 2. Upsert profile (uma trigger pode ja ter criado um row vazio)
    const { error: profErr } = await svc
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          name,
          is_admin: false,
          is_active: true,
          activated_at: new Date().toISOString(),
          created_by: guard.userId,
        },
        { onConflict: 'id' },
      );

    if (profErr) {
      // Tenta remover o auth user pra nao deixar orfao
      await svc.auth.admin.deleteUser(newUserId).catch(() => {});
      return jsonError(
        'Falha ao criar profile.',
        500,
        profErr.message,
      );
    }

    return NextResponse.json({
      ok: true,
      user: { id: newUserId, email, name },
    });
  } catch (e) {
    console.error('[admin create-user]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
