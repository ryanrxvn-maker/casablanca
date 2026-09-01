/**
 * GARANTIA da fila global do ffmpeg-wasm.
 *
 * Existe por causa de um DEADLOCK real (31.08): o pipeline do Pilot roda
 * inteiro dentro de `runFfmpegExclusive` e a pós-produção, lá dentro, pedia o
 * lock DE NOVO na hora de remuxar o áudio. Como a fila não é reentrante, a
 * operação esperava a si mesma — e, sem teto, esperava PARA SEMPRE: o card
 * ficava eternamente em "legendando: audio", sem erro nenhum.
 *
 * O que isto blinda:
 *  (a) a serialização de verdade — duas operações NUNCA se sobrepõem;
 *  (b) a fila sobrevive a erro (um falha, as próximas rodam);
 *  (c) o teto de espera existe e é o que transforma deadlock em erro visível.
 */
import { runFfmpegExclusive, esperaEstourou } from './ffmpeg-serial';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\nGARANTIA — fila global do ffmpeg (anti-deadlock):');

  // (1) SERIALIZAÇÃO: nunca duas ao mesmo tempo
  {
    let rodando = 0;
    let pico = 0;
    const ordem: number[] = [];
    const op = (n: number, ms: number) =>
      runFfmpegExclusive(async () => {
        rodando++;
        pico = Math.max(pico, rodando);
        await dorme(ms);
        ordem.push(n);
        rodando--;
        return n;
      });
    const r = await Promise.all([op(1, 30), op(2, 5), op(3, 5)]);
    ok(pico === 1, 'NUNCA duas operações ao mesmo tempo (o motivo da fila existir)');
    ok(JSON.stringify(ordem) === '[1,2,3]', 'roda na ordem em que entrou');
    ok(JSON.stringify(r) === '[1,2,3]', 'cada chamada recebe o SEU resultado');
  }

  // (2) a fila SOBREVIVE a erro — senão um falho travava todo o resto
  {
    const caiu = await runFfmpegExclusive(async () => {
      throw new Error('boom');
    }).then(
      () => 'passou',
      (e) => (e as Error).message,
    );
    ok(caiu === 'boom', 'o erro chega pra quem chamou (não é engolido)');
    const depois = await runFfmpegExclusive(async () => 'vivo');
    ok(depois === 'vivo', 'e a fila continua andando depois da falha');
  }

  // (3) TETO DE ESPERA: a regra que faz um deadlock GRITAR em vez de pendurar
  {
    ok(esperaEstourou(41 * 60_000) === true, '41min na fila = estourou (é aninhamento, não trabalho)');
    ok(esperaEstourou(39 * 60_000) === false, '39min ainda cabe (watchdog do worker é 25min)');
    ok(esperaEstourou(0) === false, 'quem pega o slot na hora nunca estoura');
    ok(esperaEstourou(1500, 1000) === true, 'o teto é parametrizável (harness)');
  }

  // (4) REENTRÂNCIA É PROIBIDA — a armadilha, documentada em teste.
  //     Chamar a fila de dentro dela mesma trava: quem está lá dentro só sai
  //     quando o de fora terminar, e o de fora só termina quando o de dentro
  //     sair. Provamos com um teto curto: em vez de esperar pra sempre, a
  //     corrida tem um vencedor conhecido (o timer).
  {
    let aninhadaRodou = false;
    const corrida = await Promise.race([
      runFfmpegExclusive(async () => {
        await runFfmpegExclusive(async () => {
          aninhadaRodou = true;
        });
        return 'aninhou';
      }),
      dorme(120).then(() => 'travou'),
    ]);
    ok(corrida === 'travou', 'aninhar a fila TRAVA (por isso o token ffmpegJaExclusivo existe)');
    ok(aninhadaRodou === false, 'a operação de dentro nem começa — ela espera o slot que o pai segura');
  }

  console.log(`\n${failed === 0 ? '✓' : '✗'} ffmpeg-serial: ${passed} ok, ${failed} fail\n`);
  if (failed > 0) process.exit(1);
  // A (4) deixa uma promise pendurada de propósito (é o deadlock provado):
  // sai limpo em vez de esperar o event loop drenar.
  process.exit(0);
}

void main();
