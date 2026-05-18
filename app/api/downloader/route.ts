import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * POST /api/downloader
 *
 * Baixa video/audio do YouTube, Instagram (Reels/posts) e TikTok.
 *
 * - TikTok: usa o MESMO esquema do savett.cc — API resolvedora
 *   (tikwm) que devolve a stream SEM marca d'agua em HD + o audio,
 *   sem precisar de login. Se o resolver falhar, cai pro yt-dlp.
 * - YouTube/Instagram: yt-dlp + ffmpeg (merge bestvideo+bestaudio).
 *
 * Body JSON:
 *   { url: string, mode: 'video'|'audio-mp3'|'audio-wav', quality?: '1080'|'720'|'480'|'best' }
 *
 * Resposta: o arquivo binario (attachment) ou JSON de erro.
 *
 * NOTA: roda em runtime Node e depende dos binarios `yt-dlp` (ou
 * `python -m yt_dlp`) e `ffmpeg` no PATH. Funciona em ambiente local /
 * self-hosted (nao em serverless puro da Vercel).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type Mode = 'video' | 'audio-mp3' | 'audio-wav';
type Quality = '1080' | '720' | '480' | 'best';

const URL_RE = /^https?:\/\/[^\s]+$/i;
const ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'm.youtube.com',
  'instagram.com',
  'instagr.am',
  'tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
];

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Nome de arquivo seguro (ASCII, sem espaco/aspas), com extensao. */
function safeName(title: string, ext: string): string {
  const base =
    (title || 'video')
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 80) || 'video';
  return `${base}.${ext}`;
}

