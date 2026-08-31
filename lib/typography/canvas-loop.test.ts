/**
 * Testes da POLÍTICA do relógio compartilhado dos canvas da legenda.
 *
 * Queixa que originou o módulo (Silas, 31.08): "não tá rodando o player de
 * preview, tá travado". Eram SEIS loops de rAF independentes desenhando
 * texto com sombra a 60fps na mesma thread que o <video> usa pra compor.
 */
import { pickJobs, type JobLike } from './canvas-loop';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

function job(o: Partial<JobLike> & { id: number }): JobLike {
  return { fps: 30, last: 0, visible: true, cost: 1, prio: 0, ...o };
}

console.log('\n── quem está fora da tela não desenha ──');
{
  const r = pickJobs([job({ id: 1, visible: false, last: 100 }), job({ id: 2, last: 100 })], 1000, 9);
  ok(r.run.join() === '2', 'só o visível entra');
  ok(!r.deferred.includes(1), 'o invisível nem conta como adiado (não está esperando vez)');
}

console.log('\n-- o PRIMEIRO quadro e incondicional --');
{
  // com a aba/painel oculto o IntersectionObserver diz que NADA esta na tela;
  // sem esta regra o canvas nascia em branco e ficava em branco pra sempre
  const r = pickJobs([job({ id: 1, visible: false, last: 0 })], 1000, 9);
  ok(r.run.join() === '1', 'trabalho que nunca desenhou entra mesmo marcado como fora da tela');
  const jaDesenhou = pickJobs([job({ id: 1, visible: false, last: 500 })], 1000, 9);
  ok(jaDesenhou.run.length === 0, 'mas depois do primeiro quadro a visibilidade volta a mandar');
}

console.log('\n── teto de FPS ──');
{
  const agora = 1000;
  // 30fps = 33.3ms de intervalo; quem desenhou há 10ms ainda não pode
  const r = pickJobs(
    [job({ id: 1, fps: 30, last: agora - 10 }), job({ id: 2, fps: 30, last: agora - 40 })],
    agora,
    9,
  );
  ok(r.run.join() === '2', 'quem desenhou há pouco espera o intervalo do seu FPS');

  const r60 = pickJobs([job({ id: 1, fps: 60, last: agora - 17 })], agora, 9);
  ok(r60.run.join() === '1', 'a 60fps o intervalo de 17ms já libera');

  const zero = pickJobs([job({ id: 1, fps: 0, last: 0 })], agora, 9);
  ok(zero.run.length === 0, 'fps 0 = pausado, nunca desenha');
}

console.log('\n── orçamento por frame ──');
{
  const agora = 5000;
  const caros = [1, 2, 3, 4, 5].map((id) => job({ id, cost: 4, last: 0 }));
  const r = pickJobs(caros, agora, 9);
  ok(r.run.length === 2, `com 9ms de orçamento e custo 4ms cada, entram 2 (entraram ${r.run.length})`);
  ok(r.deferred.length === 3, 'os outros 3 ficam pro próximo frame');
  ok(
    r.run.every((id) => !r.deferred.includes(id)),
    'ninguém aparece nas duas listas',
  );
}
{
  // trabalho MAIS CARO que o orçamento inteiro ainda precisa desenhar
  const r = pickJobs([job({ id: 1, cost: 40, last: 0 })], 5000, 9);
  ok(r.run.join() === '1', 'o primeiro sempre passa, mesmo custando mais que o orçamento');
  const r2 = pickJobs([job({ id: 1, cost: 40, last: 0 }), job({ id: 2, cost: 1, last: 0 })], 5000, 9);
  ok(r2.run.join() === '1' && r2.deferred.join() === '2', 'e o resto espera atrás dele');
}

console.log('\n── prioridade e rodízio (ninguém morre de fome) ──');
{
  const agora = 5000;
  // a prévia do vídeo (prio 10) passa na frente mesmo esperando menos
  const r = pickJobs(
    [job({ id: 1, prio: 0, last: agora - 500, cost: 8 }), job({ id: 2, prio: 10, last: agora - 40, cost: 8 })],
    agora,
    9,
  );
  ok(r.run.join() === '2', 'prioridade alta desenha primeiro');
  ok(r.deferred.join() === '1', 'e o de prioridade baixa fica pro próximo frame');
}
{
  // mesma prioridade: quem esperou MAIS vai primeiro
  const agora = 5000;
  const r = pickJobs(
    [job({ id: 1, last: agora - 100, cost: 8 }), job({ id: 2, last: agora - 900, cost: 8 })],
    agora,
    9,
  );
  ok(r.run.join() === '2', 'empatou na prioridade, ganha quem esperou mais');
}
{
  // simulação de 40 frames com 5 trabalhos caros: TODOS têm que desenhar
  const agora0 = 0;
  const lista = [1, 2, 3, 4, 5].map((id) => job({ id, cost: 4, fps: 30, last: -1000 }));
  const desenhou = new Map<number, number>();
  for (let f = 0; f < 40; f++) {
    const now = agora0 + f * 16.7;
    const { run } = pickJobs(lista, now, 9);
    for (const id of run) {
      const j = lista.find((x) => x.id === id)!;
      j.last = now;
      desenhou.set(id, (desenhou.get(id) ?? 0) + 1);
    }
  }
  ok(desenhou.size === 5, 'em 40 frames os 5 trabalhos desenharam pelo menos uma vez');
  const contagens = [...desenhou.values()];
  const menor = Math.min(...contagens);
  const maior = Math.max(...contagens);
  // Igualdade PERFEITA não é a propriedade certa aqui: o teto de FPS
  // quantiza quem fica elegível em cada frame, então sobra uma folga. O que
  // precisa valer é: ninguém passa fome e a diferença é limitada.
  ok(menor >= maior * 0.6, `o rodízio é justo dentro do razoável (mín ${menor}, máx ${maior})`);
  ok(menor >= 3, `ninguém ficou de fora (mínimo ${menor} desenhos em 40 frames)`);
}

console.log('\n── casos de borda ──');
{
  ok(pickJobs([], 1000, 9).run.length === 0, 'lista vazia não quebra');
  const todosInvisiveis = pickJobs(
    [job({ id: 1, visible: false, last: 100 }), job({ id: 2, visible: false, last: 100 })],
    1000,
    9,
  );
  ok(todosInvisiveis.run.length === 0 && todosInvisiveis.deferred.length === 0, 'página toda fora da tela = zero desenho');
  const custoZero = pickJobs([1, 2, 3].map((id) => job({ id, cost: 0, last: 0 })), 5000, 9);
  ok(custoZero.run.length === 3, 'trabalho ainda sem custo medido não é penalizado');
}

console.log(falhas === 0 ? '\n✅ canvas-loop: tudo passou' : `\n❌ canvas-loop: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
