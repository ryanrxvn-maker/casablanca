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
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
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
let ytDlpSelfHealAt = 0;
let ffmpegResolved: string | null = null;
let aria2Resolved: string | null | undefined = undefined;
let maintenanceInflight: Promise<void> | null = null;
let maintenanceAt = 0;

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
    const timer = setTimeout(() => { p.kill(); resolve(false); }, 15_000);
    p.stdout.resume();
    p.stderr.resume();
    p.on('error', () => { clearTimeout(timer); resolve(false); });
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Keep the app-owned extractor current without modifying a user's Python install. */
async function maintainExtractor(tool: Tool): Promise<void> {
  if (!process.env.YTDLP_PATH || tool.cmd !== process.env.YTDLP_PATH || tool.pre.length) return;
  if (maintenanceInflight) return maintenanceInflight;
  if (Date.now() - maintenanceAt < 24 * 60 * 60_000) return;
  maintenanceInflight = (async () => {
    const stamp = tool.cmd + '.autoedit-update.json';
    try {
      const last = JSON.parse(await readFile(stamp, 'utf8'));
      if (Date.now() - Number(last.checkedAt) < 24 * 60 * 60_000) { maintenanceAt = Number(last.checkedAt); return; }
    } catch { /* first check */ }
    const result = await run(tool.cmd, ['--ignore-config', '--update'], path.dirname(tool.cmd), 90_000);
    // A failed update never discards the last working binary; retry in one hour.
    maintenanceAt = Date.now() - (result.code === 0 ? 0 : 23 * 60 * 60_000);
    if (result.code === 0) await writeFile(stamp, JSON.stringify({ checkedAt: maintenanceAt })).catch(() => {});
    else console.error('[downloader-core] extractor update deferred:', result.stderr.slice(-500));
  })();
  try { await maintenanceInflight; } finally { maintenanceInflight = null; }
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
  // Antivirus quarantine or a broken update can invalidate a cached path
  // while the long-running engine remains online.
  if (ytDlpResolved) {
    const cached = ytDlpResolved;
    if (await probe(cached.cmd, [...cached.pre, '--version'])) return cached;
    if (ytDlpResolved === cached) {
      ytDlpResolved = null;
      ytDlpSelfHealAt = 0;
      maintenanceAt = 0;
    }
  }
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
        const timer = setTimeout(() => { p.kill(); res(); }, 120_000);
        p.stdout.resume();
        p.stderr.resume();
        p.on('error', () => { clearTimeout(timer); res(); });
        p.on('close', () => { clearTimeout(timer); res(); });
      });
      const healed = await tryTool({ cmd: anyPy, pre: ['-m', 'yt_dlp'] });
      if (healed) {
        ytDlpResolved = healed;
        return healed;
      }
    }

    // AUTO-REPARO (motor no PC do cliente): o launcher sempre define
    // YTDLP_PATH -> se o binario sumiu (antivirus apagou/quarentenou,
    // download original corrompeu), rebaixa o yt-dlp STANDALONE
    // (nao precisa de Python) direto pro caminho esperado. O cliente
    // nao precisa mexer em nada — o proximo download ja funciona.
    // Windows: yt-dlp.exe | macOS: yt-dlp_macos | Linux: yt-dlp_linux
    const healPath = process.env.YTDLP_PATH;
    const healAsset =
      process.platform === 'win32'
        ? 'yt-dlp.exe'
        : process.platform === 'darwin'
          ? 'yt-dlp_macos'
          : 'yt-dlp_linux';
    if (healPath && Date.now() - ytDlpSelfHealAt > 60 * 60_000) {
      ytDlpSelfHealAt = Date.now();
      try {
        const r = await fetch(
          `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${healAsset}`,
          { signal: AbortSignal.timeout(180_000), redirect: 'follow' },
        );
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          // real: ~18MB (win) / ~37MB (macos); menos que 5MB = HTML de erro
          if (buf.length > 5_000_000) {
            await mkdir(path.dirname(healPath), { recursive: true });
            await writeFile(healPath, buf);
            // fora do Windows o binario baixado nasce sem bit de execucao
            if (process.platform !== 'win32') {
              try {
                await chmod(healPath, 0o755);
              } catch {
                /* best-effort: o tryTool abaixo diz se ficou utilizavel */
              }
            }
            const downloaded = await tryTool({ cmd: healPath, pre: [] });
            if (downloaded) {
              console.log('[downloader-core] yt-dlp auto-reparado em', healPath);
              ytDlpResolved = downloaded;
              return downloaded;
            }
          }
        }
      } catch (e) {
        console.error('[downloader-core] auto-reparo do yt-dlp falhou:', e);
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
  if (ffmpegResolved && await fileExists(ffmpegResolved)) return ffmpegResolved;
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
  timeoutMs = 1_500_000,
  signal?: AbortSignal,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    p.stdout.resume();
    let stderr = '';
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abort = () => {
      try { p.kill('SIGKILL'); } catch { /* processo ja encerrou */ }
      finish(-1, '\n[cancelado: outra rota resolveu a mídia]');
    };
    const finish = (code: number, extra = '') => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code, stderr: stderr + extra });
    };
    timer = timeoutMs
      ? setTimeout(() => {
          try {
            p.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          finish(-1, '\n[timeout: processo morto]');
        }, timeoutMs)
      : null;
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    p.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    p.on('error', (e) => finish(-1, String(e)));
    p.on('close', (code) => finish(code ?? -1));
  });
}

