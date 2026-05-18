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

// ---------------------------------------------------------------------------
// Deteccao de binarios — ROBUSTA no Windows.
//
// child_process.spawn no Windows NAO resolve PATHEXT sem shell:true:
// spawn('yt-dlp') / spawn('python') FALHAM porque os arquivos reais sao
// `yt-dlp.exe` / `python.exe`. Solucao: resolver o CAMINHO ABSOLUTO via
// `where`/`which` e dar spawn no .exe absoluto (sem shell -> seguro com
// URLs que tem `&`). Falha NAO e cacheada (permite retry/auto-heal).
// ---------------------------------------------------------------------------

type Tool = { cmd: string; pre: string[] };

let ytDlpResolved: Tool | null = null;
let ytDlpInflight: Promise<Tool | null> | null = null;
let ffmpegResolved: string | null = null;
let aria2Resolved: string | null | undefined = undefined; // undefined=nao checado

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Caminho absoluto do executavel via `where`(win)/`which`(posix).
 *  `name` e SEMPRE um literal nosso (sem metachar) -> shell:true seguro. */
function whichAbs(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const p = spawn(finder, [name], { windowsHide: true, shell: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const first = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      resolve(first || null);
    });
  });
}

function probe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    // cmd aqui ja e caminho absoluto -> sem shell, seguro
    const p = spawn(cmd, args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

/** Diretorios Python comuns no Windows (instalacao por-usuario). */
async function winPythonDirs(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const roots = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, ''),
    'C:\\',
  ].filter(Boolean) as string[];
  const dirs: string[] = [];
  for (const root of roots) {
    try {
      for (const e of await readdir(root)) {
        if (/^Python3\d+$/i.test(e)) dirs.push(path.join(root, e));
      }
    } catch {
      /* root inexistente */
    }
  }
  return dirs;
}

async function resolveYtDlp(): Promise<Tool | null> {
  if (ytDlpResolved) return ytDlpResolved;
  if (ytDlpInflight) return ytDlpInflight;

  ytDlpInflight = (async (): Promise<Tool | null> => {
    const tryTool = async (t: Tool): Promise<Tool | null> =>
      t.cmd && (await probe(t.cmd, [...t.pre, '--version'])) ? t : null;

    // 1) override explicito por env
    const envYt = process.env.YTDLP_PATH;
    const envPy = process.env.PYTHON_PATH;
    const candidates: Tool[] = [];
    if (envYt) candidates.push({ cmd: envYt, pre: [] });
    if (envPy) candidates.push({ cmd: envPy, pre: ['-m', 'yt_dlp'] });

    // 2) PATH resolvido pra absoluto
    const ytAbs =
      (await whichAbs('yt-dlp')) || (await whichAbs('yt-dlp.exe'));
    if (ytAbs) candidates.push({ cmd: ytAbs, pre: [] });
    const pyAbs =
      (await whichAbs('python')) || (await whichAbs('python3'));
    if (pyAbs) candidates.push({ cmd: pyAbs, pre: ['-m', 'yt_dlp'] });
    const pyLauncher = await whichAbs('py');
    if (pyLauncher)
      candidates.push({ cmd: pyLauncher, pre: ['-3', '-m', 'yt_dlp'] });

    // 3) locais comuns do Windows
    for (const d of await winPythonDirs()) {
      const ytExe = path.join(d, 'Scripts', 'yt-dlp.exe');
      if (await fileExists(ytExe)) candidates.push({ cmd: ytExe, pre: [] });
      const pyExe = path.join(d, 'python.exe');
      if (await fileExists(pyExe))
        candidates.push({ cmd: pyExe, pre: ['-m', 'yt_dlp'] });
    }

    for (const c of candidates) {
      const ok = await tryTool(c);
      if (ok) {
        ytDlpResolved = ok;
        return ok;
      }
    }

    // 4) AUTO-HEAL: achou python mas sem modulo yt_dlp -> instala e tenta
    const anyPy =
      pyAbs ||
      envPy ||
      (await (async () => {
        for (const d of await winPythonDirs()) {
          const pe = path.join(d, 'python.exe');
          if (await fileExists(pe)) return pe;
        }
        return null;
      })());
    if (anyPy) {
      await new Promise<void>((res) => {
        const p = spawn(
          anyPy,
          ['-m', 'pip', 'install', '--upgrade', '--quiet', 'yt-dlp'],
          { windowsHide: true },
        );
        p.on('error', () => res());
        p.on('close', () => res());
      });
      const healed = await tryTool({ cmd: anyPy, pre: ['-m', 'yt_dlp'] });
      if (healed) {
        ytDlpResolved = healed;
        return healed;
      }
    }

    return null; // NAO cacheia falha -> proxima request tenta de novo
  })();

  try {
    return await ytDlpInflight;
  } finally {
    ytDlpInflight = null;
  }
}

async function resolveFfmpeg(): Promise<string> {
  if (ffmpegResolved) return ffmpegResolved;
  const env = process.env.FFMPEG_PATH;
  const found =
    (env && (await fileExists(env)) ? env : null) ||
    (await whichAbs('ffmpeg')) ||
    (await whichAbs('ffmpeg.exe'));
  ffmpegResolved = found || 'ffmpeg';
  return ffmpegResolved;
}

