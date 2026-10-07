// Guardas do painel admin (07.10). A lista de clientes já mentiu UMA vez:
// uma coluna ausente em produção (`whatsapp`) derrubou o select completo, a
// cascata caiu pro legado sem plano/assinatura e os 457 clientes apareceram
// como Free, com Pagantes 0 e Liberados 0, sem nenhum erro na tela.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const route = readFileSync('app/api/admin/list-users/route.ts', 'utf8');
const page = readFileSync('app/admin/page.tsx', 'utf8');

function selectBody(name) {
  const m = new RegExp(`const ${name} =\\s*'([^']+)'`).exec(route);
  assert.ok(m, `${name} não encontrado`);
  return m[1].split(',').map((c) => c.trim());
}

test('select principal da lista só tem colunas que existem em produção', () => {
  // Coluna opcional vai em consulta À PARTE; nunca no select da cascata.
  for (const sel of ['FULL_SELECT', 'MID_SELECT', 'BASIC_SELECT']) {
    assert.ok(!selectBody(sel).includes('whatsapp'), `${sel} não pode ter whatsapp (não existe em produção)`);
  }
  const full = selectBody('FULL_SELECT');
  for (const col of ['tier', 'subscription_status', 'current_period_end', 'tool_unlocks']) {
    assert.ok(full.includes(col), `FULL_SELECT precisa de ${col} pra classificar pago/liberado`);
  }
});

test('lista devolve o nível da consulta e o painel avisa quando falta dado', () => {
  assert.match(route, /NextResponse\.json\(\{ users: enriched, schema \}\)/);
  assert.match(route, /console\.error\(`\[admin list-users\] select/);
  assert.match(page, /schema !== 'full'/, 'painel precisa do aviso de dado incompleto');
  assert.match(page, /schema !== 'basic' \? stats\.paid/, 'sem plano carregado, Pagantes não pode mostrar 0 falso');
});
