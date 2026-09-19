/** Browser regression of the real Downloader page, with external auth/bridge/services controlled. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import babel from 'next/dist/compiled/babel/core.js';

const output = '.test-tmp/downloader-page';
const version = JSON.parse(readFileSync('extension-downloader/manifest.json', 'utf8')).version;
mkdirSync(output, { recursive: true });
const mocks = {
  '@/components/ToolsStateProvider': "import { useState } from 'react'; export function useToolState(key, initial) { return useState(initial); }",
  '@/lib/history': 'export function logHistory() {}',
  '@/lib/audio-engine': 'export function downloadBlob() { window.__blobSaved = true; }',
  '@/lib/supabase/client': "export function createClient() { return { auth:{ getUser:async()=>({data:{user:{id:'test'}}}) }, from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_admin:window.__admin === true}})})})}) }; }",
  '@/lib/use-tier': 'export function useUserEmail() { return "downloader-test@example.test"; }',
};
const bundle = await build({
  stdin: { contents: "import React from 'react'; import { createRoot } from 'react-dom/client'; import Page from './app/tools/downloader/page'; createRoot(document.getElementById('root')).render(<Page/>);", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_MAC_MOTOR_BETA': '""' },
  plugins: [{ name: 'controlled-external-services', setup(b) {
    b.onResolve({ filter: /^@\// }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.tsx$/ }, args => ({ contents: babel.transformSync(readFileSync(args.path, 'utf8'), {
      filename: args.path, presets: [['next/babel', { 'preset-react': { runtime: 'automatic' } }]], babelrc: false, configFile: false,
    }).code, loader: 'js' }));
  } }],
});
const css = (await postcss([tailwindcss(), autoprefixer()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })).css;
writeFileSync(`${output}/page.js`, bundle.outputFiles[0].text);
writeFileSync(`${output}/page.css`, css);
const server = createServer((req, res) => {
  if (req.url === '/page.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === '/page.css') { res.setHeader('content-type', 'text/css'); res.end(css); return; }
  if (req.url === '/api/downloader-extension/version') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version })); return; }
  if (req.url?.startsWith('/api/downloader-extension/download')) { res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', 'attachment; filename="extension.zip"'); res.end('test-download'); return; }
  if (req.url?.startsWith('/api/')) { res.statusCode = 500; res.end('Unexpected external request'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><head><link rel="stylesheet" href="/page.css"><style>:root{--font-display:Arial;--font-tech:Arial;--font-mono:monospace}body{padding:32px 0}</style></head><body><div id="root"></div><script src="/page.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const status = () => page.locator('[data-downloader-status]').getAttribute('data-downloader-status');
async function expectStatus(expected) {
  await page.locator(`[data-downloader-status="${expected}"]`).waitFor({ timeout: 10000 });
  assert.equal(await status(), expected);
  results.push(expected);
}
async function pong(value) {
  await page.evaluate(data => window.postMessage({ source: 'darko-dl-ext', type: 'DL_PONG', ...data }, location.origin), value);
}
const current = { version, engine: true, engineVersion: '1.2.1', engineCompatible: true };
try {
  await page.addInitScript(() => {
    window.__admin = true;
    localStorage.setItem('darkolab:downloader:ext-cache', JSON.stringify({ connected: true, version: '1.8.0', engine: true, ts: Date.now() }));
    window.__commands = [];
    window.addEventListener('message', event => {
      if (event.data?.source === 'darko-dl' && event.data.type === 'DL_ENGINE_DOWNLOAD') window.__commands.push(event.data);
    });
  });
  await page.goto(origin);
  await expectStatus('checking');
  await expectStatus('missing');
  assert.equal(await page.getByRole('link', { name: 'Baixar extensão', exact: true }).count(), 1);
  const zip = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Baixar extensão', exact: true }).click()]);
  assert.equal(zip[0].suggestedFilename(), 'extension.zip');
  await page.screenshot({ path: `${output}/missing.png`, fullPage: true });

  for (const version of ['1.6.0', '1.8.0', undefined]) {
    await pong({ version, engine: true });
    await expectStatus('outdated');
    assert.equal(await page.getByRole('link', { name: 'Atualizar extensão', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Modo +18' }).count(), 1, 'admin also sees update action');
  }
  await page.screenshot({ path: `${output}/update.png`, fullPage: true });
  await pong({ ...current, engineVersion: '1.0.0', engineCompatible: false });
  await expectStatus('engine-outdated');
  assert.equal(await page.getByRole('link', { name: 'Atualizar Motor', exact: true }).count(), 1);
  await pong({ ...current, engine: false });
  await expectStatus('engine-offline');
  await pong(current);
  await expectStatus('ready');
  await pong({ version, checking: true });
  await expectStatus('ready');
  await page.locator('summary').click();
  await page.screenshot({ path: `${output}/ready.png`, fullPage: true });

  await page.getByRole('textbox', { name: 'Links para baixar, um por linha' }).fill('https://www.youtube.com/watch?v=NI6gXN7YMM4&list=RDNI6gXN7YMM4&start_radio=1');
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
  await page.waitForFunction(() => window.__commands.length === 1);
  const command = await page.evaluate(() => window.__commands[0]);
  assert.equal(command.mode, 'video'); assert.equal(command.quality, '1080');
  await pong({ ...current });
  await page.evaluate(reqId => window.postMessage({ source: 'darko-dl-ext', type: 'DL_ENGINE_PROGRESS', reqId, phase: 'downloading', pct: 42 }, location.origin), command.reqId);
  await page.getByRole('button', { name: /Baixando · 42%/ }).waitFor();
  assert.equal(await page.getByText('salvo', { exact: true }).count(), 0, 'progress never claims saved');
  await page.screenshot({ path: `${output}/progress.png`, fullPage: true });
  await page.evaluate(reqId => window.postMessage({ source: 'darko-dl-ext', type: 'DL_ENGINE_RESULT', reqId, ok: true }, location.origin), command.reqId);
  await page.getByText('salvo', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).isEnabled(), true);

  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
  await page.waitForFunction(() => window.__commands.length === 2);
  await page.evaluate(() => window.postMessage({ source: 'darko-dl-ext', type: 'DL_ENGINE_RESULT', reqId: window.__commands[1].reqId, ok: false, error: 'Este vídeo está privado. Entre na conta que tem acesso e tente novamente.' }, location.origin));
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /vídeo está privado/);
  assert.equal(await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile-error.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'mobile has no horizontal overflow');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, states: results, downloadProgress: 42, completionVerified: true, retryAfterError: true, mobileNoOverflow: true, artifacts: output }, null, 2));
} finally {
  await browser.close();
  server.close();
}
