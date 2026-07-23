/**
 * POST /api/tools/remove-subtitle — finaliza o upload multipart no OSS do
 * vmake e submete a remoção Smart. Retorna { record_id } IMEDIATAMENTE
 * (não espera o processamento — o cliente faz poll em /status).
 *
 * Body: { session, parts:[{partNumber, etag}], mode?, title? }
 *   - session: token cifrado devolvido por /upload/init.
 *   - parts: ETags de cada chunk subido via /upload/part.
 *
 * Fluxo de upload (suporta arquivos grandes, sem limite):
 *   /upload/init → N× /upload/part (chunks de 4MB) → /remove-subtitle (aqui).
 *
 * O cliente final nunca vê o vmake nem a URL do OSS (tudo server-side).
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import {
  completeMultipart,
  processFromSourceUrl,
  isVmakeConfigured,
  vmakeErrorToHttp,
  type VmakeMode,
  type MultipartSession,
} from '@/lib/vmake-api';
import { runOnVmakeQueue } from '@/lib/vmake-queue';
import { decryptSecret } from '@/lib/secrets';
import { signVmakeJob } from '@/lib/vmake-job-token';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_MODES = new Set<string>(['smart', 'subtitle', 'watermark']);

interface Body {
  session?: string;
  parts?: Array<{ partNumber?: number; etag?: string }>;
  mode?: string;
  title?: string;
}

export async function POST(req: Request) {
  const guard = await requireTier('admin', { unlockTools: ['/tools/remover-elementos'] });
  if (!guard.ok) return guard.response;

  if (!isVmakeConfigured()) {
    return NextResponse.json(
      { error: 'Motor não configurado no servidor (VMAKE_ACCESS_TOKEN ausente).', code: 'config_missing' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  if (!body.session || !Array.isArray(body.parts) || body.parts.length === 0) {
    return NextResponse.json({ error: 'session e parts são obrigatórios.' }, { status: 400 });
  }

  let session: MultipartSession;
  try {
    session = JSON.parse(decryptSecret(body.session));
  } catch {
    return NextResponse.json({ error: 'Sessão de upload inválida.' }, { status: 400 });
  }

  const parts = body.parts
    .filter((p) => typeof p.partNumber === 'number' && typeof p.etag === 'string')
    .map((p) => ({ partNumber: p.partNumber as number, etag: p.etag as string }));
  if (parts.length === 0) {
    return NextResponse.json({ error: 'Nenhuma parte válida.' }, { status: 400 });
  }

  const mode: VmakeMode = VALID_MODES.has(String(body.mode)) ? (body.mode as VmakeMode) : 'smart';

  try {
    const { recordId, taskId } = await runOnVmakeQueue(async () => {
      const sourceUrl = await completeMultipart(session, parts);
      return processFromSourceUrl(sourceUrl, mode, body.title || 'video.mp4');
    });
    // Amarra o record_id ao dono num token assinado. O cliente ecoa esse token
    // como "record_id" em /status e /download; o servidor confere userId lá e
    // barra IDOR (uma conta não baixa o vídeo de outra). O taskId cru fica só
    // pra telemetria interna.
    const record_id = signVmakeJob({ recordId, userId: guard.userId });
    return NextResponse.json({ success: true, record_id, task_id: taskId });
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle finish]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
