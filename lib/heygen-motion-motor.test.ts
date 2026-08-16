/**
 * Testes do backstop de motor do Apply Custom Motion.
 *
 * O que precisa ficar provado: cena que pede gesto NUNCA sai no Avatar III
 * (que descarta motion e devolve um take parado sem reclamar), e cena sem
 * gesto continua no motor que o user escolheu — o III é mais barato e o
 * disparo do B2C não pode encarecer sozinho.
 */
import { motorEfetivo, takeUnicoPorLook } from './heygen-motion-motor';

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

// ── TAKE ÚNICO POR LOOK: fora do III, picotar cobra 6 créditos POR pedaço e
//    faz o avatar refazer o gesto a cada corte. No lote WL PL (16/08) isso era
//    a diferença entre 27 e 8 gerações no mesmo material.
{
  const takeUnico = takeUnicoPorLook;
  eq(takeUnico({ engine: 'III' }), false, 'III puro continua picotado (take barato, corte ajuda a montagem)');
  eq(takeUnico({ engine: 'III', motionPrompt: MOTION }), true, 'gesto sobe pro IV → take único');
  eq(takeUnico({ engine: 'IV' }), true, 'IV escolhido na mão → take único mesmo sem gesto');
  eq(takeUnico({ engine: 'V' }), true, 'V → take único');
  eq(takeUnico({ imageMode: true }), true, 'modo imagem → take único (cada geração re-envia a imagem)');
  eq(takeUnico({ engine: 'III', imageMode: true }), true, 'modo imagem vence o III');
  // espaço em branco não é gesto: não pode encarecer a cena à toa
  eq(takeUnico({ engine: 'III', motionPrompt: '   ' }), false, 'prompt vazio NÃO vira take único');
  eq(takeUnico({}), false, 'sem nada declarado = III = picotado (default seguro)');
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
