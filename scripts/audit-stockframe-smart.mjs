#!/usr/bin/env node
// Runner da auditoria offline do Smart Stocks (scripts/stockframe-smart-audit.ts).
// Empacota o TS com esbuild e executa repassando os argumentos.
//   node scripts/audit-stockframe-smart.mjs scripts/fixtures/smart-stocks/prostata-quiabo.json 60 adaptive
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { buildSync } = createRequire(import.meta.url)('esbuild');
const out = '.test-tmp/stockframe-smart-audit.mjs';
buildSync({ entryPoints: ['scripts/stockframe-smart-audit.ts'], outfile: out, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node20', logLevel: 'error' });
const result = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
