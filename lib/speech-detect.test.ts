/**
 * Testes do detector de FALA (o motor novo da Decupagem).
 *
 * O que precisa ficar garantido, pra sempre:
 *   1. voz (sinal periódico) é fala — em volume alto E em volume baixo;
 *   2. respiração/ar (ruído de banda larga, −35 dBFS) NÃO é fala — era o buraco
 *      do detector antigo, que só olhava energia e deixava tudo passar;
 *   3. silêncio de verdade não é fala;
 *   4. o corte encurta as pausas SEM tocar na voz;
 *   5. `keepSilence` maior deixa mais pausa (o controle da UI faz o que promete);
 *   6. CONSOANTE SURDA no fim da palavra sobrevive — o defeito de 24.08, em que
 *      "internet" saía "interne" e "horas" saía "hora". Consoante surda não tem F0
 *      e é 25 dB mais fraca que a vogal: quem decide por periodicidade+energia a
 *      trata como pausa e o corte come o fim da palavra;
 *   7. o INVARIANTE do laudo: `audit.speechRemovedSec === 0` em todo plano.
 */
import {
  extractFeatures,
  detectSpeechMask,
  planSpeechCut,
  DEFAULT_SPEECH_CONFIG,
} from './speech-detect';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ', msg); }
  else { fail++; console.error('  FAIL', msg); }
}

const SR = 16000;

type Part =
  | { kind: 'voice'; sec: number; f0?: number; amp?: number }
  | { kind: 'noise'; sec: number; amp?: number }
  /** respiração de verdade: ruído GRAVE (passa-baixa), não ruído branco */
  | { kind: 'breath'; sec: number; amp?: number }
  /** /s/ /ʃ/ /f/: ruído AGUDO, fraco e curto, colado na vogal */
  | { kind: 'fricative'; sec: number; amp?: number }
  | { kind: 'silence'; sec: number };

/** Gerador determinístico (sem Math.random: teste tem que dar sempre o mesmo). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** Monta um sinal: voz = harmônicos de F0 (periódico); ruído = respiração. */
function build(parts: Part[], sampleRate = SR) {
  const total = parts.reduce((n, p) => n + Math.round(p.sec * sampleRate), 0);
  const data = new Float32Array(total);
  const rnd = lcg(7);
  let i = 0;
  for (const p of parts) {
    const n = Math.round(p.sec * sampleRate);
    // ruído GRAVE (média móvel = passa-baixa): é assim que respiração soa
    let lp = 0;
    // ruído AGUDO (diferenciador = passa-alta): é assim que /s/ e /t/ soam
    let prev = 0;
    for (let k = 0; k < n; k++, i++) {
      if (p.kind === 'silence') { data[i] = 0; continue; }
      if (p.kind === 'noise') { data[i] = (p.amp ?? 0.018) * rnd(); continue; }
      if (p.kind === 'breath') {
        const r = rnd();
        lp = lp * 0.88 + r * 0.12;
        data[i] = (p.amp ?? 0.02) * lp * 6;
        continue;
      }
      if (p.kind === 'fricative') {
        const r = rnd();
        const hp = r - prev;
        prev = r;
        // envelope suave nas pontas pra não virar clique
        const env = Math.min(1, Math.min(k, n - k) / Math.max(1, sampleRate * 0.004));
        data[i] = (p.amp ?? 0.014) * hp * env;
        continue;
      }
      const t = k / sampleRate;
      const f0 = p.f0 ?? 130;
      const amp = p.amp ?? 0.25;
      // 4 harmônicos + um pouco de ruído: onda periódica, como voz de verdade
      data[i] =
        amp *
        (Math.sin(2 * Math.PI * f0 * t) +
          0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) +
          0.3 * Math.sin(2 * Math.PI * 3 * f0 * t) +
          0.15 * Math.sin(2 * Math.PI * 4 * f0 * t) +
          0.02 * rnd());
    }
  }
  return {
    sampleRate,
    length: total,
    duration: total / sampleRate,
    numberOfChannels: 1,
    getChannelData: (_ch: number) => data,
  };
}

/** Fração de frames marcados como fala dentro de uma janela de tempo. */
function speechFraction(buf: ReturnType<typeof build>, from: number, to: number) {
  const f = extractFeatures(buf.getChannelData(0), buf.sampleRate);
  const { mask } = detectSpeechMask(f);
  const a = Math.floor(from / f.frameSec);
  const b = Math.min(mask.length, Math.ceil(to / f.frameSec));
  let on = 0;
  for (let i = a; i < b; i++) on += mask[i];
  return b > a ? on / (b - a) : 0;
}

