// Guardas dos AVISOS (09.10): o que não pode voltar calado.
// A regra em si (audiência, janela por login, links) é testada em
// lib/announcements.test.ts; aqui ficam as ligações que nenhum teste de
// função pega: sino em toda conta, janela em todo layout logado, rota que
// só mexe na caixa da própria conta, nada animando em loop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(f, 'utf8');

test('toda conta tem o sino ao lado da calculadora e a página abre pra qualquer plano', () => {
  const top = ler('components/TopBar.tsx');
  assert.match(top, /<NotificationsButton \/>[\s\S]{0,120}<CalculadoraButton \/>/, 'sino logo antes da calculadora no topo');
  // O middleware é quem libera (TIER_PATHS é só a lista de FERRAMENTAS do hub).
  const mw = ler('lib/supabase/middleware.ts');
  const free = mw.slice(mw.indexOf('const FREE_ALLOWED_TOOLS'), mw.indexOf('];', mw.indexOf('const FREE_ALLOWED_TOOLS')));
  assert.match(free, /'\/tools\/notificacoes'/, 'Free precisa abrir /tools/notificacoes (FREE_ALLOWED_TOOLS)');
});

test('janela de aviso montada em TODO layout logado (ferramentas, configurações, admin)', () => {
  for (const f of ['app/tools/layout.tsx', 'app/configuracoes/layout.tsx', 'app/admin/layout.tsx']) {
    assert.match(ler(f), /<AnnouncementHost \/>/, `${f} sem <AnnouncementHost />`);
  }
});

test('rota do sino: só a conta da sessão, nunca a caixa de outra pessoa', () => {
  const r = ler('app/api/user/notifications/route.ts');
  assert.match(r, /auth\.getUser\(\)/, 'identifica o usuário pelo token validado');
  const updates = r.match(/inbox\(\)\.(update|select)\([^)]*\)[^;]*/g) ?? [];
  assert.ok(updates.length >= 8, `achou ${updates.length} escritas/leituras na caixa`);
  for (const u of updates) assert.match(u, /\.eq\('user_id', uid\)/, `sem filtro da conta: ${u.slice(0, 90)}`);
  assert.match(r, /\.eq\('user_id', who\.userId\)/, 'histórico lido só da conta');
  assert.doesNotMatch(r, /upsert\([^)]*dismiss/, 'fechar janela só mexe em linha que já existe (sem criar caixa de aviso alheio)');
});

test('rotas do admin exigem admin em todo método', () => {
  const r = ler('app/api/admin/announcements/route.ts');
  for (const m of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const body = r.split(`export async function ${m}(`)[1]?.split('export async function')[0] ?? '';
    assert.match(body, /requireAdmin\(\)/, `${m} sem requireAdmin`);
  }
  assert.match(ler('app/api/admin/announcements/upload/route.ts'), /requireAdmin\(\)/);
  assert.match(r, /cleanContent\(kind, body\.content\)/, 'conteúdo passa pela mesma validação do painel');
});

test('sem a migration 038 o app não quebra: rotas respondem "desligado"', () => {
  assert.match(ler('app/api/user/notifications/route.ts'), /isMissingSchema\(liveRes\.error\)/);
  assert.match(ler('app/api/admin/announcements/route.ts'), /enabled: false/);
});

test('nada anima em loop e as janelas saem do <main> (filter no tema escuro prende fixed)', () => {
  const css = ler('components/notifications/notifications.css');
  assert.doesNotMatch(css, /infinite/, 'animação infinita = janela redesenhando sem parar');
  for (const m of css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)) {
    assert.doesNotMatch(m[2], /\b(left|top|width|height|box-shadow|filter)\s*:/, `@keyframes ${m[1]} anima propriedade de repintura`);
  }
  assert.match(ler('components/notifications/AnnouncementHost.tsx'), /createPortal\([\s\S]*?document\.body/);
  assert.match(ler('app/admin/_ui/AnnouncementsStudio.tsx'), /createPortal\(/);
});

test('janela de aviso não sai da sessão por sessionStorage/localStorage (regra é do servidor)', () => {
  const store = ler('lib/notifications-client.ts');
  assert.doesNotMatch(store, /localStorage|sessionStorage/, 'janela por login é decidida no servidor (sessão do Supabase)');
});

test('"Quem viu": fechar grava a hora e o painel lê pela mesma regra, só do aviso pedido', () => {
  assert.match(ler('app/api/user/notifications/route.ts'), /addDismissedKey\([^;]*Date\.parse\(stamp\)\)/, 'fechar a janela grava a hora (sem ela o "Quem viu" fica sem horário)');
  const r = ler('app/api/admin/announcements/route.ts');
  assert.match(r, /seenFromInbox\(/, '"Quem viu" usa a regra da lib (seenFromInbox)');
  assert.match(r, /\.eq\('announcement_id', id\)[\s\S]{0,120}\.range\(/, 'lê só o aviso pedido, paginado (sem o teto de 1000 linhas)');
  assert.match(r, /from\('profiles'\)\.select\('id, email, name, is_admin'\)/, 'nome de quem recebeu vem do banco (o list-users não traz admin, e o aviso pode ir pra admins)');
  assert.match(ler('app/admin/_ui/AnnouncementsStudio.tsx'), /\[data-ann-seen\]/, 'Esc no "Quem viu" volta pra lista em vez de fechar a Central');
});
