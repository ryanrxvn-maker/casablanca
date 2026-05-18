/**
 * headless-grab — fallback universal pra sites +18 com JS/anti-bot
 * (buceteiro/playernc e afins). Carrega a pagina num Chromium real
 * (passa Cloudflare/age-gate/fingerprint), deixa o player tocar e
 * captura a stream REAL que ele baixa.
 *
 * Retorna OU o buffer ja baixado pela sessao do browser (mp4 direto,
 * o jeito mais confiavel — mesma TLS/cookies que passaram no muro),
 * OU uma URL .m3u8 + referer pro yt-dlp finalizar o HLS.
 *
 * Playwright e import dinamico: se nao estiver instalado, o fallback
 * apenas nao existe (nao quebra o resto do downloader).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const JUNK =
  /(plyr\.io|blank\.mp4|sample\.mp4|placeholder|googletag|doubleclick|trafficjunky|adtng|histats|popads|\/ads?\/|\.vtt|\.jpg|\.jpeg|\.png|\.webp|sprite|thumb)/i;

type GrabResult =
  | { buffer: Buffer; ext: string }
  | { m3u8: string; referer: string }
  | null;

// Browser singleton — relança se cair. Contexto é por-request.
let browserP: Promise<any> | null = null;

async function getBrowser(): Promise<any | null> {
  try {
    const { chromium } = await import('playwright');
    if (!browserP) {
      browserP = chromium
        .launch({ headless: true })
        .then((b: any) => {
          b.on('disconnected', () => {
            browserP = null;
          });
          return b;
        })
        .catch((e: unknown) => {
          browserP = null;
          throw e;
        });
    }
    return await browserP;
  } catch {
    return null; // playwright/chromium ausente
  }
}

function rank(u: string): number {
  return (
    (/\.m3u8(\?|$)/i.test(u) ? 5 : 0) +
    (/(premium|cdn|storage|stream)/i.test(u) && /\.mp4/i.test(u) ? 3 : 0) +
    (/\.mp4(\?|$)/i.test(u) ? 2 : 0) +
    (/\/video\.php\b/i.test(u) ? 1 : 0)
  );
}

export async function grabMedia(pageUrl: string): Promise<GrabResult> {
  const browser = await getBrowser();
  if (!browser) return null;

  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
  });
  try {
    const page = await ctx.newPage();
    const hits = new Set<string>();
    // url da midia -> origin do frame/player que a pediu (referer correto
    // pra anti-hotlink; ex.: premium.playernc.com exige playernc.com).
    const refOf = new Map<string, string>();
    const consider = (u: string, ct: string, frameUrl?: string) => {
      if (!u || JUNK.test(u)) return;
      const media =
        /\.m3u8(\?|$)/i.test(u) ||
        (/\.mp4(\?|$)/i.test(u) && !/\/video\.php/i.test(u)) ||
        /\/video\.php\b/i.test(u) ||
        (!!ct &&
          /^(video\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml))/i.test(
            ct,
          ));
      if (media) {
        hits.add(u);
        if (frameUrl && !refOf.has(u)) {
          try {
            refOf.set(u, new URL(frameUrl).origin + '/');
          } catch {
            /* ignore */
          }
        }
      }
    };
    page.on('response', (r: any) => {
      try {
        const fr = r.request().frame?.();
        consider(
          r.url(),
          r.headers()['content-type'] || '',
          fr ? fr.url() : undefined,
        );
      } catch {
        /* ignore */
      }
    });
    page.on('request', (r: any) => {
      try {
        const fr = r.frame?.();
        consider(r.url(), '', fr ? fr.url() : undefined);
      } catch {
        consider(r.url(), '');
      }
    });

    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      for (const f of page.frames()) {
        for (const sel of [
          'button.plyr__control--overlaid',
          '.plyr__control',
          '.play-large',
          '.vjs-big-play-button',
          'video',
          '#player',
        ]) {
          const el = await f.$(sel).catch(() => null);
          if (el) await el.click({ timeout: 1500 }).catch(() => {});
        }
      }
      await page.waitForTimeout(7000);
    } catch {
      /* segue com o que capturou ate aqui */
    }

    const ranked = [...hits].sort((a, b) => rank(b) - rank(a));
    if (ranked.length === 0) return null;

    // .m3u8 -> deixa o yt-dlp finalizar (HLS) com o referer certo
    const m3u8 = ranked.find((u) => /\.m3u8(\?|$)/i.test(u));
    if (m3u8) {
      return { m3u8, referer: new URL(pageUrl).origin + '/' };
    }

    // arquivo direto -> baixa pela SESSAO do browser (passou no muro).
    // Tenta varios referers: o do frame/player que pediu a midia
    // (correto pra anti-hotlink), a registrable-domain do CDN e a pagina.
    for (const target of ranked.slice(0, 4)) {
      let mediaBase = '';
      try {
        const mh = new URL(target).hostname;
        mediaBase =
          'https://' + mh.split('.').slice(-2).join('.') + '/';
      } catch {
        /* ignore */
      }
      const referers = [
        refOf.get(target),
        mediaBase,
        new URL(pageUrl).origin + '/',
        pageUrl,
      ].filter(Boolean) as string[];
      for (const ref of [...new Set(referers)]) {
        try {
          const resp = await ctx.request.get(target, {
            headers: { referer: ref, 'user-agent': UA },
            timeout: 90_000,
          });
          if (resp.status() !== 200 && resp.status() !== 206) continue;
          const body = Buffer.from(await resp.body());
          if (body.length < 80_000) continue; // provavel lixo/ad
          return { buffer: body, ext: 'mp4' };
        } catch {
          /* tenta proximo referer */
        }
      }
    }
    return null;
  } finally {
    await ctx.close().catch(() => {});
  }
}
