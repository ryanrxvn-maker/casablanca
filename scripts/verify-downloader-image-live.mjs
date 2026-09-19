/* Real Chromium extension / downloads API with a controlled engine fixture.
   Proves raster bytes reach disk; it does not claim Pinterest availability. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=process.cwd(),ext=path.join(root,'extension-downloader');
const png=await fs.readFile(path.join(ext,'icons/icon-128.png'));
const folder=path.join(root,'.test-tmp',`downloader-image-live-${Date.now()}`);
await fs.mkdir(folder,{recursive:true});
const port=47931;let gets=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(req.headers.origin?.startsWith('chrome-extension://'))res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
 res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/health')return json({app:'darkolab-downloader-engine',version:'1.2.1',capabilities:['download-jobs-v1']});
 if(url.pathname==='/pair')return json({token:'isolated-image-fixture'});
 if(url.pathname==='/jobs'&&req.method==='POST'){req.resume();return json({id:'image-test',state:'ready'});}
 if(url.pathname==='/jobs/image-test')return json({id:'image-test',state:'ready',mime:'image/png',filename:'pinterest-test.png',size:png.length});
 if(url.pathname==='/jobs/image-test/file'){
  res.writeHead(200,{'content-type':'image/png','content-length':png.length,'content-disposition':'attachment; filename="pinterest-test.png"'});
  if(req.method==='HEAD')res.end();else{gets++;res.end(png);}return;
 }
 json({error:'not found'},404);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
let context;
try{
 context=await chromium.launchPersistentContext(path.join(folder,'profile'),{channel:'chromium',headless:true,acceptDownloads:true,downloadsPath:path.join(folder,'downloads'),viewport:{width:404,height:600},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(async()=>chrome.storage.local.set({port:47931,engineCheckedAt:0}));
 const page=await context.newPage();await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
 await page.waitForFunction(()=>document.querySelector('#engineLabel').textContent==='Conectado');
 await page.locator('#urls').fill('https://www.pinterest.com/pin/1234567890/');await page.locator('#go').click();
 await page.waitForFunction(()=>document.querySelector('.job.complete')||document.querySelector('.job.error'),null,{timeout:20000});
 const record=await worker.evaluate(async()=>({version:chrome.runtime.getManifest().version,jobs:(await chrome.storage.local.get('downloadJobsV2')).downloadJobsV2,files:await new Promise(resolve=>chrome.downloads.search({},resolve))}));
 assert.equal(record.version,'1.9.3');assert.equal(record.jobs[0].state,'complete',JSON.stringify(record.jobs[0]));assert.equal(record.files[0].state,'complete');assert.equal(record.files[0].mime,'image/png');assert.equal(gets,1);
 const saved=await fs.readFile(record.files[0].filename);assert.deepEqual(saved,png);assert.equal(record.files.length,1);
 await page.screenshot({path:path.join(folder,'image-complete.png')});
 const report={version:record.version,mode:'controlled engine fixture, real Chromium extension and file transfer',state:record.jobs[0].state,filename:record.jobs[0].filename,mime:record.files[0].mime,bytes:saved.length,byteIdentical:true,downloads:record.files.length,evidence:folder};
 await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(`PASS actual image bytes via extension ${record.version} → Chrome download:`,JSON.stringify(report));
}finally{if(context)await context.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
