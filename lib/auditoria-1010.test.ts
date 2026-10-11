/**
 * GARANTIA — correções da auditoria das ferramentas Premium (10.10).
 *
 * Cada bloco trava um defeito que foi VISTO ao vivo no site:
 *  - duas ferramentas juntas: o Normalizador entregou o vídeo do Mixer, e o
 *    Cancelar do Mixer cancelou o Normalizador (fila com dono + nomes únicos);
 *  - Compressor deixava vídeo leve 3x maior e "1080p" vertical virava 608x1080;
 *  - Gerador de SRT falhava acima de ~8 min (duração não chegava na extração);
 *  - travamento/falta de memória apareciam como "Cancelado por você.";
 *  - Lipsync e Remover Silêncios perdiam o trabalho ao trocar de tela;
 *  - download com extensão errada (Normalizador/Camuflagem);
 *  - mensagens do Motor sem acento; arquivo recusado sumindo calado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpegExclusive, entrarNaFila, donoDoMotor, motorOcupado, desistirDaFila } from './ffmpeg-serial';
import { tetoDeTaxaKbps, filtroResolucao, pickTranscribeBitrateKbps, cancelarMotorSeDono } from './ffmpeg-worker';
import { toFriendlyMessage } from './friendly-error';
import { ajustarTextoDoMotor } from './texto-do-motor';
import { zipCabeNoNavegador, ZIP_MAX_BYTES } from './zip-limite';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.error('  FAIL', msg); }
}
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), 'utf8');

async function main() {
  console.log('\nGARANTIA — auditoria Premium 10.10');

  // ── fila com dono ──────────────────────────────────────────────────────
  {
    const vistos: Array<string | null> = [];
    let avisou = 0;
    const a = runFfmpegExclusive(async () => { vistos.push(donoDoMotor()); await dorme(30); }, 'normalizador');
    const b = runFfmpegExclusive(async () => { vistos.push(donoDoMotor()); }, 'mixer', () => { avisou++; });
    await Promise.all([a, b]);
    ok(vistos[0] === 'normalizador' && vistos[1] === 'mixer', 'cada operação roda com o PRÓPRIO dono');
    ok(avisou === 1, 'quem entra com a fila ocupada recebe o aviso de "na fila"');
    await dorme(5);
    ok(donoDoMotor() === null && !motorOcupado(), 'fila vazia = sem dono');
    ok(cancelarMotorSeDono('mixer') === false, 'Cancelar fora da vez NÃO derruba o motor');
  }
  {
    const ordem: string[] = [];
    const sair = await entrarNaFila('decupagem');
    const outra = runFfmpegExclusive(async () => { ordem.push('outra'); }, 'mixer');
    await dorme(20);
    ordem.push('bloco');
    ok(donoDoMotor() === 'decupagem', 'entrarNaFila segura a vez com o dono certo');
    sair();
    await outra;
    ok(ordem.join(',') === 'bloco,outra', 'a próxima só roda depois de soltar a vez');
  }
  {
    // Cancelar com a ferramenta AINDA na fila: sai na hora, sem esperar a outra.
    const ordem: string[] = [];
    const a = runFfmpegExclusive(async () => { await dorme(60); ordem.push('normalizador'); }, 'normalizador');
    const t0 = Date.now();
    const b = runFfmpegExclusive(async () => { ordem.push('mixer'); }, 'mixer');
    const c = runFfmpegExclusive(async () => { ordem.push('camuflagem'); }, 'camuflagem');
    await dorme(5);
    ok(desistirDaFila('mixer') === 1, 'Cancelar tira da fila só a ferramenta que cancelou');
    let erroB = '';
    await b.catch((e: Error) => { erroB = e.message; });
    ok(erroB === 'CANCELLED_BY_USER' && Date.now() - t0 < 40, 'quem estava na fila é cancelado NA HORA (não espera a outra terminar)');
    await Promise.all([a, c]);
    ok(ordem.join(',') === 'normalizador,camuflagem', 'quem desistiu nunca roda; as outras seguem normais');
  }
  {
    let rodou = false;
    await runFfmpegExclusive(async () => { throw new Error('x'); }, 'camuflagem').catch(() => {});
    await runFfmpegExclusive(async () => { rodou = true; }, 'normalizador');
    ok(rodou, 'erro numa operação não trava a fila');
  }

  // ── Compressor / Mixer ─────────────────────────────────────────────────
  {
    const teto = tetoDeTaxaKbps(1_750_927, 25.66);
    ok(teto !== null && teto > 300 && teto < 500, `teto do vídeo leve fica na taxa dele (${teto} kbps)`);
    ok(tetoDeTaxaKbps(1000, 0) === null, 'sem duração = sem teto (comportamento antigo)');
    const acelerado = tetoDeTaxaKbps(1_750_927, 25.66, 1.5);
    ok(acelerado !== null && teto !== null && acelerado > teto, 'acelerado ganha folga proporcional');
    const f = filtroResolucao('1080');
    ok(/if\(gt\(iw,ih\)/.test(f) && /min\(1080,iw\)/.test(f) && /min\(1080,ih\)/.test(f), 'resolução pelo LADO MENOR (vertical 1080x1920 continua 1080x1920)');
    ok(/setsar=1/.test(f), 'pixel quadrado na saída');
    const fonte = ler('lib/ffmpeg-worker.ts');
    ok(!/scale=-2:\$\{params\.resolution\}/.test(fonte), 'nada de scale=-2:<altura> (era o 608x1080)');
    const comp = ler('app/tools/compressor/page.tsx');
    ok(/semReduzirResolucao = resolution === 'original' \|\| \(ladoMenor > 0 && ladoMenor <= Number\(resolution\)\)/.test(comp)
      && /keptOriginal = semReduzirResolucao && blob\.size >= job\.file\.size/.test(comp), 'Compressor entrega o ORIGINAL quando não diminui (Original, ou vídeo já menor que a resolução escolhida)');
    const espera = comp.slice(comp.indexOf('ff = await pool.acquire();'), comp.indexOf("if (lote.cancelado) throw new Error('CANCELLED_BY_USER')"));
    ok(/lote\.cancelado\s*\?\s*'Cancelado por você\.'/.test(espera), 'motor que não carrega NÃO aparece como "Cancelado por você."');
    ok(/praticamente o mesmo tamanho/.test(comp), 'nada de "0% maior"');
    ok(/ficouMaior/.test(comp) && !/\(-\$\{/.test(comp), 'rótulo honesto ("% maior"), nunca "-258% menor"');
    ok(/não havia o que reduzir/.test(comp), 'quadro de economia sem "NaN undefined"');
  }

  // ── Gerador de SRT ─────────────────────────────────────────────────────
  {
    const kb12 = pickTranscribeBitrateKbps(12 * 60);
    ok(kb12 * 1000 * 720 / 8 <= 3_800_000, `12 min cabem no envio (${kb12} kbps)`);
    const kb60 = pickTranscribeBitrateKbps(60 * 60);
    ok(kb60 * 1000 * 3600 / 8 <= 3_800_000, `60 min cabem no envio (${kb60} kbps)`);
    ok(/duration \?\? undefined/.test(ler('app/tools/copy-srt/page.tsx')), 'Gerador de SRT passa a duração pra extração');
    ok(/readDurationFromLogs\(ff, inputName\)/.test(ler('lib/ffmpeg-worker.ts')), 'sem duração do chamador, a extração lê do arquivo');
  }

  // ── mensagens ─────────────────────────────────────────────────────────
  {
    ok(/parou no meio/.test(toFriendlyMessage('called FFmpeg.terminate()')), 'motor derrubado sem o cliente cancelar NÃO vira "Cancelado por você."');
    ok(/sem mem[oó]ria/.test(toFriendlyMessage('RuntimeError: Aborted(OOM). Build with -sASSERTIONS')), 'falta de memória vira aviso de memória');
    ok(toFriendlyMessage(new DOMException('x', 'AbortError')) === 'Cancelado por você.', 'cancelamento de verdade continua igual');
    const fonte = ler('lib/ffmpeg-worker.ts');
    const kill = fonte.slice(fonte.indexOf('const kill = (rej'), fonte.indexOf('const watchdog = new Promise'));
    ok(kill.indexOf('rej(new Error(msg))') > -1 && kill.indexOf('rej(new Error(msg))') < kill.indexOf('ff.terminate()'),
      'vigia rejeita ANTES de matar (a mensagem de travamento chega ao cliente)');
    const m = ajustarTextoDoMotor('Falha no download. esse video nao esta mais disponivel (foi removido ou saiu do ar). Confere o link no navegador.');
    ok(m === 'Falha no download. Esse vídeo não está mais disponível (foi removido ou saiu do ar). Confere o link no navegador.', 'mensagem do Motor com acento e maiúscula');
    ok(ajustarTextoDoMotor('esse video e privado ou exige login — so da pra baixar conteudo publico.') ===
      'Esse vídeo é privado ou exige login — só dá pra baixar conteúdo público.', 'frases do Motor (é privado / só dá pra)');
    ok(ajustarTextoDoMotor('Atualize esta página.') === 'Atualize esta página.', 'não mexe em "esta" solto');
  }

  // ── ZIP ───────────────────────────────────────────────────────────────
  {
    ok(zipCabeNoNavegador([200 * 1024 * 1024]), '200 MB cabe (testado ao vivo: 0,8 s)');
    ok(!zipCabeNoNavegador([ZIP_MAX_BYTES, 1]), 'acima de 1 GB avisa em vez de travar');
  }

  // ── trabalho não se perde / ferramentas usam a fila e o Cancelar com dono ─
  {
    ok(/useToolState<Job\[\]>\('lipsync:jobs'/.test(ler('components/tools/LipSyncTool.tsx')), 'Lipsync: disparos sobrevivem a trocar de tela');
    ok(/captureArtifact\(finalBlob/.test(ler('components/tools/LipSyncTool.tsx')), 'Lipsync: resultado vai pro Histórico na hora');
    ok(/trechosProntos/.test(ler('components/tools/LipSyncTool.tsx')), 'Lipsync: "Tentar de novo" reaproveita trechos prontos');
    ok(/useToolState<QueueItem\[\]>\('decupagem:queue'/.test(ler('app/tools/decupagem/page.tsx')), 'Remover Silêncios: fila sobrevive a trocar de tela');
    ok(/useToolState<Record<string, any>>\('fakepass:states'/.test(ler('app/tools/fakepass/page.tsx')), 'FakePrint: texto digitado sobrevive a trocar de tela');
    for (const [arq, nome] of [
      ['app/tools/acelerador/page.tsx', 'Mixer'],
      ['app/tools/normalizador/page.tsx', 'Normalizador'],
      ['app/tools/camuflagem/page.tsx', 'Camuflagem'],
      ['app/tools/decupagem/page.tsx', 'Remover Silêncios'],
      ['app/tools/copy-srt/page.tsx', 'Gerador de SRT'],
      ['app/tools/tipografia/page.tsx', 'Legendas'],
    ] as const) {
      const src = ler(arq);
      ok(/cancelarMotorSeDono\(DONO\)/.test(src) && !src.includes('onClick={() => cancelFFmpeg()}'), `${nome}: Cancelar só derruba o motor na vez dele`);
      ok(/(runFfmpegExclusive|entrarNaFila)\(/.test(src), `${nome}: processa pela fila global`);
    }
    for (const arq of ['app/tools/compressor/page.tsx', 'app/tools/acelerador/page.tsx', 'app/tools/normalizador/page.tsx',
      'app/tools/camuflagem/page.tsx', 'app/tools/copy-srt/page.tsx', 'app/tools/tipografia/page.tsx',
      'components/tools/LipSyncTool.tsx', 'app/tools/fakepass/page.tsx', 'app/tools/decupagem/page.tsx']) {
      ok(/acquireKeepAlive\(\)/.test(ler(arq)) && /releaseKeepAlive\(\)/.test(ler(arq)), `aba acordada em ${arq}`);
    }
    ok(/formatoDe\(job\)/.test(ler('app/tools/normalizador/page.tsx')), 'Normalizador: extensão do download = formato do resultado');
    ok(/pair\.outFormat \?\? format/.test(ler('app/tools/camuflagem/page.tsx')), 'Camuflagem: extensão do download = formato do resultado');
    const up = ler('components/BatchFileUpload.tsx');
    ok(/textoDoAviso/.test(up) && /if \(novos === 0\) return;/.test(up), 'upload em lote avisa o que não entrou e não apaga resultados');
    const w = ler('lib/ffmpeg-worker.ts');
    ok(/nomeUnico\('vel_in'/.test(w) && /nomeUnico\('norm_in'/.test(w) && /nomeUnico\('tr_in'/.test(w), 'Mixer, Normalizador e transcrição usam nomes de arquivo únicos')
  }

  console.log(`\n${pass} ok, ${fail} falhas`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
