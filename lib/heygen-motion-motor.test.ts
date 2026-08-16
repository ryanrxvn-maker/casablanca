/**
 * Testes do backstop de motor do Apply Custom Motion.
 *
 * O que precisa ficar provado: cena que pede gesto NUNCA sai no Avatar III
 * (que descarta motion e devolve um take parado sem reclamar), e cena sem
 * gesto continua no motor que o user escolheu — o III é mais barato e o
 * disparo do B2C não pode encarecer sozinho.
 */
import { motorEfetivo } from './heygen-motion-motor';

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`); fails++; }
  else console.log(`ok   ${label}`);
}

const MOTION = 'mexe a gelatina 2x no começo e segue falando';

// ── com gesto: III SEMPRE sobe (é o bug que isso existe pra matar) ──
eq(motorEfetivo('III', MOTION), 'IV', 'cena com gesto sobe do III pro IV sozinha');
eq(motorEfetivo('IV', MOTION), 'IV', 'IV com gesto continua IV');
eq(motorEfetivo('V', MOTION), 'V', 'V aceita motion — não rebaixa pro IV');

// ── sem gesto: nada muda (não encarecer disparo parado) ──
eq(motorEfetivo('III', null), 'III', 'sem gesto (null) fica no III, que é mais barato');
eq(motorEfetivo('III', undefined), 'III', 'sem gesto (ausente) fica no III');
eq(motorEfetivo('III', ''), 'III', 'string vazia não liga movimento');
eq(motorEfetivo('III', '   \n  '), 'III', 'só espaço em branco não liga movimento');
eq(motorEfetivo('IV', ''), 'IV', 'sem gesto respeita o IV escolhido pelo user');
eq(motorEfetivo('V', null), 'V', 'sem gesto respeita o V escolhido pelo user');

// ── prompt com espaço nas pontas ainda é gesto de verdade ──
eq(motorEfetivo('III', `  ${MOTION}  `), 'IV', 'prompt com espaço nas pontas ainda sobe pro IV');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
