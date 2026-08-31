/**
 * Testes do detector de BURACO NA LEGENDA.
 *
 * Pergunta do Silas (31.08) olhando um vão no meio da timeline: "o que
 * aconteceu que veio faltando legenda? foi a detecção ou era silêncio mesmo?"
 * — a ferramenta não sabia responder. Agora sabe, medindo a fala do arquivo.
 */
import type { TWord } from './engine';
import {
  describeGaps,
  findAsrGaps,
  gapWindow,
  maskToSpans,
  mergeSpans,
  overlapMs,
  spliceRecovered,
  type Span,
} from './asr-gaps';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

function w(text: string, start: number, end: number): TWord {
  return { text, start, end };
}
/** fala contínua de a até b */
function fala(a: number, b: number): Span {
  return { start: a, end: b };
}

console.log('\n── utilitários ──');
{
  ok(
    JSON.stringify(mergeSpans([fala(0, 100), fala(90, 200), fala(500, 600)])) ===
      JSON.stringify([{ start: 0, end: 200 }, { start: 500, end: 600 }]),
    'mergeSpans junta o que se toca e mantém o resto',
  );
  ok(mergeSpans([]).length === 0, 'lista vazia não quebra');
  ok(mergeSpans([fala(50, 50)]).length === 0, 'intervalo de duração zero é descartado');
  ok(overlapMs([fala(0, 1000)], 500, 2000) === 500, 'overlapMs mede a interseção');
  ok(overlapMs([fala(0, 100)], 500, 600) === 0, 'sem interseção dá zero');
}
{
  const mask = new Uint8Array([0, 1, 1, 0, 0, 1, 0]);
  const spans = maskToSpans(mask, 0.01);
  ok(
    JSON.stringify(spans) === JSON.stringify([{ start: 10, end: 30 }, { start: 50, end: 60 }]),
    'maskToSpans converte frames de 10ms em intervalos',
  );
  ok(maskToSpans(new Uint8Array([1, 1]), 0.01)[0].end === 20, 'máscara que termina em fala fecha no fim');
  ok(maskToSpans(new Uint8Array([]), 0.01).length === 0, 'máscara vazia = nada');
}

console.log('\n── buraco COM voz = falha do reconhecimento ──');
{
  // 0..3s falado, 3..40s de VOZ sem palavra nenhuma, 40..45s falado
  const words = [w('um', 0, 500), w('dois', 600, 1200), w('tres', 1300, 3000),
                 w('fim', 40000, 40600), w('mesmo', 40700, 45000)];
  const speech = [fala(0, 45000)];
  const gaps = findAsrGaps(words, speech, 45000);
  ok(gaps.length === 1, `achou exatamente 1 vão (achou ${gaps.length})`);
  ok(gaps[0].kind === 'falha', 'classificou como FALHA do reconhecimento (tem voz e não tem palavra)');
  ok(gaps[0].start === 3000 && gaps[0].end === 40000, 'o vão vai do fim da última palavra ao começo da próxima');
  ok(gaps[0].speechMs === 37000, 'e mede quanta voz tem lá dentro');
}

console.log('\n── buraco SEM voz = silêncio de verdade ──');
{
  const words = [w('um', 0, 900), w('dois', 30000, 31000)];
  const speech = [fala(0, 900), fala(30000, 31000)]; // nada no meio
  const gaps = findAsrGaps(words, speech, 31000);
  ok(gaps.length === 1 && gaps[0].kind === 'silencio', 'vão sem voz é silêncio, não falha');
  ok(gaps[0].speechMs === 0, 'e a medição confirma: zero voz');
}
{
  // meio-termo: um pigarro curto no meio de 20s de vão NÃO vira falha
  const words = [w('um', 0, 900), w('dois', 21000, 22000)];
  const speech = [fala(0, 900), fala(10000, 10250), fala(21000, 22000)];
  const gaps = findAsrGaps(words, speech, 22000);
  ok(gaps[0].kind === 'silencio', 'ruidinho de 250ms em 20s de vão continua sendo silêncio');
}
{
  // fala curta mas DENSA: 1,4s de vão com 1,2s de voz é falha
  const words = [w('um', 0, 900), w('dois', 2300, 3000)];
  const speech = [fala(0, 900), fala(950, 2150), fala(2300, 3000)];
  const gaps = findAsrGaps(words, speech, 3000);
  ok(gaps.length === 1 && gaps[0].kind === 'falha', 'vão curto mas cheio de voz é falha');
}

