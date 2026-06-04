/**
 * POST /api/tools/remove-subtitle/upload/init — inicia um upload multipart
 * no OSS do vmake. Retorna uma `session` CIFRADA (contém credenciais STS
 * temporárias + uploadId) que o cliente devolve em cada /upload/part e no
 * /remove-subtitle final.
 *
 * Body: { ext? }   (extensão do arquivo, default mp4)
 * → { session }    (token opaco cifrado — não expõe nada do vmake)
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { initMultipart, isVmakeConfigured, vmakeErrorToHttp } from '@/lib/vmake-api';
import { encryptSecret } from '@/lib/secrets';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  if (!isVmakeConfigured()) {
    return NextResponse.json(
      { error: 'Motor não configurado no servidor (VMAKE_ACCESS_TOKEN ausente).', code: 'config_missing' },
      { status: 500 },
    );
  }

  let body: { ext?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const ext = (body.ext || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';

  try {
    const session = await initMultipart(ext);
    const token = encryptSecret(JSON.stringify(session));
    return NextResponse.json({ session: token });
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle init]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
