import { NextResponse } from 'next/server';
import { poolStatus } from '@/lib/ltx-token-pool';

/**
 * GET /api/ltx-video/status — saúde do pool de contas HF (mascarado,
 * sem segredos). UI mostra "X/Y contas disponíveis".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(poolStatus());
}
