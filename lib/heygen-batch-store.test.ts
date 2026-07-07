/**
 * GARANTIA — cada disparo do Hey Auto tem a SUA própria memória, não se
 * mistura com outros (nem entre abas, nem em disparos sequenciais na mesma aba).
 *
 * O bug de classe que isto trava: o store de batches vive numa chave de
 * localStorage COMPARTILHADA por todas as abas da mesma origem. A reidratação
 * antiga pegava "o batch mais recente de todos" → uma aba reidratava o disparo
 * de OUTRA aba (ou de um disparo anterior). Os disparos se misturavam.
 *
 * A âncora da isolação é o sessionStorage (POR-ABA, sobrevive F5, nunca
 * compartilhado): cada aba só restaura o batch que ELA é dona. Este teste
 * prova o comportamento de `selectOwnBatch`/`newBatchId`/posse e trava as
 * invariantes estáticas no source (a blindagem não pode ser removida).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  selectOwnBatch,
  newBatchId,
  getOwnedBatchId,
  setOwnedBatchId,
  type SharedBatchState,
} from './heygen-batch-store';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg);
  } else {
    fail++;
    console.error('  FAIL', msg);
  }
}

function mkBatch(taskId: string, startedAt: number, hasVideo = true): SharedBatchState {
  return {
    taskId,
    taskName: taskId,
    baseAdId: taskId,
    phase: 'rendering',
    startedAt,
    parts: [{ label: 'HOOK 1', videoId: hasVideo ? 'vid-' + taskId : null, renamedTo: 'HOOK 1.mp4' }],
  };
}

console.log('\nGARANTIA — isolação por disparo do Hey Auto (não regredir):');

// ── A. selectOwnBatch: só restaura O DISPARO DESTA ABA ──
const tabA = mkBatch('heygenauto:adX:1000:aaa', 1000);
const tabB = mkBatch('heygenauto:adX:2000:bbb', 2000); // mais RECENTE
const store = [tabB, tabA]; // ordenado por recência (como listSharedBatches)

// Sem posse → aba fresca começa VAZIA (não herda card de ninguém).
ok(selectOwnBatch(store, null) === null, 'sem posse (aba fresca) → null, não adota disparo alheio');

// CASO CRÍTICO de mistura: a aba dona de A NÃO pode reidratar B (mais recente).
ok(
  selectOwnBatch(store, tabA.taskId)?.taskId === tabA.taskId,
  'aba dona de A reidrata A — NUNCA o B mais recente (isolação entre abas)',
);
ok(
  selectOwnBatch(store, tabB.taskId)?.taskId === tabB.taskId,
  'aba dona de B reidrata B (cada aba a sua)',
);

// Posse aponta pra batch que sumiu do store → null (não adota um estranho).
ok(
  selectOwnBatch(store, 'heygenauto:adX:9999:zzz') === null,
  'posse órfã (batch removido) → null, não pega o mais recente por engano',
);

// Ordem do array não muda o resultado (seleção é por id, não por posição).
ok(
  selectOwnBatch([tabA, tabB], tabA.taskId)?.taskId === tabA.taskId,
  'seleção é por id (independe da ordem do array)',
);

// ── B. newBatchId: id GARANTIDAMENTE único, sempre no namespace do Hey Auto ──
const ids = new Set<string>();
for (let i = 0; i < 2000; i++) ids.add(newBatchId('heygen')); // nome vazio colapsa p/ 'heygen'
ok(ids.size === 2000, `2000 ids do MESMO nome ('heygen') são todos distintos (nonce) — ${ids.size}/2000`);
const one = newBatchId('meu_ad');
ok(one.startsWith('heygenauto:'), 'id começa com heygenauto: (Pilot filtra por esse prefixo)');
ok(one.includes(':meu_ad:'), 'id preserva o safeName pra leitura humana');

// ── C. Posse via sessionStorage (por-aba): roundtrip + isolado ──
{
  const bag: Record<string, string> = {};
  (globalThis as any).window = {
    sessionStorage: {
      getItem: (k: string) => (k in bag ? bag[k] : null),
      setItem: (k: string, v: string) => {
        bag[k] = String(v);
      },
      removeItem: (k: string) => {
        delete bag[k];
      },
    },
  };
  ok(getOwnedBatchId() === null, 'posse inicial vazia (aba nova)');
  setOwnedBatchId('heygenauto:adX:1000:aaa');
  ok(getOwnedBatchId() === 'heygenauto:adX:1000:aaa', 'setOwnedBatchId grava e getOwnedBatchId lê');
  setOwnedBatchId('heygenauto:adX:2000:bbb'); // disparo NOVO na mesma aba
  ok(getOwnedBatchId() === 'heygenauto:adX:2000:bbb', 'novo disparo na aba troca a posse (memória segue a última)');
  setOwnedBatchId(null);
  ok(getOwnedBatchId() === null, 'remover solta a posse (não reidrata no reload)');
  delete (globalThis as any).window;
}

// ── D. Invariantes ESTÁTICAS no source (a blindagem não pode sumir) ──
const root = join(__dirname, '..');
const storeSrc = readFileSync(join(root, 'lib', 'heygen-batch-store.ts'), 'utf8');
const pageSrc = readFileSync(join(root, 'app', 'tools', 'heygen-auto', 'page.tsx'), 'utf8');

ok(/sessionStorage/.test(storeSrc), 'store: posse vive no sessionStorage (por-aba)');
ok(/ACTIVE_BATCH_KEY/.test(storeSrc), 'store: chave de posse dedicada');
ok(/Math\.random\(\)/.test(storeSrc), 'store: newBatchId usa nonce aleatório (anti-colisão)');

ok(/getOwnedBatchId\(\)/.test(pageSrc), 'page: reidratação consulta a posse desta aba');
ok(/selectOwnBatch\(/.test(pageSrc), 'page: reidratação usa selectOwnBatch (isolação estrita)');
ok(/setOwnedBatchId\(batchId\)/.test(pageSrc), 'page: disparo marca a posse desta aba');
ok(/setOwnedBatchId\(null\)/.test(pageSrc), 'page: remover solta a posse');
// O disparo NOVO precisa zerar o estado por-disparo que vivia só em memória,
// senão o 2º disparo herda "prontos"/montado do 1º na MESMA aba.
ok(
  /setDownloadStatuses\(\{\}\);\s*\n\s*setDownloadStage\(null\);\s*\n\s*setPipelineZips\(\{\}\);/.test(pageSrc),
  'page: run() zera downloadStatuses + downloadStage + pipelineZips (sem herança entre disparos)',
);
// A reidratação global antiga ("mais recente de todos") NÃO pode voltar.
ok(
  !/mine\.find\(\(b\) => \(b\.parts \|\| \[\]\)\.some\(\(p\) => p\.videoId\)\)/.test(pageSrc),
  'page: reidratação "mais recente de todos" foi removida (era a fonte da mistura)',
);
// Falha por LIMITE DIÁRIO tem mensagem honesta (não manda clicar Retomar em loop).
ok(/LIMITE DIÁRIO/.test(pageSrc), 'page: limite diário do HeyGen tem mensagem honesta (terminal, não é bug)');

console.log(`\n${fail === 0 ? '✓' : '✗'} heygen-batch-store (isolação): ${pass} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
