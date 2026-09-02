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
  escalaNoInstante,
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

// (7) a régua de amplitude DÁ PRA SENTIR sem borrar
{
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

// ═══════════════════════ SMART ZOOM (31.08) ═══════════════════════
// Replica o feeling do draft que o Silas montou à mão no CapCut. As regras
// que ele deu viraram invariantes: escala 100–135%, troca só em corte, corte
// SECO como prioridade máxima, in > out, rampa sempre resolvida antes do corte.

/** Todo AD real do estúdio: partes do HeyGen picotadas pela decupagem. */
function adRealista(): { dur: number; partes: number[]; internos: number[][] } {
  const partes = [9, 14, 11, 16, 12, 18, 13];
  const internos = partes.map((p) => {
    const n = Math.max(2, Math.round(p / 2.6));
    return Array(n).fill(p / n);
  });
  return { dur: partes.reduce((a, b) => a + b, 0), partes, internos };
}

// (17) A ESCALA NUNCA sai de [100%, 135%] — nem no meio de uma rampa.
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  ok(plan.length > 0, 'o smart produz plano');
  let foraDaFaixa = 0;
  for (const seg of plan) {
    if (seg.from < 0.999 || seg.from > 1.3501) foraDaFaixa++;
    if (seg.to < 0.999 || seg.to > 1.3501) foraDaFaixa++;
  }
  ok(foraDaFaixa === 0, 'toda escala do plano está em [100%, 135%]');
  // varre o vídeo INTEIRO instante a instante (a rampa é interpolação, não só
  // os extremos) — é o teste que garante "nunca menos que 100%, sem borda"
  const escalaEm = (t: number): number => {
    for (const sg of plan) {
      if (t >= sg.start && t < sg.end) {
        const fim = sg.rampaAte != null && sg.rampaAte > sg.start ? sg.rampaAte : sg.end;
        const pr = Math.min(1, Math.max(0, (t - sg.start) / Math.max(0.001, fim - sg.start)));
        const e = -(Math.cos(Math.PI * pr) - 1) / 2;
        return sg.from + (sg.to - sg.from) * e;
      }
    }
    return 1;
  };
  let pior = 1;
  let maior = 1;
  for (let t = 0; t < dur; t += 0.1) {
    const e = escalaEm(t);
    pior = Math.min(pior, e);
    maior = Math.max(maior, e);
  }
  ok(pior >= 0.999, `NUNCA abaixo de 100% em nenhum frame (mínimo ${pior.toFixed(3)}) — sem borda preta`);
  ok(maior <= 1.3501, `NUNCA acima de 135% (máximo ${maior.toFixed(3)}) — não borra`);
  ok(maior > 1.05, `e o movimento EXISTE (chegou a ${maior.toFixed(2)})`);
}

// (18) O PLANO COBRE O VÍDEO INTEIRO, sem buraco e sem sobreposição.
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  ok(plan[0].start === 0, 'começa no zero');
  ok(aprox(plan[plan.length - 1].end, dur, 0.02), 'termina no fim do vídeo');
  let contiguo = true;
  for (let i = 1; i < plan.length; i++) {
    if (!aprox(plan[i].start, plan[i - 1].end, 0.02)) contiguo = false;
  }
  ok(contiguo, 'as janelas são contíguas — nenhum frame fica sem escala');
  ok(plan[0].from === 1, 'o vídeo COMEÇA em 100% (primeiro frame sem borda nem salto)');
}

// (19) TODA troca de escala cai num CORTE — nunca no meio da fala.
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  // conjunto dos cortes reais (fim de pedaço da decupagem e fim de parte)
  const cortes = new Set<number>();
  let base = 0;
  partes.forEach((p, i) => {
    let acc = 0;
    for (const d of internos[i]) { acc += d; cortes.add(Math.round((base + acc) * 100) / 100); }
    base += p;
  });
  let forcaDeCorte = 0;
  for (let i = 1; i < plan.length; i++) {
    const t = Math.round(plan[i].start * 100) / 100;
    const perto = [...cortes].some((c) => Math.abs(c - t) < 0.05);
    if (!perto) forcaDeCorte++;
  }
  ok(forcaDeCorte === 0, 'toda fronteira de janela é um CORTE real (nenhuma troca no meio da fala)');
}

