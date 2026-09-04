/**
 * GARANTIA — o app NUNCA entrega um MP4 corrompido em silêncio.
 *
 * Quando o navegador estoura a memória com vídeo grande, o ffmpeg-wasm pode
 * deixar a saída TRUNCADA (sem o átomo `moov`). Esse é o arquivo que "não
 * abre". `assertValidMp4` é a rede de segurança: valida a estrutura antes de
 * devolver e lança erro CLARO se estiver quebrado — pior caso vira aviso
 * honesto, nunca um arquivo bugado.
 */
import { assertValidMp4, planDecupChunks, chunkContainerFor, DECUP_CHUNK_TARGET_BYTES,
  computeStaticGainDb, buildFinalGain, parseLoudnormStats, type LoudnormStats } from './ffmpeg-worker';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg);
  } else {
    fail++;
    console.error('  FAIL', msg);
  }
}
function throws(fn: () => void, match: RegExp, msg: string) {
  try {
    fn();
    fail++;
    console.error('  FAIL', msg, '(não lançou)');
  } catch (e) {
    const m = (e as Error)?.message || '';
    if (match.test(m)) {
      pass++;
      console.log('  ok  ', msg);
    } else {
      fail++;
      console.error('  FAIL', msg, `(msg errada: ${m})`);
    }
  }
}

const FTYP = [0x66, 0x74, 0x79, 0x70]; // 'ftyp'
const MOOV = [0x6d, 0x6f, 0x6f, 0x76]; // 'moov'

// Monta um buffer "MP4" com os átomos que escolhermos colocar.
function fakeMp4(opts: { ftyp?: boolean; moov?: boolean; moovAtEnd?: boolean; size?: number }): Uint8Array {
  const size = opts.size ?? 200_000;
  const d = new Uint8Array(size);
  if (opts.ftyp) d.set(FTYP, 4); // todo MP4 abre com ftyp logo no começo
  if (opts.moov && !opts.moovAtEnd) d.set(MOOV, 40); // faststart: moov no começo
  if (opts.moov && opts.moovAtEnd) d.set(MOOV, size - 8); // índice no fim
  return d;
}

console.log('\nGARANTIA — assertValidMp4 só aceita MP4 íntegro:');

// 1. MP4 válido (ftyp + moov no começo, como o faststart gera) → passa.
{
  let threw = false;
  try {
    assertValidMp4(fakeMp4({ ftyp: true, moov: true }), 'vídeo decupado');
  } catch {
    threw = true;
  }
  ok(!threw, 'MP4 íntegro (ftyp + moov no começo) é aceito');
}

// 2. Truncado: tem ftyp mas o moov foi cortado (estouro de memória) → erro claro.
throws(
  () => assertValidMp4(fakeMp4({ ftyp: true, moov: false }), 'vídeo decupado'),
  /moov|corrompido/i,
  'sem moov (truncado) → erro humano falando do índice',
);

// 3. Vazio / quase vazio (encode abortou) → erro de incompleto.
throws(
  () => assertValidMp4(new Uint8Array(100), 'vídeo decupado'),
  /vazio|incompleto/i,
  'saída vazia → erro "vazio/incompleto"',
);

// 4. Sem ftyp (lixo que não é MP4) → erro.
throws(
  () => assertValidMp4(fakeMp4({ ftyp: false, moov: true }), 'vídeo decupado'),
  /ftyp|corrompido/i,
  'sem ftyp → erro humano',
);

// 5. Arquivo grande com moov SÓ no fim (faststart não moveu) → ainda aceita.
//    Garante que não damos falso-positivo de "corrompido" num MP4 válido grande.
{
  let threw = false;
  try {
    // 70MB: força o caminho que varre os últimos 32MB.
    assertValidMp4(fakeMp4({ ftyp: true, moov: true, moovAtEnd: true, size: 70 * 1024 * 1024 }), 'vídeo decupado');
  } catch {
    threw = true;
  }
  ok(!threw, 'MP4 grande com moov no fim é aceito (sem falso-positivo)');
}

// ───────────────────────────────────────────────────────────────────────────
// GARANTIA — planDecupChunks (decupagem de arquivo grande SEM servidor):
// divide por TAMANHO (alvo ~160MB/parte) em cortes de TEMPO proporcionais.
console.log('\nGARANTIA — planDecupChunks divide certo e nunca quebra:');

const MB = 1024 * 1024;

// 1. Arquivo pequeno (cabe numa parte) → nada a dividir.
ok(planDecupChunks(150 * MB, 600).length === 0, '150MB → sem divisão (1 parte)');
ok(planDecupChunks(DECUP_CHUNK_TARGET_BYTES, 600).length === 0, 'exatamente no alvo → 1 parte');

