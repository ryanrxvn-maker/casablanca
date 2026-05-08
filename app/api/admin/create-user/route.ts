import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

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

    let svc;
    try {
      svc = serviceClient();
    } catch (e) {
      return jsonError(
        'Servidor mal configurado: SUPABASE_SERVICE_ROLE_KEY ausente.',
        500,
        e instanceof Error ? e.message : String(e),
      );
    }

    const { data: authData, error: authErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authErr || !authData?.user) {
      // Mensagens da Supabase Admin API que aparecem com mais frequencia:
      const msg = authErr?.message ?? '';
      let friendly = 'Falha ao criar usuario.';
      if (/already registered|already exists|duplicate/i.test(msg)) {
        friendly = 'Esse email ja tem conta cadastrada.';
      } else if (/password/i.test(msg) && /weak|strength|short|invalid/i.test(msg)) {
        friendly = 'Senha fraca ou invalida pelas regras do Supabase. Tente uma com letras + numeros + simbolos.';
      } else if (/email/i.test(msg) && /invalid|format/i.test(msg)) {
        friendly = 'Email invalido.';
      } else if (msg) {
        friendly = msg;
      }
      return jsonError(friendly, 400, msg);
    }

    const newUserId = authData.user.id;

    // Profile com must_change_password=true (cliente vai ter que trocar
    // a senha provisoria no primeiro login).
    const { error: profErr } = await svc
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          name,
          is_admin: false,
          is_active: true,
          must_change_password: true,
          activated_at: new Date().toISOString(),
          created_by: guard.userId,
        },
        { onConflict: 'id' },
      );

    if (profErr) {
      await svc.auth.admin.deleteUser(newUserId).catch(() => {});
      return jsonError('Falha ao criar profile.', 500, profErr.message);
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
