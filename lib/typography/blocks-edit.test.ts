/**
 * Testes da EDIÇÃO DE BLOCOS QUE NÃO PERDE O TRABALHO DO USUÁRIO.
 *
 * O bug que originou o módulo (relato do Silas, 30.08): marcar o cadeado em
 * alguns blocos e depois trocar o RITMO destravava tudo sozinho e aplicava a
 * mudança no vídeo inteiro. Os mesmos furos existiam no dividir/juntar
 * (id novo → cadeado, estilo, destaque e estilo por palavra viravam órfãos).
 */
import type { Block, TWord } from './engine';
import {
  emptyIdentity,
  mergeKeepingIdentity,
  pruneIdentity,
  regroupKeepingLocks,
  removeKeepingIdentity,
  splitAtWordKeepingIdentity,
  splitKeepingIdentity,
  type BlockIdentity,
} from './blocks-edit';
import { groupWords } from './group';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

/** 24 palavras de 300ms, coladas — sem gap que force quebra por silêncio. */
function fakeWords(n = 24): TWord[] {
  const out: TWord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ text: `pal${i}`, start: i * 300, end: i * 300 + 280 });
  }
  return out;
}

const WORDS = fakeWords();

console.log('\n── regroupKeepingLocks ──');
{
  const blocks = groupWords(WORDS, 'equilibrado');
  ok(blocks.length >= 4, `base tem ${blocks.length} blocos no ritmo equilibrado`);

  const alvo = blocks[1];
  const ident: BlockIdentity = {
    locked: [alvo.id],
    blockStyles: { [alvo.id]: { presetId: 'vermelho-sangue', fontScale: 1.2, posY: 0.5 } },
    wordStyles: { [alvo.id]: { 0: { color: '#ff0000' } } },
    highlights: { [alvo.id]: [0, 1] },
  };

  const r = regroupKeepingLocks(WORDS, 'palavra', blocks, ident);

  ok(r.locked.includes(alvo.id), 'o bloco travado continua travado depois de trocar o ritmo');
  const sobreviveu = r.blocks.find((b) => b.id === alvo.id);
  ok(!!sobreviveu, 'o bloco travado sobrevive com o MESMO id');
  ok(
    !!sobreviveu &&
      sobreviveu.words.map((w) => w.text).join(' ') === alvo.words.map((w) => w.text).join(' '),
    'as palavras do bloco travado ficam intactas (não viraram 1 por vez)',
  );
  ok(!!sobreviveu && sobreviveu.start === alvo.start, 'o start do bloco travado não muda');
  ok(
    r.blockStyles[alvo.id]?.presetId === 'vermelho-sangue' &&
      r.blockStyles[alvo.id]?.fontScale === 1.2,
    'o estilo congelado do bloco travado continua lá',
  );
  ok(
    JSON.stringify(r.highlights[alvo.id]) === '[0,1]',
    'os destaques do bloco travado continuam lá',
  );
  ok(
    r.wordStyles[alvo.id]?.[0]?.color === '#ff0000',
    'o estilo por palavra do bloco travado continua lá',
  );

  const livres = r.blocks.filter((b) => b.id !== alvo.id);
  ok(
    livres.every((b) => b.words.length === 1),
    'todo bloco LIVRE virou 1 palavra por vez (o ritmo novo pegou só neles)',
  );
  ok(r.kept === 1 && r.remade === livres.length, `relatório honesto: ${r.kept} mantido, ${r.remade} remontados`);

  // nenhuma palavra some e nenhuma se repete
  const texto = r.blocks.flatMap((b) => b.words.map((w) => w.text)).join(' ');
  ok(texto === WORDS.map((w) => w.text).join(' '), 'nenhuma palavra some nem duplica no reagrupamento');

  // ordenação e ausência de sobreposição (o engine para no 1º bloco da janela)
  let ordenado = true;
  let semSobrepor = true;
  for (let i = 0; i < r.blocks.length - 1; i++) {
    if (r.blocks[i].start > r.blocks[i + 1].start) ordenado = false;
    if (r.blocks[i].end > r.blocks[i + 1].start) semSobrepor = false;
  }
  ok(ordenado, 'blocos saem ordenados por tempo');
  ok(semSobrepor, 'nenhum bloco invade o começo do próximo');
}