// 2. 800MB (teto da ferramenta) → 5 partes = 4 cortes interiores, crescentes.
{
  const times = planDecupChunks(800 * MB, 1000);
  ok(times.length === 4, `800MB → 5 partes (4 cortes) — veio ${times.length + 1} partes`);
  ok(times.every((t, i) => i === 0 || t > times[i - 1]), 'cortes estritamente crescentes');
  ok(times[0] === 200 && times[3] === 800, `cortes proporcionais ao tempo (200/400/600/800) — veio ${times.join('/')}`);
  ok(times.every((t) => t > 0 && t < 1000), 'todo corte é interior (0 < t < duração)');
}

// 3. 201MB (logo acima do gatilho de 200MB da página) → 2 partes.
ok(planDecupChunks(201 * MB, 300).length === 1, '201MB → 2 partes (1 corte no meio)');

// 4. Duração inválida/curta → NUNCA divide (segue caminho direto, sem crash).
ok(planDecupChunks(800 * MB, 0).length === 0, 'duração 0 → sem divisão (sem crash)');
ok(planDecupChunks(800 * MB, NaN).length === 0, 'duração NaN → sem divisão (sem crash)');
ok(planDecupChunks(800 * MB, 0.5).length === 0, 'duração 0.5s → sem divisão');

// 5. Container das partes por extensão (sempre -c copy, nunca re-encode).
ok(chunkContainerFor('mp4').format === 'mp4' && chunkContainerFor('mov').format === 'mp4', 'mp4/mov → container mp4');
ok(chunkContainerFor('webm').format === 'webm', 'webm → container webm');
ok(chunkContainerFor('mp3').format === 'mp3' && chunkContainerFor('wav').format === 'wav', 'mp3/wav → mesmo container');
ok(chunkContainerFor('flac').format === 'matroska', 'codec exótico → matroska (aceita qualquer -c copy)');


/* ─────────────────────── NORMALIZADOR DE VOLUME ───────────────────────
 *
 * O motor de duas passadas mede a loudness real (input_i) e o true-peak
 * (input_tp) do sinal JÁ pré-filtrado e aplica um ganho ESTÁTICO + brickwall.
 * É isso que evita o "swell" das pausas e a "voz de ET" do loudnorm dinâmico.
 * A conta do ganho é pura — e portanto é a parte que PODE ser provada aqui,
 * sem ffmpeg. Até 04.09 ela não tinha teste nenhum.
 *
 * O que não pode regredir: nunca estourar (o ganho jamais passa do que o
 * true-peak permite + o headroom do limiter), nunca "blastar" arquivo
 * patológico (teto absoluto), e nunca quebrar com medição ausente ou suja.
 */
const stats = (i: string, tp: string): LoudnormStats =>
  ({
    input_i: i,
    input_tp: tp,
    input_lra: '7.0',
    input_thresh: '-26.0',
    output_i: '-16.0',
    output_tp: '-1.5',
    output_lra: '7.0',
    output_thresh: '-26.0',
    target_offset: '0.0',
  }) as LoudnormStats;

