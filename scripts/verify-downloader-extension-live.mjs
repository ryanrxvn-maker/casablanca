/* Real Chrome extension integration, isolated disposable profile only.
   Requires a running jobs-capable local Motor. Does not touch user Chrome. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const target = process.env.DOWNLOADER_TEST_URL || 'https://www.youtube.com/watch?v=NIGgXN7YMM4&list=RDNIGgXN7YMM4&start_radio=1';
const folder = path.join(root, '.test-tmp', `downloader-extension-live-${Date.now()}`);
await fs.mkdir(folder, { recursive: true });
const ext = path.join(root, 'extension-downloader');
const context = await chromium.launchPersistentContext(path.join(folder, 'profile'), {
  channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(folder, 'downloads'), viewport: { width: 404, height: 600 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).hostname;
  console.log('Isolated extension:', extensionId);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForFunction(() => document.querySelector('#engineLabel')?.textContent === 'Conectado', null, { timeout: 20000 });
  console.log('Live compatible Motor connected.');
  await page.screenshot({ path: path.join(folder, 'popup-ready.png') });
  await page.locator('#urls').fill(target);
  await page.locator('#go').click();
  await page.waitForFunction(() => document.querySelectorAll('.job').length > 0);
  const queued = await worker.evaluate(async () => (await chrome.storage.local.get('downloadJobsV2')).downloadJobsV2[0]);
  assert.ok(queued.id); assert.ok(!['complete', 'error'].includes(queued.state));
  console.log('Durable queue accepted:', queued.id, queued.state);
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.close();
  console.log('Popup closed and isolated service worker stopped.');
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  const start = Date.now(); let final;
  while (Date.now() - start < 8 * 60 * 1000) {
    final = await reopened.evaluate(async () => (await chrome.storage.local.get('downloadJobsV2')).downloadJobsV2?.[0]);
    if (final && ['complete', 'error', 'canceled'].includes(final.state)) break;
    console.log('Transfer:', final?.state, final?.phase, final?.pct);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(final?.state, 'complete', JSON.stringify(final));
  const downloads = await reopened.evaluate(() => new Promise(resolve => chrome.downloads.search({}, resolve)));
  const actual = downloads.find(item => item.id === final.downloadId);
  assert.equal(actual?.state, 'complete'); assert.ok(actual.bytesReceived > 0); assert.ok(!/json|html/i.test(actual.mime || ''));
  assert.equal(downloads.filter(item => item.state === 'complete').length, 1, 'No duplicate files after worker termination');
  await reopened.screenshot({ path: path.join(folder, 'popup-complete.png') });
  assert.deepEqual(errors, []);
  const report = { jobId: final.id, state: final.state, filename: actual.filename, mime: actual.mime, bytes: actual.bytesReceived, duplicateCount: downloads.length, pageErrors: errors, evidence: folder };
  await fs.writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS real extension → Motor → Chrome download, popup close + SW restart:', JSON.stringify(report));
} finally { await context.close(); }
