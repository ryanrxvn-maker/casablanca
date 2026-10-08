import {
  arvoreDePastas, assuntoDoTake, nomeDoTake, normalizarTexto, PASTA, pastaEmDisco, pastaPadraoDoArquivo,
  TAKES_SEM_ASSUNTO, tituloParaArquivo, virtualStoreDoCapCut,
} from './pilot-projeto-pastas';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}

console.log('PASTAS DO PROJETO — assunto dos takes e painel de mídia organizado:');

ok(normalizarTexto('CÉREBRO_REAL-SAUDÁVEL(2).mp4') === 'cerebro real saudavel 2 mp 4', 'normaliza acento, separador e número grudado');
ok(normalizarTexto('ANIMAÇÃO 3D VARIZES') === 'animacao 3 d varizes', '"3D" vira "3 d" (a regra de anatomia casa)');

// títulos REAIS do catálogo StockFrame → assunto esperado
const casos: Array<[string, string]> = [
  ['CEREBRO REAL SAUDAVEL (2)', 'CÉREBRO E MEMÓRIA'],
  ['CEREBRO DEBILITADO X SAUDAVEL LABORATORIO (7)', 'CÉREBRO E MEMÓRIA'],
  ['VELHA SAUDAVEL', 'IDOSOS'],
  ['VELHA COM SAUDE', 'IDOSOS'],
  ['DUAS IDOSAS FELIZES', 'IDOSOS'],
  ['IDOSA COM DIARREIA', 'DOR E SINTOMAS'],
  ['IDOSA COM APARELHO E FISIOTERAPIA', 'IDOSOS'],
  ['UROLOGISTA EXPLICANDO SOBRE SISTEMA REPRODUTOR MAS', 'MÉDICOS E EXAMES'],
  ['SISTEMA REPRODUTOR MASCULINO 3D', 'CORPO E ANATOMIA'],
  ['ANIMAÇÃO 3D VARIZES', 'CORPO E ANATOMIA'],
  ['EXAME DE TOQUE(3)', 'MÉDICOS E EXAMES'],
  ['CIENTISTAS PREPARANDO MISTURA', 'MÉDICOS E EXAMES'],
  ['PINGANDO COLIRIO NO OLHO(2)', 'REMÉDIOS E SUPLEMENTOS'],
  ['APLICANDO CANETINHA', 'REMÉDIOS E SUPLEMENTOS'],
  ['MOSTRANDO LAXANTES FIBRAS', 'REMÉDIOS E SUPLEMENTOS'],
  ['VIDEO CHAMATIVO PINGANDO REMEDIO NO OUVIDO', 'REMÉDIOS E SUPLEMENTOS'],
  ['TOMANDO BAKING SODA', 'COMIDA E RECEITAS'],
  ['BATIDA NO LIQUIDIFICADOR', 'COMIDA E RECEITAS'],
  ['RESTAURANTE DE LUXO (9)', 'COMIDA E RECEITAS'],
  ['CORRENTE DE SANGUE DUPLA', 'CORPO E ANATOMIA'],
  ['BRIGA DE CASAL', 'FAMÍLIA E CASAL'],
  ['MULHER COM CIUMES EM FESTA', 'FAMÍLIA E CASAL'],
  ['GESTAÇÃO COMPLETA', 'FAMÍLIA E CASAL'],
  ['HOMEM FAZENDO FISIOTERAPIA', 'EXERCÍCIO E BEM-ESTAR'],
  ['HOMEM COMEMORANDO SUCESSO', 'EXERCÍCIO E BEM-ESTAR'],
  ['MEDICO EXPLICANDO', 'MÉDICOS E EXAMES'],
  ['SETA (1)', 'TEXTOS E ELEMENTOS'],
  ['HOMEM DE TERNO', 'PESSOAS'],
  ['LACTULOSE', TAKES_SEM_ASSUNTO],
];
const errados = casos.filter(([t, esperado]) => assuntoDoTake(t) !== esperado).map(([t, e]) => `${t} → ${assuntoDoTake(t)} (esperado ${e})`);
ok(!errados.length, `assunto dos títulos reais do catálogo (${casos.length} casos)${errados.length ? ': ' + errados.join(' | ') : ''}`);

// as armadilhas de PEDAÇO de palavra que pegaram o kit_pool
ok(assuntoDoTake('HOMEM NO COMPUTADOR') === 'CASA E ROTINA', '"computaDOR" não vira DOR (palavra inteira)');
ok(assuntoDoTake('MULHER NO PROVADOR') === 'PESSOAS', '"provaDOR" não vira DOR');
ok(assuntoDoTake('CICATRIZES NA PELE') === TAKES_SEM_ASSUNTO, '"cicATRIZes" não vira nada de celebridade');
ok(assuntoDoTake('REMEDIO MEDICAMENTO') === 'REMÉDIOS E SUPLEMENTOS', '"medicamento" é remédio, não médico');

// título vence o nome do arquivo; sem título, o nome do arquivo decide
ok(assuntoDoTake('VELHA SAUDAVEL', 'cerebro.mp4') === 'IDOSOS', 'o título vence o nome do arquivo');
ok(assuntoDoTake('', 'CEREBRO 3D.mp4') === 'CÉREBRO E MEMÓRIA', 'sem título, o nome do arquivo (upload do PC) decide');
ok(assuntoDoTake(undefined, 'StockFrame_PER_WP83D.mp4') === TAKES_SEM_ASSUNTO, 'código do catálogo sem título = OUTROS TAKES (nunca chuta)');

