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

// (3) janelas pelas PARTES (o reset cai no corte real)
{
  const cfg: ZoomCfg = { on: true, modo: 'in', forca: 'medio' };
  const plan = planejarZoom(cfg, 23, [10, 5, 8]);
  ok(plan.length === 3, '3 partes = 3 janelas');
  ok(plan[0].start === 0 && aprox(plan[0].end, 10), 'janela 1 = parte 1');
  ok(aprox(plan[1].start, 10) && aprox(plan[1].end, 15), 'janela 2 = parte 2');
  ok(aprox(plan[2].end, 23), 'última janela fecha no fim do vídeo');
  ok(plan.every((s) => s.from === 1 && aprox(s.to, ZOOM_AMP.medio)), 'modo in: toda janela 1 → amp');
}

// (4) durações que NÃO batem com o vídeo caem na cadência
{
  const cfg: ZoomCfg = { on: true, modo: 'in', forca: 'leve' };
  const plan = planejarZoom(cfg, 40, [5, 5]); // soma 10 ≠ 40
  ok(plan.length >= 4, 'partes não confiáveis → cadência (~8s)');
  ok(aprox(plan[plan.length - 1].end, 40), 'cadência cobre até o fim');
  const semPartes = planejarZoom(cfg, 20, null);
  ok(semPartes.length >= 2 && aprox(semPartes[semPartes.length - 1].end, 20), 'sem partes → cadência');
}

// (5) modos out e inout
{
  const out = planejarZoom({ on: true, modo: 'out', forca: 'forte' }, 23, [10, 5, 8]);
  ok(out.every((s) => aprox(s.from, ZOOM_AMP.forte) && s.to === 1), 'modo out: amp → 1');
  const io = planejarZoom({ on: true, modo: 'inout', forca: 'medio' }, 23, [10, 5, 8]);
  ok(io[0].from === 1 && aprox(io[0].to, ZOOM_AMP.medio), 'inout: janela 0 empurra');
  ok(aprox(io[1].from, ZOOM_AMP.medio) && io[1].to === 1, 'inout: janela 1 recua');
  ok(io[2].from === 1, 'inout: janela 2 volta a empurrar');
}

// (6) força misto alterna leve/forte
{
  const m = planejarZoom({ on: true, modo: 'in', forca: 'misto' }, 23, [10, 5, 8]);
  ok(aprox(m[0].to, ZOOM_AMP.leve), 'misto: janela 0 leve');
  ok(aprox(m[1].to, ZOOM_AMP.forte), 'misto: janela 1 forte');
  ok(aprox(m[2].to, ZOOM_AMP.leve), 'misto: janela 2 leve de novo');
}

// (7) parte curtinha NÃO ganha rampa própria (funde com a vizinha)
{
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'medio' }, 21, [10, 0.8, 10.2]);
  ok(plan.length === 2, 'take de 0.8s não vira janela — gruda na anterior');
  ok(aprox(plan[0].end, 10.8), 'a janela anterior estica até o fim do take curto');
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

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-pos-producao: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
