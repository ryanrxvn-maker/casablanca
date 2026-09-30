import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';

export const dynamic = 'force-dynamic';

/** Autoridade do servidor para liberar edição/exportação dos modelos de notícia. */
export async function GET() {
  const gate = await requireTier('basic');
  if (!gate.ok) return gate.response;
  return NextResponse.json({ premium: true }, { headers: { 'Cache-Control': 'no-store' } });
}
