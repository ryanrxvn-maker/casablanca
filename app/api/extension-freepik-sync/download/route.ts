import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { buildZip, type ZipEntry } from '@/lib/zip-builder';

/**
 * GET /api/extension-freepik-sync/download
 *
 * Empacota a Chrome Extension "DARKO LAB · Freepik Sync" num ZIP.
 * Extensão minimalista que lê cookies de magnific.com via chrome.cookies API
 * e sincroniza com /api/auto-broll-v2/save-creds. Substitui o copy/paste
 * manual de cookies pelo cliente.
 *
 * Fluxo de instalação:
 *   1. Baixa esse ZIP
 *   2. Descompacta numa pasta
 *   3. chrome://extensions → modo dev → "Carregar sem compactação"
 *   4. Aponta pra pasta
 *   5. Loga em magnific.com (Freepik Premium+)
 *   6. Auto-sync feito — pode disparar B-rolls no DARKO LAB.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const FILES = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js'];
const ICONS = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), 'extension-freepik-sync');
    const entries: ZipEntry[] = [];
    for (const name of FILES) {
      const buf = await readFile(path.join(baseDir, name));
      entries.push({ name, data: new Uint8Array(buf) });
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
        'content-disposition': 'attachment; filename="darkolab-freepik-sync.zip"',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[extension-freepik-sync/download]', e);
    return NextResponse.json(
      {
        error: 'Falha ao empacotar extension Freepik Sync.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
