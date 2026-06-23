/**
 * POST /api/tools/decupagem/ticket — emite um ticket de upload descartável pro
 * navegador subir o vídeo grande DIRETO no worker Modal (sem tocar a Vercel,
 * que corta corpo > 4.5MB). O ticket é HMAC com TTL curto; o token mestre nunca
 * vai pro cliente.
 *
 * Tier: basic+ (processamento no servidor tem custo).
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { mintUploadTicket } from '@/lib/decup-server';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST() {
  const gate = await requireTier('basic');
  if (!gate.ok) return gate.response;

  if (!process.env.DECUP_UPLOAD_SECRET?.trim()) {
    return NextResponse.json(
      { error: 'Decupagem no servidor não configurada (DECUP_UPLOAD_SECRET ausente).' },
      { status: 500 },
    );
  }

  const { ticket, base } = mintUploadTicket();
  return NextResponse.json({ ticket, base });
}
