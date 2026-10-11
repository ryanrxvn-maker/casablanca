/**
 * GARANTIA — 3ª rodada da auditoria das ferramentas Premium (11.10).
 *
 * Cada bloco trava um defeito VISTO ao vivo no site:
 *  - vídeo SEM SOM em Normalizador / Remover Silêncios / SRT / Legendas /
 *    Dividir Voz terminava em "Tenta de novo" (tentar de novo nunca resolve);
 *  - arquivo só de SILÊNCIO saía "PRONTO" (Remover Silêncios com 0,08 s; SRT
 *    com legenda inventada depois do fim do áudio; Normalizador "já no nível");
 *  - o aviso certo do Remover Silêncios ("não detectei fala") virava "Tenta de novo";
 *  - Compressor: imagem renomeada = "sem memória", estragado = "suba o CRF",
 *    e "Concluído · 4/4" com 3 erros;
 *  - "— PRONTO." na etapa enquanto o Mixer ainda processava;
 *  - Calculadora: digitar 6-1-9 dava 10:19 (o orçamento saía 63% mais caro)
 *    e "1.200" virava R$ 1,20.
 * Os textos de log abaixo são os REAIS do ffmpeg com os arquivos de teste.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerTrilhasDoLog, volumeMaximoDoLog, SILENCIO_MAX_DB, MSG_SEM_AUDIO, MSG_ARQUIVO_ILEGIVEL } from './ffmpeg-worker';
import { maskTime, parseMoney } from './calculadora-campos';
import { toFriendlyMessage, FriendlyError } from './friendly-error';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.error('  FAIL', msg); }
}
const ler = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

console.log('\nGARANTIA — auditoria Premium 11.10 (3ª rodada)');

// ── o que tem dentro do arquivo ─────────────────────────────────────────
{
  const normal = lerTrilhasDoLog([
    '  Duration: 00:00:59.98, start: 0.000000, bitrate: 1204 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280, 1149 kb/s, 30 fps',
    '  Stream #0:1[0x2](und): Audio: aac (HE-AAC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 48 kb/s (default)',
  ]);
  ok(normal.temAudio && normal.temVideo && normal.legivel, 'vídeo com som: tem áudio e vídeo');
  const mudo = lerTrilhasDoLog([
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280, 1149 kb/s, 30 fps',
  ]);
  ok(!mudo.temAudio && mudo.legivel, 'vídeo SEM som: legível e sem áudio (vira "não tem som")');
  const estragado = lerTrilhasDoLog([
    '[mov,mp4,m4a,3gp,3g2,mj2 @ 0000021b60e26200] moov atom not found',
    '[in#0 @ 0000021b60e75080] Error opening input: Invalid data found when processing input',
  ]);
  ok(!estragado.legivel, 'arquivo corrompido: não legível (vira "não consegui abrir")');
  const mp3 = lerTrilhasDoLog(['  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057']);
  ok(mp3.temAudio && mp3.legivel && !mp3.temVideo, 'MP3: só áudio, legível');
  ok(!lerTrilhasDoLog([]).legivel, 'log vazio (nada reconhecido): não legível');
}
{
  ok(volumeMaximoDoLog(['[Parsed_volumedetect_0 @ 0] mean_volume: -91.0 dB', '[Parsed_volumedetect_0 @ 0] max_volume: -91.0 dB'])! <= SILENCIO_MAX_DB, 'silêncio (-91 dB) fica abaixo do limite');
  ok(volumeMaximoDoLog(['[Parsed_volumedetect_0 @ 0] max_volume: -0.5 dB'])! > SILENCIO_MAX_DB, 'fala normal (-0,5 dB) passa');
  ok(volumeMaximoDoLog(['nada aqui']) === null, 'sem medição = null (segue como antes, nunca barra)');
}
{
  ok(toFriendlyMessage(new FriendlyError(MSG_SEM_AUDIO), 'x') === MSG_SEM_AUDIO, 'aviso de "sem som" chega inteiro no cliente');
  ok(toFriendlyMessage(new FriendlyError(MSG_ARQUIVO_ILEGIVEL), 'x') === MSG_ARQUIVO_ILEGIVEL, 'aviso de "não abre" chega inteiro no cliente');
}

// ── as ferramentas usam o verificador ───────────────────────────────────
{
  const usa = (arq: string) => /motivoSemAudio\(/.test(ler(arq));
  ok(usa('app/tools/normalizador/page.tsx'), 'Normalizador confere o arquivo antes');
  ok(usa('app/tools/decupagem/page.tsx'), 'Remover Silêncios confere o arquivo antes');
  ok(usa('app/tools/copy-srt/page.tsx'), 'Gerador de SRT confere o arquivo antes');
  ok(usa('app/tools/tipografia/page.tsx'), 'Legendas conferem o arquivo antes');
  ok(usa('app/tools/audio-split/page.tsx'), 'Dividir Voz dá a causa certa quando falha');
  ok(/volumeMaximoDb\(extraido\)/.test(ler('app/tools/copy-srt/page.tsx')) && /volumeMaximoDb\(extraido\)/.test(ler('app/tools/tipografia/page.tsx')), 'SRT e Legendas recusam áudio todo em silêncio');
  ok(/report\.before\.peakDb <= SILENCIO_PICO_DB/.test(ler('app/tools/normalizador/page.tsx')), 'Normalizador não entrega "OK" pra arquivo em silêncio');
  // O Pilot usa as mesmas funções do motor: o verificador NÃO entra nelas.
  const w = ler('lib/ffmpeg-worker.ts');
  const corpo = (nome: string) => w.slice(w.indexOf(`export async function ${nome}(`), w.indexOf('\n}\n', w.indexOf(`export async function ${nome}(`)));
  ok(!/motivoSemAudio|diagnosticarArquivo/.test(corpo('normalizeVolume') + corpo('prepareVoiceForDecupagem') + corpo('extractAudioForTranscription')), 'funções do motor (usadas pelo Pilot) seguem iguais');
}

// ── Remover Silêncios ───────────────────────────────────────────────────
{
  const d = ler('app/tools/decupagem/page.tsx');
  ok(!/throw new Error\('Não consegui detectar a fala/.test(d), 'nenhum "não detectei fala" como erro comum (era trocado por "Tenta de novo")');
  ok((d.match(/throw new FriendlyError\(SEM_FALA_MSG\)/g) || []).length >= 4, 'sem fala vira aviso que chega no cliente');
  ok(/if \(e instanceof FriendlyError\) return e\.message;/.test(d), 'friendlyError respeita o aviso pronto');
  ok(/MIN_FALA_SEG = 0\.3/.test(d) && /allowEmpty \? 0\.05 : MIN_FALA_SEG/.test(d), 'arquivo inteiro com <0,3 s de fala não sai "pronto"; parte de arquivo grande segue a regra antiga');
  ok(/EMPTY_MSG/.test(d) && /f\.size === 0/.test(d), 'arquivo vazio (0 KB) não entra como se fosse bom');
}

// ── Compressor e etapas ─────────────────────────────────────────────────
{
  const c = ler('app/tools/compressor/page.tsx');
  const semComentario = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join(' ');
  ok(!/[Ss]uba o CRF/.test(semComentario(c)) && !/[Ss]uba o CRF/.test(semComentario(ler('lib/ffmpeg-worker.ts'))), 'nada de "CRF" pro cliente');
  ok(/naoAbriu = !!meta && meta\.durationSec === 0 && meta\.height === 0/.test(c), 'arquivo que nem o navegador abre ganha a causa certa');
  ok(/falhas\+\+/.test(c) && /com erro/.test(c), 'resumo do lote conta os erros (nada de "4/4" com 3 erros)');
  ok(!/onStage\?\.\('Pronto\.'\)/.test(ler('lib/ffmpeg-worker.ts')), 'motor carregado não deixa "Pronto." na etapa de quem ainda processa');
}

// ── Calculadora ─────────────────────────────────────────────────────────
{
  // Digitação tecla por tecla, como o cliente faz (o campo reaplica a máscara a cada tecla).
  const digitar = (teclas: string) => [...teclas].reduce((campo, t) => maskTime(campo + t), '');
  ok(digitar('619') === '06:19', `6-1-9 = 06:19 (era 10:19) → ${digitar('619')}`);
  ok(digitar('1745') === '17:45', `1-7-4-5 = 17:45 (era 21:45) → ${digitar('1745')}`);
  ok(digitar('130') === '01:30', '1-3-0 = 01:30');
  ok(digitar('959') === '09:59', '9-5-9 = 09:59');
  ok(digitar('14000') === '1:40:00', '1-4-0-0-0 = 1:40:00');
  ok(maskTime('06:19') === '06:19' && maskTime('1:40:00') === '1:40:00', 'reprocessar o próprio texto devolve o mesmo');
  ok(maskTime('') === '' && maskTime('abc') === '', 'vazio continua vazio');
  ok(parseMoney('1.200') === 1200, '"1.200" = mil e duzentos (era 1,20)');
  ok(parseMoney('1.200,50') === 1200.5, '"1.200,50" = 1200,50');
  ok(parseMoney('99,90') === 99.9 && parseMoney('99.90') === 99.9, '"99,90" e "99.90" = 99,90');
  ok(parseMoney('80') === 80 && parseMoney('') === 0 && parseMoney('abc') === 0, '"80" = 80; vazio/inválido = 0');
  ok(parseMoney('R$ 150') === 150, '"R$ 150" = 150');
}

console.log(`\n${pass} ok, ${fail} falhas`);
if (fail) process.exit(1);
