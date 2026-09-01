/**
 * GARANTIA da pós-produção do Pilot (legenda + zoom) — as decisões puras.
 *
 * O que isto blinda:
 *  (a) o plano de zoom respeita as PARTES da montagem (reset só em corte real)
 *      e cai na cadência quando as durações não batem com o vídeo;
 *  (b) modo/força produzem exatamente as rampas pedidas (in, out, alternado,
 *      misto leve/forte);
 *  (c) hook × body saem da MESMA régua de label do resto do app;
 *  (d) o roteiro do template sempre termina em "o resto" — sobra do ASR nunca
 *      fica sem estilo — e degrada certo sem hook.
 */
import {
  planejarZoom,
  fronteirasDasPartes,
  separarHookBody,
  montarRoteiro,
  palavrasDoHookNoAsr,
  ZOOM_AMP,
  type ZoomCfg,
} from './pilot-pos-producao';
import { TEMPLATE_1 } from './typography/caption-script';

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
const aprox = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps;

console.log('\nGARANTIA — pós-produção do Pilot (zoom + roteiro):');

// (1) fronteiras das partes
{
  ok(JSON.stringify(fronteirasDasPartes([10, 5, 8])) === '[10,15,23]', 'fronteiras = soma acumulada');
  ok(fronteirasDasPartes([10, NaN, 5]).length === 0, 'duração inválida derruba a lista inteira (vai pra cadência)');
  ok(fronteirasDasPartes([]).length === 0, 'sem partes = sem fronteiras');
}

// (2) zoom OFF / vídeo curto
{
  const off: ZoomCfg = { on: false, modo: 'in', forca: 'medio' };
  ok(planejarZoom(off, 60, [30, 30]).length === 0, 'zoom desligado = plano vazio');
  const on: ZoomCfg = { on: true, modo: 'in', forca: 'medio' };
  ok(planejarZoom(on, 0.3, [0.3]).length === 0, 'vídeo curtinho demais = sem zoom');
}

// (3) A JANELA TEM DURAÇÃO ALVO — não morre em todo corte.
// Este é o coração da regra de 31.08: com cortes a cada 2-3s (AD decupado), uma
// rampa por corte não dava tempo do movimento ser percebido. Agora a janela
// ATRAVESSA cortes até ter uns 7s.
{
  const cfg: ZoomCfg = { on: true, modo: 'in', forca: 'medio' };
  // 12 pedaços de 2s = 24s. Antes: 12 janelas de 2s (zoom invisível).
  const plan = planejarZoom(cfg, 24, [24], [Array(12).fill(2)]);
  ok(plan.length <= 4, `cortes de 2s viram POUCAS janelas (deu ${plan.length}, não 12)`);
  ok(plan.every((j) => j.end - j.start >= 4), 'nenhuma janela abaixo do mínimo de 4s');
  ok(aprox(plan[plan.length - 1].end, 24), 'e o plano cobre o vídeo inteiro');
  // toda fronteira de janela É um corte real (múltiplo de 2 aqui)
  for (const j of plan.slice(0, -1)) {
    ok(aprox(j.end % 2, 0, 0.02) || aprox(j.end % 2, 2, 0.02), `a janela fecha num corte real (t=${j.end})`);
  }
}

// (4) O RESET PREFERE A TROCA DE TAKE (corte forte), onde é invisível.
{
  // parte 1: 8s picotada em 4×2s · parte 2: 8s inteira
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'medio' }, 16, [8, 8], [[2, 2, 2, 2], [8]]);
  ok(plan.length === 2, 'duas janelas: uma por take');
  ok(aprox(plan[0].end, 8), 'a primeira fecha na TROCA DE TAKE (t=8), não num corte de decupagem');
  ok(aprox(plan[1].end, 16), 'a segunda fecha no fim');
}

// (5) durações que NÃO batem com o vídeo caem na cadência
{
  const cfg: ZoomCfg = { on: true, modo: 'in', forca: 'leve' };
  const plan = planejarZoom(cfg, 40, [5, 5]); // soma 10 ≠ 40
  ok(plan.length >= 3, 'partes não confiáveis → cadência (~8s)');
  ok(aprox(plan[plan.length - 1].end, 40), 'cadência cobre até o fim');
  const semPartes = planejarZoom(cfg, 20, null);
  ok(semPartes.length >= 2 && aprox(semPartes[semPartes.length - 1].end, 20), 'sem partes → cadência');
}

