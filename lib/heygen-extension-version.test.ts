import assert from 'node:assert/strict';
import { ECONOMY_EXTENSION_VERSION, extensionVersionAtLeast } from './heygen-extension-bridge';

assert.equal(ECONOMY_EXTENSION_VERSION, '4.43.0');
assert(extensionVersionAtLeast('4.43.0'));
assert(!extensionVersionAtLeast('4.40.9'));
assert(!extensionVersionAtLeast('?'));
assert(!extensionVersionAtLeast(undefined));
console.log('PASS: economy dispatch accepts only the current extension protocol or newer.');

// O ZIP do botao "Baixar extensao" tem que levar TODO arquivo que o manifest
// referencia — senao o Chrome recusa carregar a extensao descompactada.
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const rota: string = fs.readFileSync('app/api/extension/download/route.ts', 'utf8');
  const bloco = (rota.match(/const FILES = \[([\s\S]*?)\];/) || [])[1] || '';
  const noZip = new Set(Array.from(bloco.matchAll(/'([^']+)'/g), (m) => m[1]));
  const refs = new Set<string>([
    manifest.background && manifest.background.service_worker,
    ...(manifest.content_scripts || []).flatMap((c: { js?: string[] }) => c.js || []),
    ...(manifest.web_accessible_resources || []).flatMap((w: { resources?: string[] }) => w.resources || []),
  ].filter(Boolean));
  for (const r of refs) assert(noZip.has(r), 'o zip da extensao leva ' + r);
  const bg: string = fs.readFileSync('extension/background.js', 'utf8');
  for (const m of Array.from(bg.matchAll(/importScripts\(([^)]*)\)/g))) {
    for (const nome of Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1])) assert(noZip.has(nome), 'o zip leva o importScripts ' + nome);
  }
  for (const nome of noZip) assert(fs.existsSync('extension/' + nome), 'arquivo do zip existe: ' + nome);
}
