/**
 * GARANTIA — a fila do Hey Auto sobrevive a F5/queda de aba SEM duplicar
 * disparo e SEM misturar com outra aba nem com a fila do ClickUp Pilot.
 *
 * O que isto trava:
 *  1. Posse por-aba (sessionStorage): aba nova NUNCA adota fila alheia.
 *  2. Re-hidratação anti-duplicação: item interrompido no MEIO do dispatch
 *     (sem videoIds completos) NUNCA re-dispara sozinho; interrompido DEPOIS
 *     do dispatch retoma sem custo (re-poll+download).
 *  3. Auto-continuação SÓ quando "Processar fila" estava em andamento
 *     (runMode 'queue') — RETOMAR avulso não vira fila inteira.
 *  4. Áudios de itens pendentes ficam protegidos da faxina LRU do zip-store.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getQueueOwnerId,
  ensureQueueOwnerId,
  savePersistedQueue,
  loadPersistedQueue,
  setPersistedRunMode,
  queueAudioKey,
  listQueueAudioProtectIds,
  recoverFromMirror,
  planQueueRehydration,
  type PersistedQueueItem,
} from './heygen-queue-store';

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

function mkItem(id: string, over: Partial<PersistedQueueItem> = {}): PersistedQueueItem {
  return {
    id,
    adName: id,
    safeName: id,
    mode: 'copy',
    parts: [{ label: 'HOOK 1', text: 'oi' }],
    motor: 'V',
    decupagem: true,
    decupIntensity: 0.12,
    source: 'manual',
    status: 'pending',
    ...over,
  };
}

/** window fake: localStorage + sessionStorage independentes (como no browser). */
function mkWindow() {
  const mkStorage = () => {
    const bag: Record<string, string> = {};
    return {
      getItem: (k: string) => (k in bag ? bag[k] : null),
      setItem: (k: string, v: string) => {
        bag[k] = String(v);
      },
      removeItem: (k: string) => {
        delete bag[k];
      },
      _bag: bag,
    };
  };
  return { localStorage: mkStorage(), sessionStorage: mkStorage() };
}

console.log('\nGARANTIA — persistência + auto-retomada da fila do Hey Auto (não regredir):');

// ── A. Posse por-aba + roundtrip save/load ──
{
  (globalThis as any).window = mkWindow();
  ok(getQueueOwnerId() === null, 'aba nova não tem posse de fila (começa vazia)');
  const owner = ensureQueueOwnerId();
  ok(!!owner && getQueueOwnerId() === owner, 'ensureQueueOwnerId cria e estabiliza a posse');
  ok(ensureQueueOwnerId() === owner, 'ensure é idempotente (não troca a posse a cada chamada)');

  savePersistedQueue(owner, [mkItem('manual:ad1:1:aa'), mkItem('manual:ad2:2:bb', { status: 'done' })]);
  const back = loadPersistedQueue(owner);
  ok(back?.items.length === 2 && back.items[0].id === 'manual:ad1:1:aa', 'roundtrip save→load preserva os itens');
  ok(back?.runMode === null, 'runMode nasce null (nada rodando)');

  // Isolação: outra "aba" (owner diferente) não enxerga esta fila.
  ok(loadPersistedQueue('hgaqowner:999:zz') === null, 'owner alheio não carrega a fila desta aba (isolação)');

  // runMode gravado nas transições e preservado pelo save de itens.
  setPersistedRunMode(owner, 'queue');
  savePersistedQueue(owner, [mkItem('manual:ad1:1:aa')]);
  ok(loadPersistedQueue(owner)?.runMode === 'queue', 'save de itens PRESERVA o runMode (não zera no meio do run)');
  setPersistedRunMode(owner, null);
  ok(loadPersistedQueue(owner)?.runMode === null, 'fim do run solta o runMode (reload não auto-continua fila pausada)');

  // Fila vazia = entrada some (não deixa lixo).
  savePersistedQueue(owner, []);
  ok(loadPersistedQueue(owner) === null, 'fila esvaziada remove a entrada persistida');
  delete (globalThis as any).window;
}

