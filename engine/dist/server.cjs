"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/headless-grab.ts
var headless_grab_exports = {};
__export(headless_grab_exports, {
  grabMedia: () => grabMedia
});
async function getBrowser() {
  try {
    const { chromium } = await import("playwright");
    if (!browserP) {
      browserP = chromium.launch({ headless: true }).then((b) => {
        b.on("disconnected", () => {
          browserP = null;
        });
        return b;
      }).catch((e) => {
        browserP = null;
        throw e;
      });
    }
    return await browserP;
  } catch {
    return null;
  }
}
function rank(u) {
  return (/\.m3u8(\?|$)/i.test(u) ? 5 : 0) + (/(premium|cdn|storage|stream)/i.test(u) && /\.mp4/i.test(u) ? 3 : 0) + (/\.mp4(\?|$)/i.test(u) ? 2 : 0) + (/\/video\.php\b/i.test(u) ? 1 : 0);
}
async function grabMedia(pageUrl) {
  const browser = await getBrowser();
  if (!browser) return null;
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: "pt-BR",
    viewport: { width: 1366, height: 768 }
  });
  try {
    const page = await ctx.newPage();
    const hits = /* @__PURE__ */ new Set();
    const refOf = /* @__PURE__ */ new Map();
    const consider = (u, ct, frameUrl) => {
      if (!u || JUNK.test(u)) return;
      const media = /\.m3u8(\?|$)/i.test(u) || /\.mp4(\?|$)/i.test(u) && !/\/video\.php/i.test(u) || /\/video\.php\b/i.test(u) || !!ct && /^(video\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml))/i.test(
        ct
      );
      if (media) {
        hits.add(u);
        if (frameUrl && !refOf.has(u)) {
          try {
            refOf.set(u, new URL(frameUrl).origin + "/");
          } catch {
          }
        }
      }
    };
    page.on("response", (r) => {
      try {
        const fr = r.request().frame?.();
        consider(
          r.url(),
          r.headers()["content-type"] || "",
          fr ? fr.url() : void 0
        );
      } catch {
      }
    });
    page.on("request", (r) => {
      try {
        const fr = r.frame?.();
        consider(r.url(), "", fr ? fr.url() : void 0);
      } catch {
        consider(r.url(), "");
      }
    });
    try {
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45e3
      });
      for (const f of page.frames()) {
        for (const sel of [
          "button.plyr__control--overlaid",
          ".plyr__control",
          ".play-large",
          ".vjs-big-play-button",
          "video",
          "#player"
        ]) {
          const el = await f.$(sel).catch(() => null);
          if (el) await el.click({ timeout: 1500 }).catch(() => {
          });
        }
      }
      await page.waitForTimeout(7e3);
    } catch {
    }
    const ranked = [...hits].sort((a, b) => rank(b) - rank(a));
    if (ranked.length === 0) return null;
    const m3u8 = ranked.find((u) => /\.m3u8(\?|$)/i.test(u));
    if (m3u8) {
      return { m3u8, referer: new URL(pageUrl).origin + "/" };
    }
    for (const target of ranked.slice(0, 4)) {
      let mediaBase = "";
      try {
        const mh = new URL(target).hostname;
        mediaBase = "https://" + mh.split(".").slice(-2).join(".") + "/";
      } catch {
      }
      const referers = [
        refOf.get(target),
        mediaBase,
        new URL(pageUrl).origin + "/",
        pageUrl
      ].filter(Boolean);
      for (const ref of [...new Set(referers)]) {
        try {
          const resp = await ctx.request.get(target, {
            headers: { referer: ref, "user-agent": UA },
            timeout: 9e4
          });
          if (resp.status() !== 200 && resp.status() !== 206) continue;
          const body = Buffer.from(await resp.body());
          if (body.length < 8e4) continue;
          return { buffer: body, ext: "mp4" };
        } catch {
        }
      }
    }
    return null;
  } finally {
    await ctx.close().catch(() => {
    });
  }
}
var UA, JUNK, browserP;
var init_headless_grab = __esm({
  "lib/headless-grab.ts"() {
    "use strict";
    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    JUNK = /(plyr\.io|blank\.mp4|sample\.mp4|placeholder|googletag|doubleclick|trafficjunky|adtng|histats|popads|\/ads?\/|\.vtt|\.jpg|\.jpeg|\.png|\.webp|sprite|thumb)/i;
    browserP = null;
  }
});

// engine/server.ts
var import_http = __toESM(require("http"));
var import_fs2 = require("fs");
var import_promises4 = require("fs/promises");
var import_crypto2 = __toESM(require("crypto"));
var import_os2 = __toESM(require("os"));
var import_path3 = __toESM(require("path"));

