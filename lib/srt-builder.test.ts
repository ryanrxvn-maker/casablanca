/**
 * GARANTIA — SRT montado a partir da copy + palavras da transcrição (11.10).
 *
 * Visto ao vivo: com áudio quase sem fala (silêncio/música), a transcrição
 * devolve 2-3 palavras "inventadas" no fim e o SRT saía com o texto fora de
 * ordem ("Esse legenda." / "é um texto ... para" / "gerar a") e legendas
 * sobrepostas. Regras: a ordem do texto é SEMPRE a da copy e uma legenda
 * nunca começa antes da anterior terminar.
 */
import { buildSrtFromCopyAndWords, type Word } from './srt-builder';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.error('  FAIL', msg); }
}

type Cue = { start: number; end: number; text: string };
function parse(srt: string): Cue[] {
  const toMs = (t: string) => {
    const m = /(\d+):(\d+):(\d+),(\d+)/.exec(t)!;
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
  };
  return srt.trim().split(/\r?\n\r?\n/).filter(Boolean).map((b) => {
    const lines = b.split(/\r?\n/);
    const [a, z] = lines[1].split(' --> ');
    return { start: toMs(a), end: toMs(z), text: lines.slice(2).join(' ') };
  });
}
const palavras = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ');

function invariantes(nome: string, copy: string, words: Word[]) {
  const cues = parse(buildSrtFromCopyAndWords(copy, words, 'single'));
  ok(cues.length > 0, `${nome}: gerou legendas`);
  ok(palavras(cues.map((c) => c.text).join(' ')).join(' ') === palavras(copy).join(' '), `${nome}: texto na MESMA ordem da copy`);
  let sobreposta = 0;
  let foraDeOrdem = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].end <= cues[i].start) foraDeOrdem++;
    if (i > 0 && cues[i].start < cues[i - 1].end) sobreposta++;
    if (i > 0 && cues[i].start < cues[i - 1].start) foraDeOrdem++;
  }
  ok(sobreposta === 0, `${nome}: nenhuma legenda sobreposta (${sobreposta})`);
  ok(foraDeOrdem === 0, `${nome}: tempos sempre andando pra frente (${foraDeOrdem})`);
  return cues;
}

console.log('\nGARANTIA — SRT da copy');

const copy = 'Esse é um texto de teste da auditoria para gerar a legenda.';

// 1) Fala normal: cada palavra da copy aparece na transcrição, em ordem.
{
  const ws = palavras(copy).map((w, i) => ({ text: w.replace(/[.,]/g, ''), start: 500 + i * 400, end: 500 + i * 400 + 320 }));
  const cues = invariantes('fala normal', copy, ws);
  ok(cues[0].start === 500, 'fala normal: começa na 1ª palavra falada');
}

// 2) Áudio sem fala: a transcrição "inventa" 3 palavras no fim do arquivo.
invariantes('silêncio com palavras inventadas no fim', copy, [
  { text: 'legenda', start: 29260, end: 29600 },
  { text: 'a', start: 29700, end: 29800 },
  { text: 'gerar', start: 29850, end: 30060 },
]);

// 3) Transcrição pula metade da copy (fala rápida/abafada).
{
  const ws = palavras(copy).filter((_, i) => i % 2 === 0).map((w, i) => ({ text: w.replace(/[.,]/g, ''), start: 1000 + i * 700, end: 1000 + i * 700 + 500 }));
  invariantes('transcrição pela metade', copy, ws);
}

// 4) Copy com 2 frases e transcrição com uma palavra a mais no meio.
{
  const c2 = 'Primeira frase curta aqui. Segunda frase vem logo depois, sem pausa.';
  const ts = ['primeira', 'frase', 'curta', 'aqui', 'é', 'segunda', 'frase', 'vem', 'logo', 'depois', 'sem', 'pausa'];
  invariantes('palavra extra no meio', c2, ts.map((w, i) => ({ text: w, start: 200 + i * 350, end: 200 + i * 350 + 300 })));
}

// 5) Frases curtas que a transcrição marca no MESMO instante (o "mínimo de
//    leitura" de uma passava por cima da próxima).
invariantes('frases no mesmo instante', 'Sim. Não. Talvez.', [
  { text: 'sim', start: 1000, end: 1000 },
  { text: 'não', start: 1000, end: 1000 },
  { text: 'talvez', start: 1000, end: 1000 },
]);

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail) process.exit(1);
