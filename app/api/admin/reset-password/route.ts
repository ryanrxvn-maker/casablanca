import { NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * POST /api/admin/reset-password
 *  Body: { userId: string }
 *
 * Gera uma nova senha provisória pseudo-aleatória e atualiza:
 *   1. Senha no auth.users (via admin API)
 *   2. profiles.must_change_password = true (força troca no próximo login)
 *
 * Retorna a senha gerada UMA VEZ pro admin copiar/anotar. Depois disso
 * só o usuário (após login + troca) tem acesso.
 *
 * Formato: 4 letras + 4 dígitos (ex: "Kx9p-7142") — fácil de ditar e
 * suficientemente único pra uso provisório.
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

function genTempPassword(): string {
  // Letras sem ambiguidade (sem I, l, O, 0). randomInt = CSPRNG (não
  // Math.random, que é previsível e não serve pra credencial).
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  let p = '';
  for (let i = 0; i < 4; i++) {
    p += letters.charAt(randomInt(letters.length));
  }
  p += '-';
  for (let i = 0; i < 4; i++) {
    p += digits.charAt(randomInt(digits.length));
  }
  return p;
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { userId } = (await req.json()) as { userId?: string };
    if (!userId) {
      return jsonError('userId obrigatório.', 400);
    }

    const svc = serviceClient();
    const newPassword = genTempPassword();

    // 1) atualiza senha via admin API
    const { error: pwError } = await svc.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (pwError) {
      return jsonError(
        'Falha ao atualizar senha.',
        500,
        pwError.message,
      );
    }

    // 2) marca must_change_password=true (força troca no próximo login)
    const { error: profError } = await svc
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', userId);
    if (profError) {
      // não-fatal — senha já foi trocada
      console.warn('[reset-password] profile flag falhou', profError.message);
    }

    return NextResponse.json({ ok: true, password: newPassword });
  } catch (e) {
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
