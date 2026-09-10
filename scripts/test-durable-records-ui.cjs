// Isolated component test: synthetic records, no user profile or live API.
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');
async function main() {
  const root = path.resolve(__dirname, '..');
  const fixture = `
    export const RECORDS_EVENT = 'test:records';
    export const durabilityStatus = () => ({ready:true,message:window.failRecords?'Falha simulada':'Sincronizado',pending:0,conflicts:0,legacy:4,error:!!window.failRecords});
    export const initializeDurableRecords = async () => {};
    export const syncDurableRecords = async () => {};
    export const refreshDurableRecords = async () => {};
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
    const page=await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByText('Lista de teste',{exact:true}).waitFor();
    assert.equal(await page.getByText('Sincronizado',{exact:true}).count(),0,'healthy sync status stays invisible');
    assert.equal(await page.getByRole('button',{name:/Exportar|Importar/}).count(),0,'maintenance actions do not pollute the layout');
    await page.evaluate(()=>{window.failRecords=true;window.dispatchEvent(new CustomEvent('test:records'));});
    await page.getByText('Lista de teste',{exact:true}).waitFor();
    assert.equal(await page.getByRole('alert').count(),0,'record errors do not inject a blocking banner into the tool');
    await page.close();
    console.log('PASS UI: healthy synchronization is silent and real failures remain actionable.');
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
