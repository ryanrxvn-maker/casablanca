import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { poolStatus } from '@/lib/ltx-token-pool';

/**
 * GET /api/ltx-video/status — saúde do pool + previsibilidade de quota.
 * Só admin (a ferramenta LTX-Video é exclusiva da conta admin).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json(poolStatus());
}
