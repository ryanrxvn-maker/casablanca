import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';
import { UNLOCKABLE_TOOLS } from '@/lib/tool-unlocks';

/**
 * POST /api/admin/set-tool-unlocks  (admin)
 *   Body: { userId: string, tools: string[] }
 *
 * BETA PRO: define quais ferramentas admin-only a conta pode usar
 * (profiles.tool_unlocks). Lista vazia = remove todos os desbloqueios.
 * Valida contra o catálogo UNLOCKABLE_TOOLS — nada fora dele entra.
 *
 * Não mexe em tier nem em is_admin: o cliente continua FREE/PREMIUM,
 * só ganha as ferramentas marcadas (3 camadas: middleware, requireTier, UI).
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

const VALID_PATHS = new Set(UNLOCKABLE_TOOLS.map((t) => t.path));

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { userId, tools } = (await req.json()) as {
      userId?: string;
      tools?: unknown;
    };
    if (!userId || !Array.isArray(tools)) {
      return jsonError('Payload inválido.', 400);
    }

    const clean = Array.from(
      new Set(
        tools.filter(
          (t): t is string => typeof t === 'string' && VALID_PATHS.has(t),
        ),
      ),
    );
    if (tools.length !== clean.length) {
      const rejected = tools.filter(
        (t) => typeof t !== 'string' || !VALID_PATHS.has(t as string),
      );
      return jsonError(
        'Ferramenta fora do catálogo de desbloqueio.',
        400,
        JSON.stringify(rejected).slice(0, 200),
      );
    }

    const svc = serviceClient();

    // Nunca desbloqueia em cima de conta admin (admin já tem tudo).
    const { data: target } = await svc
      .from('profiles')
      .select('id, is_admin, email')
      .eq('id', userId)
      .maybeSingle();
    if (!target) return jsonError('Usuário não encontrado.', 404);
    if ((target as { is_admin?: boolean }).is_admin) {
      return jsonError('Conta admin já acessa tudo — nada a desbloquear.', 400);
    }

    const { error } = await svc
      .from('profiles')
      .update({ tool_unlocks: clean })
      .eq('id', userId);

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('column') && msg.includes('tool_unlocks')) {
        return jsonError(
          'Coluna tool_unlocks não existe ainda. Rode a migration 028_tool_unlocks.sql no Supabase SQL Editor.',
          500,
          error.message,
        );
      }
      return jsonError('Falha ao salvar desbloqueios.', 500, error.message);
    }

    console.log(
      `[admin set-tool-unlocks] ${guard.userId} → ${
        (target as { email?: string | null }).email ?? userId
      }: [${clean.join(', ')}]`,
    );

    return NextResponse.json({ ok: true, tools: clean });
  } catch (e) {
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
