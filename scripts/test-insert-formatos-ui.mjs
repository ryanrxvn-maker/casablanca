/**
 * FORMATOS DO INSERT na interface (07.10) — StockFrame + janela de Inserts do PC.
 *
 * Prova no navegador, com a conta StockFrame simulada do /dev/pilot-preview:
 *  - o Smart já vem com variação (React/divididas), maioria em tela cheia;
 *  - cada linha da timeline tem o botão de formato com os 6 formatos, cada um
 *    com miniatura desenhada; trocar formato, lado, cor da linha e transição;
 *  - "Aplicar e concluir" leva o formato escolhido pra montagem;
 *  - a janela de Inserts do PC mostra os takes do StockFrame (selo, palavras
 *    ocupadas), troca o formato deles e NÃO deixa insert por cima de insert;
 *  - reabrir o StockFrame traz o formato trocado no PC (rascunho conciliado).
 *
 * Uso: STOCKFRAME_PREVIEW_URL=http://localhost:3127/dev/pilot-preview node scripts/test-insert-formatos-ui.mjs
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.STOCKFRAME_PREVIEW_URL || 'http://127.0.0.1:3100/dev/pilot-preview';
const out = resolve('.artifacts/formatos');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const openStockFrame = async () => {
    await page.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
    const d = page.getByRole('dialog').filter({ has: page.locator('[data-stockframe-done], [class*="lockedState"]') });
    await d.first().waitFor({ timeout: 15_000 });
    return page.getByRole('dialog').first();
  };
  let dialog = await openStockFrame();
  await dialog.getByText('Conta Premium de Teste').waitFor();
  await dialog.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await dialog.getByRole('heading', { name: /takes · \d+(?:\.\d+)?% da copy/ }).waitFor({ timeout: 30_000 });
  const timeline = dialog.getByLabel('Dinâmica completa da copy');
  const buttons = timeline.locator('[data-format-button]');
  const n = await buttons.count();
  assert.ok(n > 0, 'cada take do plano tem o botão de formato');
  const labels = await buttons.allInnerTexts();
  console.log(`  plano: ${labels.map((l) => l.trim()).join(' | ')}`);
  assert.ok(labels.some((l) => !/Tela cheia/.test(l)), 'o Smart já vem com React/tela dividida');
  assert.ok(labels.filter((l) => /Tela cheia/.test(l)).length >= Math.ceil(n / 2), 'a maioria fica em tela cheia');

  // ── seletor da primeira linha: 6 formatos, cada um com miniatura ──
  await buttons.first().click();
  const panel = timeline.locator('[data-format-panel]').first();
  await panel.waitFor();
  assert.equal(await panel.locator('[data-formato]').count(), 6, 'seis formatos no seletor');
  assert.equal(await panel.locator('[data-formato] svg').count(), 6, 'todo formato tem preview desenhado');
  await page.screenshot({ path: resolve(out, 'stockframe-seletor-formato.png') });
  await panel.locator('[data-formato="react"]').click();
  await panel.getByRole('button', { name: 'Esquerdo' }).click();
  assert.match(await buttons.first().innerText(), /React/);
  await panel.locator('[data-formato="linha"]').click();
  await panel.getByRole('button', { name: 'Linha vermelha' }).click();
  await panel.getByRole('radio', { name: /Luz vermelha/ }).click();
  assert.match(await buttons.first().innerText(), /Dividida com linha/);
  assert.equal(await panel.locator('[data-formato="linha"]').getAttribute('aria-checked'), 'true');
  const firstVideo = await timeline.locator('[data-video-id]').first().getAttribute('data-video-id');

  // ── Aplicar e concluir ──
  const done = dialog.locator('[data-stockframe-done]');
  assert.equal(await done.getAttribute('data-stockframe-done'), 'apply');
  await done.click();
  await page.locator('[data-stockframe-done]').waitFor({ state: 'detached', timeout: 30_000 });

  // ── janela de Inserts do PC: os takes do StockFrame aparecem ──
  await page.locator('#pi-abre').click();
  const pc = page.locator('.pi-janela');
  await pc.waitFor();
  const partes = pc.locator('.pi-partes .pi-parte');
  let achou = false;
  for (let i = 0; i < await partes.count(); i++) {
    await partes.nth(i).click();
    if (await pc.locator('.pi-card.is-alheio').count()) { achou = true; break; }
  }
  assert.ok(achou, 'os takes do StockFrame aparecem na janela de Inserts do PC');
  assert.ok(await pc.locator('.pi-palavra.is-ocupada').count() > 0, 'as falas com take do StockFrame ficam marcadas como ocupadas');
  assert.ok(await pc.locator('.pi-origem.is-stockframe').count() > 0, 'selo StockFrame no card');
  // a parte que tem o take formatado (linha vermelha)
  let comLinha = null;
  for (let i = 0; i < await partes.count(); i++) {
    await partes.nth(i).click();
    const cards = pc.locator('.pi-card.is-alheio');
    for (let k = 0; k < await cards.count(); k++) {
      if (/Dividida com linha/.test(await cards.nth(k).locator('.pi-card-meta').innerText())) { comLinha = cards.nth(k); break; }
    }
    if (comLinha) break;
  }
  assert.ok(comLinha, 'o formato escolhido no StockFrame foi pra montagem (aparece no PC)');
  await comLinha.locator('.pi-card-topo').click();
  // 08.10: o insert escolhido abre no PAINEL da direita (lista + painel)
  const insp = pc.locator('.pi-inspetor');
  await insp.locator('[data-formato]').first().waitFor();
  assert.equal(await insp.locator('[data-formato]').count(), 6, 'os mesmos 6 formatos no PC');
  const nomeDaLinha = (await comLinha.locator('.pi-card-nome').innerText()).replace(/^STOCKFRAME/i, '').trim().toLowerCase();
  const nomeDoPainel = (await insp.locator('.pi-insp-nome').innerText()).trim().toLowerCase();
  assert.ok(nomeDaLinha.includes(nomeDoPainel) || nomeDoPainel.includes(nomeDaLinha), `o painel mostra o take clicado (${nomeDoPainel} × ${nomeDaLinha})`);
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, 'pc-inserts-take-stockframe.png') });
  await insp.locator('[data-formato="mescla"]').click();
  assert.match(await comLinha.locator('.pi-card-meta').innerText(), /Mescla/, 'formato do take do StockFrame trocado pelo PC');

  // ── nunca insert por cima de insert ──
  const ocupada = pc.locator('.pi-palavra.is-ocupada').first();
  const meu = pc.locator('.pi-card:not(.is-alheio)');
  if (await meu.count()) {
    // com insert próprio na parte: abrir trecho numa palavra ocupada é recusado
    await meu.first().locator('.pi-card-topo').click();
  }
  await ocupada.click();
  await pc.locator('.pi-copy-aviso').waitFor({ timeout: 5_000 });
  assert.match(await pc.locator('.pi-copy-aviso').innerText(), /já tem|cruza/, 'aviso claro ao tentar insert por cima de insert');
  await page.screenshot({ path: resolve(out, 'pc-inserts-ocupado.png') });
  await pc.getByRole('button', { name: 'Pronto' }).click();

  // ── reabrir o StockFrame: o rascunho adota o formato trocado no PC ──
  dialog = await openStockFrame();
  await dialog.getByLabel('Dinâmica completa da copy').waitFor({ timeout: 10_000 });
  const row = dialog.getByLabel('Dinâmica completa da copy').locator(`[data-video-id="${firstVideo}"]`).locator('xpath=ancestor::div[contains(@class,"timelineRow")]');
  assert.match(await row.locator('[data-format-button]').innerText(), /Mescla/, 'reabrir: o StockFrame mostra o formato trocado no PC');
  assert.equal(await dialog.locator('[data-stockframe-done]').getAttribute('data-stockframe-done'), 'close', 'reabrir: nada pendente (o PC não virou pendência)');
  assert.equal(await dialog.getByRole('checkbox', { name: 'Ativar StockFrame' }).isChecked(), true);

  assert.deepEqual(errors, []);
  console.log('Formatos do insert: variação automática, seletor com miniaturas, aplicar e concluir, takes no PC, trava de sobreposição e rascunho conciliado OK.');
} finally {
  await browser.close();
}
