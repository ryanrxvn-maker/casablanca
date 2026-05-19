// Bundla o motor (server.ts + downloader-core + headless-grab) num
// unico CJS pra rodar com Node puro no instalador. Playwright fica
// EXTERNAL (instalado ao lado, traz o Chromium).
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(here, 'dist', 'server.cjs'),
  external: ['playwright'],
  legalComments: 'none',
  logLevel: 'info',
});

console.log('engine bundle -> engine/dist/server.cjs');
