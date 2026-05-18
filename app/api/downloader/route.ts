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
import { requireAdmin } from '@/app/api/admin/_helpers';

/**
 * POST /api/downloader
 *
 * Baixa video/audio/imagem do YouTube, Instagram, TikTok e Pinterest.
 *
 * - TikTok   : esquema savett.cc — resolver tikwm (sem marca d'agua HD,
 *              sem login). Video em modo "video" e STREAMADO direto
 *              (sem tocar disco) pra latencia minima.
 * - Pinterest: esquema klickpin — extrai a midia direta do pin via
 *              yt-dlp (video mp4 ou imagem), sem login.
 * - YouTube/Instagram: yt-dlp + ffmpeg.
 *
 * Otimizacoes de velocidade (todos os providers):
 *   - resolucao de yt-dlp/aria2c memoizada no modulo (zero spawn extra
 *     por request depois do 1o);
 *   - download paralelo: `-N 8` fragmentos + aria2c (se instalado);
 *   - sem reescrever mtime; TikTok video sem buffer em disco.
 *
 * Body: { url, mode:'video'|'audio-mp3'|'audio-wav', quality?:'1080'|'720'|'480'|'best' }
 *
 * NOTA: runtime Node, depende de `yt-dlp` (ou `python -m yt_dlp`) e
 * `ffmpeg` no PATH. Local / self-hosted (nao serverless puro Vercel).
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type Mode = 'video' | 'audio-mp3' | 'audio-wav';
type Quality = '1080' | '720' | '480' | 'best';
type Provider = 'tiktok' | 'pinterest' | 'generic' | 'adult';

/**
 * Bases de dominio do modo +18 (admin-only). yt-dlp tem extractor
 * nativo pra pornhub/xhamster/redtube/youporn/xvideos; subdominios de
 * pais casam no extractor; mirrors caem no extractor generico.
 */
const ADULT_BASES = [
  'pornhub.com',
  'xhamster.com',
  'xhamster.desi',
  'xhamster2.com',
  'redtube.com',
  'redtube.com.br',
  'youporn.com',
  'xvideos.com',
  'xvideosputaria.com',
  'buceteiro.com',
];

const URL_RE = /^https?:\/\/[^\s]+$/i;

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Dominio liberado + a que provider ele pertence. */
function classify(host: string): Provider | null {
  const h = host.replace(/^www\./, '').toLowerCase();
  if (
    ADULT_BASES.some((b) => h === b || h.endsWith('.' + b))
  ) {
    return 'adult';
  }
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'pin.it' || /(^|\.)pinterest\.[a-z.]+$/.test(h)) return 'pinterest';
  if (
    h === 'youtube.com' ||
    h.endsWith('.youtube.com') ||
    h === 'youtu.be' ||
    h === 'instagram.com' ||
    h.endsWith('.instagram.com') ||
    h === 'instagr.am'
  ) {
    return 'generic';
  }
  return null;
}

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

// --- deteccao de binarios, memoizada no modulo (1x por processo) ---
let ytDlpPromise: Promise<{ cmd: string; pre: string[] } | null> | null = null;
let aria2Promise: Promise<boolean> | null = null;

function probe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

function resolveYtDlp() {
  if (!ytDlpPromise) {
    ytDlpPromise = (async () => {
      const cands: { cmd: string; pre: string[] }[] = [
        { cmd: 'yt-dlp', pre: [] },
        { cmd: 'yt-dlp.exe', pre: [] },
        { cmd: 'python', pre: ['-m', 'yt_dlp'] },
        { cmd: 'python3', pre: ['-m', 'yt_dlp'] },
        // Windows Python launcher (py) — comum quando python nao esta no PATH
        { cmd: 'py', pre: ['-3', '-m', 'yt_dlp'] },
        { cmd: 'py', pre: ['-m', 'yt_dlp'] },
      ];
      for (const c of cands) {
        if (await probe(c.cmd, [...c.pre, '--version'])) return c;
      }
      return null;
    })();
  }
  return ytDlpPromise;
}

