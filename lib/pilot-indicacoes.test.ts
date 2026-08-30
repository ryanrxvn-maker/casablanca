/**
 * Testes da associação de INDICAÇÕES (comentários do Docs → avatar do Pilot).
 * O cenário principal é o DOC REAL do teste do Silas (29.08): comentário
 * ancorado no HOOK do AD02G1GL - PRPB12, com "Doutor:" na linha acima.
 */
import { associarIndicacoes } from './pilot-indicacoes';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

// Estrutura FIEL ao doc ADGL - PRPB12 (linhas observadas ao vivo no export).
const DOC = [
  'AD1 à 6',
  'AD01GL - PRPB12',
  'BRIEFING: AD40G1GL-PRPB07 adaptado para o PRPB12',
  'Doutor: @drrobertokalil 1.mp4',
  'Como transformar um azeite de R$10 no seu próprio remédio.',
  'Body',
  'A maioria das pessoas usa azeite do jeito errado.',
  '',
  'AD02GL - PRPB12',
  'BRIEFING: AD79G1GL-PRPB07 adaptado para o PRPB12',
  'Observações: ',
  '',
  'AD02G1GL - PRPB12',
  'Doutor:',
  'Para próstata inchada, não existe nada melhor do que isso daqui.[a]',
  ' ',
  'Body',
  'Tomar finasterida te leva pro buraco rapidinho.[b]',
  '',
  'AD03GL - PRPB12',
  'Mulher: @maria 2.mp4 [c]',
  'Hook da mulher aqui.',
].join('\n');

console.log('— cenário REAL: comentário no hook do AD02, "Doutor:" acima —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'a', context: 'AD02G1GL - PRPB12 Doutor: Para próstata inchada, não existe nada melhor do que isso daqui.', body: 'COMENTARIO DE TESTE, CENARIO X' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
  });
  ok(r.porSlot[0].length === 1 && r.porSlot[0][0] === 'COMENTARIO DE TESTE, CENARIO X', 'indicação cai no slot do Doutor');
  ok(r.daTask.length === 0, 'nada sobra na task');
}

console.log('— o MESMO comentário não vaza pro AD01 nem pro AD03 —');
{
  const c = [{ marker: 'a', context: '...', body: 'CENARIO X' }];
  const r1 = associarIndicacoes({ docText: DOC, baseAdId: 'AD01GL', comments: c, slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }] });
  ok(r1.porSlot[0].length === 0 && r1.daTask.length === 0, 'AD01 não recebe o comentário do AD02');
  const r3 = associarIndicacoes({ docText: DOC, baseAdId: 'AD03GL', comments: c, slots: [{ role: 'Mulher', username: 'maria 2' }] });
  ok(r3.porSlot[0].length === 0 && r3.daTask.length === 0, 'AD03 não recebe o comentário do AD02');
}

console.log('— G1GL/GL: mesmo NÚMERO de AD = mesmo anúncio —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02G1GL',
    comments: [{ marker: 'a', context: '', body: 'AVATAR SEGURANDO O AZEITE' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
  });
  ok(r.porSlot[0][0] === 'AVATAR SEGURANDO O AZEITE', 'task AD02G1GL recebe comentário da seção AD02G1GL');
}

console.log('— comentário no BODY também acha o papel pela linha "Doutor:" acima —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'b', context: 'Tomar finasterida te leva', body: 'AVATAR EM CONSULTÓRIO' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }, { role: 'Mulher', username: 'maria 2' }],
  });
  ok(r.porSlot[0].includes('AVATAR EM CONSULTÓRIO'), 'body do AD02 → Doutor (linha Role: acima)');
  ok(r.porSlot[1].length === 0, 'Mulher não recebe');
}

console.log('— comentário ancorado na LINHA do avatar (@username no contexto) —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD03GL',
    comments: [{ marker: 'c', context: 'Mulher: @maria 2.mp4', body: 'AMBIENTE DE COZINHA' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }, { role: 'Mulher', username: 'maria 2' }],
  });
  ok(r.porSlot[1].includes('AMBIENTE DE COZINHA'), 'menção @maria 2 → slot da Mulher');
}

console.log('— multi-avatar sem dono claro → indicação da TASK —');
{
  const doc2 = [
    'AD07GL - VRWA05',
    'Homem: @joao.mp4',
    'Mulher: @ana.mp4',
    'Body',
    'Uma fala qualquer sem papel por perto.[d]',
  ].join('\n');
  // Sem linha "Role:" imediatamente acima E sem menção: os dois avatares
  // existem → ambíguo → vai pro topo do card.
  const doc3 = doc2.replace('Homem: @joao.mp4\nMulher: @ana.mp4\nBody\n', 'ELENCO — ver Drive\n\n\n');
  const r = associarIndicacoes({
    docText: doc3,
    baseAdId: 'AD07GL',
    comments: [{ marker: 'd', context: 'Uma fala qualquer', body: 'TROCAR O FUNDO' }],
    slots: [{ role: 'Homem', username: 'joao' }, { role: 'Mulher', username: 'ana' }],
  });
  ok(r.daTask.includes('TROCAR O FUNDO'), 'sem dono claro → daTask');
  ok(r.porSlot[0].length === 0 && r.porSlot[1].length === 0, 'nenhum slot recebe no ambíguo');
}

console.log('— 1 avatar só: qualquer comentário do AD vai pra ele —');
{
  const doc4 = [
    'AD09GL - MEPB03',
    'Narrador: @carlos.mp4',
    'Hook sem papel colado.[e]',
  ].join('\n');
  const r = associarIndicacoes({
    docText: doc4,
    baseAdId: 'AD09GL',
    comments: [{ marker: 'e', context: 'Hook sem papel', body: 'AVATAR SEGURANDO ALGO' }],
    slots: [{ role: 'Narrador', username: 'carlos' }],
  });
  ok(r.porSlot[0].includes('AVATAR SEGURANDO ALGO'), '1 avatar → recebe tudo do AD');
}

console.log('— doc sem comentários / marcador ausente não explode —');
{
  const r = associarIndicacoes({ docText: DOC, baseAdId: 'AD02GL', comments: [{ marker: 'z', context: '', body: 'X' }], slots: [{ role: 'Doutor', username: null }] });
  ok(r.porSlot[0].length === 0 && r.daTask.length === 0, 'marcador inexistente é ignorado');
  const r2 = associarIndicacoes({ docText: DOC, baseAdId: 'AD02GL', comments: [], slots: [] });
  ok(r2.daTask.length === 0, 'lista vazia ok');
}

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
console.log('\npilot-indicacoes: todos os testes passaram ✓');
