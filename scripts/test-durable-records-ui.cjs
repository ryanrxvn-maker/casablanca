// Isolated component test: synthetic records, no user profile or live API.
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');
async function main() {
  const root = path.resolve(__dirname, '..');
  const fixture = `
    export const RECORDS_EVENT = 'test:records';
    const state = {ready:true,message:'Sincronizado',pending:0,conflicts:0,legacy:4,error:false};
    export const durabilityStatus = () => ({...state});
    export const initializeDurableRecords = async () => {};
    export const syncDurableRecords = async () => {};
    export const refreshDurableRecords = async () => {};
    export const exportRecovery = () => {};
    export const importLegacyRecords = async () => {
      window.importCalls = (window.importCalls || 0) + 1;
      await new Promise(r => setTimeout(r, 150));
      if (window.failImport) throw new Error('Falha simulada: registros preservados.');
      state.legacy=0;
      window.dispatchEvent(new CustomEvent(RECORDS_EVENT));
    };
  `;
  const bundle = await build({
    stdin: {contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {DurableRecordsProvider} from './components/DurableRecordsProvider'; createRoot(document.getElementById('root')).render(<DurableRecordsProvider><p>Lista de teste</p></DurableRecordsProvider>);`, resolveDir:root,loader:'tsx'},
    bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'synthetic-registry',setup(b){
      b.onResolve({filter:/^@\/lib\/durable-records$/},()=>({path:'registry',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));
    }}]
  });
  const browser = await chromium.launch({headless:true});
  try {
    for (const failure of [false,true]) {
      const page=await browser.newPage();
      let dialogs=0;
      page.on('dialog', async dialog=>{dialogs++;await dialog.dismiss();});
      await page.setContent('<div id="root"></div>');
      await page.evaluate(v=>{window.failImport=v;},failure);
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.getByRole('button',{name:'Importar 4 registros antigos para esta conta',exact:true}).click();
      await page.waitForFunction(()=>window.importCalls===1);
      await page.getByText(failure?'Falha simulada: registros preservados.':'Registros adicionados ao background. Acompanhe a confirmação de salvamento acima.',{exact:true}).waitFor();
      assert.equal(dialogs,0,'import must not open native confirm or alert');
      assert.equal(await page.evaluate(()=>window.importCalls),1,'single click makes one import');
      if(failure) assert(await page.getByRole('button',{name:'Importar 4 registros antigos para esta conta'}).isEnabled(),'failed import stays retryable');
      else assert.equal(await page.getByRole('button',{name:/Importar 4/}).count(),0);
      await page.close();
    }
    console.log('PASS UI: successful import, retryable failure, inline feedback, and zero native dialogs.');
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
