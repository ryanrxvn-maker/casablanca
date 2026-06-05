/**
 * /api/tools/remove-subtitle/status?record_id=xxx&mode=smart
 *
 * O cliente chama esse endpoint a cada ~4s pra saber se o processamento
 * do vmake concluiu. Retorna { status, process, downloadUrl }.
 *
 * status: 1 = processando, 2 = pronto, negativo = falhou.
 * process: 0-1 (progresso de 0% a 100%).
 * downloadUrl: URL pública do MP4 limpo (só quando status === 2).
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requirePro } from '@/app/api/admin/_helpers';
import { pollRecord, VMAKE_EFFECT, vmakeErrorToHttp, type VmakeMode } from '@/lib/vmake-api';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VALID_MODES = new Set<string>(['smart', 'subtitle', 'watermark']);

export async function GET(req: Request) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const recordId = url.searchParams.get('record_id');
  const modeParam = url.searchParams.get('mode') || 'smart';
  const mode: VmakeMode = VALID_MODES.has(modeParam) ? (modeParam as VmakeMode) : 'smart';

  if (!recordId) {
    return NextResponse.json({ error: 'record_id é obrigatório.' }, { status: 400 });
  }

  try {
    const result = await pollRecord(recordId, VMAKE_EFFECT[mode]);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle status]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
