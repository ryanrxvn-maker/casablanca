/**
 * /api/replicate/upload — sobe um arquivo pro Replicate Files API
 * e retorna a URL publica acessivel pelos modelos.
 *
 * O Replicate Files API expira em 1h (mais que suficiente pra gerar
 * lipsync). API endpoint: POST https://api.replicate.com/v1/files
 *
 * Guard: admin only (lipsync eh admin-only).
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'REPLICATE_API_TOKEN nao configurada.' },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'FormData invalido.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Campo "file" obrigatorio.' }, { status: 400 });
  }
  // FormData entry pode ser File ou Blob; ambos tem .type, .name, e podem ir num multipart

  try {
    // Replicate Files API:
    //  POST https://api.replicate.com/v1/files
    //  Body: multipart/form-data com campo "content"
    //  Response: { id, urls: { get: "https://api.replicate.com/v1/files/{id}" } }
    //
    // Mas pra modelos, o melhor eh usar o "serving_url" que da uma URL
    // pre-signed direta. Alternativa eh enviar o arquivo como data URL,
    // mas pra videos grandes nao serve.

    const upstream = new FormData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = file as any;
    const filename = f.name || 'upload.bin';
    const type = f.type || 'application/octet-stream';
    upstream.append('content', f, filename);
    upstream.append('type', type);

    const res = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: upstream,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Replicate Files API falhou: ${res.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      id: string;
      urls?: { get?: string };
    };

    // URL pra usar como input nos modelos
    const fileUrl = data.urls?.get || `https://api.replicate.com/v1/files/${data.id}`;

    return NextResponse.json({
      success: true,
      url: fileUrl,
      id: data.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[replicate upload]', message);
    return NextResponse.json({ error: message || 'Erro upload.' }, { status: 500 });
  }
}
