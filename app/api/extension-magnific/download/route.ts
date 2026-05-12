import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildZip, type ZipEntry } from '@/lib/zip-builder';

/**
 * GET /api/extension-magnific/download
 *
 * Empacota a Chrome Extension "DARKO LAB Magnific Auto" num ZIP e serve.
 * O ZIP contem manifest.json + content scripts + background worker + icones.
 *
 * Fluxo de instalacao do user:
 *   1. Baixa esse ZIP
 *   2. Descompacta numa pasta
 *   3. chrome://extensions -> modo dev -> "Carregar sem compactacao"
 *   4. Aponta pra pasta descompactada
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const FILES = [
  'manifest.json',
  'background.js',
  'bridge.js',
  'magnific-content.js',
  'README.md',
];

const ICONS = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), 'extension-magnific');
    const entries: ZipEntry[] = [];
    for (const name of FILES) {
      try {
        const buf = await readFile(path.join(baseDir, name));
        entries.push({ name, data: new Uint8Array(buf) });
      } catch (e) {
        if (name === 'README.md') continue;
        throw e;
      }
    }
    for (const name of ICONS) {
      const buf = await readFile(path.join(baseDir, 'icons', name));
      entries.push({ name: `icons/${name}`, data: new Uint8Array(buf) });
    }

    const zip = await buildZip(entries);
    const arrayBuffer = await zip.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition':
          'attachment; filename="darkolab-magnific-extension.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[extension-magnific/download]', e);
    return NextResponse.json(
      {
        error: 'Falha ao empacotar extension Magnific.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