console.log('\nGARANTIA — o detector sabe o que é voz:');
{
  // voz | silêncio | respiração (ruído −35 dBFS) | voz
  const buf = build([
    { kind: 'voice', sec: 1.2 },
    { kind: 'silence', sec: 0.8 },
    { kind: 'noise', sec: 0.8 },
    { kind: 'voice', sec: 1.2 },
  ]);
  ok(speechFraction(buf, 0.2, 1.0) > 0.9, 'voz é reconhecida como fala');
  ok(speechFraction(buf, 1.35, 1.95) < 0.15, 'silêncio não é fala');
  ok(speechFraction(buf, 2.15, 2.75) < 0.25, 'respiração (ruído a −35 dBFS) NÃO é fala');
  ok(speechFraction(buf, 3.0, 4.0) > 0.9, 'a voz depois da respiração volta a ser fala');
}

console.log('\nGARANTIA — voz BAIXA continua sendo fala (não regride o bug antigo):');
{
  const buf = build([
    { kind: 'voice', sec: 1.0, amp: 0.3 },
    { kind: 'silence', sec: 0.6 },
    { kind: 'voice', sec: 1.2, amp: 0.03 }, // ~20 dB mais baixa
  ]);
  ok(speechFraction(buf, 2.0, 2.7) > 0.8, 'voz 20 dB mais baixa ainda é fala');
}

console.log('\nGARANTIA — o corte encurta a pausa e não come a voz:');
{
  const buf = build([
    { kind: 'voice', sec: 1.0 },
    { kind: 'silence', sec: 1.5 },
    { kind: 'voice', sec: 1.0 },
    { kind: 'noise', sec: 1.0 },   // respiração longa entre frases
    { kind: 'voice', sec: 1.0 },
  ]);
  const plan = planSpeechCut(buf, 0.08);
  const total = buf.duration;
  ok(plan.keptSec < total * 0.75, `removeu a maior parte da pausa (${total.toFixed(1)}s → ${plan.keptSec.toFixed(1)}s)`);
  ok(plan.cuts >= 2, `cortou os dois intervalos (${plan.cuts} cortes)`);

  // nenhum trecho removido pode cair dentro das faixas de voz
  const voiceRanges = [[0.05, 0.95], [2.55, 3.45], [4.55, 5.45]];
  const invade = plan.removed.some((r) =>
    voiceRanges.some(([a, b]) => Math.min(r.end, b) - Math.max(r.start, a) > 0.05),
  );
  ok(!invade, 'nenhum corte invadiu um trecho de voz');
}

console.log('\nGARANTIA — keepSilence controla o resultado:');
{
  const buf = build([
    { kind: 'voice', sec: 0.8 },
    { kind: 'silence', sec: 1.2 },
    { kind: 'voice', sec: 0.8 },
    { kind: 'silence', sec: 1.2 },
    { kind: 'voice', sec: 0.8 },
  ]);
  const curto = planSpeechCut(buf, 0.05).keptSec;
  const longo = planSpeechCut(buf, 0.3).keptSec;
  ok(longo > curto, `keep maior deixa mais pausa (0.05s → ${curto.toFixed(2)}s · 0.30s → ${longo.toFixed(2)}s)`);
  ok(curto >= 2.4, 'a fala inteira (2.4s) sobrevive mesmo no corte mais seco');
}

console.log('\nGARANTIA — casos degenerados não quebram:');
{
  const mudo = build([{ kind: 'silence', sec: 2 }]);
  const p1 = planSpeechCut(mudo, 0.08);
  ok(p1.segments.length >= 0 && p1.keptSec >= 0, 'áudio 100% mudo não quebra');

  const sofala = build([{ kind: 'voice', sec: 2 }]);
  const p2 = planSpeechCut(sofala, 0.08);
  ok(Math.abs(p2.keptSec - sofala.duration) < 0.1, 'áudio 100% fala sai inteiro');

  const curtinho = build([{ kind: 'voice', sec: 0.02 }]);
  const p3 = planSpeechCut(curtinho, 0.08);
  ok(p3.totalSec > 0 && p3.keptSec >= 0, 'áudio curtíssimo não quebra');
}

console.log('\nGARANTIA — config default é sã:');
{
  ok(DEFAULT_SPEECH_CONFIG.periodicityEnter > DEFAULT_SPEECH_CONFIG.periodicityStay, 'histerese: entrar exige mais que continuar');
  ok(DEFAULT_SPEECH_CONFIG.enterOffsetDb > DEFAULT_SPEECH_CONFIG.exitOffsetDb, 'histerese de energia na mesma direção');
  ok(DEFAULT_SPEECH_CONFIG.minGapSec >= DEFAULT_SPEECH_CONFIG.minCutSec, 'não corta pedaço maior que o próprio intervalo mínimo');
}

