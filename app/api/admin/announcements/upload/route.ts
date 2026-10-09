import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { jsonError, requireAdmin, serviceClient } from '../../_helpers';

/**
 * POST /api/admin/announcements/upload  (multipart, campo `file`)
 *
 * Imagem da propaganda → bucket PÚBLICO `announcements` do Supabase Storage
 * (criado na primeira vez, pela service role). O painel já manda a imagem
 * comprimida em WebP; aqui só confere tipo e tamanho e devolve a URL pública.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const BUCKET = 'announcements';
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return jsonError('Envie uma imagem.', 400);
    const ext = TYPES[file.type];
    if (!ext) return jsonError('Formato não aceito: use JPG, PNG, WebP, AVIF ou GIF.', 400);
    if (file.size > MAX_BYTES) return jsonError('Imagem grande demais (máximo 4 MB).', 400);

    const svc = serviceClient();
    const bucket = await svc.storage.getBucket(BUCKET);
    if (!bucket.data) {
      const made = await svc.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: Object.keys(TYPES),
      });
      if (made.error && !/already exists|duplicate/i.test(made.error.message)) {
        return jsonError('Não deu pra preparar o armazenamento de imagens.', 500, made.error.message);
      }
    }

    const path = `promo/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await svc.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (up.error) return jsonError('Falha ao enviar a imagem.', 500, up.error.message);
    const { data } = svc.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, url: data.publicUrl });
  } catch (e) {
    return jsonError('Erro inesperado no envio.', 500, e instanceof Error ? e.message : String(e));
  }
}
