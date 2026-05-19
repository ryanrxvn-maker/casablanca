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
var import_fs = require("fs");
var import_promises2 = require("fs/promises");
var import_crypto = __toESM(require("crypto"));
var import_os2 = __toESM(require("os"));
var import_path2 = __toESM(require("path"));

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
var ffmpegResolved = null;
var aria2Resolved = void 0;
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
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
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
  if (ytDlpResolved) return ytDlpResolved;
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
        p.on("error", () => res());
        p.on("close", () => res());
      });
      const healed = await tryTool({ cmd: anyPy, pre: ["-m", "yt_dlp"] });
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
async function resolveFfmpeg() {
  if (ffmpegResolved) return ffmpegResolved;
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
function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const p = (0, import_child_process.spawn)(cmd, args, { cwd, windowsHide: true });
    let stderr = "";
    let done = false;
    const finish = (code, extra = "") => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stderr: stderr + extra });
    };
    const timer = timeoutMs ? setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {
      }
      finish(-1, "\n[timeout: processo morto]");
    }, timeoutMs) : null;
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
    if (!r.ok) return { error: `resolver HTTP ${r.status}` };
    const j = await r.json();
    if (j.code !== 0 || !j.data)
      return { error: j.msg || "resolver sem dados (privado/removido?)" };
    data = j.data;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "resolver falhou" };
  }
  const videoUrl = data.hdplay || data.play || data.wmplay;
  if (!videoUrl) return { error: "sem stream de video" };
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
    return { error: e instanceof Error ? e.message : "download falhou" };
  }
  if (!vr.ok) return { error: `download da midia HTTP ${vr.status}` };
  const buf = Buffer.from(await vr.arrayBuffer());
  if (buf.length < 1024) return { error: "midia vazia" };
  const srcPath = import_path.default.join(workDir, "tt-src.mp4");
  await (0, import_promises.writeFile)(srcPath, buf);
  const ext = mode === "audio-wav" ? "wav" : "mp3";
  const outPath = import_path.default.join(workDir, `tt-out.${ext}`);
  const ffArgs = mode === "audio-wav" ? ["-y", "-i", srcPath, "-vn", outPath] : ["-y", "-i", srcPath, "-vn", "-b:a", "192k", outPath];
  const { code } = await run(await resolveFfmpeg(), ffArgs, workDir);
  if (code !== 0) return { error: "ffmpeg falhou na extracao de audio" };
  return { file: outPath, name: safeName(title, ext) };
}
async function ytDlpArgs(mode, quality, provider) {
  const base = [
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
async function fetchYtDlp(url, mode, quality, provider, workDir, referer) {
  const tool = await resolveYtDlp();
  if (!tool)
    return {
      error: "yt-dlp indisponivel e auto-instalacao falhou. Garanta Python no PATH (ou defina PYTHON_PATH/YTDLP_PATH) e ffmpeg no PATH."
    };
  const refArgs = referer ? ["--add-header", `Referer:${referer}`] : [];
  const args = [
    ...tool.pre,
    ...await ytDlpArgs(mode, quality, provider),
    ...refArgs,
    url
  ];
  const { code, stderr } = await run(tool.cmd, args, workDir, 15e5);
  if (code !== 0) {
    const clean = stderr.split("\n").filter((l) => /error|unsupported|unavailable|private|login/i.test(l)).slice(-3).join(" ").trim();
    return {
      error: clean || "Verifique se o link e publico (conteudo privado exige login)."
    };
  }
  const names = await (0, import_promises.readdir)(workDir);
  const files = (await Promise.all(
    names.filter((n) => !/\.(part|ytdl|temp)$/i.test(n)).map(async (n) => {
      const full = import_path.default.join(workDir, n);
      const s = await (0, import_promises.stat)(full);
      return s.isFile() ? { n, full, size: s.size } : null;
    })
  )).filter(Boolean);
  if (files.length === 0) return { error: "nenhum arquivo gerado" };
  files.sort((a, b) => b.size - a.size);
  return { file: files[0].full, name: files[0].n };
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
  return {
    error: `nao foi possivel resolver a midia (site pode exigir login/assinatura, ou o Chromium do headless nao esta instalado). [${native.error}]`
  };
}
async function processDownload(input) {
  const url = (input.url ?? "").trim();
  const mode = input.mode ?? "video";
  const quality = input.quality ?? "1080";
  const adult = input.adult === true;
  if (!url || !URL_RE.test(url))
    return { ok: false, status: 400, error: "URL invalida." };
  let host;
  try {
    host = new URL(url).hostname;
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
        built = "error" in fb ? { error: `TikTok: ${built.error}. Fallback yt-dlp: ${fb.error}` } : fb;
      }
    } else if (provider === "adult") {
      built = await fetchAdult(url, mode, quality, workDir);
    } else {
      built = await fetchYtDlp(url, mode, quality, provider, workDir);
    }
    if ("error" in built) {
      await dispose();
      return {
        ok: false,
        status: 502,
        error: "Falha no download. " + built.error
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
    return {
      ok: false,
      status: 500,
      error: "Erro interno no downloader: " + (e instanceof Error ? e.message : String(e))
    };
  }
}

// engine/server.ts
var VERSION = "1.0.0";
var DEFAULT_PORT = 47923;
function configDir() {
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA || import_os2.default.homedir() : import_path2.default.join(import_os2.default.homedir(), ".config");
  return import_path2.default.join(base, "DarkoDownloader");
}
async function loadConfig() {
  const dir = configDir();
  const file = import_path2.default.join(dir, "config.json");
  await (0, import_promises2.mkdir)(dir, { recursive: true });
  try {
    const c = JSON.parse(await (0, import_promises2.readFile)(file, "utf8"));
    if (c.token && c.port) {
      const envA = process.env.DARKO_ALLOW_ADULT;
      const allowAdult = envA === "1" ? true : envA === "0" ? false : c.allowAdult === true;
      return { token: c.token, port: c.port, allowAdult };
    }
  } catch {
  }
  const cfg = {
    token: import_crypto.default.randomBytes(24).toString("hex"),
    port: Number(process.env.DARKO_PORT) || DEFAULT_PORT,
    allowAdult: process.env.DARKO_ALLOW_ADULT === "1"
  };
  await (0, import_promises2.writeFile)(file, JSON.stringify(cfg, null, 2));
  return cfg;
}
async function persistConfig(cfg) {
  const file = import_path2.default.join(configDir(), "config.json");
  await (0, import_promises2.mkdir)(configDir(), { recursive: true });
  await (0, import_promises2.writeFile)(file, JSON.stringify(cfg, null, 2));
}
function isExtensionOrigin(origin) {
  return !!origin && (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || origin.startsWith("extension://"));
}
function cors(res, origin) {
  if (isExtensionOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
  const server = import_http.default.createServer(async (req, res) => {
    const origin = req.headers.origin;
    cors(res, origin);
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
          allowAdult: cfg.allowAdult
        })
      );
    }
    function tokenOk(tok) {
      try {
        return tok.length === cfg.token.length && import_crypto.default.timingSafeEqual(Buffer.from(tok), Buffer.from(cfg.token));
      } catch {
        return false;
      }
    }
    async function serve(params) {
      if (params.adult && !cfg.allowAdult) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error: "Modo +18 desativado neste motor. Ative nas opcoes (allowAdult)."
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
          res.writeHead(200, {
            "content-type": result.contentType,
            "content-disposition": cd
          });
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
      res.writeHead(200, {
        "content-type": result.contentType,
        "content-disposition": cd
      });
      const stream = (0, import_fs.createReadStream)(result.filePath);
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
  });
  function announce() {
    persistConfig(cfg).catch(() => {
    });
    console.log(
      JSON.stringify({
        event: "listening",
        port: cfg.port,
        token: cfg.token,
        allowAdult: cfg.allowAdult,
        configDir: configDir()
      })
    );
    console.log(
      `
[DarkoLab Downloader] motor rodando em http://127.0.0.1:${cfg.port}`
    );
    console.log(
      `[DarkoLab Downloader] CODIGO DE PAREAMENTO (cole na extensao):
  ${cfg.token}
`
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
