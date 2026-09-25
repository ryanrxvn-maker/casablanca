/**
 * GARANTIA do FORMATO do disparo (9:16 × 16:9) no Pilot.
 *
 * O que isto blinda:
 *  (a) PADRÃO INTOCADO: sem escolha (ou com lixo no storage) tudo continua 9:16
 *      e o filtro da montagem é BYTE A BYTE o que existia antes;
 *  (b) 16:9 DE VERDADE: landscape no HeyGen e 1920x1080 na montagem;
 *  (c) SEM MISTURA: geração já disparada segue o carimbo, nunca o botão.
 */
import {
  FORMATO_PADRAO,
  FORMATOS,
  normalizarFormato,
  orientacaoHeyGen,
  dimensoesDoFormato,
  filtroDeEnquadramento,
  formatoDaGeracao,
  formatoDoNovoDisparo,
  rotuloDoFormato,
} from './pilot-formato';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ', msg); }
  else { fail++; console.error('  FAIL', msg); }
}

// O filtro que concatAvatarParts/normalizeForConcat usavam fixo até hoje.
const FILTRO_ANTIGO = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';

console.log('\n(a) padrão intocado:');
ok(FORMATO_PADRAO === '9:16', 'padrão é 9:16');
for (const lixo of [undefined, null, '', '16x9', '9:16 ', 'landscape', 169, {}, '1:1']) {
  ok(normalizarFormato(lixo) === '9:16', `normalizarFormato(${JSON.stringify(lixo)}) = 9:16`);
}
ok(orientacaoHeyGen(undefined) === 'portrait', 'sem formato → portrait (o de sempre)');
ok(filtroDeEnquadramento(undefined) === FILTRO_ANTIGO, 'sem formato → filtro IDÊNTICO ao antigo');
ok(filtroDeEnquadramento('9:16') === FILTRO_ANTIGO, '9:16 → filtro IDÊNTICO ao antigo');
ok(dimensoesDoFormato('9:16').w === 1080 && dimensoesDoFormato('9:16').h === 1920, '9:16 = 1080x1920');

console.log('\n(b) 16:9 de verdade:');
ok(normalizarFormato('16:9') === '16:9', '16:9 reconhecido');
ok(orientacaoHeyGen('16:9') === 'landscape', '16:9 → landscape no HeyGen');
ok(dimensoesDoFormato('16:9').w === 1920 && dimensoesDoFormato('16:9').h === 1080, '16:9 = 1920x1080');
ok(
  filtroDeEnquadramento('16:9') === 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
  '16:9 → monta em 1920x1080 sem cortar pra caber em pé',
);
ok(FORMATOS.length === 2 && FORMATOS[0] === '9:16' && FORMATOS[1] === '16:9', 'botão oferece exatamente 9:16 e 16:9');
ok(rotuloDoFormato('16:9').startsWith('16:9') && rotuloDoFormato(undefined).startsWith('9:16'), 'rótulos');

console.log('\n(c) sem mistura de formato num mesmo AD:');
ok(formatoDaGeracao(undefined) === '9:16', 'geração antiga (sem carimbo) = 9:16, mesmo com o botão em 16:9');
ok(formatoDaGeracao('16:9') === '16:9', 'geração 16:9 retoma em 16:9');
ok(formatoDaGeracao('9:16') === '9:16', 'geração 9:16 retoma em 9:16');
ok(formatoDoNovoDisparo(undefined, '16:9') === '16:9', 'disparo novo sem carimbo usa o botão (16:9)');
ok(formatoDoNovoDisparo(undefined, undefined) === '9:16', 'disparo novo sem carimbo nem botão = 9:16');
ok(formatoDoNovoDisparo('9:16', '16:9') === '9:16', 'carimbo do enfileiramento vence o botão');
ok(formatoDoNovoDisparo('16:9', '9:16') === '16:9', 'carimbo 16:9 vence o botão em 9:16');
ok(formatoDoNovoDisparo('lixo', '16:9') === '16:9', 'carimbo inválido cai no botão');

console.log(`\npilot-formato: ${pass} ok, ${fail} falha(s)`);
if (fail > 0) process.exit(1);