{
  // dois travados NÃO adjacentes + ida e volta de ritmo
  const blocks = groupWords(WORDS, 'equilibrado');
  const a = blocks[0];
  const b = blocks[2];
  const ident: BlockIdentity = {
    locked: [a.id, b.id],
    blockStyles: { [a.id]: { fontScale: 1.3 }, [b.id]: { fontScale: 0.8 } },
    wordStyles: {},
    highlights: {},
  };
  const ida = regroupKeepingLocks(WORDS, 'frases', blocks, ident);
  ok(ida.kept === 2, 'dois travados separados sobrevivem juntos');
  const volta = regroupKeepingLocks(WORDS, 'equilibrado', ida.blocks, ida);
  ok(
    volta.blocks.some((x) => x.id === a.id) && volta.blocks.some((x) => x.id === b.id),
    'trocar de ritmo duas vezes seguidas ainda preserva os dois travados',
  );
  ok(
    volta.blockStyles[a.id]?.fontScale === 1.3 && volta.blockStyles[b.id]?.fontScale === 0.8,
    'os estilos congelados sobrevivem ao vai-e-volta',
  );
}

{
  // sem nenhum cadeado o comportamento antigo continua: remonta tudo
  const blocks = groupWords(WORDS, 'equilibrado');
  const r = regroupKeepingLocks(WORDS, 'palavra', blocks, emptyIdentity());
  ok(
    r.blocks.length === WORDS.length && r.kept === 0,
    'sem cadeado nenhum, trocar o ritmo remonta tudo (comportamento antigo)',
  );
}

{
  // travado cujo TEXTO foi reescrito na mão não casa com palavra nenhuma
  const blocks = groupWords(WORDS, 'equilibrado');
  const fantasma: Block = {
    id: 'fantasma',
    words: [{ text: 'inventado', start: 100_000, end: 100_400 }],
    start: 100_000,
    end: 100_800,
  };
  const comFantasma = [...blocks, fantasma];
  const r = regroupKeepingLocks(WORDS, 'rapido', comFantasma, {
    locked: ['fantasma'],
    blockStyles: { fantasma: { fontScale: 2 } },
    wordStyles: {},
    highlights: {},
  });
  ok(
    r.blocks.some((x) => x.id === 'fantasma'),
    'travado que não casa com nenhuma palavra da transcrição não some',
  );
  ok(r.blockStyles['fantasma']?.fontScale === 2, 'e o estilo dele vem junto');
}

console.log('\n── split / merge levando a identidade ──');
{
  const blocks = groupWords(WORDS, 'frases');
  const alvo = blocks[0];
  ok(alvo.words.length >= 4, `bloco de teste tem ${alvo.words.length} palavras`);
  const ident: BlockIdentity = {
    locked: [alvo.id],
    blockStyles: { [alvo.id]: { presetId: 'keynote', posY: 0.4 } },
    wordStyles: { [alvo.id]: { 0: { color: '#111' }, [alvo.words.length - 1]: { color: '#222' } } },
    highlights: { [alvo.id]: [0, alvo.words.length - 1] },
  };

  const r = splitKeepingIdentity(blocks, alvo.id, ident);
  ok(!!r, 'dividir um bloco de várias palavras funciona');
  if (r) {
    ok(
      r.locked.includes(r.firstId) && r.locked.includes(r.secondId),
      'as duas metades nascem TRAVADAS (antes, dividir destravava calado)',
    );
    ok(
      r.blockStyles[r.firstId]?.presetId === 'keynote' &&
        r.blockStyles[r.secondId]?.presetId === 'keynote',
      'as duas metades herdam o estilo congelado do pai',
    );
    ok(!r.locked.includes(alvo.id) && !r.blockStyles[alvo.id], 'a identidade do pai morto some (sem órfão)');
    ok(
      r.highlights[r.firstId]?.includes(0) === true,
      'o destaque da 1ª palavra fica na 1ª metade',
    );
    const seg = r.blocks.find((b) => b.id === r.secondId);
    ok(
      !!seg && r.highlights[r.secondId]?.includes(seg.words.length - 1) === true,
      'o destaque da última palavra é REMAPEADO pra 2ª metade',
    );
    ok(
      r.wordStyles[r.firstId]?.[0]?.color === '#111',
      'estilo por palavra da 1ª metade sobrevive',
    );
    ok(
      !!seg && r.wordStyles[r.secondId]?.[seg.words.length - 1]?.color === '#222',
      'estilo por palavra da 2ª metade sobrevive remapeado',
    );
    const first = r.blocks.find((b) => b.id === r.firstId)!;
    ok(first.end <= seg!.start, 'a 1ª metade não invade a 2ª');
    ok(r.firstId !== r.secondId, 'as metades têm ids distintos');
  }
}