console.log('\n— normalizador: ganho estático —');
{
  // 1. Arquivo baixo comum: sobe até o alvo de -16 LUFS.
  const g1 = computeStaticGainDb(stats('-24.0', '-9.0'), true);
  ok(g1 !== null && Math.abs(g1 - 8) < 1e-6, `-24 LUFS vira +8dB (veio ${g1})`);

  // 2. O TRUE-PEAK manda quando subir até o alvo estouraria.
  //    I=-24 pediria +8; TP=-2 só permite (-1.5+2)+6 = +6.5.
  const g2 = computeStaticGainDb(stats('-24.0', '-2.0'), true);
  ok(g2 !== null && Math.abs(g2 - 6.5) < 1e-6, `pico segura o ganho em +6.5dB (veio ${g2})`);

  // 3. Sem limiter não há headroom: o mesmo caso só pode +0.5dB.
  const g3 = computeStaticGainDb(stats('-24.0', '-2.0'), false);
  ok(g3 !== null && Math.abs(g3 - 0.5) < 1e-6, `sem limiter fica em +0.5dB, não estoura (veio ${g3})`);

  // 4. Arquivo já alto: ganho NEGATIVO, nunca deixa passar do alvo.
  const g4 = computeStaticGainDb(stats('-9.0', '-0.2'), true);
  ok(g4 !== null && g4 < 0, `áudio alto recebe ganho negativo (veio ${g4})`);

  // 5. Voz baixa REAL (-53 LUFS) é recuperada inteira: o alvo pede +37dB e o
  //    teto de 40 nem entra — é isso que faz gravação fraca voltar a prestar.
  const g5 = computeStaticGainDb(stats('-53.0', '-40.0'), true);
  ok(g5 !== null && Math.abs(g5 - 37) < 1e-6, `voz baixa real sobe +37dB inteiros (veio ${g5})`);

  // 5b. Arquivo PATOLÓGICO (praticamente mudo, -60 LUFS) bate no teto absoluto:
  //     amplificar mais só inflaria ruído.
  const g5b = computeStaticGainDb(stats('-60.0', '-50.0'), true);
  ok(g5b === 40, `arquivo quase mudo capa em +40dB (veio ${g5b})`);

  // 6. Medição SUJA: o ffmpeg imprime "-inf" em trecho mudo. Não pode virar
  //    NaN nem ganho maluco.
  const g6 = computeStaticGainDb(stats('-inf', '-inf'), true);
  ok(g6 !== null && Number.isFinite(g6), `medição "-inf" devolve número finito (veio ${g6})`);
  ok(g6 !== null && g6 >= 0 && g6 <= 6, `medição "-inf" dá ganho comportado (veio ${g6})`);

  // 7. Sem medição → null, e o chamador cai no loudnorm de sempre.
  ok(computeStaticGainDb(null, true) === null, 'sem medição devolve null (chamador usa o fallback)');

  // 8. INVARIANTE ANTI-CLIPPING: em toda a faixa útil, o ganho nunca passa do
  //    que o true-peak permite + headroom, nem do teto absoluto.
  let furos = 0;
  let casos = 0;
  for (let i = -60; i <= -5; i += 2.5) {
    for (let tp = -50; tp <= 0; tp += 2.5) {
      const g = computeStaticGainDb(stats(i.toFixed(1), tp.toFixed(1)), true);
      if (g === null) continue;
      casos++;
      if (g > -1.5 - tp + 6 + 1e-9) furos++;
      if (g > 40 + 1e-9) furos++;
    }
  }
  ok(furos === 0, `varredura de ${casos} combinações: nenhum ganho fura o teto de pico/absoluto`);
}

console.log('\n— normalizador: cadeia de filtro final —');
{
  const comLim = buildFinalGain(stats('-24.0', '-9.0'), true);
  ok(comLim.includes('volume=') && comLim.includes('alimiter'), 'com limiter: volume + brickwall');
  ok(!comLim.includes('loudnorm'), 'com medição NÃO usa loudnorm dinâmico (a causa do swell/ET)');
  const semLim = buildFinalGain(stats('-24.0', '-9.0'), false);
  ok(semLim.includes('volume=') && !semLim.includes('alimiter'), 'sem limiter: só volume');
  ok(buildFinalGain(null, true).includes('loudnorm'), 'sem medição cai no loudnorm (fallback de sempre)');
  ok(/volume=-?\d+\.\d\ddB/.test(comLim), `ganho formatado com 2 casas (${comLim.split(',')[0]})`);
}

console.log('\n— normalizador: leitura do log do ffmpeg —');
{
  const bloco =
    '[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-24.00",\n\t"input_tp" : "-9.00",\n' +
    '\t"input_lra" : "7.00",\n\t"input_thresh" : "-34.00",\n\t"output_i" : "-16.00",\n' +
    '\t"output_tp" : "-1.50",\n\t"output_lra" : "7.00",\n\t"output_thresh" : "-26.00",\n' +
    '\t"target_offset" : "0.00"\n}';
  const r = parseLoudnormStats(bloco);
  ok(r !== null && r.input_i === '-24.00', 'lê o bloco JSON do loudnorm no meio do log');

  // O ffmpeg cospe muita coisa antes, e pode haver mais de uma medição:
  // vale a ÚLTIMA (a da passada que interessa).
  const dois = '{"lixo":"1"}\n' + bloco.replace('-24.00', '-30.00') + '\n' + bloco;
  const r2 = parseLoudnormStats(dois);
  ok(r2 !== null && r2.input_i === '-24.00', 'com 2 medições vale a ÚLTIMA');

  ok(parseLoudnormStats('') === null, 'log vazio devolve null (sem crash)');
  ok(parseLoudnormStats('ffmpeg version 6.0\nsem json aqui') === null, 'log sem JSON devolve null');
  ok(parseLoudnormStats('{"input_i": quebrado,}') === null, 'JSON quebrado devolve null (não lança)');
  ok(parseLoudnormStats('{"outra":"coisa"}') === null, 'JSON sem input_i devolve null');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ffmpeg-worker: ${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
