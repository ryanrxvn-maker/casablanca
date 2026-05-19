/**
 * downloader-core — pipeline de download AGNOSTICO de framework.
 *
 * Mesma logica usada pela rota Next (app/api/downloader) e pelo motor
 * standalone (engine/) da extensao. NAO importa next/server nem nada
 * de Supabase: a autenticacao/gate +18 e responsabilidade de quem
 * chama (a rota Next usa requireAdmin; o motor usa token local).
 *
 * Suporta: YouTube, Instagram, TikTok (savett/tikwm), Pinterest
 * (klickpin), e +18 (impersonate + crack de embed + headless).
 */

import { spawn } from 'child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

export type Mode = 'video' | 'audio-mp3' | 'audio-wav';
export type Quality = '1080' | '720' | '480' | 'best';
type Provider = 'tiktok' | 'pinterest' | 'generic' | 'adult';

export const ADULT_BASES = [
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

export const CONTENT_TYPES: Record<string, string> = {
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

/** Classifica o dominio. Retorna null se nao suportado. */
export function classify(host: string): Provider | null {
  const h = host.replace(/^www\./, '').toLowerCase();
  if (ADULT_BASES.some((b) => h === b || h.endsWith('.' + b))) return 'adult';
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

// ---- deteccao de binarios (robusta no Windows: caminho absoluto) ----
type Tool = { cmd: string; pre: string[] };
let ytDlpResolved: Tool | null = null;
let ytDlpInflight: Promise<Tool | null> | null = null;
let ffmpegResolved: string | null = null;
let aria2Resolved: string | null | undefined = undefined;

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

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
    const p = spawn(cmd, args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

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

    const envYt = process.env.YTDLP_PATH;
    const envPy = process.env.PYTHON_PATH;
    const candidates: Tool[] = [];
    if (envYt) candidates.push({ cmd: envYt, pre: [] });
    if (envPy) candidates.push({ cmd: envPy, pre: ['-m', 'yt_dlp'] });

    const ytAbs =
      (await whichAbs('yt-dlp')) || (await whichAbs('yt-dlp.exe'));
    if (ytAbs) candidates.push({ cmd: ytAbs, pre: [] });
    const pyAbs = (await whichAbs('python')) || (await whichAbs('python3'));
    if (pyAbs) candidates.push({ cmd: pyAbs, pre: ['-m', 'yt_dlp'] });
    const pyLauncher = await whichAbs('py');
    if (pyLauncher)
      candidates.push({ cmd: pyLauncher, pre: ['-3', '-m', 'yt_dlp'] });

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
          [
            '-m',
            'pip',
            'install',
            '--upgrade',
            '--quiet',
            'yt-dlp[default,curl-cffi]',
            'curl_cffi',
          ],
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
    return null;
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
  timeoutMs?: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    let stderr = '';
    let done = false;
    const finish = (code: number, extra = '') => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stderr: stderr + extra });
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          try {
            p.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          finish(-1, '\n[timeout: processo morto]');
        }, timeoutMs)
      : null;
    p.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    p.on('error', (e) => finish(-1, String(e)));
    p.on('close', (code) => finish(code ?? -1));
  });
}

// Built interno: arquivo em disco, midia remota (TikTok fast path) ou erro.
type Built =
  | { remote: string; headers: Record<string, string>; name: string; contentType: string }
  | { file: string; name: string }
  | { error: string };

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

  if (mode === 'video') {
    // fast path: deixa o chamador streamar direto do CDN (sem disco)
    return {
      remote: videoUrl,
      headers: { 'user-agent': UA, referer: 'https://www.tikwm.com/' },
      name: safeName(title, 'mp4'),
      contentType: 'video/mp4',
    };
  }
  let vr: Response;
  try {
    vr = await fetch(videoUrl, {
      headers: { 'user-agent': UA, referer: 'https://www.tikwm.com/' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'download falhou' };
  }
  if (!vr.ok) return { error: `download da midia HTTP ${vr.status}` };
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
    base.push(
      '--impersonate',
      'chrome',
      '--user-agent',
      UA,
      '--extractor-retries',
      '3',
    );
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
  if (mode === 'audio-wav') return [...base, '-x', '--audio-format', 'wav'];
  if (provider === 'pinterest')
    return [...base, '-f', 'b/bv*+ba/best', '--merge-output-format', 'mp4'];
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
  // teto generoso: video grande conclui (ex.: 30+min), mas processo
  // realmente travado morre. --socket-timeout ja corta stalls de rede.
  const { code, stderr } = await run(tool.cmd, args, workDir, 1_500_000);
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
const JUNK_MEDIA_RE =
  /(plyr\.io|jwplayer|jsdelivr|cdnjs|googletagmanager|gstatic|doubleclick|\/blank\.mp4|blank\.mp4|sample\.mp4|placeholder|\/ads?\/)/i;
function isRealMedia(u: string): boolean {
  return /^https?:\/\//i.test(u) && !JUNK_MEDIA_RE.test(u);
}

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
  for (const src of iframes) {
    if (TUBE_RE.test(src))
      return {
        target: src.startsWith('//') ? 'https:' + src : src,
        referer: origin + '/',
      };
  }
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

function normalizeAdultUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    for (const base of [
      'pornhub.com',
      'youporn.com',
      'redtube.com',
      'xvideos.com',
    ]) {
      if (h === base || h.endsWith('.' + base)) {
        u.hostname = 'www.' + base;
        return u.toString();
      }
    }
    return raw;
  } catch {
    return raw;
  }
}

