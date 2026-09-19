import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { DOWNLOADER_ENGINE_VERSION } from '@/lib/downloader-connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'extension-downloader', 'manifest.json'), 'utf8'));
  return NextResponse.json({
    version: manifest.version,
    minimumVersion: manifest.version,
    engineVersion: DOWNLOADER_ENGINE_VERSION,
    minimumEngineVersion: DOWNLOADER_ENGINE_VERSION,
    downloadUrl: `/api/downloader-extension/download?v=${manifest.version}`,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