// Built interno: arquivo em disco, midia remota (TikTok fast path) ou erro.
// `code` e um marcador de maquina: quem chama (rota do site / motor) pode
// trocar a mensagem pela orientacao certa do seu contexto.
type Built =
  | { remote: string; headers: Record<string, string>; name: string; contentType: string }
  | { file: string; name: string }
  | { error: string; code?: 'YTDLP_MISSING' };

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
    if (!r.ok) {
      console.error('[downloader-core] tikwm HTTP', r.status);
      return { error: 'o servico do TikTok nao respondeu agora. Tenta de novo em instantes.' };
    }
    const j = (await r.json()) as { code?: number; msg?: string; data?: any };
    if (j.code !== 0 || !j.data) {
      console.error('[downloader-core] tikwm sem dados:', j.msg);
      return { error: 'nao achei esse video no TikTok — ele pode ser privado ou ter sido removido. Confere o link no navegador.' };
    }
    data = j.data;
  } catch (e) {
    console.error('[downloader-core] tikwm falhou:', e);
    return { error: 'a conexao com o TikTok falhou. Confere a internet e tenta de novo.' };
  }
  const videoUrl =
    (data.hdplay as string) ||
    (data.play as string) ||
    (data.wmplay as string);
  if (!videoUrl) return { error: 'esse post do TikTok nao tem video pra baixar.' };
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
    console.error('[downloader-core] tiktok midia falhou:', e);
    return { error: 'a conexao caiu no meio do download. Tenta de novo.' };
  }
  if (!vr.ok) {
    console.error('[downloader-core] tiktok midia HTTP', vr.status);
    return { error: 'o TikTok nao entregou o arquivo agora. Tenta de novo em instantes.' };
  }
  const buf = Buffer.from(await vr.arrayBuffer());
  if (buf.length < 1024)
    return { error: 'o TikTok entregou um arquivo vazio. Tenta de novo em instantes.' };
  const srcPath = path.join(workDir, 'tt-src.mp4');
  await writeFile(srcPath, buf);
  const ext = mode === 'audio-wav' ? 'wav' : 'mp3';
  const outPath = path.join(workDir, `tt-out.${ext}`);
  const ffArgs =
    mode === 'audio-wav'
      ? ['-y', '-i', srcPath, '-vn', outPath]
      : ['-y', '-i', srcPath, '-vn', '-b:a', '192k', outPath];
  const { code } = await run(await resolveFfmpeg(), ffArgs, workDir);
  if (code !== 0)
    return { error: 'nao consegui converter o audio agora. Tenta de novo — se repetir, baixa como video.' };
  return { file: outPath, name: safeName(title, ext) };
}

