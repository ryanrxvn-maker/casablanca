/**
 * Testes do threshold ADAPTATIVO de silêncio.
 *
 * Garante o conserto do bug "voz baixa é cortada": com um threshold fixo
 * (0.008), fala real gravada num volume baixo era classificada como silêncio
 * e descartada. O threshold adaptativo flutua com o piso de ruído do próprio
 * arquivo, então fala (bem acima do ruído) é SEMPRE preservada — vinda baixa
 * OU alta.
 */
import {
  computeAdaptiveSilenceThreshold,
  detectSilences,
  downloadBlob,
  SILENCE_FLOOR_MIN,
  SILENCE_FLOOR_MAX,
} from './audio-engine';

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

// Helper: monta um Float32Array de RMS por janela a partir de níveis.
function rmsArray(levels: number[]): Float32Array {
  return Float32Array.from(levels);
}

// Mock mínimo de AudioBuffer (detectSilences só usa sampleRate, length,
// getChannelData(0)). Constrói samples a partir de segmentos [nível, segundos].
function mockBuffer(
  segments: Array<{ level: number; sec: number }>,
  sampleRate = 16000,
): AudioBuffer {
  const total = segments.reduce((n, s) => n + Math.round(s.sec * sampleRate), 0);
  const data = new Float32Array(total);
  let i = 0;
  for (const s of segments) {
    const n = Math.round(s.sec * sampleRate);
    // onda quadrada de amplitude = level → RMS da janela ≈ level
    for (let k = 0; k < n; k++, i++) data[i] = k % 2 === 0 ? s.level : -s.level;
  }
  return {
    sampleRate,
    length: total,
    duration: total / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

console.log('\nGARANTIA — threshold adaptativo de silêncio:');

// 1. Voz BAIXA: piso 0.001, fala 0.02. Threshold deve ficar ENTRE os dois e,
//    crucialmente, ABAIXO do antigo fixo 0.008 — senão fala a 0.005 seria
//    cortada.
{
  const windows: number[] = [];
  for (let i = 0; i < 100; i++) windows.push(0.001);  // piso de ruído
  for (let i = 0; i < 100; i++) windows.push(0.02);   // fala baixa
  const thr = computeAdaptiveSilenceThreshold(rmsArray(windows));
  ok(thr > 0.001 && thr < 0.02, `voz baixa: threshold entre piso e fala (${thr.toFixed(5)})`);
  ok(thr < 0.008, `voz baixa: threshold ABAIXO do fixo antigo 0.008 (${thr.toFixed(5)}) → fala a 0.005 sobrevive`);
}

// 2. Voz ALTA: piso 0.002, fala 0.3. Threshold baixo, fala bem acima.
{
  const windows: number[] = [];
  for (let i = 0; i < 100; i++) windows.push(0.002);
  for (let i = 0; i < 100; i++) windows.push(0.3);
  const thr = computeAdaptiveSilenceThreshold(rmsArray(windows));
  ok(thr >= SILENCE_FLOOR_MIN && thr <= SILENCE_FLOOR_MAX, `voz alta: threshold dentro dos clamps (${thr.toFixed(5)})`);
  ok(thr < 0.3 * 0.25 + 1e-9, `voz alta: threshold nunca come a fala (${thr.toFixed(5)})`);
}

// 3. Áudio ruidoso: piso alto 0.01, fala 0.05. Threshold > piso (corta o
//    chiado-só) mas < fala.
{
  const windows: number[] = [];
  for (let i = 0; i < 100; i++) windows.push(0.01);
  for (let i = 0; i < 100; i++) windows.push(0.05);
  const thr = computeAdaptiveSilenceThreshold(rmsArray(windows));
  ok(thr <= SILENCE_FLOOR_MAX, `ruidoso: threshold respeita teto (${thr.toFixed(5)})`);
}

// 4. Degenerado (fala ~ ruído, sem dinâmica): cai no fixo 0.008.
{
  const windows: number[] = [];
  for (let i = 0; i < 200; i++) windows.push(0.01);
  const thr = computeAdaptiveSilenceThreshold(rmsArray(windows));
  ok(Math.abs(thr - 0.008) < 1e-9, `degenerado: cai no fixo 0.008 (${thr.toFixed(5)})`);
}

console.log('\nGARANTIA — detectSilences NÃO corta voz baixa:');

// 5. Cenário real: fala baixa (0.005) → silêncio de verdade (0.0003) → fala
//    baixa (0.005). Só o silêncio do meio pode ser detectado; as falas a 0.005
//    (abaixo do fixo antigo 0.008!) NÃO podem virar silêncio.
{
  const buf = mockBuffer([
    { level: 0.005, sec: 1.0 },   // fala baixa
    { level: 0.0003, sec: 0.5 },  // silêncio real
    { level: 0.005, sec: 1.0 },   // fala baixa
  ]);
  const regions = detectSilences(buf);
  // Deve haver exatamente 1 região de silêncio, e ela cai no meio (~1.0-1.5s).
  ok(regions.length === 1, `detectou exatamente 1 silêncio (got ${regions.length})`);
  if (regions.length === 1) {
    const r = regions[0];
    ok(r.start >= 0.9 && r.end <= 1.6, `silêncio no lugar certo (${r.start.toFixed(2)}-${r.end.toFixed(2)}s)`);
    // Garante que NENHUMA região cobre as falas (0-1.0 e 1.5-2.5).
    ok(r.start >= 1.0 - 0.05, 'fala baixa do início NÃO foi cortada');
    ok(r.end <= 1.5 + 0.05, 'fala baixa do fim NÃO foi cortada');
  }
}

// 6. Regressão de sanidade: silêncio longo no fim ainda é pego.
{
  const buf = mockBuffer([
    { level: 0.05, sec: 1.0 },    // fala normal
    { level: 0.0002, sec: 0.8 },  // silêncio no fim
  ]);
  const regions = detectSilences(buf);
  ok(regions.length === 1 && regions[0].end > 1.5, 'silêncio no fim ainda detectado');
}

console.log('\nGARANTIA — downloadBlob baixa por Object URL, NUNCA base64 (raiz da corrupção):');

// 7. O bug que entregava vídeo decupado "corrompido / não abre": o download
//    antigo convertia o arquivo inteiro pra data URL base64, que o browser
//    TRUNCAVA em arquivos grandes (MP4 sem moov atom). Este teste trava a
//    regressão: downloadBlob TEM que usar URL.createObjectURL (referência
//    direta ao blob) e NUNCA tocar em FileReader/readAsDataURL.
{
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = {
    URL: g.URL, document: g.document, FileReader: g.FileReader, setTimeout: g.setTimeout,
  };

  let fileReaderUsed = false;
  const created: Blob[] = [];
  const revoked: string[] = [];
  let hrefSet: string | undefined;
  let downloadSet: string | undefined;
  let clicked = false;
  const SENTINEL = 'blob:fake/obj-url-123';

  const fakeAnchor = {
    click() { clicked = true; },
    remove() {},
  } as Record<string, unknown>;
  Object.defineProperty(fakeAnchor, 'href', { set(v: string) { hrefSet = v; }, get() { return hrefSet; } });
  Object.defineProperty(fakeAnchor, 'download', { set(v: string) { downloadSet = v; }, get() { return downloadSet; } });

  g.URL = {
    createObjectURL: (b: Blob) => { created.push(b); return SENTINEL; },
    revokeObjectURL: (u: string) => { revoked.push(u); },
  };
  // Se QUALQUER caminho tentar base64, o teste pega na hora.
  g.FileReader = class { readAsDataURL() { fileReaderUsed = true; } };
  g.document = { createElement: () => fakeAnchor, body: { appendChild() {} } };
  g.setTimeout = (() => 0); // não agenda a revogação no teste

  // Blob de vídeo. O tamanho é irrelevante para a garantia: o que importa é
  // que ele é passado POR REFERÊNCIA pro createObjectURL (sem cópia, sem
  // conversão), então funciona igual pra 1KB ou 3GB.
  const videoBlob = new Blob([new Uint8Array(2048)], { type: 'video/mp4' });
  void downloadBlob(videoBlob, 'video_decupado.mp4');

  ok(!fileReaderUsed, 'NUNCA usa FileReader/readAsDataURL (base64 era a raiz da corrupção)');
  ok(created.length === 1, 'cria exatamente 1 Object URL');
  ok(created[0] === videoBlob, 'Object URL aponta pro blob EXATO (sem cópia/truncamento)');
  ok(hrefSet === SENTINEL, 'a.href = Object URL');
  ok(typeof hrefSet === 'string' && !hrefSet.startsWith('data:'), 'href NÃO é data: URL (não-base64)');
  ok(downloadSet === 'video_decupado.mp4', 'nome do arquivo preservado');
  ok(clicked, 'disparou o download (click)');

  g.URL = prev.URL;
  g.document = prev.document;
  g.FileReader = prev.FileReader;
  g.setTimeout = prev.setTimeout;
}

console.log(`\n${fail === 0 ? '✓' : '✗'} audio-engine: ${pass} ok, ${fail} fail`);
if (fail > 0) process.exit(1);
