import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

/**
 * GET /api/downloader-engine/download
 *
 * Entrega DarkoDownloaderSetup.exe — instalador nativo 1-clique
 * (~50 KB; stub C# com pkg.zip embutido + icone da extensao). O .exe
 * extrai pra %TEMP%, mostra a UI WinForms DARKO e baixa Node + yt-dlp
 * + ffmpeg + Chromium (~250 MB) no PC do usuario na 1a vez. Cada
 * componente ja presente e pulado (Test-Path).
 *
 * NUNCA pede codigo de pareamento: a extensao auto-pareia via /pair.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const exePath = path.join(
      process.cwd(),
      'engine',
      'DarkoDownloaderSetup.exe',
    );
    const st = await stat(exePath);
    const buf = await readFile(exePath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="DarkoDownloaderSetup.exe"',
        'content-length': String(st.size),
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Instalador indisponivel. Gere com: node engine/build.mjs && node engine/package.mjs (cria engine/DarkoDownloaderSetup.exe).',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
