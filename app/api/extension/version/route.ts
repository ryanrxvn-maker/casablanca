import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The manifest is the single source of truth for both detection and download. */
export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), 'extension', 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as { version?: unknown };
    const version = String(manifest.version || '').replace(/[^0-9.]/g, '');
    if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error('Versão inválida no manifest da Hey Auto.');
    return NextResponse.json(
      { version, downloadUrl: `/api/extension/download?v=${encodeURIComponent(version)}` },
      { headers: { 'cache-control': 'private, no-store, no-cache, must-revalidate, max-age=0', pragma: 'no-cache', expires: '0' } },
    );
  } catch (error) {
    console.error('[extension/version]', error);
    return NextResponse.json({ error: 'Não foi possível conferir a versão publicada da extensão.' }, { status: 500 });
  }
}