function hasAria2() {
  if (!aria2Promise) aria2Promise = probe('aria2c', ['--version']);
  return aria2Promise;
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

type Built =
  | { stream: ReadableStream; name: string; contentType: string }
  | { file: string; name: string }
  | { error: string };

/**
 * TikTok no esquema savett: resolver tikwm -> hdplay (sem marca
 * d'agua). Modo video = STREAM direto do CDN (zero disco). Audio =
 * baixa + ffmpeg.
 */
async function fetchTikTok(
  url: string,
  mode: Mode,
  workDir: string,
): Promise<Built> {
  const api = `https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`;
  let data: Record<string, unknown>;
  try {
    const r = await fetch(api, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { error: `resolver HTTP ${r.status}` };
    const j = (await r.json()) as { code?: number; msg?: string; data?: any };
    if (j.code !== 0 || !j.data)
      return { error: j.msg || 'resolver sem dados (privado/removido?)' };
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

  let vr: Response;
  try {
    vr = await fetch(videoUrl, {
      headers: { 'user-agent': UA, referer: 'https://www.tikwm.com/' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'download falhou' };
  }
  if (!vr.ok || !vr.body)
    return { error: `download da midia HTTP ${vr.status}` };

  // modo video: streama o CDN direto pro cliente (sem buffer/disco)
  if (mode === 'video') {
    return {
      stream: vr.body,
      name: safeName(title, 'mp4'),
      contentType: 'video/mp4',
    };
  }

  // audio: precisa do arquivo em disco pro ffmpeg
  const buf = Buffer.from(await vr.arrayBuffer());
  if (buf.length < 1024) return { error: 'midia vazia' };
  const srcPath = path.join(workDir, 'tt-src.mp4');
  await writeFile(srcPath, buf);
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

async function ytDlpArgs(
  mode: Mode,
  quality: Quality,
  provider: Provider,
): Promise<string[]> {
  const base = [
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--no-progress',
    '--no-mtime',
    '-N',
    '8',
    '--retries',
    '3',
    '--socket-timeout',
    '20',
    '-o',
    '%(title).80B-%(id)s.%(ext)s',
  ];
  if (provider === 'adult') {
    // alguns tubes bloqueiam UA nao-browser
    base.push('--user-agent', UA, '--extractor-retries', '3');
  }
  if (await hasAria2()) {
    base.push(
      '--downloader',
      'aria2c',
      '--downloader-args',
      'aria2c:-x16 -s16 -k1M -j16',
    );
  }

  if (mode === 'audio-mp3')
    return [...base, '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  if (mode === 'audio-wav')
    return [...base, '-x', '--audio-format', 'wav'];

  // VIDEO. Pinterest pode ser imagem -> nao forcar merge/format estrito.
  if (provider === 'pinterest') {
    return [...base, '-f', 'b/bv*+ba/best', '--merge-output-format', 'mp4'];
  }
  const v = [...base, '--merge-output-format', 'mp4', '-f', 'bv*+ba/b'];
  v.push(
    '-S',
    quality !== 'best' ? `res:${quality},ext:mp4:m4a` : 'ext:mp4:m4a',
  );
  return v;
}

async function fetchYtDlp(
  url: string,
  mode: Mode,
  quality: Quality,
  provider: Provider,
  workDir: string,
): Promise<Built> {
  const tool = await resolveYtDlp();
  if (!tool)
    return {
      error:
        'yt-dlp nao encontrado no servidor. Instale com: pip install yt-dlp (e tenha ffmpeg no PATH).',
    };
  const args = [...tool.pre, ...(await ytDlpArgs(mode, quality, provider)), url];
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
        'Verifique se o link e publico (conteudo privado exige login).',
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
      adult?: boolean;
    };
    const url = (body.url ?? '').trim();
    const mode: Mode = body.mode ?? 'video';
    const quality: Quality = body.quality ?? '1080';
    const adult = body.adult === true;

    if (!url || !URL_RE.test(url))
      return NextResponse.json({ error: 'URL invalida.' }, { status: 400 });
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return NextResponse.json({ error: 'URL invalida.' }, { status: 400 });
    }
    const provider = classify(host);
    if (!provider)
      return NextResponse.json(
        {
          error:
            'Dominio nao suportado. Use YouTube, Instagram, TikTok ou Pinterest.',
        },
        { status: 400 },
      );

    // Modo +18: SO admin autenticado, e so com a flag explicita ligada.
    // Gate real no servidor — usuario normal nao acessa nem forjando body.
    if (provider === 'adult') {
      if (!adult)
        return NextResponse.json(
          { error: 'Conteudo +18: ative o modo +18 no Downloader.' },
          { status: 400 },
        );
      const guard = await requireAdmin();
      if (!guard.ok)
        return NextResponse.json(
          { error: 'Modo +18 restrito a administradores.' },
          { status: 403 },
        );
    }
    if (!['video', 'audio-mp3', 'audio-wav'].includes(mode))
      return NextResponse.json({ error: 'Modo invalido.' }, { status: 400 });

    workDir = await mkdtemp(path.join(os.tmpdir(), 'darkolab-dl-'));

    let built: Built;
    if (provider === 'tiktok') {
      built = await fetchTikTok(url, mode, workDir);
      if ('error' in built) {
        const fb = await fetchYtDlp(
          url,
          mode,
          quality,
          'generic',
          workDir,
        );
        built =
          'error' in fb
            ? { error: `TikTok: ${built.error}. Fallback yt-dlp: ${fb.error}` }
            : fb;
      }
    } else {
      built = await fetchYtDlp(url, mode, quality, provider, workDir);
    }

    if ('error' in built)
      return NextResponse.json(
        { error: 'Falha no download. ' + built.error },
        { status: 502 },
      );

    // Resposta STREAMADA (TikTok video) — latencia minima, sem disco.
    if ('stream' in built) {
      return new NextResponse(built.stream, {
        status: 200,
        headers: {
          'content-type': built.contentType,
          'content-disposition': `attachment; filename="${built.name.replace(/"/g, '')}"`,
          'cache-control': 'no-store',
        },
      });
    }

    const ext = path.extname(built.name).toLowerCase();
    const data = await readFile(built.file);
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${built.name.replace(/"/g, '')}"`,
        'content-length': String(data.length),
        'cache-control': 'no-store',
      },
    });
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
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
