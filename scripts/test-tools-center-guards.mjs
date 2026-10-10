// Guardas do painel "Ferramentas" do /admin (10.10). A regra em si está em
// lib/maintenance.test.ts; aqui ficam as ligações que nenhum teste de função
// pega: todo portão do servidor lendo o estado do painel, ferramenta nova
// entrando no catálogo, cliente sem nome de ferramenta interna.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (f) => readFileSync(f, 'utf8');

test('toda ferramenta de app/tools está no catálogo do painel (ou é página da conta)', () => {
  const cat = ler('lib/tool-catalog.ts');
  const paths = new Set([...cat.matchAll(/path: '(\/tools\/[a-z0-9-]+)'/g)].map((m) => m[1]));
  const conta = new Set([...cat.slice(cat.indexOf('ACCOUNT_PAGES')).matchAll(/'(\/tools\/[a-z0-9-]+)'/g)].map((m) => m[1]));
  const rotas = readdirSync('app/tools', { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join('app/tools', d.name, 'page.tsx')))
    .map((d) => `/tools/${d.name}`);
  const fora = rotas.filter((r) => !paths.has(r) && !conta.has(r));
  assert.deepEqual(fora, [], `ferramenta fora do painel "Ferramentas": ${fora.join(', ')} (lib/tool-catalog.ts)`);
});

test('os 3 portões do servidor leem o estado do painel (não a lista fixa)', () => {
  const mw = ler('lib/supabase/middleware.ts');
  assert.match(mw, /async function maintenanceBlocks\([\s\S]*?loadToolsConfig\(\)[\s\S]*?isToolInMaintenance\(pathname, cfg\)[\s\S]*?canBypassMaintenance\(email, cfg\)/);
  assert.match(mw, /if \(!isAdmin && pathname\.startsWith\('\/tools\/'\) && \(await maintenanceBlocks\(pathname, user\.email\)\)\)/, 'admin nunca consulta nem é barrado');
  const rt = ler('lib/require-tier.ts');
  assert.match(rt, /if \(gate\.isAdmin\) return gate;[\s\S]*?loadToolsConfig\(\)[\s\S]*?maintenanceOf\(toolPath, cfg\)[\s\S]*?canBypassMaintenance\(gate\.email, cfg\)/);
  assert.doesNotMatch(rt + mw, /isToolInMaintenance\((pathname|toolPath)\)\s*[&|)]/, 'chamada sem o estado do painel = lista fixa de volta');
});

test('estado no Storage: edge-safe, sem cache de CDN, falha nunca derruba', () => {
  const st = ler('lib/maintenance-store.ts');
  assert.doesNotMatch(st, /from '@supabase\/supabase-js'|from 'node:/, 'o middleware (edge) importa este módulo: só fetch');
  assert.match(st, /\?v=\$\{Date\.now\(\)\}/, 'leitura fura cache de CDN');
  assert.match(st, /cache: 'no-store'/);
  assert.match(st, /source: 'stale'/, 'falha de rede = último estado bom');
  assert.match(st, /public: false/, 'bucket privado');
});

test('painel: admin em todo método, versão contra atropelo, não grava às cegas', () => {
  const r = ler('app/api/admin/tools-status/route.ts');
  for (const m of ['GET', 'POST']) {
    const body = r.split(`export async function ${m}(`)[1]?.split('export async function')[0] ?? '';
    assert.match(body, /requireAdmin\(\)/, `${m} sem requireAdmin`);
  }
  assert.match(r, /status: 409/, 'conflito de versão');
  assert.match(r, /loaded\.source !== 'storage' && loaded\.source !== 'default'/, 'sem ler o estado atual, não grava');
});

test('cliente nunca recebe nome de ferramenta interna', () => {
  const s = ler('app/api/tools/status/route.ts');
  assert.match(s, /if \(!isAdmin && internal && !pathUnlockedByList/);
  const f = ler('components/MaintenanceFlash.tsx');
  assert.match(f, /tool && tool\.plan !== 'admin' \? tool\.label : 'Esta ferramenta'/);
});

test('hub e menu lateral usam o estado vivo; barrado vê o aviso', () => {
  const hub = ler('components/ToolsHub.tsx');
  assert.match(hub, /isToolInMaintenance\(href, maintSnap\)/);
  assert.match(hub, /<MaintenanceFlash from=\{lockedFrom\} \/>/);
  assert.match(ler('components/SubSidebar.tsx'), /isToolInMaintenance\(it\.href, maintSnap\)/);
});

test('painel: 2 etapas pra derrubar ferramenta e janela fora do <main>', () => {
  const c = ler('app/admin/_ui/ToolsCenter.tsx');
  assert.match(c, /'Colocar em manutenção'/, 'Manutenção abre o painel da linha; só grava no botão');
  assert.match(c, /return createPortal\(/);
  assert.match(c, /BulkConfirm/, 'lote com confirmação');
  assert.match(ler('app/admin/page.tsx'), /<ToolsCenter users=\{users\}/);
});