// nome dos arquivos
ok(nomeDoTake(3, 'CEREBRO REAL SAUDAVEL (2)', 'mp4') === 'TAKE 03 - CEREBRO REAL SAUDAVEL (2).mp4', 'nome do take: número + título');
ok(nomeDoTake(12, 'ÁGUA/ÓLEO: "teste" <x>?', 'mov') === 'TAKE 12 - AGUA OLEO teste x.mov', 'nome sem acento nem caractere proibido no Windows');
ok(nomeDoTake(1, '', 'mp4') === 'TAKE 01.mp4', 'sem título: só o número');
ok(tituloParaArquivo('StockFrame_PER_WP83D.mp4') === 'StockFrame PER WP83D', 'tira a extensão e o sublinhado');
ok(tituloParaArquivo('x'.repeat(80)).length === 48, 'título comprido corta em 48 letras');

// pasta padrão de cada tipo de arquivo do exportador
const p = (nome: string, tipo: 'video' | 'imagem' | 'audio' = 'imagem') => pastaPadraoDoArquivo({ nome, tipo }).join(' / ');
ok(p('avatar.mp4', 'video') === PASTA.avatar && p('SFX - Plim 1.wav', 'audio') === PASTA.sfx && p('TRILHA - Lo-Fi.mp3', 'audio') === PASTA.trilha
  && p('legenda_0001.png') === PASTA.legendas && p('headline_1.png') === PASTA.headlines && p('transicao_preto.png') === PASTA.efeitos
  && p('transicao_piscar_03.png') === PASTA.efeitos && p('linha_ffffff.png') === PASTA.efeitos && p('TAKE 01 - X.mp4', 'video') === `${PASTA.takes} / ${TAKES_SEM_ASSUNTO}`,
  'cada arquivo do exportador tem a sua pasta');

// árvore em ordem fixa
const arvore = arvoreDePastas([
  [PASTA.sfx], [PASTA.takes, TAKES_SEM_ASSUNTO], [PASTA.takes, 'IDOSOS'], [PASTA.avatar], [PASTA.takes, 'CÉREBRO E MEMÓRIA'], [PASTA.legendas],
]);
ok(arvore.map((c) => c.join('>')).join(' | ') === [
  PASTA.avatar, PASTA.takes, `${PASTA.takes}>CÉREBRO E MEMÓRIA`, `${PASTA.takes}>IDOSOS`, `${PASTA.takes}>${TAKES_SEM_ASSUNTO}`, PASTA.sfx, PASTA.legendas,
].join(' | '), 'ordem: 01, 02 (assuntos A→Z, OUTROS por último), 03… — igual em todo projeto');

ok(pastaEmDisco([PASTA.takes, 'CÉREBRO E MEMÓRIA']) === '02 - TAKES/CEREBRO E MEMORIA' && pastaEmDisco([PASTA.efeitos]) === '07 - TRANSICOES E EFEITOS',
  'pasta em disco (Premiere): ASCII, sem o "·"');

// formato do CapCut
let n = 0;
const vs = virtualStoreDoCapCut([
  { id: 'a1', pasta: [PASTA.avatar] },
  { id: 't1', pasta: [PASTA.takes, 'IDOSOS'] },
  { id: 't2', pasta: [PASTA.takes, 'IDOSOS'] },
  { id: 's1', pasta: [PASTA.sfx] },
], 1_791_000_000, () => (++n).toString(16).padStart(32, '0'));
const pastas = vs.draft_virtual_store[0].value as Array<{ id: string; display_name: string; creation_time: number }>;
const rel = vs.draft_virtual_store[1].value as Array<{ child_id: string; parent_id: string }>;
ok(pastas[0].id === '' && pastas[0].display_name === '', '1ª entrada é a raiz vazia (como o CapCut grava)');
ok(pastas.slice(1).map((x) => x.display_name).join(',') === [PASTA.avatar, PASTA.takes, 'IDOSOS', PASTA.sfx].join(','), 'pastas na ordem canônica');
ok(pastas.slice(1).every((x, i, a) => i === 0 || x.creation_time > a[i - 1].creation_time), 'datas de criação crescentes (o CapCut ordena por elas)');
ok(pastas.slice(1).every((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.id)), 'id de pasta em formato uuid (como o CapCut grava)');
const idDe = (nome: string) => pastas.find((x) => x.display_name === nome)!.id;
ok(rel.some((r) => r.child_id === idDe('IDOSOS') && r.parent_id === idDe(PASTA.takes)), 'IDOSOS mora DENTRO de 02 · TAKES (pasta aninhada)');
ok(rel.some((r) => r.child_id === idDe(PASTA.takes) && r.parent_id === ''), 'pasta de cima fica na raiz');
ok(rel.filter((r) => r.parent_id === idDe('IDOSOS')).map((r) => r.child_id).join(',') === 't1,t2', 'os takes ficam na pasta do assunto deles');
ok(rel.some((r) => r.child_id === 'a1' && r.parent_id === idDe(PASTA.avatar)) && rel.some((r) => r.child_id === 's1' && r.parent_id === idDe(PASTA.sfx)),
  'avatar e SFX nas pastas deles');
ok(vs.draft_virtual_store[2].type === 2 && (vs.draft_virtual_store[2].value as unknown[]).length === 0 && Array.isArray(vs.draft_materials), 'type 2 vazio e draft_materials presente');

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed) process.exit(1);