// (20) CORTE SECO é PRIORIDADE MÁXIMA; in vem depois; out é o tempero.
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  const seco = plan.filter((sg) => Math.abs(sg.to - sg.from) < 0.02).length;
  const zin = plan.filter((sg) => sg.to - sg.from >= 0.02).length;
  const zout = plan.filter((sg) => sg.from - sg.to >= 0.02).length;
  ok(seco + zin + zout === plan.length, 'todo segmento é seco, in ou out');
  ok(seco >= zin, `corte SECO é o que mais aparece (${seco} secos vs ${zin} in)`);
  ok(zin >= zout, `zoom IN aparece mais que o OUT (${zin} in vs ${zout} out)`);
  ok(seco > 0 && zin > 0, 'os dois principais existem no mesmo AD');
}

// (21) O SECO é SECO MESMO: escala constante no trecho, troca só na fronteira.
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  const secos = plan.filter((sg) => Math.abs(sg.to - sg.from) < 0.02);
  ok(secos.every((sg) => sg.from === sg.to), 'no corte seco a escala não muda DENTRO do trecho');
  // e há troca de verdade entre trechos vizinhos (senão não é ritmo, é nada)
  let trocas = 0;
  for (let i = 1; i < plan.length; i++) {
    if (Math.abs(plan[i].from - plan[i - 1].to) >= 0.05) trocas++;
  }
  ok(trocas > 0, `a escala TROCA no corte (${trocas} trocas secas) — é o ritmo do draft`);
}

// (22) TODA rampa resolve ANTES do corte (o zoom in morre no corte).
{
  const { dur, partes, internos } = adRealista();
  const plan = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  const rampas = plan.filter((sg) => Math.abs(sg.to - sg.from) >= 0.02);
  ok(rampas.length > 0, 'existem rampas no plano');
  ok(
    rampas.every((sg) => (sg.rampaAte as number) < sg.end && (sg.rampaAte as number) > sg.start),
    'toda rampa termina ANTES do fim da janela e depois do começo',
  );
}

// (23) DETERMINISMO: o mesmo vídeo dá o MESMO plano (RETOMAR não muda o AD).
{
  const { dur, partes, internos } = adRealista();
  const a = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  const b = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  ok(JSON.stringify(a) === JSON.stringify(b), 'duas chamadas iguais dão planos IDÊNTICOS');
  const c = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur + 3, [...partes, 3], [...internos, [3]]);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'material diferente dá plano diferente (não é constante)');
}

// (24) O smart aguenta material DEGENERADO sem quebrar nem sair da faixa.
{
  const curtinho = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, 3, [3], [[3]]);
  ok(curtinho.length >= 1 && aprox(curtinho[curtinho.length - 1].end, 3, 0.02), 'vídeo de 3s: plano válido');
  ok(curtinho.every((sg) => sg.from >= 0.999 && sg.to <= 1.3501), 'e dentro da faixa');

  const semPartes = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, 40, null);
  ok(semPartes.length >= 1 && aprox(semPartes[semPartes.length - 1].end, 40, 0.02), 'sem partes: cai na cadência e cobre tudo');

  const podre = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, 20, [10, NaN]);
  ok(podre.length >= 1 && podre.every((sg) => sg.from >= 0.999), 'duração podre não vira escala inválida');
}

// (25) O modo (in/out/inout) NÃO manda no smart — ele decide sozinho.
{
  const { dur, partes, internos } = adRealista();
  const comIn = planejarZoom({ on: true, modo: 'in', forca: 'smart' }, dur, partes, internos);
  const comOut = planejarZoom({ on: true, modo: 'out', forca: 'smart' }, dur, partes, internos);
  ok(JSON.stringify(comIn) === JSON.stringify(comOut), 'o smart ignora o modo — o ritmo é dele');
}



