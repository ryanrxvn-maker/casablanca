/**
 * GET /api/tools/decupagem/status?job=<token> — acompanha um job de decupagem
 * no servidor. Verifica o token assinado, consulta o Modal e, quando pronto,
 * devolve a URL de download direto (Content-Disposition força o nome certo).
 *
 * Poll leve: o cliente chama a cada ~5s.
 */

import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { verifyDecupJob } from '@/lib/decup-job-token';
import { checkDecupStatus, buildDownloadUrl } from '@/lib/decup-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const gate = await requireTier('basic');
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const token = url.searchParams.get('job');
  const job = verifyDecupJob(token);
  if (!job) {
    return NextResponse.json({ status: 'error', error: 'Job inválido ou expirado.' }, { status: 400 });
  }
  // Só o dono do job acompanha.
  if (job.userId !== gate.userId && !gate.isAdmin) {
    return NextResponse.json({ status: 'error', error: 'Sem acesso a este job.' }, { status: 403 });
  }

  try {
    const st = await checkDecupStatus(job.callId);
    if (st.status === 'processing') {
      return NextResponse.json({ status: 'processing' });
    }
    if (st.status === 'failed') {
      return NextResponse.json({ status: 'failed', error: st.error || 'Falha no processamento.' });
    }
    // done
    const ext = job.outputKind === 'audio' ? 'mp3' : 'mp4';
    const base = job.fileName.replace(/\.[^.]+$/, '') || 'video';
    const downloadUrl = buildDownloadUrl(st.id, `${base}_decupado.${ext}`);
    return NextResponse.json({
      status: 'done',
      download_url: downloadUrl,
      original_dur: st.original_dur,
      new_dur: st.new_dur,
      segments: st.segments,
      size_mb: st.size_mb,
    });
  } catch (e) {
    return NextResponse.json(
      { status: 'failed', error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
