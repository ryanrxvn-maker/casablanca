/**
 * Trava as invariantes do HISTÓRICO POR FERRAMENTA (botão em cada ferramenta).
 *
 * O que isto blinda:
 *  - toda rota de ferramenta acha a ferramenta dela (senão o botão some ou,
 *    pior, mostra o histórico de outra);
 *  - ferramenta nova em /app/tools entra no registro — o teste varre o disco e
 *    reprova quem esquecer de registrar;
 *  - apelidos (caixinha→fakepass, lipsync-history→lipsync e o legado
 *    'Famous Hey') dobram no mesmo histórico;
 *  - o botão Baixar diz a verdade: local × resgate remoto × expirado.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  HISTORY_TOOLS,
  buildChains,
  canonicalTool,
  chainState,
  countByTool,
  filterHistory,
  historyToolForPath,
  historyToolLabel,
  type FileRef,
  type HistoryEvent,
} from './history-tools';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

console.log('\nGARANTIA — histórico por ferramenta:');

// (A) rota → ferramenta
{
  ok(historyToolForPath('/tools/decupagem') === 'decupagem', 'rota simples acha a ferramenta');
  ok(historyToolForPath('/tools/clickup-pilot') === 'clickup-pilot', 'Pilot tem histórico');
  ok(historyToolForPath('/tools/fakepass/qualquer') === 'fakepass', 'sub-rota continua na ferramenta');
  ok(historyToolForPath('/tools/decupagem/') === 'decupagem', 'barra no fim não atrapalha');
  ok(historyToolForPath('/tools') === null, 'a vitrine de ferramentas não tem botão');
  ok(historyToolForPath('/dashboard') === null, 'fora de /tools não tem botão');
  ok(historyToolForPath(null) === null, 'pathname nulo não explode');
  ok(historyToolForPath('/tools/rota-que-nao-existe') === null, 'rota desconhecida não inventa histórico');
}

// (B) rotas que NÃO são ferramenta de produzir arquivo
{
  for (const rota of ['historico', 'background', 'points', 'calculadora']) {
    ok(historyToolForPath(`/tools/${rota}`) === null, `/tools/${rota} não ganha botão próprio`);
  }
}

// (C) apelidos dobram no mesmo histórico
{
  ok(historyToolForPath('/tools/caixinha-pergunta') === 'fakepass', 'caixinha cai no FakePrint');
  ok(historyToolForPath('/tools/lipsync-history') === 'lipsync', 'histórico de avatares cai no Lipsync');
  ok(canonicalTool('Famous Hey') === 'famous-hey', 'registro legado com o NOME casa com a rota');
  ok(historyToolLabel('caixinha-pergunta') === 'FakePrint', 'rótulo do apelido é o da dona');
  ok(historyToolLabel('famous-hey') === 'Famous Hey', 'rótulo da Famous Hey');
}

// (D) TODA ferramenta em app/tools está registrada (varre o disco de verdade)
{
  const dir = path.join(__dirname, '..', 'app', 'tools');
  const semHistorico = new Set(['historico', 'background', 'points', 'calculadora']);
  const rotas = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(dir, n, 'page.tsx')));
  ok(rotas.length > 15, `varreu as rotas de ferramenta (${rotas.length})`);
  const orfas = rotas.filter((n) => !semHistorico.has(n) && historyToolForPath(`/tools/${n}`) === null);
  ok(orfas.length === 0, `nenhuma ferramenta sem histórico (órfãs: ${orfas.join(', ') || 'nenhuma'})`);
}

// (E) todo id registrado tem rótulo próprio (nunca cai no slug cru)
{
  const semRotulo = HISTORY_TOOLS.filter((t) => historyToolLabel(t.id) === t.id && !/ /.test(t.label));
  ok(
    HISTORY_TOOLS.every((t) => historyToolLabel(t.id) === t.label),
    `rótulo de todas as ${HISTORY_TOOLS.length} ferramentas (${semRotulo.length} suspeitas)`,
  );
  ok(new Set(HISTORY_TOOLS.map((t) => t.id)).size === HISTORY_TOOLS.length, 'sem id repetido no registro');
}

// (F) cadeia de download: mesmo NOME = um botão só, com fallback em ordem
{
  const refs: FileRef[] = [
    { via: 'vault', key: 'hv:1', name: 'montado.mp4' },
    { via: 'zip', key: 'batch:x:montado', name: 'montado.mp4' },
    { via: 'heygen', parts: [{ label: 'take 1', videoId: 'v1' }], name: 'takes.zip' },
  ];
  const chains = buildChains(refs);
  ok(chains.length === 2, 'dois arquivos = dois botões');
  ok(chains[0].refs.length === 2, 'o mesmo arquivo vira cadeia de fallback');
  ok(buildChains(undefined).length === 0, 'evento sem ref não gera botão');
}

// (G) estado honesto do botão
{
  const vault: FileRef = { via: 'vault', key: 'hv:1', name: 'a.mp4' };
  const zip: FileRef = { via: 'zip', key: 'batch:x:montado', name: 'b.zip' };
  const hg: FileRef = { via: 'heygen', parts: [{ label: 't', videoId: 'v' }], name: 'c.zip' };
  const vazio = { vaultKeys: new Set<string>(), zipKeys: new Set<string>() };
  ok(
    chainState(buildChains([vault])[0], { vaultKeys: new Set(['hv:1']), zipKeys: new Set() }) === 'local',
    'bytes no cofre = baixa na hora',
  );
  ok(
    chainState(buildChains([zip])[0], { vaultKeys: new Set(), zipKeys: new Set(['batch:x:montado']) }) === 'local',
    'pacote no zip-store = baixa na hora',
  );
  ok(chainState(buildChains([hg])[0], vazio) === 'remote', 'sem bytes mas com receita = resgate remoto');
  ok(chainState(buildChains([vault])[0], vazio) === 'gone', 'chave que saiu do cofre = expirou');
  ok(
    chainState(buildChains([vault, hg].map((r, i) => ({ ...r, name: 'x.zip' } as FileRef)))[0], vazio) === 'remote',
    'cadeia sem bytes cai no resgate em vez de mentir "expirou"',
  );
}

// (H) filtro é o MESMO da página geral e do painel da ferramenta
{
  const ev = (id: string, tool: string, title: string, ref?: FileRef[]): HistoryEvent => ({
    id, t: 1_700_000_000_000, tool, title, kind: 'done', ref,
  });
  const events = [
    ev('1', 'decupagem', 'ad-hook.mp4 decupado', [{ via: 'vault', key: 'k1', name: 'ad-hook.mp4' }]),
    ev('2', 'caixinha-pergunta', 'Caixinha exportada'),
    ev('3', 'fakepass', 'Print instagram exportado'),
    ev('4', 'Famous Hey', 'Vídeo pronto'),
  ];
  ok(filterHistory(events, { tool: 'decupagem' }).length === 1, 'filtra pela ferramenta');
  ok(filterHistory(events, { tool: 'fakepass' }).length === 2, 'apelido entra no histórico da dona');
  ok(filterHistory(events, { tool: 'famous-hey' }).length === 1, 'registro legado aparece na ferramenta certa');
  ok(filterHistory(events, { tool: 'all' }).length === 4, '"all" não filtra');
  ok(filterHistory(events, {}).length === 4, 'sem filtro devolve tudo');
  ok(filterHistory(events, { query: 'ad-hook' }).length === 1, 'busca pelo nome do arquivo');
  ok(filterHistory(events, { query: 'FAKEPRINT' }).length === 2, 'busca pelo rótulo da ferramenta, sem caixa');
  ok(filterHistory(events, { soRecuperaveis: true }).length === 1, 'só o que ainda dá pra baixar');
  ok(
    filterHistory(events, { tool: 'fakepass', query: 'caixinha' }).length === 1,
    'ferramenta + busca juntas',
  );
  const c = countByTool(events);
  ok(c.get('fakepass') === 2 && c.get('famous-hey') === 1, 'contagem do selo dobra os apelidos');
}

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed > 0) process.exit(1);
