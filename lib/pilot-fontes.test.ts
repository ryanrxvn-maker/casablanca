/**
 * GARANTIA — as tasks que nascem fora do ClickUp (DOCS / CREATOR) cumprem o
 * contrato que o resto do Pilot lê, e um doc real com vários ADs vira o mesmo
 * conjunto de tasks que o ClickUp listaria.
 */
import * as fs from 'fs';
import {
  enumerarTasksDoDoc,
  idTaskDoDoc,
  idTaskCreator,
  isTaskLocal,
  modoDaTaskLocal,
  taskSintetica,
  tasksDoDoc,
  proximoNomeCreator,
  docDaCopyColada,
  baseAdIdDoNome,
  docDeTexto,
  textoDeDocumentXml,
  decodificarXml,
  hashCurto,
  lerTasksLocais,
  salvarTasksLocais,
  lerDocsLocais,
  salvarDocLocal,
  type DocLocal,
  type TaskLocal,
} from './pilot-fontes';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log('  ok  ', msg);
  } else {
    failed++;
    console.error('  FAIL', msg);
  }
}
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (veio ${JSON.stringify(a)})`}`);

console.log('GARANTIA — fontes de task do Pilot (DOCS / CREATOR):');

/* ── (1) doc com heading de GRUPO (dialeto 1) ── */
{
  const DOC = [
    'AD01GL - VRPB09',
    'Doutor: @medico.mp4',
    'AD01G1GL - VRPB09',
    'Gancho do primeiro',
    'Body',
    'Corpo do primeiro',
    '',
    'AD02GL - VRPB09',
    'Mulher: @mulher.mp4',
    'AD02G1GL - VRPB09',
    'Gancho do segundo',
    'AD02G2GL - VRPB09',
    'Segundo gancho do segundo',
    'Body',
    'Corpo do segundo',
  ].join('\n');
  const ts = enumerarTasksDoDoc(DOC);
  eq(ts.map((t) => t.baseAdId), ['AD01GL', 'AD02GL'], 'dialeto 1: um AD por grupo, G1/G2 colapsam');
  eq(ts.map((t) => t.nome), ['AD01GL - VRPB09', 'AD02GL - VRPB09'], 'nome no padrão do ClickUp (base + sufixo)');
}

/* ── (2) doc SEM heading de grupo (dialeto 2: só os hooks) ── */
{
  const DOC = [
    'AD12G1VN - VRWA06',
    'Meta: @a.mp4',
    'GANCHO',
    'oi',
    'BODY',
    'corpo',
    'AD12G2VN - VRWA06',
    'GANCHO',
    'outro oi',
    'AD13G1VN - VRWA06',
    'GANCHO',
    'terceiro',
    'BODY',
    'corpo 13',
  ].join('\n');
  const ts = enumerarTasksDoDoc(DOC);
  eq(ts.map((t) => t.nome), ['AD12VN - VRWA06', 'AD13VN - VRWA06'], 'dialeto 2: o G<n> sai do nome, igual à task do ClickUp');
}

/* ── (3) marcador entre colchetes e traço sem espaço ── */
{
  const ts = enumerarTasksDoDoc('AD17G1VN[T]-RIPTVWA\nGANCHO\nx\nBODY\ny');
  eq(ts.map((t) => t.nome), ['AD17VN - RIPTVWA'], 'heading "AD17G1VN[T]-RIPTVWA" vira "AD17VN - RIPTVWA"');
}

/* ── (4) docs REAIS de B2C (quando estão nesta máquina) ── */
{
  const reais: Array<[string, number]> = [
    ['D:/B2C/BRIEFINGS/VF-RIPTINPB/doc.txt', 10],
    ['D:/B2C/BRIEFINGS/RIPTVWA/doc.txt', 51],
    ['D:/B2C/BRIEFINGS/VRWA06/doc.txt', 10],
  ];
  for (const [caminho, esperado] of reais) {
    if (!fs.existsSync(caminho)) {
      console.log(`  skip  ${caminho} não está nesta máquina`);
      continue;
    }
    const txt = fs.readFileSync(caminho, 'utf8');
    const ts = enumerarTasksDoDoc(txt);
    ok(ts.length === esperado, `${caminho.split('/').slice(-2)[0]}: ${ts.length} tasks (o parser de produção acha ${esperado})`);
    ok(ts.every((t) => /^AD\d+[A-Z]*( - [A-Z0-9]+)?$/.test(t.nome)), 'todo nome no padrão AD<n><suf> - SUFIXO');
    ok(new Set(ts.map((t) => t.nome)).size === ts.length, 'nenhum nome repetido');
    ok(ts.every((t) => !/G\d+/.test(t.baseAdId)), 'nenhum baseAdId carrega infixo G<n>');
  }
}

