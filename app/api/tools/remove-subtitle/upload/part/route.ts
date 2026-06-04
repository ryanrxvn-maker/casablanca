/**
 * POST /api/tools/remove-subtitle/upload/part — sobe UMA parte (chunk) do
 * vídeo pro OSS do vmake (server-side, sem CORS). Cada chunk vem ≤ 4MB
 * (abaixo do limite da Vercel) e é repassado pro OSS como UploadPart.
 *
 * Headers:
 *   x-vmk-session : token cifrado da /upload/init
 *   x-vmk-part    : número da parte (1-based)
 * Body: bytes crus do chunk.
 * → { etag }   (usado depois no /remove-subtitle pra fechar o multipart)
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { uploadPart, vmakeErrorToHttp, type MultipartSession } from '@/lib/vmake-api';
import { decryptSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 60;

// limite defensivo por chunk (Vercel corta acima de ~4.5MB)
const MAX_CHUNK = 4.4 * 1024 * 1024;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const sessionToken = req.headers.get('x-vmk-session');
  const partStr = req.headers.get('x-vmk-part');
  if (!sessionToken || !partStr) {
    return NextResponse.json({ error: 'Headers x-vmk-session e x-vmk-part obrigatórios.' }, { status: 400 });
  }
  const partNumber = parseInt(partStr, 10);
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    return NextResponse.json({ error: 'x-vmk-part inválido.' }, { status: 400 });
  }

  let session: MultipartSession;
  try {
    session = JSON.parse(decryptSecret(sessionToken));
  } catch {
    return NextResponse.json({ error: 'Sessão de upload inválida.' }, { status: 400 });
  }

  const ab = await req.arrayBuffer();
  if (ab.byteLength === 0) {
    return NextResponse.json({ error: 'Chunk vazio.' }, { status: 400 });
  }
  if (ab.byteLength > MAX_CHUNK) {
    return NextResponse.json({ error: 'Chunk grande demais.' }, { status: 413 });
  }

  try {
    const etag = await uploadPart(session, partNumber, Buffer.from(ab));
    return NextResponse.json({ etag, partNumber });
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle part]', partNumber, code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
