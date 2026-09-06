import {
  MAX_HOOKS,
  copyDasPartes,
  copyVazia,
  ehHook,
  partesDaCopy,
  problemaDaCopy,
  videosDaMontagem,
  type ParteDaCopy,
} from './pilot-copy-creator';

let oks = 0;
let fails = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    oks++;
    console.log(`  ok   ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (veio ${JSON.stringify(a)})`}`);
}

// corte de body de mentira: um take por parágrafo
const porParagrafo = (t: string) => t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

console.log('pilot-copy-creator:');

// 1. dois hooks + body em 2 parágrafos → HOOK 1, HOOK 2, BODY 1, BODY 2
{
  const partes = partesDaCopy({ hooks: ['Gancho A', 'Gancho B'], body: 'Para 1.\n\nPara 2.' }, 'Avatar 1', [], porParagrafo);
  eq(partes.map((p) => p.label), ['HOOK 1', 'HOOK 2', 'BODY 1', 'BODY 2'], 'labels na ordem hooks → body');
  ok(partes.every((p) => p.matchByRole === 'avatar 1' && p.speaker === 'Avatar 1'), 'todas as partes são do avatar (matchByRole minúsculo, speaker original)');
  eq(videosDaMontagem(partes), 2, '2 hooks = 2 vídeos na montagem');
}

// 2. full body: sem hook, um vídeo só
{
  const partes = partesDaCopy({ hooks: ['', '   '], body: 'Só corpo.' }, 'Doutor', [], porParagrafo);
  eq(partes.map((p) => p.label), ['BODY 1'], 'hooks em branco são descartados: full body');
  eq(videosDaMontagem(partes), 1, 'full body = 1 vídeo');
  eq(problemaDaCopy({ hooks: [''], body: 'x' }), null, 'full body não é problema');
}

// 3. numeração continua depois das partes dos outros avatares
{
  const outros: ParteDaCopy[] = [
    { label: 'HOOK 1', text: 'a', matchByRole: 'doutor' },
    { label: 'BODY 1', text: 'b', matchByRole: 'doutor' },
    { label: 'BODY 2', text: 'c', matchByRole: 'doutor' },
  ];
  const partes = partesDaCopy({ hooks: ['Outro gancho'], body: 'Fala da mulher.' }, 'Mulher', outros, porParagrafo);
  eq(partes.map((p) => p.label), ['HOOK 2', 'BODY 3'], 'HOOK e BODY continuam a numeração global da task');
}

// 4. teto de 10 hooks
{
  const dez = Array.from({ length: 12 }, (_, i) => `h${i + 1}`);
  eq(problemaDaCopy({ hooks: dez, body: '' }), 'hooks-demais', '12 hooks = problema');
  const partes = partesDaCopy({ hooks: dez, body: '' }, 'A', [], porParagrafo);
  eq(partes.length, MAX_HOOKS, `partesDaCopy corta em ${MAX_HOOKS}`);
  eq(problemaDaCopy({ hooks: dez.slice(0, 10), body: '' }), null, '10 hooks passa');
}

// 5. sem texto nenhum
{
  eq(problemaDaCopy({ hooks: ['', ''], body: '  ' }), 'sem-texto', 'só espaço = sem-texto');
  eq(partesDaCopy({ hooks: [], body: '' }, 'A', [], porParagrafo), [], 'copy vazia → nenhuma parte');
}

// 6. ida e volta: partes → caixas → partes
{
  const copy = { hooks: ['G1', 'G2'], body: 'P1.\n\nP2.\n\nP3.' };
  const partes = partesDaCopy(copy, 'Avatar 1', [], porParagrafo);
  const volta = copyDasPartes(partes);
  eq(volta, copy, 'copyDasPartes remonta hooks e body (takes voltam como parágrafos)');
  const partes2 = partesDaCopy(volta, 'Avatar 1', [], porParagrafo);
  eq(partes2, partes, 'segunda ida é idêntica');
}

// 7. caixas vazias quando o avatar não tem parte
{
  eq(copyDasPartes([]), copyVazia(), 'sem partes = uma caixa de hook vazia e body vazio');
}

// 8. CRLF e espaços
{
  const partes = partesDaCopy({ hooks: ['  Gancho\r\ncom quebra  '], body: 'Corpo\r\n\r\nDois' }, 'A', [], porParagrafo);
  eq(partes[0].text, 'Gancho\ncom quebra', 'CRLF vira LF e apara as pontas');
  eq(partes.length, 3, 'body com CRLF duplo vira 2 takes');
}

// 9. rótulos aceitos como hook
{
  ok(ehHook('HOOK 3') && ehHook('gancho 1') && !ehHook('BODY 1') && !ehHook('PARTE 2'), 'ehHook reconhece HOOK/GANCHO e rejeita BODY/PARTE');
}

console.log(`\npilot-copy-creator: ${oks} ok, ${fails} fail`);
if (fails) process.exit(1);