async function aria2Path(): Promise<string | null> {
  if (aria2Resolved !== undefined) return aria2Resolved;
  aria2Resolved =
    (await whichAbs('aria2c')) || (await whichAbs('aria2c.exe'));
  return aria2Resolved;
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
  const { code } = await run(await resolveFfmpeg(), ffArgs, workDir);
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
  const aria2 = await aria2Path();
  if (aria2) {
    base.push(
      '--downloader',
      aria2,
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
  referer?: string,
): Promise<Built> {
  const tool = await resolveYtDlp();
  if (!tool)
    return {
      error:
        'yt-dlp indisponivel e auto-instalacao falhou. Garanta Python no PATH (ou defina PYTHON_PATH/YTDLP_PATH) e ffmpeg no PATH.',
    };
  const refArgs = referer ? ['--add-header', `Referer:${referer}`] : [];
  const args = [
    ...tool.pre,
    ...(await ytDlpArgs(mode, quality, provider)),
    ...refArgs,
    url,
  ];
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

const TUBE_RE =
  /(pornhub|xvideos|xhamster|redtube|youporn|spankbang|eporner|tube8)\.[a-z.]+/i;

// URLs de bibliotecas de player / placeholders — NUNCA sao o video real.
const JUNK_MEDIA_RE =
  /(plyr\.io|jwplayer|jsdelivr|cdnjs|googletagmanager|gstatic|doubleclick|\/blank\.mp4|blank\.mp4|sample\.mp4|placeholder|\/ads?\/)/i;

function isRealMedia(u: string): boolean {
  return /^https?:\/\//i.test(u) && !JUNK_MEDIA_RE.test(u);
}

/**
 * Crack de embed pra blogs/mirrors +18 (xvideosputaria, buceteiro, …)
 * que nao tem extractor proprio: faz scrape da pagina e acha a midia
 * real — iframe pra tube conhecido, player HLS (vazounudes), ou
 * .m3u8/.mp4/og:video direto. Mesmo principio dos sites de download.
 */
async function resolveAdultEmbed(
  pageUrl: string,
): Promise<{ target: string; referer: string } | null> {
  let html: string;
  let origin: string;
  try {
    const u = new URL(pageUrl);
    origin = u.origin;
    const r = await fetch(pageUrl, {
      headers: { 'user-agent': UA, referer: origin + '/' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    html = await r.text();
  } catch {
    return null;
  }

  const iframes = [
    ...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi),
  ].map((m) => m[1].replace(/&amp;/g, '&'));

  // 1) iframe apontando pra um tube conhecido -> yt-dlp nativo resolve
  for (const src of iframes) {
    if (TUBE_RE.test(src)) {
      return { target: src.startsWith('//') ? 'https:' + src : src, referer: origin + '/' };
    }
  }

  // 2) player HLS embarcado (ex.: vazounudes video-player-d.php?id=UUID)
  for (const src of iframes) {
    const abs = src.startsWith('//')
      ? 'https:' + src
      : src.startsWith('http')
        ? src
        : origin + (src.startsWith('/') ? '' : '/') + src;
    try {
      const fr = await fetch(abs, {
        headers: { 'user-agent': UA, referer: origin + '/' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!fr.ok) continue;
      const fh = await fr.text();
      const refOrigin = new URL(abs).origin + '/';
      const m3u8 = [...fh.matchAll(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi)]
        .map((m) => m[0])
        .find(isRealMedia);
      if (m3u8) return { target: m3u8, referer: refOrigin };
      const mp4 = [...fh.matchAll(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi)]
        .map((m) => m[0])
        .find(isRealMedia);
      if (mp4) return { target: mp4, referer: refOrigin };
    } catch {
      /* tenta proximo */
    }
  }

  // 3) midia direta na propria pagina (ignorando lixo de player)
  const og = html.match(
    /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["'](https?:[^"']+)["']/i,
  );
  const direct =
    [...html.matchAll(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi)]
      .map((m) => m[0])
      .find(isRealMedia) ||
    (og && isRealMedia(og[1]) ? og[1] : null) ||
    [...html.matchAll(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi)]
      .map((m) => m[0])
      .find(isRealMedia);
  if (direct) return { target: direct, referer: origin + '/' };

  return null;
}

/**
 * Pipeline +18: tenta extractor nativo do yt-dlp (pornhub, xvideos,
 * xhamster, redtube, youporn) e, se o site for um mirror/blog sem
 * extractor, cai no crack de embed -> yt-dlp na midia real.
 */
async function fetchAdult(
  url: string,
  mode: Mode,
  quality: Quality,
  workDir: string,
): Promise<Built> {
  const native = await fetchYtDlp(url, mode, quality, 'adult', workDir);
  if (!('error' in native)) return native;

  const emb = await resolveAdultEmbed(url);
  if (emb) {
    const viaEmbed = await fetchYtDlp(
      emb.target,
      mode,
      quality,
      'adult',
      workDir,
      emb.referer,
    );
    if (!('error' in viaEmbed)) return viaEmbed;
    return {
      error: `nao foi possivel resolver a midia (site pode exigir login/assinatura ou carregar via JS). [${viaEmbed.error}]`,
    };
  }
  return {
    error: `nao foi possivel resolver a midia deste link (sem video extraivel — pode exigir login/assinatura ou ser pagina sem video). [${native.error}]`,
  };
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
    } else if (provider === 'adult') {
      built = await fetchAdult(url, mode, quality, workDir);
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
