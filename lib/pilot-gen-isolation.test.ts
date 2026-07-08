/**
 * Trava as invariantes da ISOLAÇÃO POR GERAÇÃO do ClickUp Pilot.
 * Ver [[project_disparo_genid_isolacao]] / lib/pilot-gen-isolation.ts.
 *
 * O bug que isto blinda: RETOMAR após F5 montava embaralhando takes de uma
 * GERAÇÃO ANTERIOR (avatar antigo) com a atual, porque a chave do IndexedDB era
 * (taskId, label) — a MESMA em toda re-geração do AD. Estes testes garantem que
 * duas gerações NUNCA compartilham chave, que o purge do disparo do zero apaga
 * TODAS as gerações, e que batch legado (sem genId) mantém a chave antiga.
 */
import { newPilotGenId, pilotGenPrefix, pilotPartKey } from './pilot-gen-isolation';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

console.log('\nGARANTIA — isolação por geração do Pilot (nunca embaralhar avatares):');

const TASK = '868xyz';
const LABEL = 'HOOK 1';

// (1) genIds distintos ⇒ chaves NUNCA colidem — nenhuma leitura cruza gerações.
{
  const gA = 'aaa111';
  const gB = 'bbb222';
  ok(
    pilotPartKey(TASK, gA, LABEL) !== pilotPartKey(TASK, gB, LABEL),
    'genIds distintos geram chaves de take distintas (não cruza gerações)',
  );
  ok(
    pilotGenPrefix(TASK, gA) !== pilotGenPrefix(TASK, gB),
    'genIds distintos geram prefixos distintos',
  );
}

// (2) QUALQUER prefixo de geração começa com o prefixo-base `pilot:<taskId>:`
//     → o purge do disparo do zero (deletePrefix('pilot:<taskId>:')) apaga
//     TODAS as gerações + o legado de uma vez.
{
  const base = pilotGenPrefix(TASK); // sem genId = base
  ok(base === `pilot:${TASK}:`, 'prefixo-base é pilot:<taskId>: (o que o purge usa)');
  const g1 = pilotGenPrefix(TASK, 'g1');
  const g2 = pilotGenPrefix(TASK, 'g2');
  ok(g1.startsWith(base) && g2.startsWith(base), 'todo prefixo de geração começa com o prefixo-base (purge pega todas)');
  ok(pilotPartKey(TASK, 'g1', LABEL).startsWith(base), 'chave de take também cai sob o prefixo-base (purge alcança)');
}

// (3) genId ausente ⇒ chave IDÊNTICA ao formato antigo (compat total, sem
//     regressão pra batches disparados antes do fix / mid-flight no deploy).
{
  ok(
    pilotPartKey(TASK, undefined, LABEL) === `pilot:${TASK}:part:${LABEL}`,
    'genId undefined = chave legada pilot:<taskId>:part:<label> (compat)',
  );
  ok(
    pilotPartKey(TASK, null, LABEL) === `pilot:${TASK}:part:${LABEL}`,
    'genId null = chave legada (compat)',
  );
  ok(
    pilotGenPrefix(TASK, undefined) === `pilot:${TASK}:`,
    'prefixo legado = pilot:<taskId>: (idêntico ao base)',
  );
}

// (4) newPilotGenId é único mesmo em rajada (ms + nonce) — 5000 chamadas seguidas.
{
  const N = 5000;
  const ids = new Set<string>();
  for (let i = 0; i < N; i++) ids.add(newPilotGenId());
  ok(ids.size === N, `${N} genIds seguidos são todos distintos (${ids.size}/${N})`);
}

// (5) O separador `:` protege contra colisão de prefixo textual entre ids: a
//     chave da task "123" NÃO pode ser apagada por um purge da task "12".
{
  const purge12 = pilotGenPrefix('12');       // 'pilot:12:'
  const key123 = pilotPartKey('123', 'gX', LABEL); // 'pilot:123:g:gX:part:...'
  ok(!key123.startsWith(purge12), 'purge da task "12" NÃO alcança chaves da task "123" (separador : protege)');
  const key12 = pilotPartKey('12', 'gX', LABEL);
  ok(key12.startsWith(purge12), 'purge da task "12" alcança as próprias chaves da "12"');
}

// (6) Sanidade: chave de take de geração leva o segmento :g:<genId>: no meio.
{
  ok(
    pilotPartKey(TASK, 'zzz', LABEL) === `pilot:${TASK}:g:zzz:part:${LABEL}`,
    'chave de take de geração tem o formato pilot:<taskId>:g:<genId>:part:<label>',
  );
}

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-gen-isolation: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