// ── B. Chave de áudio + proteção da faxina ──
{
  (globalThis as any).window = mkWindow();
  const owner = ensureQueueOwnerId();
  ok(queueAudioKey('manual:x:1:aa', 2) === 'hgaq:manual:x:1:aa:audio:2', 'queueAudioKey determinística (itemId+idx)');

  savePersistedQueue(owner, [
    mkItem('itemAudioPendente', { mode: 'audio', parts: [{ label: 'HOOK 1', audioKey: 'hgaq:itemAudioPendente:audio:0' }] }),
    mkItem('itemAudioEntregue', { mode: 'audio', status: 'done', parts: [{ label: 'HOOK 1', audioKey: 'hgaq:itemAudioEntregue:audio:0' }] }),
    mkItem('itemCopy'),
  ]);
  const prot = listQueueAudioProtectIds();
  ok(prot.includes('itemAudioPendente'), 'item pendente com áudio entra na proteção da faxina');
  ok(!prot.includes('itemAudioEntregue'), 'item ENTREGUE sai da proteção (áudio segue o LRU normal)');
  ok(!prot.includes('itemCopy'), 'item de copy (sem áudio) não polui a proteção');
  delete (globalThis as any).window;
}

// ── C. recoverFromMirror: videoIds do espelho compartilhado ──
{
  const running = mkItem('r1', { status: 'running', batchId: 'heygenauto:r1:1:aa' });
  const full = [
    { label: 'HOOK 1', videoId: 'vidA', error: null },
    { label: 'BODY', videoId: 'vidB', error: null },
  ];
  const rec = recoverFromMirror(running, full);
  ok(rec.videoIds?.join(',') === 'vidA,vidB', 'espelho completo → recupera videoIds (retomável sem re-disparar)');
  ok(rec.partResults?.length === 2, 'espelho completo → partResults reconstruídos');

  const partial = [
    { label: 'HOOK 1', videoId: 'vidA', error: null },
    { label: 'BODY', videoId: null, error: null },
  ];
  ok(recoverFromMirror(running, partial).videoIds == null, 'dispatch PARCIAL não vira retomada (entregaria vídeo furado)');
  ok(recoverFromMirror(running, null).videoIds == null, 'sem espelho → não inventa videoIds');
  const done = mkItem('d1', { status: 'done' });
  ok(recoverFromMirror(done, full) === done, 'item não-running não é tocado');
  const withIds = mkItem('w1', { status: 'running', videoIds: ['x'] });
  ok(recoverFromMirror(withIds, full).videoIds?.join(',') === 'x', 'item que JÁ tem videoIds não é sobrescrito');
}

// ── D. planQueueRehydration: anti-duplicação de disparo ──
{
  const items: PersistedQueueItem[] = [
    mkItem('done1', { status: 'done' }),
    mkItem('pend1'),
    mkItem('runComIds', { status: 'running', videoIds: ['v1', 'v2'] }),
    mkItem('runSemIds', { status: 'running' }),
  ];
  const plan = planQueueRehydration(items, 'queue');
  const by = (id: string) => plan.items.find((i) => i.id === id)!;

  ok(by('done1').status === 'done', 'done fica done (downloads do disco continuam)');
  ok(by('pend1').status === 'pending', 'pendente fica pendente');
  ok(by('runComIds').status === 'pending' && plan.autoResumeIds.includes('runComIds'),
    'rodando COM videoIds → retomável + auto-retomada (re-poll, sem re-disparar)');
  ok(by('runSemIds').status === 'failed' && !plan.autoResumeIds.includes('runSemIds'),
    'rodando SEM videoIds (meio do dispatch) → failed honesto, NUNCA re-dispara sozinho');
  ok(/em dobro|duplicar/i.test(by('runSemIds').message || ''), 'mensagem explica o anti-duplicação');
  ok(plan.continueQueue === true, 'runMode queue + pendentes → continua a fila sozinho');

  const single = planQueueRehydration(items, 'single');
  ok(single.continueQueue === false, 'RETOMAR avulso interrompido NÃO vira fila inteira');
  const idle = planQueueRehydration(items, null);
  ok(idle.continueQueue === false && idle.autoResumeIds.includes('runComIds') === true,
    'fila parada: nada auto-continua, mas item interrompido segue retomável');

  const noPending = planQueueRehydration([mkItem('d', { status: 'done' })], 'queue');
  ok(noPending.continueQueue === false, 'sem pendentes não há o que continuar');
}

