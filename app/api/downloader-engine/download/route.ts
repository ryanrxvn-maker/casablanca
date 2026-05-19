import { NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { buildZip } from '@/lib/zip-builder';

/**
 * GET /api/downloader-engine/download
 *
 * O pacote do motor agora e LEVE (server.cjs + Instalar.ps1 +
 * Desinstalar.ps1 + DarkoDownloader.cmd + LEIA-ME.txt, ~40 KB). O
 * Instalar.ps1 baixa Node + yt-dlp + ffmpeg + Chromium NO PC do
 * usuario na 1a vez. Logo da pra zipar e servir em qualquer deploy
 * (inclusive Vercel) — sem arquivo gigante.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const dir = path.join(process.cwd(), 'engine', 'pkg');
    const names = (await readdir(dir)).filter((n) => !n.endsWith('.zip'));
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        data: new Uint8Array(await readFile(path.join(dir, name))),
      })),
    );
    if (entries.length === 0) throw new Error('engine/pkg vazio');
    const zip = await buildZip(entries);
    const arrayBuffer = await zip.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="DarkoLab-Downloader-motor.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Pacote do motor indisponivel. Gere com: node engine/build.mjs && node engine/package.mjs (cria engine/pkg/).',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
