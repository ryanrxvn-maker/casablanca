/**
 * Testes da AFINAÇÃO de tempos (asr-tempo.ts).
 *
 * A queixa que originou isto: "as vezes bate um pouco no tempo errado a
 * legenda". As regras são covardes por contrato — cada teste aqui garante
 * tanto o conserto quanto a covardia (nada anda mais que SNAP_MS, nada
 * muda de ordem, nada some).
 */
import { afinarTempos, SNAP_MS } from './asr-tempo';
import type { Span } from './asr-gaps';
import type { TWord } from './engine';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  x FALHOU: ' + msg); }
}

const w = (text: string, start: number, end: number): TWord => ({ text, start, end });

console.log('\n-- palavra que nasce cedo demais --');
{
  // fala começa em 1000; Whisper deu start 850 (150ms no silêncio)
  const fala: Span[] = [{ start: 1000, end: 3000 }];
  const r = afinarTempos([w('oi', 850, 1400)], fala);
  ok(r[0].start === 1000, `start puxado pro início da voz (${r[0].start})`);
  ok(r[0].end === 1400, 'end fica onde estava');
}

console.log('\n-- palavra que morre tarde demais --');
{
  // fala termina em 2000; Whisper esticou o end até 2200
  const fala: Span[] = [{ start: 500, end: 2000 }];
  const r = afinarTempos([w('fim', 1500, 2200)], fala);
  ok(r[0].end === 2000, `end puxado pro fim da voz (${r[0].end})`);
  ok(r[0].start === 1500, 'start fica onde estava');
}

console.log('\n-- covardia: longe demais, não mexe --');
{
  const fala: Span[] = [{ start: 2000, end: 3000 }];
  // start 400ms antes da voz: fora do alcance do snap → intacto
  const r = afinarTempos([w('x', 1600, 2500)], fala);
  ok(r[0].start === 1600, `start fora do alcance fica intacto (${r[0].start})`);
  const dentro = afinarTempos([w('x', 2000 - SNAP_MS, 2500)], fala);
  ok(dentro[0].start === 2000, 'no limite exato do alcance ainda encosta');
}

console.log('\n-- start dentro da fala nunca é mexido --');
{
  const fala: Span[] = [{ start: 0, end: 5000 }];
  const r = afinarTempos([w('a', 100, 500), w('b', 600, 900)], fala);
  ok(r[0].start === 100 && r[1].start === 600, 'palavras dentro da voz ficam como vieram');
}

console.log('\n-- ordem e sobreposição --');
{
  const fala: Span[] = [{ start: 0, end: 10000 }];
  // segunda palavra começa ANTES do fim da primeira (overlap do ASR)
  const r = afinarTempos([w('a', 0, 800), w('b', 700, 1200)], fala);
  ok(r[1].start >= r[0].end, `overlap removido (b começa em ${r[1].start})`);
  ok(r[1].end > r[1].start, 'e a palavra continua com duração');
}

console.log('\n-- nenhuma palavra some nem troca de texto --');
{
  const fala: Span[] = [
    { start: 300, end: 1400 },
    { start: 2000, end: 4000 },
  ];
  const antes = [w('um', 250, 700), w('dois', 800, 1500), w('tres', 1900, 2600)];
  const r = afinarTempos(antes, fala);
  ok(r.length === antes.length, 'mesmo número de palavras');
  ok(r.map((x) => x.text).join(' ') === 'um dois tres', 'mesmos textos na mesma ordem');
  ok(r.every((x, i) => Math.abs(x.start - antes[i].start) <= SNAP_MS + 1), 'nenhum start andou mais que o alcance');
  ok(r.every((x) => x.end > x.start), 'toda palavra tem duração positiva');
  ok(r.every((x, i) => i === 0 || x.start >= r[i - 1].end), 'sequência monotônica');
}

console.log('\n-- casos degenerados --');
{
  ok(afinarTempos([], [{ start: 0, end: 100 }]).length === 0, 'lista vazia devolve vazia');
  const semFala = afinarTempos([w('a', 10, 200)], []);
  ok(semFala[0].start === 10 && semFala[0].end === 200, 'sem spans de fala, nada muda');
  const zero = afinarTempos([w('a', 500, 500)], []);
  ok(zero[0].end > zero[0].start, 'palavra de duração zero ganha o mínimo');
}

if (falhas > 0) { console.error(`\n${falhas} FALHA(S)`); process.exit(1); }
console.log('\nOK asr-tempo: tudo passou');
