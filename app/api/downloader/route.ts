import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * POST /api/downloader
 *
 * Baixa video/audio do YouTube, Instagram (Reels/posts) e TikTok usando
 * `yt-dlp` + `ffmpeg`. yt-dlp resolve a stream, ffmpeg faz o merge de
 * video+audio (ou a extracao de audio).
 *
 * Body JSON:
 *   { url: string, mode: 'video'|'audio-mp3'|'audio-wav', quality?: '1080'|'720'|'480'|'best' }
 *
 * Resposta: o arquivo binario (attachment) ou JSON de erro.
 *
 * NOTA: roda em runtime Node e depende dos binarios `yt-dlp` (ou
 * `python -m yt_dlp`) e `ffmpeg` no PATH do servidor. Funciona em
 * ambiente local / self-hosted (nao em serverless puro da Vercel).
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

/** Resolve qual comando usar: `yt-dlp` standalone ou `python -m yt_dlp`. */
async function resolveYtDlp(): Promise<{ cmd: string; pre: string[] } | null> {
  const candidates: { cmd: string; pre: string[] }[] = [
    { cmd: 'yt-dlp', pre: [] },
    { cmd: process.platform === 'win32' ? 'python' : 'python3', pre: ['-m', 'yt_dlp'] },
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

function buildArgs(mode: Mode, quality: Quality): string[] {
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

  // video — merge bestvideo+bestaudio em mp4
  const v: string[] = [
    ...base,
    '--merge-output-format',
    'mp4',
    '-f',
    'bv*+ba/b',
  ];
  if (quality !== 'best') {
    v.push('-S', `res:${quality},ext:mp4:m4a`);
  } else {
    v.push('-S', 'ext:mp4:m4a');
  }
  return v;
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

    const tool = await resolveYtDlp();
    if (!tool) {
      return NextResponse.json(
        {
          error:
            'yt-dlp nao encontrado no servidor. Instale com: pip install yt-dlp (e tenha ffmpeg no PATH).',
        },
        { status: 500 },
      );
    }

    workDir = await mkdtemp(path.join(os.tmpdir(), 'darkolab-dl-'));
    const args = [...tool.pre, ...buildArgs(mode, quality), url];

    const { code, stderr } = await run(tool.cmd, args, workDir);
    if (code !== 0) {
      const clean = stderr
        .split('\n')
        .filter((l) => /error|unsupported|unavailable|private|login/i.test(l))
        .slice(-4)
        .join(' ')
        .trim();
      return NextResponse.json(
        {
          error:
            'Falha no download. ' +
            (clean ||
              'Verifique se o link e publico (Instagram/TikTok privados exigem login).'),
        },
        { status: 502 },
      );
    }

    // Pega o maior arquivo gerado que nao seja temporario (.part/.ytdl).
    const names = await readdir(workDir);
    const files = (
      await Promise.all(
        names
          .filter((n) => !/\.(part|ytdl|temp)$/i.test(n))
          .map(async (n) => {
            const full = path.join(workDir as string, n);
            const s = await stat(full);
            return s.isFile() ? { n, full, size: s.size } : null;
          }),
      )
    ).filter(Boolean) as { n: string; full: string; size: number }[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'Download concluiu mas nenhum arquivo foi gerado.' },
        { status: 502 },
      );
    }
    files.sort((a, b) => b.size - a.size);
    const out = files[0];
    const ext = path.extname(out.n).toLowerCase();
    const data = await readFile(out.full);

    const headers = new Headers();
    headers.set(
      'content-type',
      CONTENT_TYPES[ext] ?? 'application/octet-stream',
    );
    headers.set(
      'content-disposition',
      `attachment; filename="${out.n.replace(/"/g, '')}"`,
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
