import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    window.__stockFrameTestDownloads = 0;
    window.addEventListener('message', event => {
      if (event.data?.source === 'pilot-stockframe' && event.data?.type === 'SF_REQUEST' && event.data?.action === 'download') window.__stockFrameTestDownloads++;
    });
  });
  await page.goto(process.env.STOCKFRAME_PREVIEW_URL || 'http://127.0.0.1:3100/dev/pilot-preview');
  const open = () => page.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  await open();
  let dialog = page.getByRole('dialog');
  await dialog.getByText('Conta Premium de Teste').waitFor();
  const toggle = dialog.getByRole('checkbox', { name: 'Ativar StockFrame' });
  await dialog.locator('label[class*="masterToggle"]').click();
  assert.equal(await toggle.isChecked(), false);
  await dialog.getByRole('heading', { name: 'StockFrame desligado' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Smart Stocks', exact: true }).isEnabled(), false);
  assert.equal(await dialog.locator('article').count(), 0);
  await dialog.locator('label[class*="masterToggle"]').click();
  assert.equal(await toggle.isChecked(), true);
  await dialog.getByText('Conta Premium de Teste').waitFor();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await open();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'StockFrame desligado' }).waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: 'Ativar StockFrame' }).isChecked(), false, 'Fechar sem escolher take deve voltar para OFF');

  await dialog.locator('label[class*="masterToggle"]').click();
  await dialog.getByText('Conta Premium de Teste').waitFor();
  await dialog.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await dialog.getByRole('heading', { name: /takes · \d+(?:\.\d+)?% da copy/ }).waitFor({ timeout: 25_000 });
  const timeline = dialog.getByLabel('Dinâmica completa da copy');
  const avatarRows = timeline.locator('[class*="avatarRow"]');
  assert.ok(await avatarRows.count() > 0, '60% deve exibir os trechos de avatar sem b-roll');
  const initialTakeCount = await timeline.locator('[data-video-id]').count();
  assert.ok(initialTakeCount > 0);
  const selectedIds = await timeline.locator('[data-video-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-video-id')));
  const altIds = await dialog.locator('[class*="alternatives"] button[data-video-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-video-id')));
  assert.ok(altIds.every(id => !selectedIds.includes(id)), 'Alternativas não podem incluir takes já selecionados');
  await mkdir('.artifacts/stockframe', { recursive: true });
  await avatarRows.first().locator('[class*="segmentMain"]').click();
  await page.screenshot({ path: resolve('.artifacts/stockframe/smart-60-avatar-timeline.png') });
  await avatarRows.first().getByRole('button', { name: 'Adicionar take' }).click();
  await dialog.getByText('ADICIONAR B-ROLL').waitFor();
  await dialog.locator('aside button').filter({ hasText: 'ED' }).first().click();
  await dialog.locator('aside button').filter({ hasText: 'Todos os vídeos' }).first().click();
  await dialog.getByRole('button', { name: 'Usar no plano' }).first().click();
  await dialog.getByLabel('Dinâmica completa da copy').waitFor();
  assert.equal(await page.evaluate(() => window.__stockFrameTestDownloads), 0, 'Editar plano não deve baixar takes');
  assert.equal(await timeline.locator('[data-video-id]').count(), initialTakeCount + 1);
  await dialog.getByRole('button', { name: 'Deixar com avatar' }).click();
  assert.equal(await timeline.locator('[data-video-id]').count(), initialTakeCount);
  // 07.10 — bug do Silas: "coloco os stocks, clico pra concluir e quando
  // volto o StockFrame tá desligado e sem os stocks". Com plano revisado e
  // ainda não aplicado, o Concluir APLICA (baixa os takes) e fecha.
  const done = dialog.locator('[data-stockframe-done]');
  assert.equal(await done.getAttribute('data-stockframe-done'), 'apply', 'plano pendente: o botão aplica');
  assert.match(await done.innerText(), /Aplicar e concluir/);
  await done.click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  assert.ok(await page.evaluate(() => window.__stockFrameTestDownloads) > 0, 'Concluir com plano pendente baixa os takes');
  await open();
  dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('checkbox', { name: 'Ativar StockFrame' }).isChecked(), true, 'depois do Concluir o StockFrame fica ON');
  await dialog.getByRole('button', { name: /Ajustar \d+ takes/ }).waitFor({ timeout: 10_000 });
  await dialog.getByLabel('Dinâmica completa da copy').waitFor({ timeout: 10_000 });
  assert.equal(await dialog.locator('[data-stockframe-done]').getAttribute('data-stockframe-done'), 'close', 'reabrir: plano restaurado e nada pendente');
  const downloadsAntes = await page.evaluate(() => window.__stockFrameTestDownloads);
  await dialog.locator('[data-stockframe-done]').click();
  await dialog.waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__stockFrameTestDownloads), downloadsAntes, 'Concluir sem pendência não baixa nada');

  const full = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await full.goto(process.env.STOCKFRAME_PREVIEW_URL || 'http://127.0.0.1:3100/dev/pilot-preview');
  await full.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  let fullDialog = full.getByRole('dialog');
  await fullDialog.getByText('Conta Premium de Teste').waitFor();
  await fullDialog.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await fullDialog.getByRole('button', { name: '100% de cobertura' }).click();
  // 07.10: com insert do PC na montagem, 100% StockFrame cobriria por cima
  // dele — o plano pula o trecho ocupado e o Aplicar recusa, sem baixar nada.
  await fullDialog.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await fullDialog.getByRole('heading', { name: /takes · \d+(?:\.\d+)?% da copy/ }).waitFor({ timeout: 25_000 });
  const downloadsFull = await full.evaluate(() => window.__stockFrameTestDownloads || 0);
  await fullDialog.getByRole('button', { name: 'Aplicar na montagem' }).click();
  await fullDialog.getByText(/Há inserts manuais ou do Flow nesta montagem/).waitFor({ timeout: 10_000 });
  assert.equal(await full.evaluate(() => window.__stockFrameTestDownloads || 0), downloadsFull, '100% bloqueado não baixa nada');
  await fullDialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await fullDialog.waitFor({ state: 'detached', timeout: 10_000 });
  // tira o insert do PC pela janela de Inserts e refaz o 100%
  await full.locator('#pi-abre').click();
  const pcWin = full.locator('.pi-janela');
  await pcWin.waitFor();
  await pcWin.locator('.pi-partes .pi-parte').filter({ hasText: 'BODY 1' }).click();
  await pcWin.locator('.pi-card:not(.is-alheio) .pi-card-topo').first().click();
  await pcWin.getByRole('button', { name: 'remover insert' }).click();
  await pcWin.getByRole('button', { name: 'Pronto' }).click();
  await full.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  fullDialog = full.getByRole('dialog');
  // o rascunho com takes manteve o StockFrame ON (07.10)
  assert.equal(await fullDialog.getByRole('checkbox', { name: 'Ativar StockFrame' }).isChecked(), true, 'fechar com rascunho de takes mantém ON');
  await fullDialog.getByText('Conta Premium de Teste').waitFor();
  await fullDialog.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await fullDialog.getByRole('button', { name: '100% de cobertura' }).click();
  await fullDialog.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await fullDialog.getByRole('heading', { name: /takes · 100% da copy/ }).waitFor({ timeout: 25000 });
  await fullDialog.getByRole('button', { name: 'Deixar com avatar' }).click();
  await fullDialog.getByRole('button', { name: 'Adicionar take' }).first().click();
  await fullDialog.getByRole('button', { name: 'Usar no plano' }).first().click();
  await fullDialog.getByRole('heading', { name: /takes · 100% da copy/ }).waitFor({ timeout: 10000 });
  await fullDialog.getByRole('button', { name: 'Aplicar na montagem' }).click();
  await fullDialog.getByRole('button', { name: /Ajustar \d+ takes/ }).waitFor({ timeout: 30000 });
  await fullDialog.getByRole('button', { name: 'Concluir' }).click();
  await full.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  assert.equal(await full.getByRole('dialog').getByRole('checkbox', { name: 'Ativar StockFrame' }).isChecked(), true, 'Take aplicado na montagem deve manter StockFrame ON');
  await full.close();

  // Take StockFrame inserido À MÃO continua na montagem quando o plano Smart
  // é aplicado: o Smart não pode escolhê-lo de novo nem oferecê-lo como
  // alternativa, e a biblioteca no modo "Trocar/Adicionar" o marca como usado.
  const manual = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await manual.goto(process.env.STOCKFRAME_PREVIEW_URL || 'http://127.0.0.1:3100/dev/pilot-preview');
  await manual.getByRole('button', { name: 'Abrir integração StockFrame' }).click();
  const md = manual.getByRole('dialog');
  await md.getByText('Conta Premium de Teste').waitFor();
  await md.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await md.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await md.getByRole('heading', { name: /takes · \d+(?:\.\d+)?% da copy/ }).waitFor({ timeout: 25_000 });
  const firstPick = md.getByLabel('Dinâmica completa da copy').locator('[data-video-id]').first();
  const pickedId = await firstPick.getAttribute('data-video-id');
  const pickedTitle = (await firstPick.locator('b').innerText()).trim();
  assert.ok(pickedId && pickedTitle, 'o Smart deve escolher ao menos um take');
  await md.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await md.getByPlaceholder('Buscar cenas, sintomas, ações, pessoas…').fill(pickedTitle);
  await md.getByRole('button', { name: 'Buscar', exact: true }).click();
  const card = md.locator('article').filter({ hasText: pickedTitle }).first();
  await card.getByRole('button', { name: 'Inserir' }).click();
  await md.getByRole('button', { name: /Ajustar \d+ takes/ }).waitFor({ timeout: 30_000 });
  await md.getByRole('button', { name: 'Smart Stocks', exact: true }).click();
  await md.getByRole('button', { name: 'Analisar copy e montar plano' }).click();
  await md.getByRole('heading', { name: /takes · \d+(?:\.\d+)?% da copy/ }).waitFor({ timeout: 25_000 });
  const replanned = await md.getByLabel('Dinâmica completa da copy').locator('[data-video-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-video-id')));
  assert.ok(!replanned.includes(pickedId), 'o Smart não pode escolher de novo um take já inserido à mão na montagem');
  const rows = md.getByLabel('Dinâmica completa da copy').locator('[class*="timelineRow"]');
  for (let i = 0; i < await rows.count(); i++) {
    await rows.nth(i).locator('[class*="segmentMain"]').click();
    const alts = await md.locator('[class*="alternatives"] button[data-video-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-video-id')));
    assert.ok(!alts.includes(pickedId), 'take já inserido à mão não pode aparecer como alternativa');
  }
  await md.getByRole('button', { name: 'Trocar take' }).first().click();
  await md.getByText('TROCAR TAKE').waitFor();
  await md.getByPlaceholder('Buscar cenas, sintomas, ações, pessoas…').fill(pickedTitle);
  await md.getByRole('button', { name: 'Buscar', exact: true }).click();
  const usedCard = md.locator('article').filter({ hasText: pickedTitle }).first();
  await usedCard.getByRole('button', { name: 'Já no plano' }).waitFor();
  assert.equal(await usedCard.getByRole('button', { name: 'Já no plano' }).isDisabled(), true, 'a biblioteca deve travar o take já inserido à mão');
  await manual.close();

  assert.deepEqual(errors, []);
  console.log('StockFrame Smart editor: OFF/ON, avatar gaps, add/remove without download, alternatives outside plan and outside manual inserts, edited 100% apply OK.');
} finally {
  await browser.close();
}
