import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = path.join(process.cwd(), '.test-tmp', 'downloader-ui-interactions');
await fs.mkdir(out,{recursive:true});
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:404,height:600}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:49091/popup.html');
 await page.waitForFunction(()=>document.querySelector('#engineLabel').textContent==='Conectado');
 assert.ok(await page.evaluate(()=>document.body.scrollHeight<=600));
 await page.locator('#go').click();await page.locator('#inputError').waitFor({state:'visible'});
 assert.equal(await page.locator('#urls').evaluate(e=>e===document.activeElement),true);
 await page.locator('#urls').fill('invalid-link'); await page.locator('#go').click();assert.match(await page.locator('#inputError').textContent(),/não é válido/);
 await page.locator('#modes button[data-v="audio-mp3"]').click();assert.equal(await page.locator('#quals button:disabled').count(),4);
 await page.locator('#modes button[data-v="video"]').click();assert.equal(await page.locator('#quals button:disabled').count(),0);
 await page.locator('#urls').fill('https://www.youtube.com/watch?v=NIGgXN7YMM4&list=radio');await page.locator('#go').click();
 await page.locator('.job.complete').waitFor();assert.equal(await page.locator('.job').count(),1);
 await page.getByRole('button',{name:'Mostrar na pasta'}).click();assert.equal(await page.locator('body').getAttribute('data-show-folder'),'true');
 await page.locator('#clearJobs').click(); await page.locator('#emptyState').waitFor({state:'visible'});
 await page.screenshot({path:path.join(out,'popup-ready.png')});
 for(const scenario of ['error','working','offline','update']){
  await page.goto('http://127.0.0.1:49091/popup.html?state='+scenario); await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=404));
  if(['offline','update'].includes(scenario))assert.equal(await page.locator('#noEngine').isVisible(),true);
  await page.screenshot({path:path.join(out,'popup-'+scenario+'.png'),fullPage:true});
 }
 await page.goto('http://127.0.0.1:49091/popup.html?state=error'); await page.waitForTimeout(200);
 await page.getByRole('button',{name:'Tentar novamente'}).click();await page.locator('.job.complete').waitFor();
 await page.goto('http://127.0.0.1:49091/watch?v=demo');
 const contentButton=page.locator('#darko-dl-btn');await contentButton.waitFor({state:'visible'});
 assert.equal((await contentButton.textContent()).trim(),'');
 assert.equal(await contentButton.getAttribute('aria-label'),'Baixar este vídeo com Auto Edit');
 const idleBox=await contentButton.boundingBox();assert.ok(idleBox.width<=60&&idleBox.height<=60,'content button must remain compact and icon-only');
 await contentButton.focus();assert.equal(await contentButton.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
 await page.screenshot({path:path.join(out,'button-idle.png'),fullPage:true});
 await contentButton.click();
 await contentButton.waitFor({state:'visible'});assert.equal(await contentButton.getAttribute('aria-busy'),'true');
 await page.screenshot({path:path.join(out,'button-loading.png'),fullPage:true});
 await page.locator('#darko-dl-btn[data-state="ok"]').waitFor();assert.match(await page.locator('#darko-dl-toast').textContent(),/concluído/);
 assert.equal((await contentButton.textContent()).trim(),'');assert.match(await contentButton.getAttribute('aria-label'),/Arquivo salvo/);
 await page.screenshot({path:path.join(out,'button-complete.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS popup empty/validation/format/multiple states/retry/clear/folder and content button real DOM interactions; no overflow, no JS errors; default popup fits600px. Simulated transfer fixture: '+out);
} finally {await browser.close();}