/* ── (5) ids: nada que o resto do Pilot interprete ── */
{
  const docKey = 'link_' + hashCurto('qualquer texto');
  const id = idTaskDoDoc(docKey, 'AD12VN');
  ok(isTaskLocal(id) && modoDaTaskLocal(id) === 'docs', `id do DOCS é local e do modo docs (${id})`);
  ok(!/[:]/.test(id), 'id sem ":" (prefixo pilot:<id>: do IndexedDB)');
  ok(!/-(?:yt|v\d{1,2})$/.test(id), 'id não termina como sufixo de versão (-yt / -v3)');
  ok(!id.startsWith('heygenauto'), 'id não começa com heygenauto (o Pilot ignora esse prefixo)');
  ok(/^[A-Za-z0-9_]+$/.test(id), 'id só com [A-Za-z0-9_]');
  ok(idTaskDoDoc(docKey, 'AD12VN') === id, 'id é ESTÁVEL (mesmo doc + mesmo AD = mesmo id) — a fila e o RETOMAR dependem disso');
  ok(idTaskDoDoc('outro_doc', 'AD12VN') !== id, 'mesmo AD em outro doc = outro id (não colide cache)');
  const c = idTaskCreator(1_700_000_000_000, 0.123456789);
  ok(isTaskLocal(c) && modoDaTaskLocal(c) === 'creator', `id do CREATOR é local e do modo creator (${c})`);
  ok(/^[A-Za-z0-9_]+$/.test(c) && !/-(?:yt|v\d{1,2})$/.test(c), 'id do CREATOR também seguro');
  ok(!isTaskLocal('86c1abc') && !isTaskLocal('') && modoDaTaskLocal('86c1abc') === null, 'id do ClickUp não é local');
}

/* ── (6) a task sintética cumpre o que o card/análise leem ── */
{
  const doc = docDeTexto('AD05GL - VRPB09\nx', 'link', { docUrl: 'https://docs.google.com/document/d/abc/edit' });
  const [local] = tasksDoDoc(doc, 'team1', 123);
  const t = taskSintetica(local, doc);
  ok(t.id === local.id && t.name === 'AD05GL - VRPB09', 'id e name da task vêm da local');
  ok(!!t.status && typeof t.status.color === 'string' && typeof t.status.status === 'string', 'status é objeto completo (o card lê status.color)');
  ok(Array.isArray(t.assignees) && t.assignees.length === 0, 'assignees: []');
  ok(t.priority === null && t.due_date === undefined, 'sem prioridade nem data (fica no fim da ordenação)');
  ok(t.team_id === 'team1', 'team_id carimbado (a fila filtra por empresa)');
  ok(!!t.custom_fields?.find((f) => /DOC DA COPY/i.test(f.name) && f.value === doc.docUrl), 'doc por link vira custom field "DOC DA COPY"');
  const semLink = taskSintetica(local, { ...doc, docUrl: undefined });
  ok((semLink.custom_fields || []).length === 0, 'doc por arquivo/colado: sem custom field (o texto vem do DocLocal)');
  ok(/\bAD\d+/.test(t.name), 'nome tem AD<n> (a análise exige)');
}

