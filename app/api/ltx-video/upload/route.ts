import { NextResponse } from 'next/server';
import { ltxUpload, pickToken } from '@/lib/ltx-gradio-server';

/**
 * POST /api/ltx-video/upload  (multipart: file)
 * Sobe o último frame do chunk anterior pra Space e devolve o path dela,
 * usado como input do image_to_video (continuação dos 12s / 2 chunks).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart inválido' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file ausente' }, { status: 400 });
  }
  const tokenIndex = Number(form.get('tokenIndex') ?? 0);
  const { token } = pickToken(tokenIndex);

  const r = await ltxUpload(file, 'frame.jpg', token);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ path: r.path });
}
