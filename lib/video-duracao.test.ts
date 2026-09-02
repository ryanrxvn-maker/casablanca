/**
 * A DURAÇÃO NÃO PODE DEPENDER DE ABA VISÍVEL (02.09).
 *
 * O AD com Smart Zoom saiu sem zoom porque a duração do montado era medida por
 * um <video preload="metadata">. Em aba de segundo plano o Chrome estrangula o
 * pipeline de mídia, o `loadedmetadata` não chega, o timeout devolve 0 — e a
 * pós-produção abortava sem legenda, sem zoom e sem avisar.
 *
 * O Node não tem `document`: rodar aqui é exatamente o cenário "sem <video>".
 * Se a duração sair mesmo assim, ela sai em qualquer aba.
 */
import { readFileSync } from 'node:fs';
import { metaPeloCabecalho, duracaoPeloCabecalho, duracaoDeVideo } from './video-duracao';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

async function main() {
  ok(typeof (globalThis as { document?: unknown }).document === 'undefined', 'este teste roda SEM <video> (como a aba oculta)');

  const blob = new Blob([readFileSync('tiny-test.mp4')], { type: 'video/mp4' });

  const meta = await metaPeloCabecalho(blob);
  ok(!!meta, 'o cabeçalho do MP4 responde');
  ok(!!meta && meta.durSec > 0, `duração pelo cabeçalho: ${meta?.durSec}s`);
  ok(!!meta && meta.width > 0 && meta.height > 0, `dimensões pelo cabeçalho: ${meta?.width}x${meta?.height}`);

  const dur = await duracaoPeloCabecalho(blob);
  ok(dur !== null && dur > 0, 'o atalho só-duração também responde');

  const semVideo = await duracaoDeVideo(blob);
  ok(semVideo > 0, 'duracaoDeVideo entrega sem <video> nenhum — era AQUI que o zoom morria');

  // ── a última linha: a soma das partes que o pipeline já mediu ──
  const lixo = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5])]);
  ok((await duracaoDeVideo(lixo, 62.4)) === 62.4, 'arquivo ilegível + dica do pipeline = usa a dica');
  ok((await duracaoDeVideo(lixo)) === 0, 'arquivo ilegível sem dica = 0 (e a pós-produção avisa)');
  ok((await duracaoDeVideo(lixo, 0)) === 0, 'dica zerada não vira duração');
  ok((await duracaoDeVideo(lixo, Number.NaN)) === 0, 'dica NaN não vira duração');

  // ── não trava com arquivo grande nem com vazio ──
  ok((await duracaoDeVideo(new Blob([]))) === 0, 'blob vazio devolve 0 sem explodir');

  console.log(`
${failed === 0 ? '✓' : '✗'} video-duracao: ${passed} ok, ${failed} fail
`);
  if (failed > 0) process.exit(1);
}
main();