/* ── (7) CREATOR: nome padrão e copy colada ── */
{
  eq(proximoNomeCreator([]), 'AD01 - CREATOR', 'primeira task do CREATOR é AD01');
  eq(proximoNomeCreator([{ nome: 'AD01 - CREATOR' }, { nome: 'AD03GL - X' }]), 'AD02 - CREATOR', 'pula os números já usados');
  const d = docDaCopyColada('AD01 - CREATOR', 'Doutor: @doutor.mp4\r\nHOOK\r\nOi\r\nBODY\r\nCorpo', 7);
  ok(d.text.startsWith('AD01 - CREATOR\n'), 'copy colada ganha o heading da nomenclatura (o parser acha a seção)');
  ok(!d.text.includes('\r'), 'CRLF normalizado');
  ok(d.origem === 'colado' && d.key.startsWith('colado_'), 'origem e chave do colado');
  const d2 = docDaCopyColada('AD01 - CREATOR', 'AD01 - CREATOR\nHOOK\nOi', 7);
  ok(!d2.text.startsWith('AD01 - CREATOR\nAD01 - CREATOR'), 'se o editor já colou com heading, não duplica');
  eq(baseAdIdDoNome('AD01 - CREATOR'), 'AD01', 'baseAdId do CREATOR é AD01 (como a análise extrai do nome)');
  eq(baseAdIdDoNome('AD12VN - VRWA06'), 'AD12VN', 'baseAdId de nomenclatura B2C mantém o sufixo colado');
  eq(baseAdIdDoNome('sem ad nenhum'), null, 'nome sem AD<n> devolve null (a análise exige)');
}

/* ── (8) .docx: parágrafos, tabs, quebras e entidades ── */
{
  const xml =
    '<w:document><w:body>' +
    '<w:p><w:r><w:t>AD01GL - VRPB09</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Doutor:</w:t></w:r><w:tab/><w:r><w:t>@doutor.mp4</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>&#8220;Oi&#8221; &amp; tchau</w:t></w:r><w:br/><w:r><w:t>segunda linha</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const txt = textoDeDocumentXml(xml);
  const linhas = txt.split('\n');
  eq(linhas[0], 'AD01GL - VRPB09', 'parágrafo 1 vira linha 1');
  eq(linhas[1], 'Doutor:\t@doutor.mp4', '<w:tab/> vira tab');
  eq(linhas[2], '“Oi” & tchau', 'entidades numéricas e &amp; decodificadas (aspas curvas do Docs)');
  eq(linhas[3], 'segunda linha', '<w:br/> vira quebra dentro do parágrafo');
  eq(decodificarXml('&lt;a&gt; &quot;b&quot; &apos;c&apos; &amp;lt;'), '<a> "b" \'c\' &lt;', '&amp; decodificado por ÚLTIMO (não re-decodifica)');
}

/* ── (9) persistência: poda guarda os docs em uso ── */
{
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  eq(lerTasksLocais(store), [], 'sem nada gravado → lista vazia');
  const docs: DocLocal[] = [];
  const tasks: TaskLocal[] = [];
  for (let i = 0; i < 9; i++) {
    const d = docDeTexto(`AD0${i + 1}GL - X\ncopy ${i}`, 'arquivo', {}, 1000 + i);
    docs.push(d);
    if (i === 0) tasks.push(...tasksDoDoc(d, null, 1000)); // só o MAIS VELHO tem task
    salvarDocLocal(d, tasks, store);
  }
  const guardados = lerDocsLocais(store);
  ok(guardados[docs[0].key] !== undefined, 'doc mais velho SOBREVIVE à poda porque uma task usa ele');
  ok(Object.keys(guardados).length <= 7, `poda mantém no máximo 6 recentes + os em uso (${Object.keys(guardados).length})`);
  ok(guardados[docs[8].key] !== undefined, 'o mais recente está guardado');
  salvarTasksLocais(tasks, store);
  eq(lerTasksLocais(store).map((t) => t.id), tasks.map((t) => t.id), 'tasks locais voltam do storage');
  mem.set('darkolab:clickup-pilot:tasks-locais', '[{"id":"86c1abc","modo":"docs"},{"lixo":1}]');
  eq(lerTasksLocais(store), [], 'entrada com id do ClickUp ou lixo é descartada na leitura');
  mem.set('darkolab:clickup-pilot:tasks-locais', 'nao é json');
  eq(lerTasksLocais(store), [], 'JSON quebrado → lista vazia, sem lançar');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-fontes: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
