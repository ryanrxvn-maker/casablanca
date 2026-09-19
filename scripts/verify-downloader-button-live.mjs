/* Live site content-button validation, disposable Chromium profile only. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd(),folder=path.join(root,'.test-tmp',`downloader-button-live-${Date.now()}`),ext=path.join(root,'extension-downloader');
await fs.mkdir(folder,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(folder,'profile'),{channel:'chromium',headless:true,acceptDownloads:true,downloadsPath:path.join(folder,'downloads'),viewport:{width:1360,height:850},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--mute-audio']});
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const page=await context.newPage();
 await page.goto('https://www.youtube.com/watch?v=NIGgXN7YMM4&list=RDNIGgXN7YMM4&start_radio=1',{waitUntil:'domcontentloaded',timeout:45000});
 const button=page.locator('#darko-dl-btn');await button.waitFor({state:'visible',timeout:30000});
 assert.equal((await button.textContent()).trim(),'');
 assert.equal(await button.getAttribute('aria-label'),'Baixar este vídeo com Auto Edit');
 const buttonBox=await button.boundingBox();assert.ok(buttonBox.width<=60&&buttonBox.height<=60,'Injected button must stay icon-only and compact');
 await button.click();
 await page.waitForTimeout(400);
 assert.equal(await button.getAttribute('data-state'),'loading','Must not claim success on enqueue');
 console.log('Actual YouTube injected button accepted and remains loading.');
 await page.screenshot({path:path.join(folder,'button-preparing.png')});
 const started=Date.now();
 while(Date.now()-started<180000){
  const observed=await page.evaluate(()=>({state:document.querySelector('#darko-dl-btn')?.dataset.state,label:document.querySelector('#darko-dl-btn')?.getAttribute('aria-label'),url:location.href}));
  console.log('Button progress:',JSON.stringify(observed));
  if(['ok','err'].includes(observed.state))break;
  await new Promise(resolve=>setTimeout(resolve,3000));
 }
 const finalState=await button.getAttribute('data-state');
 const toast=await page.locator('#darko-dl-toast').textContent();
 assert.equal(finalState,'ok',toast);
 const data=await worker.evaluate(async()=>({jobs:(await chrome.storage.local.get('downloadJobsV2')).downloadJobsV2,downloads:await new Promise(resolve=>chrome.downloads.search({},resolve))}));
 assert.equal(data.jobs.length,1);assert.equal(data.jobs[0].state,'complete');assert.equal(data.downloads.length,1);assert.equal(data.downloads[0].state,'complete');assert.ok(data.downloads[0].bytesReceived>0);
 await page.screenshot({path:path.join(folder,'button-complete.png')});
 const popup=await context.newPage();await popup.setViewportSize({width:404,height:600});
 await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);await popup.waitForFunction(()=>document.querySelector('.job.complete'));
 await popup.waitForFunction(()=>document.querySelector('#engineLabel').textContent==='Conectado');
 await popup.screenshot({path:path.join(folder,'popup-complete.png')});
 await popup.locator('#clearJobs').click();await popup.locator('#emptyState').waitFor({state:'visible'});
 await popup.screenshot({path:path.join(folder,'popup-ready.png')});
 const file=data.downloads[0].filename;
 const decode=spawnSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{encoding:'utf8',windowsHide:true,timeout:180000});
 assert.equal(decode.status,0,decode.stderr);assert.equal(decode.stderr.trim(),'');
 const report={source:page.url(),buttonState:finalState,toast,downloadId:data.downloads[0].id,mime:data.downloads[0].mime,bytes:data.downloads[0].bytesReceived,file,decode:'full video and audio: passed',duplicateCount:data.downloads.length,evidence:folder};
 await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
 console.log('PASS actual YouTube button → Motor → Chrome saved → successful full FFmpeg decode:',JSON.stringify(report));
} finally {await context.close();}