// (6) modos out e inout
{
  const out = planejarZoom({ on: true, modo: 'out', forca: 'forte' }, 30, [10, 10, 10]);
  ok(out.every((s) => aprox(s.from, ZOOM_AMP.forte) && s.to === 1), 'modo out: amp → 1');
  const io = planejarZoom({ on: true, modo: 'inout', forca: 'medio' }, 30, [10, 10, 10]);
  ok(io[0].from === 1 && aprox(io[0].to, ZOOM_AMP.medio), 'inout: janela 0 empurra');
  ok(aprox(io[1].from, ZOOM_AMP.medio) && io[1].to === 1, 'inout: janela 1 recua');
  ok(io[2].from === 1, 'inout: janela 2 volta a empurrar');
}

// (7) força misto alterna leve/forte; e a régua nova DÁ PRA SENTIR
{
  const m = planejarZoom({ on: true, modo: 'in', forca: 'misto' }, 30, [10, 10, 10]);
  ok(aprox(m[0].to, ZOOM_AMP.leve), 'misto: janela 0 leve');
  ok(aprox(m[1].to, ZOOM_AMP.forte), 'misto: janela 1 forte');
  ok(ZOOM_AMP.medio >= 1.14, 'médio subiu pra faixa que se percebe no plano fechado');
  ok(ZOOM_AMP.forte <= 1.3, 'forte NÃO passa do ponto em que o upscale borra');
  ok(ZOOM_AMP.leve < ZOOM_AMP.medio && ZOOM_AMP.medio < ZOOM_AMP.forte, 'a escada é monotônica');
}

// (8) hook × body pela MESMA régua de label do app
{
  const r = separarHookBody([
    { label: 'HOOK 1', text: 'Como transformar azeite em remédio.' },
    { label: 'BODY 1', text: 'A maioria usa errado.' },
    { label: 'GANCHO 2', text: 'Outro gancho.' },
    { label: 'BODY 2', text: '' },
    { label: 'PARTE 3', text: 'O composto se chama oleocantal.' },
  ]);
  ok(r.hook.includes('azeite') && r.hook.includes('Outro gancho'), 'HOOK e GANCHO viram hook');
  ok(r.body.includes('errado') && r.body.includes('oleocantal'), 'BODY e PARTE viram body');
  ok(!r.body.includes('azeite'), 'hook não vaza pro body');
}

// (9) roteiro do template: hook com a copy + body "o resto"
{
  const segs = montarRoteiro(TEMPLATE_1, 'Como transformar um azeite de dez reais.', 'corpo qualquer');
  ok(segs.length === 2, 'hook + body');
  ok(segs[0].kind === 'hook' && segs[0].text.includes('azeite'), 'hook leva a copy do doc');
  ok(segs[0].style.presetId === 'vermelho-sangue', 'hook herda o estilo do template');
  const ultimo = segs[segs.length - 1];
  ok(ultimo.kind === 'body' && ultimo.text === '' && ultimo.words === null, 'body é "o resto" (nada do ASR fica sem estilo)');
  ok(ultimo.style.presetId === 'keynote', 'body herda o estilo do template');
}

// (10) sem hook no doc → um trecho só, de body
{
  const segs = montarRoteiro(TEMPLATE_1, '', 'só corpo');
  ok(segs.length === 1 && segs[0].kind === 'body', 'sem hook degrada pra body único');
  ok(segs[0].text === '' && segs[0].words === null, 'e continua sendo "o resto"');
}

// (11) O ZOOM RESOLVE ANTES DO CORTE — a rampa termina em `rampaAte` e a
// escala fica PARADA até a fronteira: nenhum corte é atravessado com movimento
// em curso NO FIM da janela (atravessar no MEIO é de propósito, ver (3)).
{
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'medio' }, 30, [10, 10, 10]);
  for (const seg of plan) {
    ok(seg.rampaAte != null, 'toda janela tem fim de rampa declarado');
    ok((seg.rampaAte as number) < seg.end, 'a rampa termina ANTES do fim da janela (respiro)');
    ok((seg.rampaAte as number) > seg.start, 'e depois do começo (a rampa existe)');
  }
  const s0 = plan[0];
  const esc = (t: number) => {
    const fim = s0.rampaAte as number;
    const p = -(Math.cos(Math.PI * Math.min(1, Math.max(0, (t - s0.start) / (fim - s0.start)))) - 1) / 2;
    return s0.from + (s0.to - s0.from) * p;
  };
  ok(aprox(esc(s0.end - 0.01), s0.to, 0.0005), 'no frame anterior ao corte a escala JÁ chegou ao destino');
}

