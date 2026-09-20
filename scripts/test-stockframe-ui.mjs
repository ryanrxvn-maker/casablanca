import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.STOCKFRAME_PREVIEW_URL || 'http://127.0.0.1:3100/dev/pilot-preview';
const outputDir = resolve('.artifacts/stockframe');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openPreview(page) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Conta Premium de Teste').waitFor({ state: 'visible', timeout: 10_000 });
  return dialog;
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await desktop.addInitScript(() => {
    window.__stockFrameTestDownloads = 0;
    window.addEventListener('message', (event) => {
      if (event.data?.source === 'pilot-stockframe' && event.data?.type === 'SF_REQUEST' && event.data?.action === 'download') window.__stockFrameTestDownloads++;
    });
  });
  const desktopDialog = await openPreview(desktop);
  await desktop.waitForFunction(() => (document.querySelector('[role="dialog"]')?.querySelectorAll('article').length || 0) >= 6, null, { timeout: 10_000 });
  const cards = desktopDialog.getByRole('button', { name: /^Ver / });
  const desktopCards = await cards.count();
  if (desktopCards < 6) throw new Error(`Catálogo renderizou apenas ${desktopCards} cards.`);
  await desktop.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] video')].filter((video) => video.readyState >= 2).length >= 3, null, { timeout: 15_000 });
  await desktop.screenshot({ path: resolve(outputDir, 'library-desktop.png'), fullPage: false });

  await cards.first().click();
  await desktop.getByLabel('Preview do take').waitFor({ state: 'visible' });
  await desktop.screenshot({ path: resolve(outputDir, 'take-preview-desktop.png'), fullPage: false });
  await desktop.getByRole('button', { name: 'Fechar preview' }).click();

  await desktopDialog.getByRole('button', { name: 'Inserir', exact: true }).first().click();
  await desktop.getByRole('button', { name: 'Ajustar 1 takes', exact: true }).waitFor({ state: 'visible' });
  await desktopDialog.getByRole('button', { name: 'Inserir', exact: true }).first().click();
  await desktop.getByRole('button', { name: 'Ajustar 2 takes', exact: true }).waitFor({ state: 'visible' });
  if (await desktop.evaluate(() => window.__stockFrameTestDownloads) !== 1) throw new Error('Reutilizar o mesmo take consumiu outro download.');

  await desktop.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await desktop.getByRole('button', { name: '100% de cobertura' }).click();
  await desktop.getByRole('button', { name: 'Cortes rápidos' }).click();
  await desktop.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await desktop.getByText(/takes escolhidos/).waitFor({ state: 'visible', timeout: 20_000 });
  if (!await desktop.getByRole('button', { name: 'Aplicar na montagem' }).isVisible()) {
    throw new Error('O plano Smart não chegou ao estado revisável antes do download.');
  }
  const plannedSegments = await desktopDialog.locator('[class*="timeline"] > button').allTextContents();
  if (!plannedSegments.length || plannedSegments.some((text) => /dor no joelho/i.test(text))) {
    throw new Error('O plano da copy sobre azeite/próstata escolheu uma cena de joelho fora de contexto.');
  }
  await desktop.screenshot({ path: resolve(outputDir, 'smart-plan-desktop.png'), fullPage: false });

  await desktop.getByRole('button', { name: '30% de cobertura' }).click();
  await desktop.getByRole('heading', { name: 'Aguardando análise' }).waitFor({ state: 'visible' });
  if (await desktop.getByRole('button', { name: 'Aplicar na montagem' }).isVisible()) throw new Error('Trocar cobertura deixou aplicar o plano antigo.');
  await desktop.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await desktop.getByText(/takes escolhidos/).waitFor({ state: 'visible' });
  await desktop.getByRole('button', { name: 'Takes mais longos' }).click();
  await desktop.getByRole('heading', { name: 'Aguardando análise' }).waitFor({ state: 'visible' });
  if (await desktop.getByRole('button', { name: 'Aplicar na montagem' }).isVisible()) throw new Error('Trocar ritmo deixou aplicar o plano antigo.');

  const desktopBounds = await desktopDialog.boundingBox();
  if (!desktopBounds || desktopBounds.x < 0 || desktopBounds.y < 0 || desktopBounds.x + desktopBounds.width > 1601 || desktopBounds.y + desktopBounds.height > 1001) {
    throw new Error('A janela desktop escapou da viewport.');
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobileDialog = await openPreview(mobile);
  const smartTab = mobile.getByRole('button', { name: 'Smart Stocks', exact: true });
  if (!await smartTab.isVisible()) throw new Error('O seletor Smart Stocks sumiu no mobile.');
  await smartTab.click();
  await mobile.getByRole('heading', { name: 'Smart Stocks' }).waitFor({ state: 'visible' });
  const mobileBounds = await mobileDialog.boundingBox();
  if (!mobileBounds || mobileBounds.x < -1 || mobileBounds.width > 392) throw new Error('A janela mobile criou overflow horizontal.');
  await mobile.screenshot({ path: resolve(outputDir, 'smart-mobile.png'), fullPage: false });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({
    ok: true,
    desktopCards,
    smartPlan: true,
    mobileModeSwitch: true,
    repeatedTakeReusesDownload: true,
    changedCoverageAndPaceInvalidatePlan: true,
    unrelatedBodyPartRejected: true,
    screenshots: ['library-desktop.png', 'take-preview-desktop.png', 'smart-plan-desktop.png', 'smart-mobile.png'],
  }, null, 2));
} finally {
  await browser.close();
}
