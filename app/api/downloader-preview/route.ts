import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function provider(url: URL): 'youtube' | 'tiktok' | 'pinterest' | 'instagram' | null {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'pin.it' || host === 'pinterest.com' || /^pinterest\.[a-z.]+$/.test(host) || host.includes('.pinterest.')) return 'pinterest';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  return null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(html)?.[1];
    if (found) return decodeHtml(found.trim());
  }
  return null;
}

function youtubeThumbnail(url: URL): string | null {
  const id = url.hostname === 'youtu.be'
    ? url.pathname.split('/').filter(Boolean)[0]
    : url.searchParams.get('v') || (/\/(?:shorts|live)\/([\w-]+)/.exec(url.pathname) || [])[1];
  return /^[\w-]{6,20}$/.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

async function oembed(endpoint: string) {
  const response = await fetch(endpoint, {
    cache: 'no-store',
    headers: { 'user-agent': 'AutoEditDownloader/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data ? { thumbnailUrl: httpUrl(data.thumbnail_url), title: typeof data.title === 'string' ? data.title.slice(0, 240) : null } : null;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url') || '';
  let source: URL;
  try { source = new URL(raw); } catch { return NextResponse.json({ error: 'URL inválida.' }, { status: 400 }); }
  if (!/^https?:$/.test(source.protocol)) return NextResponse.json({ error: 'URL inválida.' }, { status: 400 });
  const kind = provider(source);
  if (!kind) return NextResponse.json({ error: 'Fonte não suportada.' }, { status: 400 });

  let result: { thumbnailUrl: string | null; title: string | null } | null = null;
  try {
    if (kind === 'youtube') result = { thumbnailUrl: youtubeThumbnail(source), title: null };
    if (kind === 'tiktok') result = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(source.href)}`);
    if (kind === 'pinterest') result = await oembed(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(source.href)}`);
    if (kind === 'instagram') {
      const response = await fetch(source.href, {
        cache: 'no-store',
        redirect: 'error',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; AutoEditDownloader/1.0)' },
        signal: AbortSignal.timeout(7000),
      });
      const html = response.ok ? await response.text() : '';
      result = { thumbnailUrl: httpUrl(meta(html, 'og:image')), title: meta(html, 'og:title')?.slice(0, 240) || null };
    }
  } catch {
    result = null;
  }
  return NextResponse.json(result || { thumbnailUrl: null, title: null }, {
    headers: { 'cache-control': 'private, max-age=300' },
  });
}
