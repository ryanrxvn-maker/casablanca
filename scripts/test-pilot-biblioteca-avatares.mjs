/**
 * BIBLIOTECA DE AVATARES DO PILOT — a listagem tem que trazer TODOS os
 * avatares da conta logada, e quando não conseguir, DIZER.
 *
 * Nasceu do caso 17.09.2026: conta com vários avatares mostrando 1 no picker,
 * sem erro na tela. Causas que este teste prende:
 *   - listagem sem o workspace ativo (x-space-id) → lista do workspace errado
 *   - campo da resposta com outro nome (avatar_group_list) → lista zerada
 *   - looks travados no teto de 50 sem paginação
 *   - lista mais curta que o total informado pelo HeyGen → passava calada
 *
 * Roda com: node scripts/test-pilot-biblioteca-avatares.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const file = 'extension/heygen-content.js';
const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const names = [
  'heygenCookieValue', 'heygenStoredValue', 'heygenWorkspaceHeaders', 'getInternalAuthHeaders',
  'fetchHeyGenWithSession', 'fetchWithTimeout', 'fetchListaHeyGen', 'listMyAvatars',
  'detectAvatarVersion', 'findIdField', 'findNameField', 'findThumbField',
];
// Ajudantes que o caminho autenticado usa em ALGUMAS versões do content script
// (recuperação pela sessão da aba). Entram quando existem, sem exigir.
const opcionais = ['heygenAuthRefused', 'fetchHeyGenPageSession', 'base64ToBytes'];
const declarations = [];
const encontradas = new Set();
function visit(n) {
  const nome = ts.isFunctionDeclaration(n) ? n.name?.text : null;
  if (nome && (names.includes(nome) || opcionais.includes(nome))) {
    declarations.push(n.getText(ast));
    encontradas.add(nome);
  }
  ts.forEachChild(n, visit);
}
visit(ast);
assert.deepEqual(
  names.filter((n) => !encontradas.has(n)),
  [],
  'todas as funções de produção da listagem devem ser executadas pelo teste',
);

/** Contexto com fetch falso; `document.cookie` define o workspace ativo. */
function harness(fetcher) {
  const requests = [];
  const ctx = vm.createContext({
    URL, Response, DOMException, AbortController, atob, btoa, setTimeout, clearTimeout,
    performance, JSON, Array, Set, Number, String, Promise, Math, Date, Object,
    DARKO_EXT_VERSION: 'test-version',
    document: { cookie: '' },
    // Sem id de extensão o caminho de recuperação pela sessão da aba fica
    // fora: aqui o que está sob teste é a listagem, não o transporte.
    chrome: { runtime: { id: null } },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return fetcher(String(url), options);
    },
  });
  vm.runInContext(declarations.join('\n'), ctx);
  return { ctx, requests };
}

// ids no formato do HeyGen (longos): findIdField descarta id com 5 caracteres
// ou menos, então id curto de teste mentiria sobre o comportamento real.
const grupo = (n) => ({ id: `grupo_00000${n}`, name: `avatar ${n}`, preview_image: `http://img/${n}.png` });
const look = (n, i) => ({ id: `look_00000${n}_${i}`, name: `look ${i}`, image_url: `http://img/${n}-${i}.png` });

/** Servidor falso do HeyGen. `campo` troca o nome do campo dos grupos;
 *  `soComWorkspace` recusa quem não mandar o x-space-id. */
function servidor({ grupos, looksPorGrupo = 1, campo = 'avatar_groups', total = null, soComWorkspace = false }) {
  return async (url, options) => {
    if (soComWorkspace && options?.headers?.['x-space-id'] !== 'empresa') {
      return Response.json({ code: 400112, message: 'Unauthorized' }, { status: 401 });
    }
    if (url.includes('avatar_group.private.list')) {
      const page = Number(new URL(url).searchParams.get('page') || 1);
      const lista = page === 1 ? grupos.map(grupo) : [];
      return Response.json({ code: 100, data: { [campo]: lista, total: total ?? grupos.length } });
    }
    if (url.includes('avatar_look.private.list')) {
      const u = new URL(url);
      const page = Number(u.searchParams.get('page') || 1);
      const limit = Number(u.searchParams.get('limit') || 100);
      const n = u.searchParams.get('group_id').replace(/^grupo_0*/, '');
      const inicio = (page - 1) * limit;
      const fatia = [];
      for (let i = inicio; i < Math.min(inicio + limit, looksPorGrupo); i++) fatia.push(look(n, i));
      return Response.json({ code: 100, data: { avatar_looks: fatia } });
    }
    return Response.json({ code: 100, data: {} }, { status: 404 });
  };
}

test('listagem manda o workspace ATIVO: membro convidado vê a biblioteca da empresa, não 1 avatar', async () => {
  // Cookie sozinho (sem header) é recusado — era exatamente o que acontecia
  // com quem recebeu acesso ao workspace de outra empresa.
  const h = harness(servidor({ grupos: [1, 2, 3], soComWorkspace: true }));
  h.ctx.document.cookie = 'heygen_space=empresa';
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.ok, true);
  assert.equal(r.groups.length, 3, 'os três avatares da conta têm que aparecer');
  assert.ok(
    h.requests.every((q) => !q.url.includes('avatar_group.private.list') || q.options.headers['x-space-id'] === 'empresa'),
    'toda listagem viaja com o workspace ativo',
  );
  assert.equal(r.error, null, 'lista completa não carrega ressalva');
});

test('campo com outro nome (avatar_group_list) não zera a biblioteca', async () => {
  const h = harness(servidor({ grupos: [1, 2], campo: 'avatar_group_list' }));
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.ok, true);
  assert.equal(r.groups.length, 2);
});

test('looks passam do teto de 50: paginação traz todos', async () => {
  const h = harness(servidor({ grupos: [1], looksPorGrupo: 130 }));
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].looksCount, 130, 'os 130 looks do avatar têm que vir');
  assert.equal(r.avatars.length, 130);
});

test('lista mais curta que o total informado pelo HeyGen é DITA, não engolida', async () => {
  // O HeyGen diz 14; a resposta entrega 1. Era o sintoma do cliente, e a tela
  // não tinha como saber.
  const h = harness(servidor({ grupos: [1], total: 14 }));
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.ok, true);
  assert.equal(r.groups.length, 1);
  assert.match(r.error ?? '', /\[LISTA_PARCIAL\]/);
  assert.match(r.error ?? '', /informou 14 avatares/);
  assert.match(r.error ?? '', /ler 1/);
});

test('avatar cujos looks falham entra na lista e a falha é declarada', async () => {
  const base = servidor({ grupos: [1, 2] });
  const h = harness(async (url, options) =>
    url.includes('avatar_look.private.list') && url.includes('group_id=grupo_000002')
      ? Response.json({ code: 400, message: 'boom' }, { status: 500 })
      : base(url, options),
  );
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.groups.length, 2, 'nenhum avatar desaparece por causa dos looks');
  assert.match(r.error ?? '', /\[LISTA_PARCIAL\]/);
  assert.match(r.error ?? '', /1 avatar\(es\) não puderam ser lidos/);
});

test('biblioteca realmente vazia continua dizendo que está vazia', async () => {
  const h = harness(servidor({ grupos: [] }));
  const r = await h.ctx.listMyAvatars();
  assert.equal(r.ok, false);
  assert.match(r.error, /vazia/i);
});
