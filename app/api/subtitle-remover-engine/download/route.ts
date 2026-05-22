import { NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { buildZip } from '@/lib/zip-builder';
import { requireAdmin } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/download
 *
 * Espelha /api/downloader-engine/download. Serve o motor LEVE
 * (server.py + pipeline.py + Instalar.ps1 + Desinstalar.ps1 +
 * DarkoSubtitleRemover.cmd + Codigo.ps1 + LEIA-ME.txt, ~50 KB).
 * O Instalar.ps1 baixa Python 3.11 embed + paddleocr + opencv +
 * ffmpeg NO PC do usuario na 1a vez (~400 MB, ~3-5 min).
 *
 * Admin-only enquanto a ferramenta nao for liberada pros alunos —
 * quando for, basta remover o requireAdmin().
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  // Mantem a ferramenta restrita a admin no estado atual.
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const dir = path.join(process.cwd(), 'engine', 'subtitle-remover-pkg');
    const names = (await readdir(dir)).filter((n) => !n.endsWith('.zip'));
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        data: new Uint8Array(await readFile(path.join(dir, name))),
      })),
    );
    if (entries.length === 0) throw new Error('engine/subtitle-remover-pkg vazio');
    const zip = await buildZip(entries);
    const arrayBuffer = await zip.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="DarkoLab-SubtitleRemover-motor.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Pacote do motor indisponivel. Verifique engine/subtitle-remover-pkg/.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