{
  // corte na palavra EXATA (motor do roteiro hook × body)
  const blocks = groupWords(WORDS, 'frases');
  const alvo = blocks[0];
  const r = splitAtWordKeepingIdentity(blocks, alvo.id, 2, emptyIdentity());
  ok(!!r, 'corte na palavra exata funciona');
  if (r) {
    const a = r.blocks.find((b) => b.id === r.firstId)!;
    ok(a.words.length === 2, 'a 1ª parte tem exatamente as 2 palavras pedidas');
  }
  ok(splitAtWordKeepingIdentity(blocks, alvo.id, 0, emptyIdentity()) === null, 'corte em 0 é recusado');
  ok(
    splitAtWordKeepingIdentity(blocks, alvo.id, alvo.words.length, emptyIdentity()) === null,
    'corte no fim (que geraria bloco vazio) é recusado',
  );
}

{
  const blocks = groupWords(WORDS, 'equilibrado');
  const a = blocks[0];
  const b = blocks[1];
  const ident: BlockIdentity = {
    locked: [b.id],
    blockStyles: { [a.id]: { fontScale: 1.5 }, [b.id]: { fontScale: 0.5, posY: 0.2 } },
    wordStyles: { [b.id]: { 0: { bold: true } } },
    highlights: { [a.id]: [0], [b.id]: [0] },
  };
  const r = mergeKeepingIdentity(blocks, a.id, ident);
  ok(!!r, 'juntar com o próximo funciona');
  if (r) {
    ok(r.locked.includes(r.mergedId), 'a junção fica travada porque um dos dois estava');
    ok(
      r.blockStyles[r.mergedId]?.fontScale === 1.5 && r.blockStyles[r.mergedId]?.posY === 0.2,
      'o estilo do 1º vence e o do 2º preenche o que faltava',
    );
    ok(
      JSON.stringify(r.highlights[r.mergedId]) === JSON.stringify([0, a.words.length]),
      'os destaques dos dois entram, o do 2º deslocado pelo tamanho do 1º',
    );
    ok(
      r.wordStyles[r.mergedId]?.[a.words.length]?.bold === true,
      'o estilo por palavra do 2º é remapeado pela posição na junção',
    );
    ok(!r.blockStyles[a.id] && !r.blockStyles[b.id], 'os pais mortos não deixam órfão');
  }
}

console.log('\n── faxina de órfãos ──');
{
  const blocks = groupWords(WORDS, 'equilibrado');
  const morto = blocks[1];
  const ident: BlockIdentity = {
    locked: [morto.id, blocks[0].id],
    blockStyles: { [morto.id]: { fontScale: 2 }, [blocks[0].id]: { fontScale: 1.1 } },
    wordStyles: { [morto.id]: { 0: { bold: true } } },
    highlights: { [morto.id]: [0] },
  };
  const r = removeKeepingIdentity(blocks, morto.id, ident);
  ok(!r.locked.includes(morto.id), 'excluir o bloco tira o cadeado órfão');
  ok(!r.blockStyles[morto.id] && !r.wordStyles[morto.id] && !r.highlights[morto.id], 'e os 3 mapas restantes também');
  ok(r.locked.includes(blocks[0].id) && r.blockStyles[blocks[0].id]?.fontScale === 1.1, 'o que sobrou fica intacto');

  // índice de palavra além do fim do texto é podado
  const encolhido: Block[] = [{ ...blocks[0], words: blocks[0].words.slice(0, 1) }];
  const p = pruneIdentity(encolhido, {
    locked: [],
    blockStyles: {},
    wordStyles: { [blocks[0].id]: { 0: { bold: true }, 9: { bold: true } } },
    highlights: { [blocks[0].id]: [0, 9] },
  });
  ok(
    p.wordStyles[blocks[0].id]?.[9] === undefined && p.wordStyles[blocks[0].id]?.[0]?.bold === true,
    'estilo de palavra que não existe mais é podado, o válido fica',
  );
  ok(JSON.stringify(p.highlights[blocks[0].id]) === '[0]', 'destaque fora do texto é podado');
}

console.log('\n── ids não colidem ──');
{
  // Antes, o contador reiniciava a cada F5: split depois de restaurar sessão
  // cunhava id igual ao de um bloco existente.
  const vistos = new Set<string>();
  let blocks = groupWords(WORDS, 'frases');
  for (const b of blocks) vistos.add(b.id);
  for (let i = 0; i < 30; i++) {
    const r = splitKeepingIdentity(blocks, blocks[0].id, emptyIdentity());
    if (!r) break;
    blocks = r.blocks;
    ok(!vistos.has(r.firstId) && !vistos.has(r.secondId) ? true : false, `split #${i + 1} cunhou ids inéditos`);
    vistos.add(r.firstId);
    vistos.add(r.secondId);
    if (blocks[0].words.length < 2) break;
  }
  const idsVivos = blocks.map((b) => b.id);
  ok(new Set(idsVivos).size === idsVivos.length, 'nenhum id duplicado entre os blocos vivos');
}

console.log(falhas === 0 ? '\n✅ blocks-edit: tudo passou' : `\n❌ blocks-edit: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
