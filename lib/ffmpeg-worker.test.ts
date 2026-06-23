/**
 * GARANTIA — o app NUNCA entrega um MP4 corrompido em silêncio.
 *
 * Quando o navegador estoura a memória com vídeo grande, o ffmpeg-wasm pode
 * deixar a saída TRUNCADA (sem o átomo `moov`). Esse é o arquivo que "não
 * abre". `assertValidMp4` é a rede de segurança: valida a estrutura antes de
 * devolver e lança erro CLARO se estiver quebrado — pior caso vira aviso
 * honesto, nunca um arquivo bugado.
 */
import { assertValidMp4 } from './ffmpeg-worker';

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

console.log(`\n${fail === 0 ? '✓' : '✗'} ffmpeg-worker: ${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