console.log('\nGARANTIA — CONSOANTE SURDA no fim da palavra não é comida (bug 24.08):');
{
  // "interneT": vogal + /t/ fraco e agudo, e só DEPOIS a pausa longa. O detector
  // antigo não via o /t/ (sem F0, 25 dB abaixo da vogal) e o corte começava nele.
  const buf = build([
    { kind: 'voice', sec: 0.9 },
    { kind: 'fricative', sec: 0.06, amp: 0.012 },
    { kind: 'silence', sec: 1.4 },
    { kind: 'voice', sec: 0.9 },
  ]);
  const plan = planSpeechCut(buf, 0.05);
  const comeu = plan.removed.reduce(
    (n, r) => n + Math.max(0, Math.min(r.end, 0.96) - Math.max(r.start, 0.9)), 0,
  );
  ok(comeu < 0.005, `o /t/ final sobreviveu (comeu ${comeu.toFixed(3)}s)`);
  ok(plan.cuts >= 1, `e ainda assim cortou a pausa (${plan.cuts} cortes)`);
  ok(plan.keptSec < buf.duration - 0.8, `a pausa de 1,4s foi encurtada (${buf.duration.toFixed(1)}s → ${plan.keptSec.toFixed(1)}s)`);
}

{
  // "horaS": o /s/ do plural, mais longo que a plosiva — o caso que o ASR pegou
  // no material real (horas→hora, minutos→minuto, acessos→acesso).
  const buf = build([
    { kind: 'voice', sec: 0.8 },
    { kind: 'fricative', sec: 0.18, amp: 0.014 },
    { kind: 'silence', sec: 1.5 },
    { kind: 'voice', sec: 0.8 },
  ]);
  const plan = planSpeechCut(buf, 0.05);
  const comeu = plan.removed.reduce(
    (n, r) => n + Math.max(0, Math.min(r.end, 0.98) - Math.max(r.start, 0.8)), 0,
  );
  ok(comeu < 0.01, `o /s/ do plural sobreviveu (comeu ${comeu.toFixed(3)}s)`);
  ok(plan.cuts >= 1, 'e a pausa de 1,5s continuou sendo cortada');
}

{
  // ataque: o /p/ de "Pepino" — consoante ANTES da vogal, logo depois de uma pausa
  const buf = build([
    { kind: 'voice', sec: 0.8 },
    { kind: 'silence', sec: 1.4 },
    { kind: 'fricative', sec: 0.05, amp: 0.012 },
    { kind: 'voice', sec: 0.9 },
  ]);
  const plan = planSpeechCut(buf, 0.05);
  const comeu = plan.removed.reduce(
    (n, r) => n + Math.max(0, Math.min(r.end, 2.25) - Math.max(r.start, 2.2)), 0,
  );
  ok(comeu < 0.005, `o ataque da palavra sobreviveu (comeu ${comeu.toFixed(3)}s)`);
}

console.log('\nGARANTIA — respiração continua saindo (a proteção não virou desculpa):');
{
  const buf = build([
    { kind: 'voice', sec: 1.0 },
    { kind: 'breath', sec: 0.9 },
    { kind: 'silence', sec: 0.8 },
    { kind: 'voice', sec: 1.0 },
  ]);
  const plan = planSpeechCut(buf, 0.05);
  ok(plan.keptSec < 2.7, `respiração + silêncio saíram (3.7s → ${plan.keptSec.toFixed(2)}s)`);
}

console.log('\nGARANTIA — o laudo é o contrato: nada de fala dentro do removido:');
{
  const casos = [
    build([{ kind: 'voice', sec: 1 }, { kind: 'silence', sec: 1.2 }, { kind: 'voice', sec: 1 }]),
    build([{ kind: 'voice', sec: 0.7 }, { kind: 'fricative', sec: 0.15 }, { kind: 'breath', sec: 0.7 },
           { kind: 'silence', sec: 0.9 }, { kind: 'voice', sec: 0.7 }]),
    build([{ kind: 'voice', sec: 2 }]),
    build([{ kind: 'silence', sec: 2 }]),
    build([{ kind: 'breath', sec: 1.5 }, { kind: 'voice', sec: 0.6 }]),
  ];
  let todosOk = true;
  for (const c of casos) {
    for (const keep of [0.01, 0.05, 0.12, 0.3]) {
      const plan = planSpeechCut(c, keep);
      if (plan.audit.speechRemovedSec > 0 || !plan.audit.ok) todosOk = false;
    }
  }
  ok(todosOk, 'audit.speechRemovedSec === 0 em 5 sinais × 4 intensidades');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} speech-detect: ${pass} ok, ${fail} fail`);
if (fail > 0) (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
