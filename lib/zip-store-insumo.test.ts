/**
 * O FRAME do modo imagem é INSUMO do disparo — não pode ser varrido por nenhum
 * caminho de limpeza enquanto a cena ainda precisa dele.
 *
 * Dois caminhos comeram o frame em 16/08, com sintomas idênticos e horas de
 * caça no meio ("re-disparando 1 parte" sem nada acontecer):
 *   1. a FAXINA (zipGroupId não conhecia `:img:` → grupo " misc " próprio, fora
 *      da proteção do disparo);
 *   2. a PURGA POR GERAÇÃO (`deletePrefix('pilot:<task>:')` levava o frame
 *      junto com os takes velhos, logo ANTES de o disparo tentar usá-lo).
 *
 * Take velho tem que sumir mesmo. Frame, não.
 */
import { zipGroupId, planZipEviction } from './zip-store-prune';
import { INSUMO_DO_DISPARO } from './zip-store';

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`); fails++; }
  else console.log(`ok   ${label}`);
}

const T = '868knk3e8';

// (1) FAXINA: o frame pertence ao disparo, não a um grupo solto.
eq(zipGroupId(`pilot:${T}:img:0`), T, 'frame entra no grupo do disparo (não vira " misc ")');
eq(zipGroupId(`pilot:${T}:img:0`), zipGroupId(`pilot:${T}:part:HOOK 1`), 'frame e take do mesmo disparo = mesmo grupo');
eq(zipGroupId(`pilot:${T}:g:abc:img:2`), T, 'frame com genId também agrupa certo');

// e, agrupado, o frame é protegido junto com o disparo ativo
{
  const agora = Date.now();
  const velho = agora - 40 * 60 * 60 * 1000; // 40h: fora de qualquer janela
  const metas = [
    { key: `pilot:${T}:img:0`, size: 300_000, createdAt: velho },
    { key: `pilot:${T}:part:HOOK 1`, size: 2_000_000, createdAt: velho },
  ];
  const plano = planZipEviction(metas, { protect: [T], keepGroups: 0, minAgeMs: 0 });
  eq(plano.evictKeys.length, 0, 'disparo protegido não perde nem o frame nem o take');

  // sem proteção, o disparo velho sai INTEIRO — frame junto, como deve ser
  const plano2 = planZipEviction(metas, { keepGroups: 0, minAgeMs: 0 });
  eq(plano2.evictKeys.length, 2, 'disparo velho e desprotegido sai inteiro (frame não vira lixo órfão)');
}

// (2) PURGA POR GERAÇÃO: o regex de exceção pega frame e só frame.
eq(INSUMO_DO_DISPARO.test(`pilot:${T}:img:0`), true, 'purga preserva o frame');
eq(INSUMO_DO_DISPARO.test(`pilot:${T}:g:abc:img:2`), true, 'preserva o frame também com genId');
eq(INSUMO_DO_DISPARO.test(`pilot:${T}:part:BODY 1`), false, 'take velho continua sendo purgado');
eq(INSUMO_DO_DISPARO.test(`pilot:${T}:leveled:BODY 1`), false, 'clip derivado continua sendo purgado');
eq(INSUMO_DO_DISPARO.test(`pilot:${T}:decupado:BODY 1@k0.04`), false, 'decupado continua sendo purgado');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
