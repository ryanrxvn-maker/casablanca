import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';

/**
 * GET /api/downloader-engine/download
 *
 * Serve o motor empacotado (Windows) — engine/pkg.zip, gerado por
 * `node engine/package.mjs`. É grande (~300 MB): streamado do disco
 * (sem carregar na memoria). Se nao existir (ex.: deploy serverless
 * sem o pkg), devolve instrucoes pra gerar.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  const zipPath = path.join(process.cwd(), 'engine', 'pkg.zip');
  try {
    const s = await stat(zipPath);
    if (!s.isFile() || s.size < 1000) throw new Error('zip invalido');
    const nodeStream = createReadStream(zipPath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="DarkoLab-Downloader-motor.zip"',
        'content-length': String(s.size),
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'Motor ainda nao empacotado neste servidor. Gere com: node engine/build.mjs && node engine/package.mjs (cria engine/pkg.zip). Em hospedagem serverless o motor deve ser distribuido a parte (arquivo grande).',
      },
      { status: 503 },
    );
  }
}
