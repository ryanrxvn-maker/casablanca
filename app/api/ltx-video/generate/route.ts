import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/admin/_helpers';
import { ltxGenerate } from '@/lib/ltx-client-server';

/**
 * POST /api/ltx-video/generate  (multipart/form-data)
 * Campos: prompt, duration, width, height, enhance ("1"/"0"), seed?,
 *         image? (arquivo — último frame, p/ continuação i2v)
 *
 * Rotação de até 10 contas HF é automática dentro do ltxGenerate.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart inválido' }, { status: 400 });
  }

  const prompt = String(form.get('prompt') ?? '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt obrigatório.' }, { status: 400 });
  }

  const duration = Number(form.get('duration') ?? 6) || 6;
  const width = Number(form.get('width') ?? 1280) || 1280;
  const height = Number(form.get('height') ?? 736) || 736;
  const enhance = String(form.get('enhance') ?? '0') === '1';
  const seedRaw = form.get('seed');
  const seed =
    seedRaw != null && String(seedRaw) !== '' ? Number(seedRaw) : undefined;

  let imageBytes: Uint8Array | null = null;
  const img = form.get('image');
  if (img instanceof Blob && img.size > 0) {
    imageBytes = new Uint8Array(await img.arrayBuffer());
  }

  const r = await ltxGenerate({
    prompt,
    duration,
    width,
    height,
    enhancePrompt: enhance,
    seed,
    imageBytes,
  });

  if (!r.ok) {
    const status =
      r.kind === 'quota' ? 429 : r.kind === 'config' ? 400 : 502;
    return NextResponse.json(
      { error: r.error, kind: r.kind, retrySec: r.retrySec ?? null },
      { status },
    );
  }

  return NextResponse.json({ videoUrl: r.videoUrl, seed: r.seed });
}