// ── E. Faxina de sessões velhas (nunca a atual) ──
{
  (globalThis as any).window = mkWindow();
  const OLD = Date.now() - 8 * 24 * 3600_000;
  const raw = {
    'hgaqowner:velha:aa': { items: [mkItem('x')], runMode: null, updatedAt: OLD },
    'hgaqowner:nova:bb': { items: [mkItem('y')], runMode: null, updatedAt: Date.now() },
  };
  (globalThis as any).window.localStorage.setItem('darkolab:heygenauto:queues', JSON.stringify(raw));
  savePersistedQueue('hgaqowner:atual:cc', [mkItem('z')]);
  ok(loadPersistedQueue('hgaqowner:velha:aa') === null, 'sessão com +7 dias é removida no save');
  ok(loadPersistedQueue('hgaqowner:nova:bb') !== null, 'sessão recente de OUTRA aba não é tocada');
  ok(loadPersistedQueue('hgaqowner:atual:cc') !== null, 'a sessão atual nunca é removida');
  delete (globalThis as any).window;
}

// ── F. Invariantes ESTÁTICAS no source (a blindagem não pode sumir) ──
const root = join(__dirname, '..');
const pageSrc = readFileSync(join(root, 'app', 'tools', 'heygen-auto', 'page.tsx'), 'utf8');
const zipStoreSrc = readFileSync(join(root, 'lib', 'zip-store.ts'), 'utf8');
const pruneSrc = readFileSync(join(root, 'lib', 'zip-store-prune.ts'), 'utf8');

ok(/loadPersistedQueue\(/.test(pageSrc), 'page: re-hidrata a fila no mount');
ok(/savePersistedQueue\(/.test(pageSrc), 'page: persiste a fila a cada mudança');
ok(/getQueueOwnerId\(\)/.test(pageSrc) && /ensureQueueOwnerId\(\)/.test(pageSrc), 'page: posse por-aba (sessionStorage) na fila');
ok(/persistQueueItemAudios/.test(pageSrc), 'page: áudio (File) vai pro IndexedDB JÁ no enfileirar');
ok(/planQueueRehydration\(/.test(pageSrc), 'page: classificação anti-duplicação na re-hidratação');
ok(/recoverFromMirror\(/.test(pageSrc), 'page: recupera videoIds do espelho compartilhado');
ok(/skipFailed/.test(pageSrc), 'page: auto-continuação pula faileds (re-disparo é decisão do user)');
// resumeVideoIds precisa ser passado nos DOIS caminhos: RETOMAR avulso E
// processQueue (senão "Processar fila" re-disparava item pausado — custo em dobro).
const resumePassCount = (pageSrc.match(/resumeVideoIds: item\.videoIds && item\.videoIds\.length > 0 \? item\.videoIds : undefined/g) || []).length;
ok(resumePassCount >= 2, `page: resumeVideoIds passado no Retomar E no processQueue (${resumePassCount}/2) — nunca re-dispara item já disparado`);
ok(/listQueueAudioProtectIds/.test(zipStoreSrc), 'zip-store: faxina protege áudios de fila pendente (qualquer caller)');
ok(pruneSrc.includes('^hgaq:(.+):audio:'), 'prune: zipGroupId agrupa hgaq:<itemId>:audio:<n> pelo itemId');

console.log(`\n${fail === 0 ? '✓' : '✗'} heygen-queue-store (persistência da fila): ${pass} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
