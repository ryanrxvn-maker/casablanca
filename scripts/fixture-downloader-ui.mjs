/* Local visual / interaction fixture. Chrome API and transfer states are
   explicitly simulated; HTML, CSS and application JS are the shipped files. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const base = path.join(process.cwd(), 'extension-downloader');
const port = Number(process.env.DOWNLOADER_FIXTURE_PORT || 49091);
const mock = `
const scenario = new URL(location.href).searchParams.get('state') || 'ready';
const fixtureJobs = scenario === 'error' ? [{id:'fixture-error',url:'https://www.youtube.com/watch?v=NIGgXN7YMM4',mode:'video',quality:'1080',state:'error',phase:'error',error:'A conexão foi interrompida. Confira a internet e se o Motor está aberto; depois tente novamente.',createdAt:Date.now()}] : scenario === 'working' ? [{id:'fixture-progress',url:'https://www.youtube.com/watch?v=NIGgXN7YMM4',filename:'Vídeo de referência.mp4',mode:'video',quality:'1080',state:'downloading',phase:'saving',pct:64,createdAt:Date.now()}] : [];
const storageListeners = [], messageListeners = [];
const fixtureStorage = {downloadJobsV2:fixtureJobs};
function notifyFixture(){ for(const f of storageListeners)f({downloadJobsV2:{newValue:fixtureJobs}},'local');for(const job of fixtureJobs)for(const f of messageListeners)f({type:'darko-dl-progress',...job,jobId:job.id}); }
window.chrome={runtime:{id:'visual-fixture',lastError:null,getManifest:()=>({version:'1.9.4'}),onMessage:{addListener:f=>messageListeners.push(f)},sendMessage:(m,cb)=>{setTimeout(()=>{if(m.type==='darko-jobs')return cb({ok:true,jobs:fixtureJobs});if(m.type==='darko-job')return cb({ok:true,job:fixtureJobs.find(j=>j.id===m.jobId)});if(m.type==='darko-clear-jobs'){fixtureJobs.splice(0,fixtureJobs.length,...fixtureJobs.filter(j=>!['complete','error','canceled'].includes(j.state)));notifyFixture();return cb({ok:true});}if(m.type==='darko-enqueue'){const job={id:crypto.randomUUID(),url:m.url,mode:m.mode,quality:m.quality,state:'preparing',phase:'preparing',pct:-1,createdAt:Date.now()};fixtureJobs.push(job);notifyFixture();cb({ok:true,jobId:job.id,job});setTimeout(()=>{Object.assign(job,{state:'downloading',phase:'saving',pct:64});notifyFixture();},1200);setTimeout(()=>{Object.assign(job,{state:'complete',phase:'complete',pct:100,filename:'Vídeo de referência.mp4',downloadId:99});notifyFixture();},2700);return;}cb({ok:true,connected:scenario!=='offline',engineVersion:scenario==='update'?'1.2.0':'1.2.1',engineCompatible:!['offline','update'].includes(scenario),port:47923});},100);}},storage:{local:{get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,fixtureStorage[k]])),set:async value=>Object.assign(fixtureStorage,value)},onChanged:{addListener:f=>storageListeners.push(f)}},downloads:{show:()=>{document.body.dataset.showFolder='true';}}};
`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/fixture-chrome.js') { res.setHeader('content-type','text/javascript'); res.end(mock); return; }
    if (url.pathname === '/watch') {
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end('<!doctype html><html><head><title>Botão Auto Edit — prévia simulada</title><link rel="stylesheet" href="content.css"/></head><body style="margin:0;background:#141414;color:#ededed;font:16px Segoe UI;padding:40px"><p style="font-size:11px;letter-spacing:1px;color:#aaa">PRÉVIA VISUAL · DOWNLOAD SIMULADO</p><h1 style="font-size:28px;font-weight:500">Vídeo de referência</h1><div style="background:#202020;height:420px;display:grid;place-items:center;border-radius:10px;color:#747474">Área do vídeo</div><script src="fixture-chrome.js"></script><script src="fixture-content.js"></script></body></html>'); return;
    }
    if (url.pathname === '/fixture-content.js') { res.setHeader('content-type','text/javascript'); res.end((await fs.readFile(path.join(base,'content.js'),'utf8')).replace('const host = location.hostname;', 'const host = "www.youtube.com";').replace("url.hostname.endsWith('youtube.com')", "(url.hostname.endsWith('youtube.com') || url.hostname === '127.0.0.1')")); return; }
    const name = url.pathname === '/' ? 'popup.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(base, name);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    let content = await fs.readFile(file);
    if (name === 'popup.html') content = Buffer.from(content.toString().replace('<script src="download-utils.js">','<script src="fixture-chrome.js"></script><script src="download-utils.js">'));
    const ext = path.extname(name); res.setHeader('content-type',ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css':ext==='.js'?'text/javascript':'image/png'); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log('Downloader UI fixture (simulated Chrome API): http://127.0.0.1:'+port+'/popup.html | ?state=error|working|offline|update | /watch?v=demo'));
