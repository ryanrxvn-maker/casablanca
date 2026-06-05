/**
 * GET /api/tools/remove-subtitle/download?record_id=X&mode=smart[&dl=1]
 *
 * Proxy de streaming do MP4 limpo. RESOLVE uma download_url FRESCA no vmake
 * a cada request (a URL do CDN é assinada e EXPIRA em ~1-2min — por isso o
 * cliente NUNCA pode guardar a URL; sempre pede aqui) e faz streaming do
 * arquivo de volta:
 *   - dl=1 → Content-Disposition: attachment  (força o download do MP4)
 *   - sem dl → inline (serve o <video> de preview, com suporte a Range/seek)
 *
 * Streaming = suporta arquivos GRANDES sem estourar memória (não bufferiza).
 * O cliente final nunca vê a URL do vmake.
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requirePro } from '@/app/api/admin/_helpers';
import { pollRecord, VMAKE_EFFECT, vmakeErrorToHttp, type VmakeMode } from '@/lib/vmake-api';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_MODES = new Set<string>(['smart', 'subtitle', 'watermark']);

export async function GET(req: Request) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const recordId = url.searchParams.get('record_id');
  const modeParam = url.searchParams.get('mode') || 'smart';
  const mode: VmakeMode = VALID_MODES.has(modeParam) ? (modeParam as VmakeMode) : 'smart';
  const asAttachment = url.searchParams.get('dl') === '1';

  if (!recordId) {
    return NextResponse.json({ error: 'record_id é obrigatório.' }, { status: 400 });
  }

  try {
    const { status, downloadUrl } = await pollRecord(recordId, VMAKE_EFFECT[mode]);
    if (status !== 2 || !downloadUrl) {
      return NextResponse.json({ error: 'Ainda processando.', code: 'processing', status }, { status: 409 });
    }

    // Streaming direto do CDN (URL fresca). Encaminha Range pra permitir
    // seek no preview e downloads parciais/resumíveis.
    const range = req.headers.get('range');
    const upstream = await fetch(downloadUrl, {
      headers: range ? { Range: range } : {},
      cache: 'no-store',
    });
    if (!upstream.ok && upstream.status !== 206) {
      const t = await upstream.text().catch(() => '');
      console.error('[remove-subtitle download] upstream', upstream.status, t.slice(0, 120));
      return NextResponse.json({ error: 'Falha ao buscar o vídeo. Tenta de novo.' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'no-store');
    const cl = upstream.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) headers.set('Content-Range', cr);
    headers.set(
      'Content-Disposition',
      `${asAttachment ? 'attachment' : 'inline'}; filename="video_limpo.mp4"`,
    );

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    const { status, message, code, detail } = vmakeErrorToHttp(err);
    console.error('[remove-subtitle download]', code, detail);
    return NextResponse.json({ error: message, code }, { status });
  }
}
