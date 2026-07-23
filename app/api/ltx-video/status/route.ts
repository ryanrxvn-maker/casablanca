import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { poolStatus } from '@/lib/ltx-token-pool';

/**
 * GET /api/ltx-video/status — saúde do pool + previsibilidade de quota.
 * Só admin (a ferramenta LTX-Video é exclusiva da conta admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireTier('admin', { unlockTools: ['/tools/ltx-video'] });
  if (!guard.ok) return guard.response;
  return NextResponse.json(poolStatus());
}
