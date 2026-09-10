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
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FILES = [
  'manifest.json',
  'background.js',
  'bridge.js',
  'heygen-content.js',
];

const ICONS = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), 'extension');
    const fileEntries = await Promise.all(
      FILES.map(async (name) => {
        const buf = await readFile(path.join(baseDir, name));
        return { name, data: new Uint8Array(buf) };
      }),
    );
    const iconEntries = await Promise.all(
      ICONS.map(async (name) => {
        const buf = await readFile(path.join(baseDir, 'icons', name));
        return { name: `icons/${name}`, data: new Uint8Array(buf) };
      }),
    );
    const entries = [...fileEntries, ...iconEntries];
    const manifest = JSON.parse(new TextDecoder().decode(fileEntries.find((entry) => entry.name === 'manifest.json')!.data));
    const version = String(manifest.version || 'latest').replace(/[^0-9.]/g, '');

    const zip = await buildZip(entries);
    const arrayBuffer = await zip.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="auto-edit-heygen-extension-v${version}.zip"`,
        'cache-control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'x-autoedit-extension-version': version,
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
