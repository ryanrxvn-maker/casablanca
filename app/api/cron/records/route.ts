import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { error } = await serviceClient().rpc('prune_durable_history');
  if (error) return NextResponse.json({ error: 'Falha na manutenção do histórico.' }, { status: 503 });
  return NextResponse.json({ ok: true });
}