// lib/downloader-core.ts
var import_child_process = require("child_process");
var import_promises = require("fs/promises");
var import_os = __toESM(require("os"));
var import_path = __toESM(require("path"));
var ADULT_BASES = [
  "pornhub.com",
  "xhamster.com",
  "xhamster.desi",
  "xhamster2.com",
  "redtube.com",
  "redtube.com.br",
  "youporn.com",
  "xvideos.com",
  "xvideosputaria.com",
  "buceteiro.com"
];
var URL_RE = /^https?:\/\/[^\s]+$/i;
var CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
var UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function classify(host) {
  const h = host.replace(/^www\./, "").toLowerCase();
  if (ADULT_BASES.some((b) => h === b || h.endsWith("." + b))) return "adult";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (h === "pin.it" || /(^|\.)pinterest\.[a-z.]+$/.test(h)) return "pinterest";
  if (h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtu.be" || h === "instagram.com" || h.endsWith(".instagram.com") || h === "instagr.am") {
    return "generic";
  }
  return null;
}
function safeName(title, ext) {
  const base = (title || "video").normalize("NFKD").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 80) || "video";
  return `${base}.${ext}`;
}
var ytDlpResolved = null;
var ytDlpInflight = null;
var ytDlpSelfHealAt = 0;
var ffmpegResolved = null;
var aria2Resolved = void 0;
var maintenanceInflight = null;
var maintenanceAt = 0;
async function fileExists(p) {
  try {
    return (await (0, import_promises.stat)(p)).isFile();
  } catch {
    return false;
  }
}
function whichAbs(name) {
  return new Promise((resolve) => {
    const finder = process.platform === "win32" ? "where" : "which";
    const p = (0, import_child_process.spawn)(finder, [name], { windowsHide: true, shell: true });
    let out = "";
    p.stdout.on("data", (d) => out += d.toString());
    p.on("error", () => resolve(null));
    p.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      resolve(first || null);
    });
  });
}
function probe(cmd, args) {
  return new Promise((resolve) => {
    const p = (0, import_child_process.spawn)(cmd, args, { windowsHide: true });
    const timer = setTimeout(() => {
      p.kill();
      resolve(false);
    }, 15e3);
    p.stdout.resume();
    p.stderr.resume();
    p.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
async function maintainExtractor(tool) {
  if (!process.env.YTDLP_PATH || tool.cmd !== process.env.YTDLP_PATH || tool.pre.length) return;
  if (maintenanceInflight) return maintenanceInflight;
  if (Date.now() - maintenanceAt < 24 * 60 * 6e4) return;
  maintenanceInflight = (async () => {
    const stamp = tool.cmd + ".autoedit-update.json";
    try {
      const last = JSON.parse(await (0, import_promises.readFile)(stamp, "utf8"));
      if (Date.now() - Number(last.checkedAt) < 24 * 60 * 6e4) {
        maintenanceAt = Number(last.checkedAt);
        return;
      }
    } catch {
    }
    const result = await run(tool.cmd, ["--ignore-config", "--update"], import_path.default.dirname(tool.cmd), 9e4);
    maintenanceAt = Date.now() - (result.code === 0 ? 0 : 23 * 60 * 6e4);
    if (result.code === 0) await (0, import_promises.writeFile)(stamp, JSON.stringify({ checkedAt: maintenanceAt })).catch(() => {
    });
    else console.error("[downloader-core] extractor update deferred:", result.stderr.slice(-500));
  })();
  try {
    await maintenanceInflight;
  } finally {
    maintenanceInflight = null;
  }
}
async function winPythonDirs() {
  if (process.platform !== "win32") return [];
  const roots = [
    process.env.LOCALAPPDATA && import_path.default.join(process.env.LOCALAPPDATA, "Programs", "Python"),
    process.env.ProgramFiles && import_path.default.join(process.env.ProgramFiles, ""),
    "C:\\"
  ].filter(Boolean);
  const dirs = [];
  for (const root of roots) {
    try {
      for (const e of await (0, import_promises.readdir)(root)) {
        if (/^Python3\d+$/i.test(e)) dirs.push(import_path.default.join(root, e));
      }
    } catch {
    }
  }
  return dirs;
}
async function resolveYtDlp() {
  if (ytDlpResolved) {
    const cached = ytDlpResolved;
    if (await probe(cached.cmd, [...cached.pre, "--version"])) return cached;
    if (ytDlpResolved === cached) {
      ytDlpResolved = null;
      ytDlpSelfHealAt = 0;
      maintenanceAt = 0;
    }
  }
  if (ytDlpInflight) return ytDlpInflight;
  ytDlpInflight = (async () => {
    const tryTool = async (t) => t.cmd && await probe(t.cmd, [...t.pre, "--version"]) ? t : null;
    const envYt = process.env.YTDLP_PATH;
    const envPy = process.env.PYTHON_PATH;
    const candidates = [];
    if (envYt) candidates.push({ cmd: envYt, pre: [] });
    if (envPy) candidates.push({ cmd: envPy, pre: ["-m", "yt_dlp"] });
    const ytAbs = await whichAbs("yt-dlp") || await whichAbs("yt-dlp.exe");
    if (ytAbs) candidates.push({ cmd: ytAbs, pre: [] });
    const pyAbs = await whichAbs("python") || await whichAbs("python3");
    if (pyAbs) candidates.push({ cmd: pyAbs, pre: ["-m", "yt_dlp"] });
    const pyLauncher = await whichAbs("py");
    if (pyLauncher)
      candidates.push({ cmd: pyLauncher, pre: ["-3", "-m", "yt_dlp"] });
    for (const d of await winPythonDirs()) {
      const ytExe = import_path.default.join(d, "Scripts", "yt-dlp.exe");
      if (await fileExists(ytExe)) candidates.push({ cmd: ytExe, pre: [] });
      const pyExe = import_path.default.join(d, "python.exe");
      if (await fileExists(pyExe))
        candidates.push({ cmd: pyExe, pre: ["-m", "yt_dlp"] });
    }
    for (const c of candidates) {
      const ok = await tryTool(c);
      if (ok) {
        ytDlpResolved = ok;
        return ok;
      }
    }
    const anyPy = pyAbs || envPy || await (async () => {
      for (const d of await winPythonDirs()) {
        const pe = import_path.default.join(d, "python.exe");
        if (await fileExists(pe)) return pe;
      }
      return null;
    })();
    if (anyPy) {
      await new Promise((res) => {
        const p = (0, import_child_process.spawn)(
          anyPy,
          [
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--quiet",
            "yt-dlp[default,curl-cffi]",
            "curl_cffi"
          ],
          { windowsHide: true }
        );
        const timer = setTimeout(() => {
          p.kill();
          res();
        }, 12e4);
        p.stdout.resume();
        p.stderr.resume();
        p.on("error", () => {
          clearTimeout(timer);
          res();
        });
        p.on("close", () => {
          clearTimeout(timer);
          res();
        });
      });
      const healed = await tryTool({ cmd: anyPy, pre: ["-m", "yt_dlp"] });
      if (healed) {
        ytDlpResolved = healed;
        return healed;
      }
    }
    const healPath = process.env.YTDLP_PATH;
    const healAsset = process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
    if (healPath && Date.now() - ytDlpSelfHealAt > 60 * 6e4) {
      ytDlpSelfHealAt = Date.now();
      try {
        const r = await fetch(
          `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${healAsset}`,
          { signal: AbortSignal.timeout(18e4), redirect: "follow" }
        );
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 5e6) {
            await (0, import_promises.mkdir)(import_path.default.dirname(healPath), { recursive: true });
            await (0, import_promises.writeFile)(healPath, buf);
            if (process.platform !== "win32") {
              try {
                await (0, import_promises.chmod)(healPath, 493);
              } catch {
              }
            }
            const downloaded = await tryTool({ cmd: healPath, pre: [] });
            if (downloaded) {
              console.log("[downloader-core] yt-dlp auto-reparado em", healPath);
              ytDlpResolved = downloaded;
              return downloaded;
            }
          }
        }
      } catch (e) {
        console.error("[downloader-core] auto-reparo do yt-dlp falhou:", e);
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
async function resolveFfmpeg() {
  if (ffmpegResolved && await fileExists(ffmpegResolved)) return ffmpegResolved;
  const env = process.env.FFMPEG_PATH;
  const found = (env && await fileExists(env) ? env : null) || await whichAbs("ffmpeg") || await whichAbs("ffmpeg.exe");
  ffmpegResolved = found || "ffmpeg";
  return ffmpegResolved;
}
async function aria2Path() {
  if (aria2Resolved !== void 0) return aria2Resolved;
  aria2Resolved = await whichAbs("aria2c") || await whichAbs("aria2c.exe");
  return aria2Resolved;
}
function run(cmd, args, cwd, timeoutMs = 15e5, signal) {
  return new Promise((resolve) => {
    const p = (0, import_child_process.spawn)(cmd, args, { cwd, windowsHide: true });
    p.stdout.resume();
    let stderr = "";
    let done = false;
    let timer = null;
    const abort = () => {
      try {
        p.kill("SIGKILL");
      } catch {
      }
      finish(-1, "\n[cancelado: outra rota resolveu a m\xEDdia]");
    };
    const finish = (code, extra = "") => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, stderr: stderr + extra });
    };
    timer = timeoutMs ? setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {
      }
      finish(-1, "\n[timeout: processo morto]");
    }, timeoutMs) : null;
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    p.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 64e3) stderr = stderr.slice(-64e3);
    });
    p.on("error", (e) => finish(-1, String(e)));
    p.on("close", (code) => finish(code ?? -1));
  });
}
async function fetchTikTok(url, mode, workDir) {
  const api = `https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`;
  let data;
  try {
    const r = await fetch(api, {
      headers: { "user-agent": UA2, accept: "application/json" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!r.ok) {
      console.error("[downloader-core] tikwm HTTP", r.status);
      return { error: "o servico do TikTok nao respondeu agora. Tenta de novo em instantes." };
    }
    const j = await r.json();
    if (j.code !== 0 || !j.data) {
      console.error("[downloader-core] tikwm sem dados:", j.msg);
      return { error: "nao achei esse video no TikTok \u2014 ele pode ser privado ou ter sido removido. Confere o link no navegador." };
    }
    data = j.data;
  } catch (e) {
    console.error("[downloader-core] tikwm falhou:", e);
    return { error: "a conexao com o TikTok falhou. Confere a internet e tenta de novo." };
  }
  const videoUrl = data.hdplay || data.play || data.wmplay;
  if (!videoUrl) return { error: "esse post do TikTok nao tem video pra baixar." };
  const title = data.title || data.id || "tiktok";
  if (mode === "video") {
    return {
      remote: videoUrl,
      headers: { "user-agent": UA2, referer: "https://www.tikwm.com/" },
      name: safeName(title, "mp4"),
      contentType: "video/mp4"
    };
  }
  let vr;
  try {
    vr = await fetch(videoUrl, {
      headers: { "user-agent": UA2, referer: "https://www.tikwm.com/" },
      signal: AbortSignal.timeout(12e4)
    });
  } catch (e) {
    console.error("[downloader-core] tiktok midia falhou:", e);
    return { error: "a conexao caiu no meio do download. Tenta de novo." };
  }
  if (!vr.ok) {
    console.error("[downloader-core] tiktok midia HTTP", vr.status);
    return { error: "o TikTok nao entregou o arquivo agora. Tenta de novo em instantes." };
  }
  const buf = Buffer.from(await vr.arrayBuffer());
  if (buf.length < 1024)
    return { error: "o TikTok entregou um arquivo vazio. Tenta de novo em instantes." };
  const srcPath = import_path.default.join(workDir, "tt-src.mp4");
  await (0, import_promises.writeFile)(srcPath, buf);
  const ext = mode === "audio-wav" ? "wav" : "mp3";
  const outPath = import_path.default.join(workDir, `tt-out.${ext}`);
  const ffArgs = mode === "audio-wav" ? ["-y", "-i", srcPath, "-vn", outPath] : ["-y", "-i", srcPath, "-vn", "-b:a", "192k", outPath];
  const { code } = await run(await resolveFfmpeg(), ffArgs, workDir);
  if (code !== 0)
    return { error: "nao consegui converter o audio agora. Tenta de novo \u2014 se repetir, baixa como video." };
  return { file: outPath, name: safeName(title, ext) };
}
async function ytDlpArgs(mode, quality, provider) {
  const base = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "--no-progress",
    "--no-mtime",
    "-N",
    "8",
    "--retries",
    "3",
    "--socket-timeout",
    "20",
    "-o",
    "%(title).80B-%(id)s.%(ext)s"
  ];
  base.push("--js-runtimes", `node:${process.execPath}`, "--ffmpeg-location", await resolveFfmpeg());
  if (provider === "adult") {
    base.push(
      "--impersonate",
      "chrome",
      "--user-agent",
      UA2,
      "--extractor-retries",
      "3"
    );
  }
  const aria2 = await aria2Path();
  if (aria2) {
    base.push(
      "--downloader",
      aria2,
      "--downloader-args",
      "aria2c:-x16 -s16 -k1M -j16"
    );
  }
  if (mode === "audio-mp3")
    return [...base, "-x", "--audio-format", "mp3", "--audio-quality", "0"];
  if (mode === "audio-wav") return [...base, "-x", "--audio-format", "wav"];
  if (provider === "pinterest")
    return [...base, "-f", "b/bv*+ba/best", "--merge-output-format", "mp4"];
  const v = [...base, "--merge-output-format", "mp4", "-f", "bv*+ba/b"];
  v.push(
    "-S",
    quality !== "best" ? `res:${quality},ext:mp4:m4a` : "ext:mp4:m4a"
  );
  return v;
}
function friendlyYtDlpFail(stderr) {
  const m = stderr.toLowerCase();
  if (/(requested format.*not available|javascript runtime|signature|nsig|challenge solving|no supported js)/.test(m))
    return "o site mudou a forma de entregar este v\xEDdeo. O Motor verifica atualiza\xE7\xF5es automaticamente; tente novamente. Se persistir, atualize o Motor na p\xE1gina do Downloader.";
  if (/(not a bot|confirm.*bot|http error 403|forbidden)/.test(m))
    return "o site recusou o acesso autom\xE1tico a este v\xEDdeo. Abra o link no navegador e tente novamente mais tarde.";
  if (/(private|login|sign in|logged.?in|members.?only|subscriber|only available for registered)/.test(m))
    return "esse video e privado ou exige login \u2014 so da pra baixar conteudo publico. Confere o link no navegador.";
  if (/(age.?restrict|confirm your age|18\+)/.test(m))
    return "esse video tem restricao de idade e o site nao libera o download direto.";
  if (/(unavailable|removed|terminated|deleted|does not exist|no longer available|404)/.test(m))
    return "esse video nao esta mais disponivel (foi removido ou saiu do ar). Confere o link no navegador.";
  if (/(unsupported url|is not a valid url)/.test(m))
    return "esse link nao parece ser de um video. Confere se copiou o link certo.";
  if (/ffmpeg (is )?not (found|installed)/.test(m))
    return "um componente do Motor sumiu deste computador (provavelmente o antivirus). Reinstala o Motor na pagina do Downloader (passo 1) que ele volta a funcionar.";
  if (/(429|too many request|rate.?limit)/.test(m))
    return "o site limitou os downloads agora (muitos pedidos seguidos). Espera alguns minutos e tenta de novo.";
  if (/(timed?.?out|timeout|connection|network|getaddrinfo|resolve host|unreachable)/.test(m))
    return "a conexao falhou no meio do download. Confere a internet e tenta de novo.";
  return "nao consegui baixar esse link agora. Confere se o video esta publico e tenta de novo em instantes.";
}
function extractorNeedsUpdate(stderr) {
  return /(requested format.*not available|javascript runtime|signature|nsig|challenge solving|no supported js|unable to extract)/i.test(stderr);
}
async function fetchYtDlp(url, mode, quality, provider, workDir, referer, signal) {
  const tool = await resolveYtDlp();
  if (!tool)
    return {
      code: "YTDLP_MISSING",
      error: "o componente que baixa os videos nao foi encontrado. Reinstala o Motor na pagina do Downloader (passo 1) \u2014 leva 1 minuto e volta a funcionar."
    };
  const refArgs = referer ? ["--add-header", `Referer:${referer}`] : [];
  const args = [
    ...tool.pre,
    ...await ytDlpArgs(mode, quality, provider),
    ...refArgs,
    url
  ];
  let result = await run(tool.cmd, args, workDir, 15e5, signal);
  if (signal?.aborted) return { error: "rota substituida por uma midia direta do Pinterest." };
  if (result.code !== 0 && extractorNeedsUpdate(result.stderr)) {
    await maintainExtractor(tool);
    result = await run(tool.cmd, args, workDir, 15e5, signal);
  }
  const { code, stderr } = result;
  if (code !== 0) {
    console.error("[downloader-core] yt-dlp falhou:", stderr.slice(-4e3));
    return { error: friendlyYtDlpFail(stderr) };
  }
  const names = await (0, import_promises.readdir)(workDir);
  const files = (await Promise.all(
    names.filter((n) => CONTENT_TYPES[import_path.default.extname(n).toLowerCase()] && !/\.f\d+\./i.test(n)).map(async (n) => {
      const full = import_path.default.join(workDir, n);
      const s = await (0, import_promises.stat)(full);
      return s.isFile() && s.size > 32 ? { n, full, size: s.size } : null;
    })
  )).filter(Boolean);
  if (files.length === 0)
    return { error: "o download terminou sem gerar arquivo. Tenta de novo em instantes." };
  files.sort((a, b) => b.size - a.size);
  return { file: files[0].full, name: files[0].n };
}
function decodePinterestHtmlValue(value) {
  return value.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/gi, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/gi, '"');
}
function pinterestImageCandidates(html) {
  const raw = [];
  const meta = /<meta\b[^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi;
  for (const match of html.matchAll(meta)) raw.push(match[1] || match[2]);
  for (const match of html.matchAll(/https?:(?:\\u002F|\\\/|\/){2}i\.pinimg\.com(?:\\u002F|\\\/|\/)[^"'<>\s]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"'<>\s]*)?/gi)) {
    raw.push(match[0]);
  }
  const candidates = [];
  for (const value of raw) {
    if (!value) continue;
    const decoded = decodePinterestHtmlValue(value);
    let parsed;
    try {
      parsed = new URL(decoded);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "i.pinimg.com" && !host.endsWith(".pinimg.com")) continue;
    if (!/\.(?:jpe?g|png|webp|gif)$/i.test(parsed.pathname)) continue;
    const original = new URL(parsed.href);
    original.pathname = original.pathname.replace(/^\/(?:75x75_RS|136x136|170x|236x|474x|564x|736x)\//i, "/originals/");
    if (original.href !== parsed.href) candidates.push(original.href);
    candidates.push(parsed.href);
  }
  return [...new Set(candidates)];
}
function pinterestPageHasVideo(html) {
  return /(?:property|name)=["'](?:og:video(?::url|:secure_url)?|twitter:player)["']|"(?:contentUrl|video_list|story_pin_data)"\s*:/i.test(html);
}
async function fetchPinterestPage(url) {
  try {
    const page = await fetch(url, {
      headers: {
        "user-agent": UA2,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.7"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25e3)
    });
    return page.ok ? await page.text() : null;
  } catch (error) {
    console.error("[downloader-core] pagina do Pinterest falhou:", error);
    return null;
  }
}
async function fetchPinterestImage(url, workDir, pageHtml) {
  const html = pageHtml ?? await fetchPinterestPage(url);
  if (!html) return { error: "nao consegui abrir esse pin agora. Confere a internet e tenta de novo." };
  const candidates = pinterestImageCandidates(html);
  if (!candidates.length) return { error: "esse pin nao entregou uma imagem ou video publico." };
  const pinId = new URL(url).pathname.match(/\/pin\/(?:[^/]*--)?(\d+)/i)?.[1] || "imagem";
  for (const candidate of candidates) {
    try {
      const media = await fetch(candidate, {
        headers: { "user-agent": UA2, referer: url, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" },
        redirect: "follow",
        signal: AbortSignal.timeout(6e4)
      });
      if (!media.ok) continue;
      const finalHost = new URL(media.url || candidate).hostname.toLowerCase();
      if (finalHost !== "i.pinimg.com" && !finalHost.endsWith(".pinimg.com")) continue;
      const mime = (media.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const extByMime = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
      };
      const ext = extByMime[mime];
      if (!ext) continue;
      const bytes = Buffer.from(await media.arrayBuffer());
      if (bytes.length < 32 || /^(?:\s*<!doctype|\s*<html|\s*<\?xml)/i.test(bytes.subarray(0, 256).toString("utf8"))) continue;
      const name = safeName(`pinterest-${pinId}`, ext);
      const file = import_path.default.join(workDir, name);
      await (0, import_promises.writeFile)(file, bytes);
      return { file, name };
    } catch (error) {
      console.error("[downloader-core] candidato de imagem do Pinterest falhou:", error);
    }
  }
  return { error: "o Pinterest nao entregou uma imagem valida para esse pin." };
}
var TUBE_RE = /(pornhub|xvideos|xhamster|redtube|youporn|spankbang|eporner|tube8)\.[a-z.]+/i;
var JUNK_MEDIA_RE = /(plyr\.io|jwplayer|jsdelivr|cdnjs|googletagmanager|gstatic|doubleclick|\/blank\.mp4|blank\.mp4|sample\.mp4|placeholder|\/ads?\/)/i;
function isRealMedia(u) {
  return /^https?:\/\//i.test(u) && !JUNK_MEDIA_RE.test(u);
}
async function resolveAdultEmbed(pageUrl) {
  let html;
  let origin;
  try {
    const u = new URL(pageUrl);
    origin = u.origin;
    const r = await fetch(pageUrl, {
      headers: { "user-agent": UA2, referer: origin + "/" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!r.ok) return null;
    html = await r.text();
  } catch {
    return null;
  }
  const iframes = [
    ...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)
  ].map((m) => m[1].replace(/&amp;/g, "&"));
  for (const src of iframes) {
    if (TUBE_RE.test(src))
      return {
        target: src.startsWith("//") ? "https:" + src : src,
        referer: origin + "/"
      };
  }
  for (const src of iframes) {
    const abs = src.startsWith("//") ? "https:" + src : src.startsWith("http") ? src : origin + (src.startsWith("/") ? "" : "/") + src;
    try {
      const fr = await fetch(abs, {
        headers: { "user-agent": UA2, referer: origin + "/" },
        signal: AbortSignal.timeout(2e4)
      });
      if (!fr.ok) continue;
      const fh = await fr.text();
      const refOrigin = new URL(abs).origin + "/";
      const m3u8 = [...fh.matchAll(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi)].map((m) => m[0]).find(isRealMedia);
      if (m3u8) return { target: m3u8, referer: refOrigin };
      const mp4 = [...fh.matchAll(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi)].map((m) => m[0]).find(isRealMedia);
      if (mp4) return { target: mp4, referer: refOrigin };
    } catch {
    }
  }
  const og = html.match(
    /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["'](https?:[^"']+)["']/i
  );
  const direct = [...html.matchAll(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/gi)].map((m) => m[0]).find(isRealMedia) || (og && isRealMedia(og[1]) ? og[1] : null) || [...html.matchAll(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi)].map((m) => m[0]).find(isRealMedia);
  if (direct) return { target: direct, referer: origin + "/" };
  return null;
}
function normalizeAdultUrl(raw) {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    for (const base of [
      "pornhub.com",
      "youporn.com",
      "redtube.com",
      "xvideos.com"
    ]) {
      if (h === base || h.endsWith("." + base)) {
        u.hostname = "www." + base;
        return u.toString();
      }
    }
    return raw;
  } catch {
    return raw;
  }
}
async function fetchAdult(url, mode, quality, workDir) {
  const native = await fetchYtDlp(
    normalizeAdultUrl(url),
    mode,
    quality,
    "adult",
    workDir
  );
  if (!("error" in native)) return native;
  const emb = await resolveAdultEmbed(url);
  if (emb) {
    const viaEmbed = await fetchYtDlp(
      emb.target,
      mode,
      quality,
      "adult",
      workDir,
      emb.referer
    );
    if (!("error" in viaEmbed)) return viaEmbed;
  }
  try {
    const { grabMedia: grabMedia2 } = await Promise.resolve().then(() => (init_headless_grab(), headless_grab_exports));
    const grab = await Promise.race([
      grabMedia2(url),
      new Promise((r) => setTimeout(() => r(null), 7e4))
    ]);
    if (grab && "m3u8" in grab) {
      const viaHls = await fetchYtDlp(
        grab.m3u8,
        mode,
        quality,
        "adult",
        workDir,
        grab.referer
      );
      if (!("error" in viaHls)) return viaHls;
    } else if (grab && "buffer" in grab) {
      if (mode === "video") {
        const name = safeName(
          new URL(url).pathname.split("/").filter(Boolean).pop() || "video",
          grab.ext
        );
        const fp = import_path.default.join(workDir, name);
        await (0, import_promises.writeFile)(fp, grab.buffer);
        return { file: fp, name };
      }
      const src = import_path.default.join(workDir, "hl-src.mp4");
      await (0, import_promises.writeFile)(src, grab.buffer);
      const ext = mode === "audio-wav" ? "wav" : "mp3";
      const outP = import_path.default.join(workDir, `hl-out.${ext}`);
      const ff = mode === "audio-wav" ? ["-y", "-i", src, "-vn", outP] : ["-y", "-i", src, "-vn", "-b:a", "192k", outP];
      const { code } = await run(await resolveFfmpeg(), ff, workDir);
      if (code === 0)
        return {
          file: outP,
          name: safeName(
            new URL(url).pathname.split("/").filter(Boolean).pop() || "audio",
            ext
          )
        };
    }
  } catch {
  }
  console.error("[downloader-core] +18 esgotou fallbacks para", url);
  return { error: `esse site nao liberou o video (pode exigir login ou assinatura). ${native.error}`, code: native.code };
}
async function processDownload(input) {
  let url = typeof input.url === "string" ? input.url.trim() : "";
  const mode = input.mode ?? "video";
  const quality = input.quality ?? "1080";
  const adult = input.adult === true;
  if (!url || !URL_RE.test(url))
    return { ok: false, status: 400, error: "URL invalida." };
  let host;
  try {
    host = new URL(url).hostname;
    if (/(^|\.)youtube\.com$/.test(host) && new URL(url).searchParams.has("v")) {
      const clean = new URL(url);
      clean.search = new URLSearchParams({ v: clean.searchParams.get("v") }).toString();
      url = clean.toString();
    }
  } catch {
    return { ok: false, status: 400, error: "URL invalida." };
  }
  const provider = classify(host);
  if (!provider)
    return {
      ok: false,
      status: 400,
      error: "Dominio nao suportado. Use YouTube, Instagram, TikTok, Pinterest (ou +18)."
    };
  if (provider === "adult" && !adult)
    return {
      ok: false,
      status: 400,
      error: "Conteudo +18: ative o modo +18."
    };
  if (!["video", "audio-mp3", "audio-wav"].includes(mode))
    return { ok: false, status: 400, error: "Modo invalido." };
  if (!["1080", "720", "480", "best"].includes(quality))
    return { ok: false, status: 400, error: "Qualidade inv\xE1lida." };
  const workDir = await (0, import_promises.mkdtemp)(import_path.default.join(import_os.default.tmpdir(), "darkolab-dl-"));
  const dispose = async () => {
    await (0, import_promises.rm)(workDir, { recursive: true, force: true }).catch(() => {
    });
  };
  try {
    let built;
    if (provider === "tiktok") {
      built = await fetchTikTok(url, mode, workDir);
      if ("error" in built) {
        const fb = await fetchYtDlp(url, mode, quality, "generic", workDir);
        if ("error" in fb) {
          console.error("[downloader-core] fallback yt-dlp do TikTok tambem falhou:", fb.error);
          built = { error: built.error };
        } else {
          built = fb;
        }
      }
    } else if (provider === "adult") {
      built = await fetchAdult(url, mode, quality, workDir);
    } else if (provider === "pinterest") {
      if (mode === "video") {
        const abortVideo = new AbortController();
        const video = fetchYtDlp(url, mode, quality, provider, workDir, void 0, abortVideo.signal);
        const html = await fetchPinterestPage(url);
        if (html && !pinterestPageHasVideo(html) && pinterestImageCandidates(html).length) {
          abortVideo.abort();
          await video;
          built = await fetchPinterestImage(url, workDir, html);
        } else {
          built = await video;
          if ("error" in built) {
            const image = await fetchPinterestImage(url, workDir, html);
            if (!("error" in image)) built = image;
            else console.error("[downloader-core] fallback de imagem do Pinterest falhou:", image.error);
          }
        }
      } else {
        built = await fetchYtDlp(url, mode, quality, provider, workDir);
      }
    } else {
      built = await fetchYtDlp(url, mode, quality, provider, workDir);
    }
    if ("error" in built) {
      await dispose();
      return {
        ok: false,
        status: 502,
        error: "Falha no download. " + built.error,
        code: built.code
      };
    }
    if ("remote" in built) {
      return {
        ok: true,
        kind: "remote",
        url: built.remote,
        headers: built.headers,
        name: built.name,
        contentType: built.contentType,
        dispose
      };
    }
    const ext = import_path.default.extname(built.name).toLowerCase();
    return {
      ok: true,
      kind: "file",
      filePath: built.file,
      name: built.name,
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      dispose
    };
  } catch (e) {
    await dispose();
    console.error("[downloader-core] erro interno:", e);
    return {
      ok: false,
      status: 500,
      error: "Deu um erro inesperado no download. Tenta de novo em instantes."
    };
  }
}

// engine/jobs.ts
var import_crypto = __toESM(require("crypto"));
var import_path2 = __toESM(require("path"));
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_stream = require("stream");
var import_promises3 = require("stream/promises");
var TTL = 6 * 60 * 60 * 1e3;
async function validateMedia(file, mime) {
  if (!/^(video|audio|image)\//.test(mime)) throw new Error("A fonte n\xE3o entregou um arquivo de m\xEDdia v\xE1lido.");
  const size = (await (0, import_promises2.stat)(file)).size;
  if (size < 32) throw new Error("A fonte entregou um arquivo vazio ou incompleto.");
  const handle = await (0, import_promises2.open)(file, "r");
  try {
    const bytes = Buffer.alloc(512);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const head = bytes.subarray(0, bytesRead).toString("utf8").trimStart();
    if (/^(?:<!doctype|<html|<\?xml|\{\s*"|\[\s*\{)/i.test(head)) {
      throw new Error("A fonte retornou uma mensagem de erro no lugar do v\xEDdeo. Tente novamente.");
    }
  } finally {
    await handle.close();
  }
  return size;
}
var DownloadJobs = class {
  constructor(dir, process2 = processDownload) {
    this.dir = dir;
    this.process = process2;
  }
  dir;
  process;
  jobs = /* @__PURE__ */ new Map();
  active = 0;
  pumping = false;
  initializing = /* @__PURE__ */ new Set();
  saves = /* @__PURE__ */ new Map();
  async init() {
    await (0, import_promises2.mkdir)(this.dir, { recursive: true });
    for (const name of await (0, import_promises2.readdir)(this.dir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const job = JSON.parse(await (0, import_promises2.readFile)(import_path2.default.join(this.dir, name), "utf8"));
        if (name !== `${job.id}.json`) continue;
        this.jobs.set(job.id, job);
        if (job.state === "processing") job.state = "queued";
        if (job.state === "ready") {
          try {
            await validateMedia(this.filePath(job.id), job.mime || "");
          } catch {
            job.state = "error";
            job.error = "O arquivo n\xE3o est\xE1 mais dispon\xEDvel. Inicie o download novamente.";
          }
        }
      } catch {
      }
    }
    await this.prune();
    void this.pump();
  }
  async save(job) {
    const destination = import_path2.default.join(this.dir, `${job.id}.json`);
    const snapshot = JSON.stringify(job);
    const pending = (this.saves.get(job.id) || Promise.resolve()).catch(() => {
    }).then(async () => {
      await (0, import_promises2.writeFile)(destination + ".tmp", snapshot);
      await (0, import_promises2.rename)(destination + ".tmp", destination);
    });
    this.saves.set(job.id, pending);
    try {
      await pending;
    } finally {
      if (this.saves.get(job.id) === pending) this.saves.delete(job.id);
    }
  }
  filePath(id) {
    return import_path2.default.join(this.dir, `${id}.media`);
  }
  get(id) {
    return this.jobs.get(id);
  }
  public(job) {
    const { input: _input, requestId: _requestId, ...publicJob } = job;
    return publicJob;
  }
  async create(input, requestId) {
    const existing = [...this.jobs.values()].find((j) => j.requestId === requestId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("Esse pedido j\xE1 foi usado para outro download.");
      await this.saves.get(existing.id);
      return existing;
    }
    if ([...this.jobs.values()].filter((j) => j.state === "queued" || j.state === "processing").length >= 100) throw new Error("A fila est\xE1 cheia. Aguarde os downloads atuais terminarem.");
    const job = { id: import_crypto.default.randomUUID(), requestId, input, state: "queued", createdAt: Date.now(), updatedAt: Date.now() };
    this.jobs.set(job.id, job);
    this.initializing.add(job.id);
    try {
      await this.save(job);
    } catch (e) {
      this.jobs.delete(job.id);
      throw e;
    } finally {
      this.initializing.delete(job.id);
    }
    void this.pump();
    return job;
  }
  async prune() {
    for (const [id, job] of this.jobs) {
      if (job.state === "queued" || job.state === "processing" || Date.now() - job.updatedAt < TTL) continue;
      this.jobs.delete(id);
      await (0, import_promises2.rm)(this.filePath(id), { force: true });
      await (0, import_promises2.rm)(import_path2.default.join(this.dir, `${id}.json`), { force: true });
    }
  }
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active < 2) {
        const job = [...this.jobs.values()].find((j) => j.state === "queued" && !this.initializing.has(j.id));
        if (!job) break;
        job.state = "processing";
        this.active++;
        void this.run(job).finally(() => {
          this.active--;
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }
  async run(job) {
    let result;
    const file = this.filePath(job.id);
    try {
      await this.save(job);
      result = await this.process(job.input);
      if (!result.ok) throw new Error(result.error);
      if (result.kind === "file") {
        await (0, import_promises2.copyFile)(result.filePath, file);
      } else {
        const response = await fetch(result.url, { headers: result.headers, signal: AbortSignal.timeout(25 * 6e4) });
        if (!response.ok || !response.body) throw new Error("A fonte do v\xEDdeo n\xE3o respondeu. Tente novamente em instantes.");
        if (/json|html|xml/.test(response.headers.get("content-type") || "")) throw new Error("A fonte retornou um erro no lugar do v\xEDdeo.");
        await (0, import_promises3.pipeline)(import_stream.Readable.fromWeb(response.body), (0, import_fs.createWriteStream)(file));
        const length = Number(response.headers.get("content-length"));
        if (length && (await (0, import_promises2.stat)(file)).size !== length) throw new Error("A conex\xE3o caiu antes de terminar o arquivo. Tente novamente.");
      }
      job.size = await validateMedia(file, result.contentType);
      job.filename = result.name.replace(/[\r\n"\\/]/g, "_");
      job.mime = result.contentType;
      job.state = "ready";
    } catch (e) {
      job.state = "error";
      job.error = e instanceof Error ? e.message : "N\xE3o foi poss\xEDvel preparar o download. Tente novamente.";
      await (0, import_promises2.rm)(file, { force: true }).catch(() => {
      });
    } finally {
      if (result?.ok) await result.dispose().catch(() => {
      });
      job.updatedAt = Date.now();
      await this.save(job).catch((e) => console.error("[jobs] persist failed:", e.message));
    }
  }
};

// engine/server.ts
var VERSION = "1.2.1";
var DEFAULT_PORT = 47923;
function configDir() {
  if (process.env.AUTOEDIT_ENGINE_CONFIG_DIR) return import_path3.default.resolve(process.env.AUTOEDIT_ENGINE_CONFIG_DIR);
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA || import_os2.default.homedir() : import_path3.default.join(import_os2.default.homedir(), ".config");
  return import_path3.default.join(base, "DarkoDownloader");
}
async function loadConfig() {
  const dir = configDir();
  const file = import_path3.default.join(dir, "config.json");
  await (0, import_promises4.mkdir)(dir, { recursive: true });
  try {
    const c = JSON.parse(await (0, import_promises4.readFile)(file, "utf8"));
    if (c.token && c.port) {
      const envA = process.env.DARKO_ALLOW_ADULT;
      const allowAdult = envA === "1" ? true : envA === "0" ? false : c.allowAdult === true;
      return { token: c.token, port: c.port, allowAdult };
    }
  } catch {
  }
  const cfg = {
    token: import_crypto2.default.randomBytes(24).toString("hex"),
    port: Number(process.env.DARKO_PORT) || DEFAULT_PORT,
    allowAdult: process.env.DARKO_ALLOW_ADULT === "1"
  };
  await (0, import_promises4.writeFile)(file, JSON.stringify(cfg, null, 2));
  return cfg;
}
async function persistConfig(cfg) {
  const file = import_path3.default.join(configDir(), "config.json");
  await (0, import_promises4.mkdir)(configDir(), { recursive: true });
  await (0, import_promises4.writeFile)(file, JSON.stringify(cfg, null, 2));
}
function isExtensionOrigin(origin) {
  return !!origin && (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || origin.startsWith("extension://"));
}
function cors(res, origin) {
  if (isExtensionOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 1e6) reject(new Error("body grande"));
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}
async function main() {
  const cfg = await loadConfig();
  const jobs = new DownloadJobs(import_path3.default.join(configDir(), "jobs"));
  await jobs.init();
  setInterval(() => {
    void jobs.prune().catch(console.error);
  }, 6e4).unref();
  const server = import_http.default.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      console.error("[engine] request failed:", error instanceof Error ? error.message : error);
      if (res.headersSent) return res.destroy();
      res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "N\xE3o foi poss\xEDvel concluir o pedido. Tente novamente." }));
    });
  });
  async function handle(req, res) {
    const origin = req.headers.origin;
    cors(res, origin);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${cfg.port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: true,
          app: "darkolab-downloader-engine",
          version: VERSION,
          capabilities: ["download-jobs-v1"],
          allowAdult: cfg.allowAdult
        })
      );
    }
    if (req.method === "GET" && url.pathname === "/pair") {
      if (origin && !isExtensionOrigin(origin)) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "origem nao permitida" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          app: "darkolab-downloader-engine",
          token: cfg.token,
          port: cfg.port,
          allowAdult: cfg.allowAdult,
          version: VERSION,
          capabilities: ["download-jobs-v1"]
        })
      );
    }
    function tokenOk(tok) {
      try {
        return tok.length === cfg.token.length && import_crypto2.default.timingSafeEqual(Buffer.from(tok), Buffer.from(cfg.token));
      } catch {
        return false;
      }
    }
    if (url.pathname === "/jobs" || url.pathname.startsWith("/jobs/")) {
      const fileRequest = /^\/jobs\/([a-f0-9-]{36})\/file$/.exec(url.pathname);
      const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || (fileRequest ? url.searchParams.get("t") || "" : "");
      if (!tokenOk(tok) || origin && !isExtensionOrigin(origin)) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Conex\xE3o expirada. Reconecte a extens\xE3o." }));
      }
      if (req.method === "POST" && url.pathname === "/jobs") {
        let b;
        try {
          b = JSON.parse(await readBody(req));
        } catch {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Pedido inv\xE1lido." }));
        }
        if (!b || typeof b.url !== "string" || typeof b.requestId !== "string" || !b.requestId || b.requestId.length > 160) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "Link ou identificador de download inv\xE1lido." }));
        }
        if (b.adult && !cfg.allowAdult) {
          res.writeHead(403, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "O modo +18 est\xE1 desativado neste Motor." }));
        }
        try {
          const job2 = await jobs.create({ url: b.url, mode: b.mode || "video", quality: b.quality || "1080", adult: b.adult === true }, b.requestId);
          res.writeHead(202, { "content-type": "application/json" });
          return res.end(JSON.stringify(jobs.public(job2)));
        } catch (e) {
          res.writeHead(409, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: e instanceof Error ? e.message : "N\xE3o foi poss\xEDvel adicionar \xE0 fila." }));
        }
      }
      const match = /^\/jobs\/([a-f0-9-]{36})(?:\/file)?$/.exec(url.pathname);
      const job = match ? jobs.get(match[1]) : void 0;
      if (!job) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Este download expirou. Inicie novamente." }));
      }
      if (!fileRequest && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(jobs.public(job)));
      }
      if (fileRequest && (req.method === "GET" || req.method === "HEAD")) {
        if (job.state !== "ready" || !job.size || !job.mime) {
          res.writeHead(409, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: job.error || "O arquivo ainda est\xE1 sendo preparado." }));
        }
        let start = 0;
        let end = job.size - 1;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (range && (range[1] || range[2])) {
            start = range[1] ? Number(range[1]) : Math.max(0, job.size - Number(range[2]));
            end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
          } else start = job.size;
          if (start > end || start >= job.size) {
            res.writeHead(416, { "content-range": `bytes */${job.size}` });
            return res.end();
          }
          res.setHeader("content-range", `bytes ${start}-${end}/${job.size}`);
        }
        res.writeHead(req.headers.range ? 206 : 200, {
          "content-type": job.mime,
          "content-length": String(end - start + 1),
          "content-disposition": `attachment; filename="${(job.filename || "download").replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(job.filename || "download")}`,
          "accept-ranges": "bytes"
        });
        if (req.method === "HEAD") return res.end();
        const stream = (0, import_fs2.createReadStream)(jobs.filePath(job.id), { start, end });
        res.on("close", () => stream.destroy());
        stream.on("error", () => res.destroy());
        stream.pipe(res);
        return;
      }
      res.writeHead(405);
      return res.end();
    }
    async function serve(params) {
      if (params.adult && !cfg.allowAdult) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error: "O modo +18 esta desativado neste Motor. Reinstale o Motor pela pagina do Downloader pra reativar."
          })
        );
      }
      const result = await processDownload(params);
      if (!result.ok) {
        res.writeHead(result.status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: result.error }));
      }
      const cd = `attachment; filename="${result.name.replace(/"/g, "")}"`;
      if (result.kind === "remote") {
        try {
          const up = await fetch(result.url, { headers: result.headers });
          if (!up.ok || !up.body) {
            await result.dispose();
            res.writeHead(502, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: `CDN HTTP ${up.status}` }));
          }
          const upLen = up.headers.get("content-length");
          const baseHeaders = {
            "content-type": result.contentType,
            "content-disposition": cd
          };
          if (upLen) baseHeaders["content-length"] = upLen;
          res.writeHead(200, baseHeaders);
          const reader = up.body.getReader();
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (e) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : "CDN falhou"
            })
          );
        } finally {
          await result.dispose();
        }
        return;
      }
      let totalBytes = 0;
      try {
        totalBytes = (await (await import("fs/promises")).stat(result.filePath)).size;
      } catch {
      }
      const fhdrs = {
        "content-type": result.contentType,
        "content-disposition": cd
      };
      if (totalBytes > 0) fhdrs["content-length"] = String(totalBytes);
      res.writeHead(200, fhdrs);
      const stream = (0, import_fs2.createReadStream)(result.filePath);
      stream.on("error", () => {
        try {
          res.destroy();
        } catch {
        }
      });
      stream.on("close", () => {
        result.dispose();
      });
      stream.pipe(res);
    }
    if (req.method === "POST" && url.pathname === "/download") {
      if (!isExtensionOrigin(origin)) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Origem nao permitida." }));
      }
      const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!tokenOk(tok)) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ error: "Token invalido. Pareie a extensao." })
        );
      }
      let b;
      try {
        b = JSON.parse(await readBody(req) || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "JSON invalido." }));
      }
      return serve({
        url: b.url || "",
        mode: b.mode,
        quality: b.quality,
        adult: b.adult === true
      });
    }
    if (req.method === "GET" && url.pathname === "/get") {
      if (!tokenOk(url.searchParams.get("t") || "")) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Token invalido." }));
      }
      return serve({
        url: url.searchParams.get("url") || "",
        mode: url.searchParams.get("mode") || "video",
        quality: url.searchParams.get("quality") || "1080",
        adult: url.searchParams.get("adult") === "1"
      });
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
  function announce() {
    persistConfig(cfg).catch(() => {
    });
    console.log(
      JSON.stringify({
        event: "listening",
        port: cfg.port,
        allowAdult: cfg.allowAdult,
        configDir: configDir()
      })
    );
    console.log(
      `
[DarkoLab Downloader] motor rodando em http://127.0.0.1:${cfg.port}`
    );
  }
  async function tryListen(port, attempt) {
    server.removeAllListeners("error");
    server.once("error", async (e) => {
      if (e.code === "EADDRINUSE") {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2500)
          });
          const j = await r.json().catch(() => ({}));
          if (j && j.app === "darkolab-downloader-engine") {
            console.log(
              `[DarkoLab Downloader] ja ha um motor em ${port} \u2014 ok, saindo.`
            );
            process.exit(0);
          }
        } catch {
        }
        if (attempt < 8) {
          const next = port + 1;
          cfg.port = next;
          try {
            await persistConfig(cfg);
          } catch {
          }
          return tryListen(next, attempt + 1);
        }
      }
      console.error("[DarkoLab Downloader] erro do servidor:", e);
      process.exit(1);
    });
    server.listen(port, "127.0.0.1", announce);
  }
  await tryListen(cfg.port, 0);
}
main();