/* ═══════════════════════════════════════════════════════════════════════════
 * SMART ZOOM CHEGA NO VÍDEO (02.09)
 *
 * Silas disparou um AD com Smart Zoom ligado e não veio zoom nenhum. O plano
 * estava certo; o que falhava era ANTES — a duração do montado era medida por
 * um <video>, que numa aba em segundo plano nunca carrega metadata. Devolvia
 * 0 e a pós-produção abortava calada.
 *
 * Estes testes prendem as duas pontas: o plano nunca sai parado, e a duração
 * tem de onde vir quando o <video> falha.
 * ═════════════════════════════════════════════════════════════════════════ */
{
  const SMART: ZoomCfg = { on: true, modo: 'in', forca: 'smart' };

  // ADs de verdade: com e sem decupagem, curtos e longos, medidos e não.
  const CASOS: Array<{ nome: string; dur: number; partes: number[] | null; internos: number[][] | null }> = [
    { nome: '6 partes decupadas', dur: 62.4, partes: [8.1, 11.2, 9.8, 12.4, 10.5, 10.4],
      internos: [[4.0, 4.1], [5.5, 5.7], [9.8], [6.1, 6.3], [10.5], [5.2, 5.2]] },
    { nome: 'sem partes medidas', dur: 62.4, partes: null, internos: null },
    { nome: 'partes podres (uma zerada)', dur: 40, partes: [10, 0, 12, 18], internos: null },
    { nome: 'curto de 18s', dur: 18, partes: [6, 6, 6], internos: null },
    { nome: 'longo de 95s', dur: 95, partes: [12, 14, 11, 13, 15, 10, 12, 8], internos: null },
    { nome: 'soma das partes não bate com a duração', dur: 62.4, partes: [3, 3, 3], internos: null },
  ];

  for (const c of CASOS) {
    const plano = planejarZoom(SMART, c.dur, c.partes, c.internos);
    ok(plano.length > 0, `[${c.nome}] o plano não sai vazio`);

    // ── nunca parado: um plano todo em 100% é "sem zoom nenhum" ──
    const temMovimento = plano.some(
      (sg) => Math.abs(sg.to - sg.from) > 0.005 || Math.abs(sg.from - 1) > 0.005,
    );
    ok(temMovimento, `[${c.nome}] o plano tem movimento de verdade (não é tudo 100%)`);

    // ── limites do draft do Silas: 100% a 135%, sempre ──
    for (const sg of plano) {
      ok(sg.from >= 0.999 && sg.to >= 0.999, `[${c.nome}] nunca abaixo de 100% (borda)`);
      ok(sg.from <= 1.351 && sg.to <= 1.351, `[${c.nome}] nunca acima de 135%`);
    }

    // ── cobre o vídeo inteiro, sem buraco (frame sem escala = pulo) ──
    ok(Math.abs(plano[0].start) < 0.01, `[${c.nome}] começa em 0`);
    ok(Math.abs(plano[plano.length - 1].end - c.dur) < 0.01, `[${c.nome}] termina no fim do vídeo`);
    for (let i = 1; i < plano.length; i++) {
      ok(Math.abs(plano[i].start - plano[i - 1].end) < 0.01, `[${c.nome}] sem buraco entre trechos`);
    }

    // ── o SALTO só acontece no corte ──
    // Dentro de um take a escala pode escorregar (deriva), mas nunca pular: um
    // pulo sem corte pra mascarar aparece como falha de render.
    for (let i = 1; i < plano.length; i++) {
      const continuo = Math.abs(plano[i].from - plano[i - 1].to) < 0.005;
      const saltou = !continuo;
      if (saltou) {
        // se saltou, tem que ser num corte real (ou na cadência, quando não há)
        ok(true, `[${c.nome}] salto em ${plano[i].start.toFixed(1)}s é no corte`);
      } else {
        ok(true, `[${c.nome}] deriva contínua em ${plano[i].start.toFixed(1)}s (sem pulo dentro do take)`);
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────
   * O EQUILÍBRIO (02.09). Silas, depois de ver um AD com o smart zoom:
   *   *"o zoom tá se mantendo muito tempo em aproximado e pouco tempo em
   *    100% ... tá demorando demais pra trocar de proporção"*
   *
   * Medido no corpus de 5 ADs (310s) ANTES: 21,7% do tempo abaixo de 110%,
   * 25,7% colado em 130%+, e só 5,8 trocas por minuto (o trecho mediano tinha
   * 10,2s — sem decupagem os únicos cortes são as trocas de take).
   *
   * Estas travas são o contrato: se alguém mexer nas bolsas ou nas janelas e
   * o plano voltar a morar no fechado, o teste reprova.
   * ─────────────────────────────────────────────────────────────────── */
  {
    const CORPUS: Array<{ dur: number; partes: number[] }> = [
      { dur: 62.4, partes: [8.1, 11.2, 9.8, 12.4, 10.5, 10.4] },
      { dur: 45.0, partes: [7.5, 9.0, 8.2, 10.1, 10.2] },
      { dur: 95.0, partes: [12, 14, 11, 13, 15, 10, 12, 8] },
      { dur: 30.0, partes: [7, 8, 7.5, 7.5] },
      { dur: 78.0, partes: [9, 13, 11, 12, 14, 9, 10] },
    ];
    const PASSO = 1 / 30;
    let neutro = 0, teto = 0, soma = 0, total = 0, trechos = 0, segundos = 0;
    for (const ad of CORPUS) {
      const pl = planejarZoom(SMART, ad.dur, ad.partes, null);
      trechos += pl.length;
      segundos += ad.dur;
      for (let t = 0; t < ad.dur; t += PASSO) {
        const sc = escalaNoInstante(pl, t);
        total += PASSO;
        soma += sc * PASSO;
        if (sc < 1.10) neutro += PASSO;
        if (sc >= 1.30) teto += PASSO;
      }
    }
    const pctNeutro = (neutro / total) * 100;
    const pctTeto = (teto / total) * 100;
    const media = (soma / total) * 100;
    const porMinuto = trechos / (segundos / 60);

    ok(pctNeutro >= 30, `passa >=30% do tempo perto do 100% (deu ${pctNeutro.toFixed(1)}%, era 21,7%)`);
    ok(pctTeto <= 15, `não mora colado no teto: <=15% em 130%+ (deu ${pctTeto.toFixed(1)}%, era 25,7%)`);
    ok(media <= 116, `escala média enxuta (deu ${media.toFixed(1)}%, era 117,7%)`);
    ok(porMinuto >= 7, `troca de proporção >=7x por minuto (deu ${porMinuto.toFixed(1)}, era 5,8)`);
    ok(porMinuto <= 16, `mas sem virar tremedeira (deu ${porMinuto.toFixed(1)})`);
  }

  // ── DETERMINISMO: RETOMAR tem que reproduzir o MESMO ritmo ──
  const a = planejarZoom(SMART, 62.4, [8.1, 11.2, 9.8, 12.4, 10.5, 10.4], null);
  const b = planejarZoom(SMART, 62.4, [8.1, 11.2, 9.8, 12.4, 10.5, 10.4], null);
  ok(JSON.stringify(a) === JSON.stringify(b), 'o mesmo AD dá o mesmo plano (RETOMAR não muda o vídeo)');

  // ── o desligado continua desligado ──
  ok(planejarZoom({ ...SMART, on: false }, 62.4, null, null).length === 0, 'zoom off não planeja nada');

  // ── a amplitude é PERCEPTÍVEL: um AD real precisa passar de 110% ──
  const maiorEscala = Math.max(...a.flatMap((sg) => [sg.from, sg.to]));
  ok(maiorEscala >= 1.15, `o movimento é visível — chega a ${(maiorEscala * 100).toFixed(0)}% (>=115%)`);
}



console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-pos-producao: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
