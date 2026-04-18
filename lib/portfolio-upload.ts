/**
 * CASABLANCA — Helpers de upload para o portfolio.
 *
 * Sobe videos e thumbnails para o Supabase Storage, obedecendo a convencao
 * de pastas por usuario ({user_id}/...) exigida pelas policies definidas em
 * supabase/migrations/002_storage.sql.
 */

import { createClient } from './supabase/client';

export const VIDEO_BUCKET = 'portfolio-videos';
export const THUMB_BUCKET = 'portfolio-thumbnails';
export const PROOFS_BUCKET = 'social-proofs';

function randomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function extFromName(name: string, fallback: string) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Gera uma thumbnail extraindo um frame do video via HTMLVideoElement.
 * `atSeconds` e o tempo do frame desejado (default 1s). Retorna PNG.
 */
export async function generateThumbnail(
  file: Blob,
  atSeconds: number = 1,
  maxWidth: number = 640,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      let done = false;
      const onLoad = () => {
        if (done) return;
        done = true;
        resolve();
      };
      video.onloadeddata = onLoad;
      video.onerror = () => reject(new Error('Nao foi possivel ler o video para gerar thumbnail.'));
      // timeout de 10s pra nao travar
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve();
        }
      }, 10000);
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(duration > 0 ? duration / 2 : atSeconds, atSeconds);
    video.currentTime = Math.max(0.1, target);

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 5000);
    });

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D nao disponivel.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao gerar thumbnail.'))),
        'image/jpeg',
        0.82,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Uploads ------------------------------------------------------

export type UploadResult = {
  path: string;         // path relativo dentro do bucket (ex: {user_id}/foo.mp4)
  publicUrl: string;    // URL publica (os buckets sao public=true)
};

async function uploadToBucket(
  bucket: string,
  userId: string,
  file: Blob,
  filename: string,
  contentType?: string,
): Promise<UploadResult> {
  const supabase = createClient();
  const path = `${userId}/${filename}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: contentType ?? (file as File).type ?? undefined,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function uploadVideo(userId: string, file: File): Promise<UploadResult> {
  const ext = extFromName(file.name, 'mp4');
  const name = `${randomId()}.${ext}`;
  return uploadToBucket(VIDEO_BUCKET, userId, file, name);
}

export async function uploadThumbnail(
  userId: string,
  blob: Blob,
  baseId: string,
): Promise<UploadResult> {
  const name = `${baseId}.jpg`;
  return uploadToBucket(THUMB_BUCKET, userId, blob, name, 'image/jpeg');
}

export async function uploadProof(userId: string, file: File): Promise<UploadResult> {
  const ext = extFromName(file.name, 'jpg');
  const name = `${randomId()}.${ext}`;
  return uploadToBucket(PROOFS_BUCKET, userId, file, name);
}

/**
 * Deleta um arquivo a partir da URL publica (reverte para path relativo).
 */
export async function deleteByPublicUrl(bucket: string, publicUrl: string): Promise<void> {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(publicUrl.slice(idx + marker.length));
  const supabase = createClient();
  await supabase.storage.from(bucket).remove([path]);
}

/**
 * Upload completo de um item de portfolio: video + thumbnail + row no DB.
 */
export async function uploadPortfolioItem(params: {
  userId: string;
  file: File;
  title: string;
  category: string;
  niche?: string | null;
  order?: number;
  onProgress?: (stage: string) => void;
}): Promise<void> {
  const { userId, file, title, category, niche, order, onProgress } = params;
  const supabase = createClient();

  onProgress?.('Enviando video...');
  const video = await uploadVideo(userId, file);

  let thumbUrl: string | null = null;
  try {
    onProgress?.('Gerando thumbnail...');
    const thumb = await generateThumbnail(file, 1.0);
    onProgress?.('Enviando thumbnail...');
    // Usa o id do video (path sem extensao) como baseId
    const baseId = video.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? randomId();
    const up = await uploadThumbnail(userId, thumb, baseId);
    thumbUrl = up.publicUrl;
  } catch (e) {
    console.warn('[portfolio] thumbnail falhou, seguindo sem:', e);
  }

  onProgress?.('Salvando no banco...');
  const { error } = await supabase.from('portfolio_items').insert({
    user_id: userId,
    title,
    category,
    niche: niche ?? null,
    video_url: video.publicUrl,
    thumbnail_url: thumbUrl,
    order: order ?? 0,
  });
  if (error) throw error;
}