/** Resolve qual comando usar: `yt-dlp` standalone ou `python -m yt_dlp`. */
async function resolveYtDlp(): Promise<{ cmd: string; pre: string[] } | null> {
  const candidates: { cmd: string; pre: string[] }[] = [
    { cmd: 'yt-dlp', pre: [] },
    {
      cmd: process.platform === 'win32' ? 'python' : 'python3',
      pre: ['-m', 'yt_dlp'],
    },
    { cmd: 'python', pre: ['-m', 'yt_dlp'] },
  ];
  for (const c of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(c.cmd, [...c.pre, '--version'], { windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
    if (ok) return c;
  }
  return null;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    p.on('error', (e) => resolve({ code: -1, stderr: String(e) }));
    p.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

type Built = { file: string; name: string };

/**
 * Esquema savett.cc para TikTok: resolver tikwm -> URL sem marca
 * d'agua (hdplay) -> baixa os bytes. Audio sai via ffmpeg do proprio
 * video (garante que casa com a stream baixada).
 */
async function fetchTikTok(
  url: string,
  mode: Mode,
  workDir: string,
): Promise<Built | { error: string }> {
  const api = `https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`;
  let data: Record<string, unknown>;
  try {
    const r = await fetch(api, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return { error: `resolver HTTP ${r.status}` };
    const j = (await r.json()) as { code?: number; msg?: string; data?: any };
    if (j.code !== 0 || !j.data) {
      return { error: j.msg || 'resolver sem dados (privado/removido?)' };
    }
    data = j.data;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'resolver falhou' };
  }

  const videoUrl =
    (data.hdplay as string) ||
    (data.play as string) ||
    (data.wmplay as string);
  if (!videoUrl) return { error: 'sem stream de video' };

  const title = (data.title as string) || (data.id as string) || 'tiktok';
  let buf: Buffer;
  try {
    const vr = await fetch(videoUrl, {
      headers: { 'user-agent': UA, referer: 'https://www.tikwm.com/' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!vr.ok) return { error: `download da midia HTTP ${vr.status}` };
    buf = Buffer.from(await vr.arrayBuffer());
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'download falhou' };
  }
  if (buf.length < 1024) return { error: 'midia vazia' };

  const srcPath = path.join(workDir, 'tt-src.mp4');
  await writeFile(srcPath, buf);

  if (mode === 'video') {
    return { file: srcPath, name: safeName(title, 'mp4') };
  }

  const ext = mode === 'audio-wav' ? 'wav' : 'mp3';
  const outPath = path.join(workDir, `tt-out.${ext}`);
  const ffArgs =
    mode === 'audio-wav'
      ? ['-y', '-i', srcPath, '-vn', outPath]
      : ['-y', '-i', srcPath, '-vn', '-b:a', '192k', outPath];
  const { code } = await run('ffmpeg', ffArgs, workDir);
  if (code !== 0) return { error: 'ffmpeg falhou na extracao de audio' };
  return { file: outPath, name: safeName(title, ext) };
}

function ytDlpArgs(mode: Mode, quality: Quality): string[] {
  const base = [
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--no-progress',
    '--retries',
    '3',
    '--socket-timeout',
    '20',
    '-o',
    '%(title).80B-%(id)s.%(ext)s',
  ];
  if (mode === 'audio-mp3') {
    return [...base, '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  }
  if (mode === 'audio-wav') {
    return [...base, '-x', '--audio-format', 'wav'];
  }
  const v = [...base, '--merge-output-format', 'mp4', '-f', 'bv*+ba/b'];
  v.push('-S', quality !== 'best' ? `res:${quality},ext:mp4:m4a` : 'ext:mp4:m4a');
  return v;
}

async function fetchYtDlp(
  url: string,
  mode: Mode,
  quality: Quality,
  workDir: string,
): Promise<Built | { error: string }> {
  const tool = await resolveYtDlp();
  if (!tool) {
    return {
      error:
        'yt-dlp nao encontrado no servidor. Instale com: pip install yt-dlp (e tenha ffmpeg no PATH).',
    };
  }
  const args = [...tool.pre, ...ytDlpArgs(mode, quality), url];
  const { code, stderr } = await run(tool.cmd, args, workDir);
  if (code !== 0) {
    const clean = stderr
      .split('\n')
      .filter((l) => /error|unsupported|unavailable|private|login/i.test(l))
      .slice(-3)
      .join(' ')
      .trim();
    return {
      error:
        clean ||
        'Verifique se o link e publico (Instagram/TikTok privados exigem login).',
    };
  }
  const names = await readdir(workDir);
  const files = (
    await Promise.all(
      names
        .filter((n) => !/\.(part|ytdl|temp)$/i.test(n))
        .map(async (n) => {
          const full = path.join(workDir, n);
          const s = await stat(full);
          return s.isFile() ? { n, full, size: s.size } : null;
        }),
    )
  ).filter(Boolean) as { n: string; full: string; size: number }[];
  if (files.length === 0) return { error: 'nenhum arquivo gerado' };
  files.sort((a, b) => b.size - a.size);
  return { file: files[0].full, name: files[0].n };
}

export async function POST(req: NextRequest) {
  let workDir: string | null = null;
  try {
    const body = (await req.json()) as {
      url?: string;
      mode?: Mode;
      quality?: Quality;
    };
    const url = (body.url ?? '').trim();
    const mode: Mode = body.mode ?? 'video';
    const quality: Quality = body.quality ?? '1080';

    if (!url || !URL_RE.test(url)) {
      return NextResponse.json({ error: 'URL invalida.' }, { status: 400 });
    }
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return NextResponse.json({ error: 'URL invalida.' }, { status: 400 });
    }
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      return NextResponse.json(
        {
          error:
            'Dominio nao suportado. Use links do YouTube, Instagram ou TikTok.',
        },
        { status: 400 },
      );
    }
    if (!['video', 'audio-mp3', 'audio-wav'].includes(mode)) {
      return NextResponse.json({ error: 'Modo invalido.' }, { status: 400 });
    }

    workDir = await mkdtemp(path.join(os.tmpdir(), 'darkolab-dl-'));

    const isTikTok =
      host === 'tiktok.com' || host.endsWith('.tiktok.com');

    let built: Built | { error: string };
    if (isTikTok) {
      // 1) esquema savett (sem marca d'agua, HD, sem login)
      built = await fetchTikTok(url, mode, workDir);
      // 2) fallback yt-dlp se o resolver falhar
      if ('error' in built) {
        const fb = await fetchYtDlp(url, mode, quality, workDir);
        if (!('error' in fb)) built = fb;
        else
          built = {
            error: `TikTok: ${built.error}. Fallback yt-dlp: ${fb.error}`,
          };
      }
    } else {
      built = await fetchYtDlp(url, mode, quality, workDir);
    }

    if ('error' in built) {
      return NextResponse.json(
        { error: 'Falha no download. ' + built.error },
        { status: 502 },
      );
    }

    const ext = path.extname(built.name).toLowerCase();
    const data = await readFile(built.file);
    const headers = new Headers();
    headers.set(
      'content-type',
      CONTENT_TYPES[ext] ?? 'application/octet-stream',
    );
    headers.set(
      'content-disposition',
      `attachment; filename="${built.name.replace(/"/g, '')}"`,
    );
    headers.set('content-length', String(data.length));
    headers.set('cache-control', 'no-store');
    return new NextResponse(new Uint8Array(data), { status: 200, headers });
  } catch (e) {
    console.error('[downloader]', e);
    return NextResponse.json(
      {
        error: 'Erro interno no downloader.',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  } finally {
    if (workDir) {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