// (12) Take LONGO usa um corte de decupagem como ponto de reset — senão a
// janela ficaria enorme e o movimento viraria deriva.
{
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'medio' }, 40, [40], [Array(8).fill(5)]);
  ok(plan.length >= 3, `take de 40s se parte em várias janelas (deu ${plan.length})`);
  ok(plan.every((j) => j.end - j.start >= 4), 'e nenhuma fica curta demais');
  for (const j of plan.slice(0, -1)) {
    ok(aprox(j.end % 5, 0, 0.02) || aprox(j.end % 5, 5, 0.02), `fecha num corte de decupagem real (t=${j.end})`);
  }
}

// (13) Entrada podre NÃO derruba o plano — cai na cadência
{
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'medio' }, 23, [10, NaN, 8]);
  ok(plan.length >= 1, 'plano continua existindo com duração podre');
  ok(aprox(plan[plan.length - 1].end, 23), 'e ainda fecha no fim do vídeo');
}

// (14) FRONTEIRA DO HOOK POR ALINHAMENTO — a blindagem contra "trocou o estilo
// antes da hora". O ASR não conta palavras igual ao doc; a fronteira tem que
// sair do CONTEÚDO.
{
  const hook = 'como transformar um azeite de dez reais no seu remedio daqui';
  // ASR fiel: a fronteira é o tamanho do hook
  const fiel = [...hook.split(' '), 'a', 'maioria', 'das', 'pessoas', 'usa', 'errado'];
  ok(palavrasDoHookNoAsr(fiel, hook) === 11, 'ASR fiel: fronteira = todas as palavras do hook');

  // ⭐ O DEFEITO REAL: o ASR COMEU uma palavra do meio do hook. Pela contagem
  // da copy (11) o corte cairia 1 palavra DEPOIS — levando "a" do body pro
  // hook; ou, no caso do AD02, deixando "daqui." de fora. O alinhamento acha
  // o fim de verdade.
  const comeu = ['como', 'transformar', 'azeite', 'de', 'dez', 'reais', 'no', 'seu', 'remedio', 'daqui', 'a', 'maioria', 'das', 'pessoas'];
  ok(palavrasDoHookNoAsr(comeu, hook) === 10, 'ASR comeu 1 palavra: a fronteira anda junto (10, não 11)');

  // ASR INVENTOU uma palavra dentro do hook
  const inventou = ['como', 'transformar', 'um', 'azeite', 'ai', 'de', 'dez', 'reais', 'no', 'seu', 'remedio', 'daqui', 'a', 'maioria'];
  ok(palavrasDoHookNoAsr(inventou, hook) === 12, 'ASR inventou 1 palavra: a fronteira também (12)');

  // erro de grafia não desalinha (o casamento é por similaridade)
  const errou = ['comu', 'transformar', 'um', 'azeyte', 'de', 'dez', 'reais', 'no', 'seu', 'remedio', 'daki', 'a', 'maioria'];
  ok(palavrasDoHookNoAsr(errou, hook) === 11, 'grafia errada do ASR ainda casa (similaridade)');

  // pontuação e acento não contam
  ok(palavrasDoHookNoAsr(fiel, 'Como transformar um azeite de dez reais no seu remédio DAQUI.') === 11, 'acento e pontuação não mudam a fronteira');
}

// (15) O alinhamento SE RECUSA quando não dá pra confiar — e aí o caller cai
// na contagem de antes (o comportamento que já rodava).
{
  ok(palavrasDoHookNoAsr(['a', 'b', 'c'], 'oi') === null, 'hook curto demais → null');
  ok(palavrasDoHookNoAsr([], 'como transformar um azeite qualquer') === null, 'ASR vazio → null');
  ok(
    palavrasDoHookNoAsr(['xis', 'zeta', 'plutonio', 'gamba', 'quiabo'], 'como transformar um azeite de dez reais') === null,
    'ASR que não tem NADA a ver com o hook → null (não inventa fronteira)',
  );
}

// (16) montarRoteiro USA a fronteira medida — é ela que vira `words`
{
  const semMedida = montarRoteiro(TEMPLATE_1, 'como transformar um azeite', 'corpo');
  ok(semMedida[0].words === null, 'sem medida, o hook cai na contagem da copy (como antes)');
  const comMedida = montarRoteiro(TEMPLATE_1, 'como transformar um azeite', 'corpo', 9);
  ok(comMedida[0].words === 9, 'com medida, ela VENCE a contagem da copy');
  const zero = montarRoteiro(TEMPLATE_1, 'como transformar um azeite', 'corpo', 0);
  ok(zero[0].words === null, 'medida zero é ignorada (não zera o hook)');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-pos-producao: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
