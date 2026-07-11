/**
 * GARANTIA — o app NUNCA entrega um MP4 corrompido em silêncio.
 *
 * Quando o navegador estoura a memória com vídeo grande, o ffmpeg-wasm pode
 * deixar a saída TRUNCADA (sem o átomo `moov`). Esse é o arquivo que "não
 * abre". `assertValidMp4` é a rede de segurança: valida a estrutura antes de
 * devolver e lança erro CLARO se estiver quebrado — pior caso vira aviso
 * honesto, nunca um arquivo bugado.
 */
import { assertValidMp4, planDecupChunks, chunkContainerFor, DECUP_CHUNK_TARGET_BYTES } from './ffmpeg-worker';

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

console.log(`\n${fail === 0 ? '✓' : '✗'} ffmpeg-worker: ${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
