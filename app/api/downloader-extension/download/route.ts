import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildZip } from '@/lib/zip-builder';

/**
 * GET /api/downloader-extension/download
 *
 * Empacota a extensao DarkoLab Downloader (UI no navegador) num ZIP.
 * Usuario: baixa -> descompacta -> chrome://extensions -> modo dev ->
 * "Carregar sem compactacao" -> seleciona a pasta.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const FILES = [
  'manifest.json',
  'bg.js',
  'bridge.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.css',
  'popup.js',
];
const ICONS = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), 'extension-downloader');
    const fileEntries = await Promise.all(
      FILES.map(async (name) => ({
        name,
        data: new Uint8Array(await readFile(path.join(baseDir, name))),
      })),
    );
    const iconEntries = await Promise.all(
      ICONS.map(async (name) => ({
        name: `icons/${name}`,
        data: new Uint8Array(await readFile(path.join(baseDir, 'icons', name))),
      })),
    );
    const zip = await buildZip([...fileEntries, ...iconEntries]);
    const arrayBuffer = await zip.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="darkolab-downloader-extension.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[downloader-extension/download]', e);
    return NextResponse.json(
      {
        error: 'Falha ao empacotar a extensao.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
