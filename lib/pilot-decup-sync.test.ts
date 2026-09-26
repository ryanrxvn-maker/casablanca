/**
 * Gate da PARTE decupada (26.09.2026). O corte de BODY 1/BODY 2 do AD129VN-PRPB07
 * (e de BODY 1/BODY 8 do AD128GL) saiu com a faixa de VÍDEO 3-4x mais longa que
 * a de ÁUDIO — o resto era imagem congelada e muda — e a montagem entregou 80s
 * parados com o card em PRONTO. Os números abaixo são os medidos nos clipes
 * reais do cache (114 decupados: 4 tortos, 110 bons).
 *
 *   npx tsx lib/pilot-decup-sync.test.ts
 */
import { avForaDeSincronia } from './clickup-pilot-pipeline';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ok  ${msg}`);
  else { failures++; console.error(`  FAIL ${msg}`); }
}

console.log('# parte decupada com vídeo sobrando reprova');
for (const [nome, s] of [
  ['AD129 BODY 1', { videoSec: 58.54875, audioSec: 15.583333333333334 }],
  ['AD129 BODY 2', { videoSec: 53.67375, audioSec: 14.296333333333333 }],
  ['AD128 BODY 1', { videoSec: 68.05125, audioSec: 18.066333333333333 }],
  ['AD128 BODY 8', { videoSec: 49.8975, audioSec: 13.247333333333334 }],
] as const) {
  assert(avForaDeSincronia(s), `${nome} (v=${s.videoSec.toFixed(1)}s a=${s.audioSec.toFixed(1)}s) reprova`);
}

console.log('# parte boa continua passando (NAO DESFAZER O QUE FUNCIONA)');
for (const [nome, s] of [
  ['AD129 BODY 3 decupado', { videoSec: 15.56, audioSec: 15.605333333333334 }],
  ['AD129 HOOK 1 decupado', { videoSec: 4.12, audioSec: 4.165333333333334 }],
  ['AD129 BODY 4 nivelado', { videoSec: 20.36, audioSec: 20.381333333333334 }],
  ['cauda natural de 0.45s', { videoSec: 30, audioSec: 30.45 }],
  ['AD longo, 2% de cauda', { videoSec: 240, audioSec: 244.5 }],
] as const) {
  assert(!avForaDeSincronia(s), `${nome} passa`);
}
assert(!avForaDeSincronia(null), 'sem medida (null) nunca reprova');

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} assert(s) falharam`);
  process.exit(1);
} else {
  console.log('✓ todos os asserts passaram');
}