console.log('\n── pontas: começo e fim do vídeo ──');
{
  // o Whisper comeu os primeiros 8s
  const words = [w('tarde', 8000, 8600), w('demais', 8700, 12000)];
  const gaps = findAsrGaps(words, [fala(0, 12000)], 12000);
  ok(gaps.some((g) => g.start === 0 && g.kind === 'falha'), 'o começo sem palavra é um vão detectado');
}
{
  // e comeu a cauda
  const words = [w('so', 0, 500), w('inicio', 600, 4000)];
  const gaps = findAsrGaps(words, [fala(0, 60000)], 60000);
  ok(gaps.some((g) => g.end === 60000 && g.kind === 'falha'), 'a cauda comida também aparece');
}
{
  const gaps = findAsrGaps([w('a', 0, 1000)], [fala(0, 1000)], 1000);
  ok(gaps.length === 0, 'transcrição que cobre tudo não acusa vão nenhum');
}
{
  const gaps = findAsrGaps([], [fala(0, 5000)], 5000);
  ok(gaps.length === 1 && gaps[0].kind === 'falha', 'transcrição VAZIA em vídeo falado é um vão só, e é falha');
}

console.log('\n── respiro curto entre palavras NÃO é buraco ──');
{
  const words = [w('um', 0, 400), w('dois', 620, 1000), w('tres', 1250, 1800)];
  const gaps = findAsrGaps(words, [fala(0, 1800)], 1800);
  ok(gaps.length === 0, 'pausas normais de fala (200ms) não viram vão');
}

console.log('\n── janela de recuperação ──');
{
  const win = gapWindow({ start: 5000, end: 9000 }, 60000, 900);
  ok(win.start === 4100 && win.end === 9900, 'a janela ganha folga dos dois lados (contexto pro Whisper)');
  const naBorda = gapWindow({ start: 0, end: 2000 }, 60000, 900);
  ok(naBorda.start === 0, 'na borda de início não passa de 0');
  const noFim = gapWindow({ start: 58000, end: 60000 }, 60000, 900);
  ok(noFim.end === 60000, 'na borda de fim não passa da duração');
}

console.log('\n── costurar o que foi recuperado ──');
{
  const base = [w('antes', 0, 1000), w('depois', 9000, 10000)];
  const gap = { start: 1000, end: 9000 };
  // o recorte começou em 100ms (janela com folga) — tempos vêm relativos a ele
  const recuperadas = [w('meio', 1200, 1800), w('do', 1900, 2200), w('video', 2300, 3000)];
  const r = spliceRecovered(base, recuperadas, gap, 100);
  ok(r.added === 3, 'as 3 palavras recuperadas entraram');
  ok(r.words.length === 5, 'a lista final tem as 5');
  ok(
    r.words.map((x) => x.text).join(' ') === 'antes meio do video depois',
    'e saíram na ORDEM certa do vídeo',
  );
  ok(r.words[1].start === 1300, 'o tempo foi deslocado pelo início da janela');
  let ordenado = true;
  for (let i = 1; i < r.words.length; i++) if (r.words[i].start < r.words[i - 1].start) ordenado = false;
  ok(ordenado, 'nenhuma palavra fora de ordem');
}
{
  // o que veio da FOLGA (fora do buraco) não pode duplicar o que já existia
  const base = [w('antes', 0, 1000), w('depois', 9000, 10000)];
  const gap = { start: 1000, end: 9000 };
  const recuperadas = [w('antes', 0, 1000), w('meio', 3000, 3500), w('depois', 9000, 10000)];
  const r = spliceRecovered(base, recuperadas, gap, 0);
  ok(r.added === 1, 'só a palavra do buraco entrou (as da folga foram descartadas)');
  ok(r.words.filter((x) => x.text === 'antes').length === 1, '"antes" não duplicou');
  ok(r.words.filter((x) => x.text === 'depois').length === 1, '"depois" não duplicou');
}
{
  // recuperada que INVADE o tempo de uma palavra existente é descartada
  const base = [w('ja', 5000, 6000)];
  const gap = { start: 1000, end: 9000 };
  const r = spliceRecovered(base, [w('conflito', 5500, 5800)], gap, 0);
  ok(r.added === 0 && r.words.length === 1, 'palavra que pisa em cima de outra não entra');
}
{
  const base = [w('a', 0, 100)];
  const r = spliceRecovered(base, [], { start: 200, end: 900 }, 0);
  ok(r.added === 0 && r.words === base, 'nada recuperado devolve a lista original intacta');
  const so = spliceRecovered(base, [w('   ', 300, 400)], { start: 200, end: 900 }, 0);
  ok(so.added === 0, 'palavra só de espaço não conta');
}

console.log('\n── resumo pra tela ──');
{
  const gaps = [
    { start: 0, end: 2000, speechMs: 1800, kind: 'falha' as const },
    { start: 5000, end: 9000, speechMs: 0, kind: 'silencio' as const },
    { start: 20000, end: 30000, speechMs: 9000, kind: 'falha' as const },
  ];
  const d = describeGaps(gaps);
  ok(d.falhas.length === 2 && d.silencios.length === 1, 'separa falha de silêncio');
  ok(d.totalFalhaMs === 12000, 'soma só o tempo das falhas');
  ok(describeGaps([]).totalFalhaMs === 0, 'sem vão nenhum, zero');
}

console.log(falhas === 0 ? '\n✅ asr-gaps: tudo passou' : `\n❌ asr-gaps: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
