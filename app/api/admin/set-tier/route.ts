import { NextResponse } from 'next/server';
import { jsonError, requireAdmin, serviceClient } from '../_helpers';

/**
 * POST /api/admin/set-tier
 *   Body: { userId: string, tier: 'free' | 'basic' | 'pro' }
 *
 * Apenas admin pode mudar o tier de qualquer conta. Tier 'admin' não é
 * setável via este endpoint (precisa setar is_admin=true direto).
 */

export const runtime = 'nodejs';
export const maxDuration = 10;

const VALID = new Set(['free', 'basic', 'pro']);

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { userId, tier } = (await req.json()) as {
      userId?: string;
      tier?: string;
    };
    if (!userId || !tier || !VALID.has(tier)) {
      return jsonError('Payload inválido.', 400);
    }

    const svc = serviceClient();
    // Tenta UPDATE direto na coluna tier
    const { data, error } = await svc
      .from('profiles')
      .update({ tier })
      .eq('id', userId)
      .select('id, tier');

    if (error) {
      // Coluna tier não existe? Mensagem explícita.
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('column') && msg.includes('tier')) {
        return jsonError(
          'Coluna tier não existe ainda. Rode a migration 016_tier_expand.sql no Supabase SQL Editor.',
          500,
          error.message,
        );
      }
      return jsonError('Falha ao atualizar tier.', 500, error.message);
    }

    if (!data || data.length === 0) {
      return jsonError('Usuário não encontrado.', 404);
    }

    return NextResponse.json({ ok: true, tier: data[0].tier });
  } catch (e) {
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
