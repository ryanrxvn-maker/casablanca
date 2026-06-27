/**
 * Fila GLOBAL de "1 operação ffmpeg-wasm por vez" pra TODO o app.
 *
 * O ffmpeg-wasm (lib/ffmpeg-worker.ts) é um SINGLETON compartilhado no navegador.
 * Quando 2 tarefas tocam ffmpeg ao mesmo tempo (a fila roda até 2 disparos em
 * paralelo), elas usam a MESMA instância e se atropelam: uma chama
 * `cancelFFmpeg()` (no timeout/retry dela) e mata o worker enquanto a OUTRA ainda
 * processa → a outra morre com "called FFmpeg.terminate()". Foi exatamente isso
 * que perdia o concat de UM avatar no VA (o AD saía com 1/2 avatares) e o que já
 * dava "1 PRONTO, resto INCOMPLETO" na decupagem das tasks normais.
 *
 * Este módulo é PROPOSITALMENTE sem dependências (não importa o ffmpeg-worker nem
 * o @ffmpeg/ffmpeg) pra poder ser importado tanto pela página quanto pela
 * lib/va-pipeline.ts SEM puxar o wasm pro bundle. Todos os caminhos que tocam
 * ffmpeg (montagem das tasks normais, concat do VA-texto, pipeline do VA-lipsync)
 * passam por `runFfmpegExclusive` → garante 1 operação por vez, sem colisão.
 *
 * A fila SEGUE mesmo quando uma operação falha (o encadeamento engole o erro pra
 * não travar as próximas). Cada operação tem seus próprios timeouts por cima, e o
 * watchdog do worker (25min) é o backstop final — então o slot SEMPRE libera, sem
 * risco de travar a fila pra sempre.
 *
 * IMPORTANTE: não aninhar — uma função passada pra `runFfmpegExclusive` não pode,
 * lá dentro, chamar `runFfmpegExclusive` de novo (esperaria a fila que ela mesma
 * segura = deadlock). Por isso embrulhamos no NÍVEL ALTO (a operação inteira),
 * nunca nas primitivas de baixo nível do worker.
 */
let _chain: Promise<unknown> = Promise.resolve();

export function runFfmpegExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = _chain.then(() => fn());
  _chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