async function fetchAdult(
  url: string,
  mode: Mode,
  quality: Quality,
  workDir: string,
): Promise<Built> {
  const native = await fetchYtDlp(
    normalizeAdultUrl(url),
    mode,
    quality,
    'adult',
    workDir,
  );
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
  }

  try {
    const { grabMedia } = await import('./headless-grab');
    // headless com teto duro de 70s — nunca trava infinito
    const grab = await Promise.race([
      grabMedia(url),
      new Promise<null>((r) => setTimeout(() => r(null), 70_000)),
    ]);
    if (grab && 'm3u8' in grab) {
      const viaHls = await fetchYtDlp(
        grab.m3u8,
        mode,
        quality,
        'adult',
        workDir,
        grab.referer,
      );
      if (!('error' in viaHls)) return viaHls;
    } else if (grab && 'buffer' in grab) {
      if (mode === 'video') {
        const name = safeName(
          new URL(url).pathname.split('/').filter(Boolean).pop() || 'video',
          grab.ext,
        );
        const fp = path.join(workDir, name);
        await writeFile(fp, grab.buffer);
        return { file: fp, name };
      }
      const src = path.join(workDir, 'hl-src.mp4');
      await writeFile(src, grab.buffer);
      const ext = mode === 'audio-wav' ? 'wav' : 'mp3';
      const outP = path.join(workDir, `hl-out.${ext}`);
      const ff =
        mode === 'audio-wav'
          ? ['-y', '-i', src, '-vn', outP]
          : ['-y', '-i', src, '-vn', '-b:a', '192k', outP];
      const { code } = await run(await resolveFfmpeg(), ff, workDir);
      if (code === 0)
        return {
          file: outP,
          name: safeName(
            new URL(url).pathname.split('/').filter(Boolean).pop() ||
              'audio',
            ext,
          ),
        };
    }
  } catch {
    /* headless indisponivel */
  }

  return {
    error: `nao foi possivel resolver a midia (site pode exigir login/assinatura, ou o Chromium do headless nao esta instalado). [${native.error}]`,
  };
}

// --------------------------- API publica ---------------------------

export type DownloadInput = {
  url: string;
  mode?: Mode;
  quality?: Quality;
  adult?: boolean; // ja autorizado pelo chamador (gate e do chamador)
};

export type DownloadResult =
  | {
      ok: true;
      kind: 'file';
      filePath: string;
      name: string;
      contentType: string;
      dispose: () => Promise<void>;
    }
  | {
      ok: true;
      kind: 'remote';
      url: string;
      headers: Record<string, string>;
      name: string;
      contentType: string;
      dispose: () => Promise<void>;
    }
  | { ok: false; status: number; error: string };

/**
 * Resolve e baixa a midia. NAO faz auth: quem chama deve ter validado
 * o gate +18 (passar adult=true so depois de autorizar).
 */
export async function processDownload(
  input: DownloadInput,
): Promise<DownloadResult> {
  const url = (input.url ?? '').trim();
  const mode: Mode = input.mode ?? 'video';
  const quality: Quality = input.quality ?? '1080';
  const adult = input.adult === true;

  if (!url || !URL_RE.test(url))
    return { ok: false, status: 400, error: 'URL invalida.' };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, status: 400, error: 'URL invalida.' };
  }
  const provider = classify(host);
  if (!provider)
    return {
      ok: false,
      status: 400,
      error:
        'Dominio nao suportado. Use YouTube, Instagram, TikTok, Pinterest (ou +18).',
    };
  if (provider === 'adult' && !adult)
    return {
      ok: false,
      status: 400,
      error: 'Conteudo +18: ative o modo +18.',
    };
  if (!['video', 'audio-mp3', 'audio-wav'].includes(mode))
    return { ok: false, status: 400, error: 'Modo invalido.' };

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'darkolab-dl-'));
  const dispose = async () => {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    let built: Built;
    if (provider === 'tiktok') {
      built = await fetchTikTok(url, mode, workDir);
      if ('error' in built) {
        const fb = await fetchYtDlp(url, mode, quality, 'generic', workDir);
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

    if ('error' in built) {
      await dispose();
      return {
        ok: false,
        status: 502,
        error: 'Falha no download. ' + built.error,
      };
    }
    if ('remote' in built) {
      return {
        ok: true,
        kind: 'remote',
        url: built.remote,
        headers: built.headers,
        name: built.name,
        contentType: built.contentType,
        dispose,
      };
    }
    const ext = path.extname(built.name).toLowerCase();
    return {
      ok: true,
      kind: 'file',
      filePath: built.file,
      name: built.name,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      dispose,
    };
  } catch (e) {
    await dispose();
    return {
      ok: false,
      status: 500,
      error:
        'Erro interno no downloader: ' +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}

export { readFile };
