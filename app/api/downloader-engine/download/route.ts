import { NextResponse, type NextRequest } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';

/**
 * GET /api/downloader-engine/download
 *
 * Entrega AutoEditDownloaderSetup.exe — instalador nativo.
 *
 * Estratégia anti-antivírus (sem certificado de code signing):
 *  - Console visível (target:exe não winexe)
 *  - SEM ShowWindow hide, SEM -WindowStyle Hidden
 *  - SEM VBS gerado dinamicamente
 *  - SEM Startup folder mod direta — usa Task Scheduler (schtasks)
 *  - Manifest XML com asInvoker (não pede UAC)
 *  - AssemblyInfo com CompanyName/Description/Version completos
 *  - PowerShell rodado sem flags suspeitas (-NoProfile -Bypass apenas)
 *  - UseShellExecute=false → janela aparece no console pai
 *
 * Build: `node engine/build.mjs && node engine/package.mjs`
 *
 * Streaming pra time-to-first-byte mínimo — cliente começa a ver
 * progresso assim que o servidor lê a 1ª chunk do disco.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // ?format=zip → entrega o pkg.zip (scripts puros, sem .exe)
  // Pra casos extremos onde AV ainda bloqueia o .exe assinado.
  const { searchParams } = new URL(req.url);
  const wantZip = searchParams.get('format') === 'zip';

  const fileName = wantZip
    ? 'AutoEditDownloader.zip'
    : 'AutoEditDownloaderSetup.exe';
  const localName = wantZip ? 'pkg.zip' : 'AutoEditDownloaderSetup.exe';

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
          ? 'ZIP fallback indisponivel. Gere com: node engine/package.mjs (cria engine/pkg.zip).'
          : 'Instalador indisponivel. Gere com: node engine/build.mjs && node engine/package.mjs.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
