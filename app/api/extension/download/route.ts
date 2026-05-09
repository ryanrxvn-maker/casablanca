import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildZip } from '@/lib/zip-builder';

/**
 * GET /api/extension/download
 *
 * Empacota os arquivos da Chrome Extension DARKO LAB num ZIP e serve.
 * O ZIP contem manifest.json + content scripts + background worker.
 *
 * O usuario:
 *   1. Baixa esse ZIP
 *   2. Descompacta numa pasta
 *   3. chrome://extensions → modo dev → carregar sem compactacao
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const FILES = [
  'manifest.json',
  'background.js',
  'bridge.js',
  'heygen-content.js',
  'README.md',
];

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), 'extension');
    const entries = await Promise.all(
      FILES.map(async (name) => {
        const buf = await readFile(path.join(baseDir, name));
        return { name, data: new Uint8Array(buf) };
      }),
    );

    const zip = await buildZip(entries);
    const arrayBuffer = await zip.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="darkolab-heygen-extension.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[extension/download]', e);
    return NextResponse.json(
      {
        error: 'Falha ao empacotar extension.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
