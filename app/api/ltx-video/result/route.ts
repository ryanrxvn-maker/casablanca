import { NextResponse } from 'next/server';
import { ltxPoll, pickToken } from '@/lib/ltx-gradio-server';

/**
 * GET /api/ltx-video/result?fn=...&eventId=...&tokenIndex=0
 * Lê o stream da fila por ~45s. Devolve done/error/pending.
 * Em 'pending' o client chama de novo (Gradio mantém o resultado).
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fn = searchParams.get('fn') ?? '';
  const eventId = searchParams.get('eventId') ?? '';
  const tokenIndex = Number(searchParams.get('tokenIndex') ?? 0);

  if (!fn || !eventId) {
    return NextResponse.json(
      { status: 'error', error: 'fn e eventId obrigatórios.' },
      { status: 400 },
    );
  }

  const { token } = pickToken(tokenIndex);
  const r = await ltxPoll(fn, eventId, token, 45_000);
  return NextResponse.json(r);
}
