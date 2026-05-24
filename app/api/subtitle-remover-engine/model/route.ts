import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';
import { requirePro } from '@/app/api/admin/_helpers';

/**
 * GET /api/subtitle-remover-engine/model
 *
 * Serve o modelo neural STTN (`infer_model.pth`, ~66 MB) usado pelo
 * Smart Remover. ANTES era embedded no EXE — o que inflava o
 * AutoEditSmartRemoverSetup.exe pra 59 MB. Agora o EXE é leve (~250 KB)
 * e baixa esse modelo durante a instalação.
 *
 * Vantagens:
 *  - Download do .exe rápido (250 KB vs 59 MB)
 *  - Cache no Vercel CDN
 *  - Se user já instalou antes, Instalar.ps1 pula este download
 *
 * Auth: Pro+ (mesmo gate do installer)
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const guard = await requirePro();
  if (!guard.ok) return guard.response;

  try {
    const modelPath = path.join(
      process.cwd(),
      'engine',
      'subtitle-remover-pkg',
      'sttn',
      'infer_model.pth',
    );
    const st = await stat(modelPath);
    const node = createReadStream(modelPath);
    const webStream = Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="infer_model.pth"',
        'content-length': String(st.size),
        // Vercel pode cachear esse arquivo grande (raramente muda)
        'cache-control': 'public, max-age=86400, immutable',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Modelo indisponível.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 },
    );
  }
}