async function ytDlpArgs(
  mode: Mode,
  quality: Quality,
  provider: Provider,
): Promise<string[]> {
  const base = [
    '--ignore-config',
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
  // The bundled Node/ffmpeg are not on the customer's PATH. YouTube now
  // requires an explicitly enabled JS runtime to solve its player challenge.
  base.push('--js-runtimes', `node:${process.execPath}`, '--ffmpeg-location', await resolveFfmpeg());
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

// Traduz o stderr do yt-dlp pra uma frase que o CLIENTE entende e consegue
// agir. O stderr cru NUNCA chega na tela — vai pro console (engine.log no
// motor / logs do servidor) pra diagnostico.
function friendlyYtDlpFail(stderr: string): string {
  const m = stderr.toLowerCase();
  if (/(requested format.*not available|javascript runtime|signature|nsig|challenge solving|no supported js)/.test(m))
    return 'o site mudou a forma de entregar este vídeo. O Motor verifica atualizações automaticamente; tente novamente. Se persistir, atualize o Motor na página do Downloader.';
  if (/(not a bot|confirm.*bot|http error 403|forbidden)/.test(m))
    return 'o site recusou o acesso automático a este vídeo. Abra o link no navegador e tente novamente mais tarde.';
  if (/(private|login|sign in|logged.?in|members.?only|subscriber|only available for registered)/.test(m))
    return 'esse video e privado ou exige login — so da pra baixar conteudo publico. Confere o link no navegador.';
  if (/(age.?restrict|confirm your age|18\+)/.test(m))
    return 'esse video tem restricao de idade e o site nao libera o download direto.';
  if (/(unavailable|removed|terminated|deleted|does not exist|no longer available|404)/.test(m))
    return 'esse video nao esta mais disponivel (foi removido ou saiu do ar). Confere o link no navegador.';
  if (/(unsupported url|is not a valid url)/.test(m))
    return 'esse link nao parece ser de um video. Confere se copiou o link certo.';
  if (/ffmpeg (is )?not (found|installed)/.test(m))
    return 'um componente do Motor sumiu deste computador (provavelmente o antivirus). Reinstala o Motor na pagina do Downloader (passo 1) que ele volta a funcionar.';
  if (/(429|too many request|rate.?limit)/.test(m))
    return 'o site limitou os downloads agora (muitos pedidos seguidos). Espera alguns minutos e tenta de novo.';
  if (/(timed?.?out|timeout|connection|network|getaddrinfo|resolve host|unreachable)/.test(m))
    return 'a conexao falhou no meio do download. Confere a internet e tenta de novo.';
  return 'nao consegui baixar esse link agora. Confere se o video esta publico e tenta de novo em instantes.';
}

function extractorNeedsUpdate(stderr: string): boolean {
  return /(requested format.*not available|javascript runtime|signature|nsig|challenge solving|no supported js|unable to extract)/i.test(stderr);
}

async function fetchYtDlp(
  url: string,
  mode: Mode,
  quality: Quality,
  provider: Provider,
  workDir: string,
  referer?: string,
  signal?: AbortSignal,
): Promise<Built> {
  const tool = await resolveYtDlp();
  if (!tool)
    return {
      code: 'YTDLP_MISSING',
      error:
        'o componente que baixa os videos nao foi encontrado. Reinstala o Motor na pagina do Downloader (passo 1) — leva 1 minuto e volta a funcionar.',
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
  let result = await run(tool.cmd, args, workDir, 1_500_000, signal);
  if (signal?.aborted) return { error: 'rota substituida por uma midia direta do Pinterest.' };
  // Atualizar antes de cada pedido prendia o cliente numa chamada de rede
  // sem relação com o arquivo. Tenta com o extrator atual; só diante de um
  // sinal real de mudança do site atualiza e repete uma vez.
  if (result.code !== 0 && extractorNeedsUpdate(result.stderr)) {
    await maintainExtractor(tool);
    result = await run(tool.cmd, args, workDir, 1_500_000, signal);
  }
  const { code, stderr } = result;
  if (code !== 0) {
    console.error('[downloader-core] yt-dlp falhou:', stderr.slice(-4_000));
    return { error: friendlyYtDlpFail(stderr) };
  }
  const names = await readdir(workDir);
  const files = (
    await Promise.all(
      names
        .filter((n) => CONTENT_TYPES[path.extname(n).toLowerCase()] && !/\.f\d+\./i.test(n))
        .map(async (n) => {
          const full = path.join(workDir, n);
          const s = await stat(full);
          return s.isFile() && s.size > 32 ? { n, full, size: s.size } : null;
        }),
    )
  ).filter(Boolean) as { n: string; full: string; size: number }[];
  if (files.length === 0)
    return { error: 'o download terminou sem gerar arquivo. Tenta de novo em instantes.' };
  files.sort((a, b) => b.size - a.size);
  return { file: files[0].full, name: files[0].n };
}

function decodePinterestHtmlValue(value: string): string {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/gi, '"');
}

/**
 * Extrai somente imagens raster hospedadas no CDN oficial do Pinterest.
 * O helper e exportado para permitir regressao deterministica sem depender
 * da disponibilidade da pagina real durante a suite.
 */
export function pinterestImageCandidates(html: string): string[] {
  const raw: string[] = [];
  const meta = /<meta\b[^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;
  for (const match of html.matchAll(meta)) raw.push(match[1] || match[2]);
  for (const match of html.matchAll(/https?:(?:\\u002F|\\\/|\/){2}i\.pinimg\.com(?:\\u002F|\\\/|\/)[^"'<>\s]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"'<>\s]*)?/gi)) {
    raw.push(match[0]);
  }

  const candidates: string[] = [];
  for (const value of raw) {
    if (!value) continue;
    const decoded = decodePinterestHtmlValue(value);
    let parsed: URL;
    try { parsed = new URL(decoded); } catch { continue; }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'i.pinimg.com' && !host.endsWith('.pinimg.com')) continue;
    if (!/\.(?:jpe?g|png|webp|gif)$/i.test(parsed.pathname)) continue;
    const original = new URL(parsed.href);
    original.pathname = original.pathname.replace(/^\/(?:75x75_RS|136x136|170x|236x|474x|564x|736x)\//i, '/originals/');
    if (original.href !== parsed.href) candidates.push(original.href);
    candidates.push(parsed.href);
  }
  return [...new Set(candidates)];
}

export function pinterestPageHasVideo(html: string): boolean {
  return /(?:property|name)=["'](?:og:video(?::url|:secure_url)?|twitter:player)["']|"(?:contentUrl|video_list|story_pin_data)"\s*:/i.test(html);
}

async function fetchPinterestPage(url: string): Promise<string | null> {
  try {
    const page = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    return page.ok ? await page.text() : null;
  } catch (error) {
    console.error('[downloader-core] pagina do Pinterest falhou:', error);
    return null;
  }
}

async function fetchPinterestImage(url: string, workDir: string, pageHtml?: string | null): Promise<Built> {
  const html = pageHtml ?? await fetchPinterestPage(url);
  if (!html) return { error: 'nao consegui abrir esse pin agora. Confere a internet e tenta de novo.' };
  const candidates = pinterestImageCandidates(html);
  if (!candidates.length) return { error: 'esse pin nao entregou uma imagem ou video publico.' };
  const pinId = new URL(url).pathname.match(/\/pin\/(?:[^/]*--)?(\d+)/i)?.[1] || 'imagem';

  for (const candidate of candidates) {
    try {
      const media = await fetch(candidate, {
        headers: { 'user-agent': UA, referer: url, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      });
      if (!media.ok) continue;
      const finalHost = new URL(media.url || candidate).hostname.toLowerCase();
      if (finalHost !== 'i.pinimg.com' && !finalHost.endsWith('.pinimg.com')) continue;
      const mime = (media.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const extByMime: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
        'image/webp': 'webp', 'image/gif': 'gif',
      };
      const ext = extByMime[mime];
      if (!ext) continue;
      const bytes = Buffer.from(await media.arrayBuffer());
      if (bytes.length < 32 || /^(?:\s*<!doctype|\s*<html|\s*<\?xml)/i.test(bytes.subarray(0, 256).toString('utf8'))) continue;
      const name = safeName(`pinterest-${pinId}`, ext);
      const file = path.join(workDir, name);
      await writeFile(file, bytes);
      return { file, name };
    } catch (error) {
      console.error('[downloader-core] candidato de imagem do Pinterest falhou:', error);
    }
  }
  return { error: 'o Pinterest nao entregou uma imagem valida para esse pin.' };
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

  // Devolve o motivo (ja amigavel) da primeira tentativa — e o mais
  // representativo. Detalhe tecnico de headless/embed fica no console.
  console.error('[downloader-core] +18 esgotou fallbacks para', url);
  return { error: `esse site nao liberou o video (pode exigir login ou assinatura). ${native.error}`, code: native.code };
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
  | { ok: false; status: number; error: string; code?: 'YTDLP_MISSING' };

/**
 * Resolve e baixa a midia. NAO faz auth: quem chama deve ter validado
 * o gate +18 (passar adult=true so depois de autorizar).
 */
export async function processDownload(
  input: DownloadInput,
): Promise<DownloadResult> {
  let url = typeof input.url === 'string' ? input.url.trim() : '';
  const mode: Mode = input.mode ?? 'video';
  const quality: Quality = input.quality ?? '1080';
  const adult = input.adult === true;

  if (!url || !URL_RE.test(url))
    return { ok: false, status: 400, error: 'URL invalida.' };
  let host: string;
  try {
    host = new URL(url).hostname;
    if (/(^|\.)youtube\.com$/.test(host) && new URL(url).searchParams.has('v')) {
      const clean = new URL(url);
      clean.search = new URLSearchParams({ v: clean.searchParams.get('v')! }).toString();
      url = clean.toString();
    }
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
  if (!['1080', '720', '480', 'best'].includes(quality))
    return { ok: false, status: 400, error: 'Qualidade inválida.' };

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
        // Duas rotas falharam: mostra pro cliente SO o motivo do caminho
        // principal (ja amigavel); o detalhe da 2a rota vai pro console.
        if ('error' in fb) {
          console.error('[downloader-core] fallback yt-dlp do TikTok tambem falhou:', fb.error);
          built = { error: built.error };
        } else {
          built = fb;
        }
      }
    } else if (provider === 'adult') {
      built = await fetchAdult(url, mode, quality, workDir);
    } else if (provider === 'pinterest') {
      if (mode === 'video') {
        // Página e extrator começam juntos. Se o HTML provar que é imagem,
        // cancelamos o processo de vídeo imediatamente; se for vídeo, o
        // extrator já ganhou esse tempo e continua sem atraso adicional.
        const abortVideo = new AbortController();
        const video = fetchYtDlp(url, mode, quality, provider, workDir, undefined, abortVideo.signal);
        const html = await fetchPinterestPage(url);
        if (html && !pinterestPageHasVideo(html) && pinterestImageCandidates(html).length) {
          abortVideo.abort();
          await video;
          built = await fetchPinterestImage(url, workDir, html);
        } else {
          built = await video;
          if ('error' in built) {
            const image = await fetchPinterestImage(url, workDir, html);
            if (!('error' in image)) built = image;
            else console.error('[downloader-core] fallback de imagem do Pinterest falhou:', image.error);
          }
        }
      } else {
        built = await fetchYtDlp(url, mode, quality, provider, workDir);
      }
    } else {
      built = await fetchYtDlp(url, mode, quality, provider, workDir);
    }

    if ('error' in built) {
      await dispose();
      return {
        ok: false,
        status: 502,
        error: 'Falha no download. ' + built.error,
        code: built.code,
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
    console.error('[downloader-core] erro interno:', e);
    return {
      ok: false,
      status: 500,
      error: 'Deu um erro inesperado no download. Tenta de novo em instantes.',
    };
  }
}

export { readFile };
