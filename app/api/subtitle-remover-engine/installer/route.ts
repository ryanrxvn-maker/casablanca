import { NextResponse, type NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';
import { requirePro } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/installer
 *
 * Entrega o AutoEditSmartRemoverSetup.exe — instalador WinForms nativo
 * com o mesmo design + proteções anti-AV do downloader:
 *  - .exe assinado (self-signed CN=Auto Edit) com timestamp DigiCert
 *  - WinForms UI violet/fuchsia, sem CMD visível
 *  - AssemblyInfo completo + manifest XML asInvoker
 *  - Compilado de engine/installer/Setup.cs com /define:REMOVER
 *
 * ?format=zip → serve pkg-remover.zip (scripts puros, fallback se AV
 *               corporativo bloquear o .exe assinado)
 *
 * Build: node engine/package-remover.mjs
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const wantZip = searchParams.get('format') === 'zip';

  const fileName = wantZip
    ? 'AutoEditSmartRemover.zip'
    : 'AutoEditSmartRemoverSetup.exe';
  const localName = wantZip
    ? 'pkg-remover.zip'
    : 'AutoEditSmartRemoverSetup.exe';

  try {
    const filePath = path.join(process.cwd(), 'engine', localName);
    const st = await stat(filePath);
    const node = createReadStream(filePath);
    const webStream = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'content-type': wantZip ? 'application/zip' : 'application/octet-stream',
        'content-disposition': `attachment; filename="${fileName}"`,
        'content-length': String(st.size),
        'cache-control': 'public, max-age=3600',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: wantZip
          ? 'ZIP fallback indisponível. Gere com: node engine/package-remover.mjs'
          : 'Instalador indisponível. Gere com: node engine/package-remover.mjs',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
