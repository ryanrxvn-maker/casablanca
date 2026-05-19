/**
 * DarkoLab Downloader — MOTOR LOCAL
 *
 * Servidor HTTP que roda no PC do usuario (127.0.0.1), recebe pedidos
 * da extensao do navegador e baixa usando lib/downloader-core (mesma
 * logica do app web). Empacotado num instalador junto com yt-dlp,
 * ffmpeg e Chromium.
 *
 * Seguranca:
 *  - bind SO em 127.0.0.1 (nao exposto na rede)
 *  - Origin precisa ser uma extensao do Chrome/Edge
 *  - /download exige Authorization: Bearer <token> (token gerado no
 *    1o run e pareado na extensao uma unica vez)
 *  - +18 so quando allowAdult=true na config local
 */

import http from 'http';
import { createReadStream } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { processDownload, type Mode, type Quality } from '../lib/downloader-core';

const VERSION = '1.0.0';
const DEFAULT_PORT = 47923;

type Config = { token: string; port: number; allowAdult: boolean };

function configDir(): string {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || os.homedir()
      : path.join(os.homedir(), '.config');
  return path.join(base, 'DarkoDownloader');
}

async function loadConfig(): Promise<Config> {
  const dir = configDir();
  const file = path.join(dir, 'config.json');
  await mkdir(dir, { recursive: true });
  try {
    const c = JSON.parse(await readFile(file, 'utf8')) as Partial<Config>;
    if (c.token && c.port) {
      return {
        token: c.token,
        port: c.port,
        allowAdult: c.allowAdult === true,
      };
    }
  } catch {
    /* sem config -> cria */
  }
  const cfg: Config = {
    token: crypto.randomBytes(24).toString('hex'),
    port: Number(process.env.DARKO_PORT) || DEFAULT_PORT,
    allowAdult: process.env.DARKO_ALLOW_ADULT === '1',
  };
  await writeFile(file, JSON.stringify(cfg, null, 2));
  return cfg;
}

function isExtensionOrigin(origin: string | undefined): boolean {
  return (
    !!origin &&
    (origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://') ||
      origin.startsWith('extension://'))
  );
}

function cors(res: http.ServerResponse, origin: string | undefined) {
  // so reflete origens de extensao (nao libera site qualquer)
  if (isExtensionOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 1_000_000) reject(new Error('body grande'));
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

async function main() {
  const cfg = await loadConfig();

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    cors(res, origin);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${cfg.port}`);

    // Detecção (sem token) — não vaza o token, só status.
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          ok: true,
          app: 'darkolab-downloader-engine',
          version: VERSION,
          allowAdult: cfg.allowAdult,
        }),
      );
    }

    if (req.method === 'POST' && url.pathname === '/download') {
      // origem precisa ser extensao
      if (!isExtensionOrigin(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Origem nao permitida.' }));
      }
      // token
      const auth = req.headers.authorization || '';
      const tok = auth.replace(/^Bearer\s+/i, '');
      if (
        tok.length !== cfg.token.length ||
        !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(cfg.token))
      ) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Token invalido. Pareie a extensao.' }));
      }

      let body: { url?: string; mode?: Mode; quality?: Quality; adult?: boolean };
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'JSON invalido.' }));
      }

      const adult = body.adult === true;
      if (adult && !cfg.allowAdult) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            error:
              'Modo +18 desativado neste motor. Ative nas opcoes (allowAdult).',
          }),
        );
      }

      const result = await processDownload({
        url: body.url || '',
        mode: body.mode,
        quality: body.quality,
        adult,
      });

      if (!result.ok) {
        res.writeHead(result.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }

      const cd = `attachment; filename="${result.name.replace(/"/g, '')}"`;

      if (result.kind === 'remote') {
        try {
          const up = await fetch(result.url, { headers: result.headers });
          if (!up.ok || !up.body) {
            await result.dispose();
            res.writeHead(502, { 'content-type': 'application/json' });
            return res.end(
              JSON.stringify({ error: `CDN HTTP ${up.status}` }),
            );
          }
          res.writeHead(200, {
            'content-type': result.contentType,
            'content-disposition': cd,
          });
          const reader = up.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: e instanceof Error ? e.message : 'CDN falhou',
            }),
          );
        } finally {
          await result.dispose();
        }
        return;
      }

      // arquivo em disco
      res.writeHead(200, {
        'content-type': result.contentType,
        'content-disposition': cd,
      });
      const stream = createReadStream(result.filePath);
      stream.on('error', () => {
        try {
          res.destroy();
        } catch {
          /* noop */
        }
      });
      stream.on('close', () => {
        result.dispose();
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    // stdout serve pro instalador exibir o token de pareamento
    console.log(
      JSON.stringify({
        event: 'listening',
        port: cfg.port,
        token: cfg.token,
        allowAdult: cfg.allowAdult,
        configDir: configDir(),
      }),
    );
    console.log(
      `\n[DarkoLab Downloader] motor rodando em http://127.0.0.1:${cfg.port}`,
    );
    console.log(
      `[DarkoLab Downloader] CODIGO DE PAREAMENTO (cole na extensao):\n  ${cfg.token}\n`,
    );
  });

  server.on('error', (e) => {
    console.error('[DarkoLab Downloader] erro do servidor:', e);
    process.exit(1);
  });
}

main();
