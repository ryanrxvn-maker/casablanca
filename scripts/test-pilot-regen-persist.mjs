// Trava de código-fonte (26.09.2026): re-gerar UM take tem que reivindicar a
// task antes de mexer no estado. Task restaurada fica em recoveredBatchIdsRef
// (só-leitura nesta aba) e o persist pula ela — sem reivindicar, o texto e o
// vídeo novos do take nunca eram gravados e um F5 devolvia o plano velho
// (AD130/AD131-PRPB07). O desenho só-leitura continua valendo pro resto.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/tools/clickup-pilot/page.tsx', 'utf8');

function corpoDa(nome) {
  const ini = src.indexOf(`async function ${nome}(`);
  assert.ok(ini >= 0, `função ${nome} não encontrada`);
  const fim = src.indexOf('\n  async function ', ini + 10);
  return src.slice(ini, fim > ini ? fim : undefined);
}

for (const nome of ['regenerateSinglePart', 'regenerateSinglePartFromAudio']) {
  test(`${nome} reivindica a task antes de mudar o estado`, () => {
    const corpo = corpoDa(nome);
    const claim = corpo.indexOf('recoveredBatchIdsRef.current.delete(taskId)');
    const primeiroSet = corpo.indexOf('setBatchStates(');
    assert.ok(claim >= 0, `${nome} não tira a task de recoveredBatchIdsRef`);
    assert.ok(primeiroSet > claim, `${nome} muda o estado ANTES de reivindicar a task`);
  });
}

test('persist continua pulando task não reivindicada (desenho só-leitura intacto)', () => {
  assert.match(src, /filter\(\(\[id\]\) => !recoveredBatchIdsRef\.current\.has\(id\)\)/);
});
