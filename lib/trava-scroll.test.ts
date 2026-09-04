/**
 * GARANTIA — a trava de scroll da página aguenta DUAS janelas abertas.
 *
 * Dez modais do app (Legenda/Zoom, Inserts, Headline, EditPart, Lipsync,
 * RestartDispatch, GlobalSearch, GuidePanel, CaptionScript, TakeCard) travavam
 * o scroll do jeito ingênuo: guarda o overflow de antes, põe 'hidden', e no
 * fim devolve o guardado. Com uma janela funciona. Com duas — o caso normal no
 * ClickUp Pilot, porque a mesma task aparece no card de análise E na fila —
 * a segunda guardava 'hidden' e, ao fechar as duas, a página NUNCA MAIS ROLAVA.
 *
 * Este teste roda em Node com um `document` de mentira: só o que a trava toca.
 */
import { travarScrollDaPagina } from './trava-scroll';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log('  ok  ', msg);
  } else {
    failed++;
    console.error('  FAIL', msg);
  }
}

// `document` de mentira: só body.style.overflow existe
const body = { style: { overflow: '' } };
(globalThis as unknown as { document: unknown }).document = { body };
const overflow = () => body.style.overflow;

console.log('GARANTIA — trava de scroll com contador:');

// (1) uma janela: trava e destrava, devolvendo o valor ORIGINAL
{
  body.style.overflow = 'auto';
  const soltar = travarScrollDaPagina();
  ok(overflow() === 'hidden', 'uma janela aberta → body travado');
  soltar();
  ok(overflow() === 'auto', 'fechou → volta o overflow original (auto), não string vazia');
}

// (2) DUAS janelas: o bug que existia. Só a última que fecha destrava.
{
  body.style.overflow = '';
  const soltarA = travarScrollDaPagina();
  const soltarB = travarScrollDaPagina();
  ok(overflow() === 'hidden', 'duas abertas → travado');
  soltarA();
  ok(overflow() === 'hidden', 'fechou a PRIMEIRA, a segunda ainda está aberta → continua travado');
  soltarB();
  ok(overflow() === '', 'fechou a ÚLTIMA → destrava (era isto que ficava em hidden pra sempre)');
}

// (3) ordem inversa também: B fecha antes de A
{
  body.style.overflow = 'scroll';
  const soltarA = travarScrollDaPagina();
  const soltarB = travarScrollDaPagina();
  soltarB();
  ok(overflow() === 'hidden', 'B fechou primeiro → A segura a trava');
  soltarA();
  ok(overflow() === 'scroll', 'A fechou por último → devolve o original (scroll)');
}

// (4) a limpeza do React pode rodar DUAS vezes (StrictMode / remontagem):
//     chamar `soltar` de novo não pode empurrar o contador pra baixo de zero.
{
  body.style.overflow = '';
  const soltarA = travarScrollDaPagina();
  const soltarB = travarScrollDaPagina();
  soltarA();
  soltarA(); // repetido de propósito
  ok(overflow() === 'hidden', 'soltar repetido da mesma janela NÃO destrava a outra');
  soltarB();
  ok(overflow() === '', 'a última destrava normalmente depois do repetido');
}

// (5) três janelas empilhadas — o contador conta certo além de dois
{
  body.style.overflow = '';
  const s = [travarScrollDaPagina(), travarScrollDaPagina(), travarScrollDaPagina()];
  s[1]();
  s[0]();
  ok(overflow() === 'hidden', 'três abertas, duas fechadas → ainda travado');
  s[2]();
  ok(overflow() === '', 'a terceira fecha → destrava');
}

// (6) o valor original é o de ANTES da primeira trava, mesmo que alguém
//     mexa no meio (não deve, mas não pode virar 'hidden' preso)
{
  body.style.overflow = 'auto';
  const soltarA = travarScrollDaPagina();
  const soltarB = travarScrollDaPagina(); // a segunda vê 'hidden' e NÃO pode guardar isso
  soltarA();
  soltarB();
  ok(overflow() === 'auto', 'a segunda janela não "aprendeu" hidden como original');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} trava-scroll: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
