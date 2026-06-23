/**
 * POST /api/tools/decupagem/start — dispara a decupagem no servidor (Modal).
 *
 * Body: { input_id, keepSilence, outputKind, fileName }
 *   input_id  = id retornado pelo Modal /up (vídeo já subiu direto)
 * Retorna: { job } — token assinado pra acompanhar no /status.
 *
 * Tier: basic+.
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { startDecupar } from '@/lib/decup-server';
import { signDecupJob } from '@/lib/decup-job-token';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const gate = await requireTier('basic');
  if (!gate.ok) return gate.response;

  if (!process.env.DECUP_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Decupagem no servidor não configurada (DECUP_KEY ausente).' },
      { status: 500 },
    );
  }

  let body: { input_id?: string; keepSilence?: number; outputKind?: string; fileName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const inputId = (body.input_id || '').trim();
  if (!inputId || !/^[\w.-]+$/.test(inputId)) {
    return NextResponse.json({ error: 'input_id inválido.' }, { status: 400 });
  }
  const outputKind: 'video' | 'audio' = body.outputKind === 'audio' ? 'audio' : 'video';
  let keepSilence = Number(body.keepSilence);
  if (!Number.isFinite(keepSilence)) keepSilence = 0.05;
  keepSilence = Math.max(0.01, Math.min(0.5, keepSilence));
  const fileName = (body.fileName || 'video').slice(0, 120);

  try {
    const { callId } = await startDecupar({ inputId, keepSilence, outputKind });
    const job = signDecupJob({ callId, fileName, outputKind, userId: gate.userId });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json(
      { error: 'Falha ao iniciar a decupagem no servidor.', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
