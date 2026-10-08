import {
  SFX_CATALOGO, SFX_CFG_DEFAULT, SFX_IDS, GAP_POR_DENSIDADE, GAP_ABSOLUTO_SEC, MARGEM_DAS_PONTAS_SEC,
  planejarSfx, normalizarSfxCfg, planoDaTrilha, ganhoDaTrilha, normalizarTrilhaCfg, TRILHA_FADE_OUT_SEC,
  normalizarVelocidadeCfg, velocidadeEfetiva, escalarTempos, fimDoGanchoNoVideo, dbDoVolume, lufsIntegrado, limitarPicos,
  type SfxCfg,
} from './pilot-sonoplastia';
import {
  transicoesDasJanelas, coberturaNoInstante, coberturaDaTransicao, aberturaDoOlho, alcanceDaTransicao,
  normalizarInsert, insertPadrao, TIPOS_DE_TRANSICAO, PISCAR_ANTES_SEC, PISCAR_DEPOIS_SEC, PISCAR_FECHADO_SEC, PISCAR_FECHA_SEC, PISCAR_ABRE_SEC,
  type TipoTransicao,
} from './pilot-inserts';
import { contornoDoOlho, meiaAlturaMaxima } from './transicao-olho';
import { zipGroupId, grupoAutogerido } from './zip-store-prune';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}
const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const ligado = (extra: Partial<SfxCfg> = {}): SfxCfg => ({ ...SFX_CFG_DEFAULT, on: true, ...extra });

console.log('PISCAR — o olho que fecha no corte:');
{
  ok(TIPOS_DE_TRANSICAO.includes('piscar'), 'piscar é uma transição de verdade');
  const ins = normalizarInsert({ ...insertPadrao('p', 'HOOK 1', { key: 'k', nome: 'a', tipo: 'video', w: 1, h: 1 }), transicao: 'piscar' });
  ok(ins.transicao === 'piscar', 'piscar sobrevive à normalização (não vira escurecer calado)');
  ok(aberturaDoOlho(-1) === 1 && aberturaDoOlho(1) === 1, 'longe da borda o olho está aberto (nada desenhado)');
  ok(aberturaDoOlho(0) === 0 && aberturaDoOlho(-PISCAR_FECHADO_SEC) === 0 && aberturaDoOlho(PISCAR_FECHADO_SEC) === 0,
    'na borda (o corte) o olho está FECHADO — a troca de imagem fica escondida');
  let monotono = true;
  for (let d = -PISCAR_ANTES_SEC; d < -PISCAR_FECHADO_SEC; d += 0.005) if (aberturaDoOlho(d + 0.005) > aberturaDoOlho(d) + 1e-9) monotono = false;
  for (let d = PISCAR_FECHADO_SEC; d < PISCAR_DEPOIS_SEC; d += 0.005) if (aberturaDoOlho(d + 0.005) < aberturaDoOlho(d) - 1e-9) monotono = false;
  ok(monotono, 'fecha sem voltar e abre sem voltar (nenhum quadro tremendo)');
  ok(PISCAR_FECHA_SEC < PISCAR_ABRE_SEC, 'fecha mais rápido do que abre, como um piscar de verdade');
  const c = coberturaDaTransicao('piscar', 10, 10);
  ok(!!c && c.forma === 'olho' && c.abertura === 0 && c.alpha === 1, 'cobertura da piscada vem como PÁLPEBRAS (forma olho), não véu de cor');
  ok(coberturaDaTransicao('piscar', 10 - PISCAR_ANTES_SEC - 0.01, 10) === null && coberturaDaTransicao('piscar', 10 + PISCAR_DEPOIS_SEC + 0.01, 10) === null,
    'fora do alcance da piscada nada é desenhado');
  ok(alcanceDaTransicao('piscar').antes === PISCAR_ANTES_SEC && alcanceDaTransicao('nenhuma').antes === 0, 'alcance por tipo de transição');
  // geometria: aberta cobre nada (cantos livres), fechada é uma linha
  const W = 1080, H = 1920;
  const hmax = meiaAlturaMaxima(W, H);
  const aberto = contornoDoOlho(W, H, 1);
  const cima = aberto.slice(0, aberto.length / 2);
  // na borda lateral do quadro, a abertura passa da metade da altura (cantos visíveis)
  const naBorda = cima.reduce((m, p) => (Math.abs(p.x) < Math.abs(m.x) ? p : m), cima[0]);
  ok(hmax > H && naBorda.y < 0, 'olho todo aberto não tapa nem os cantos do quadro (sem estalo ao terminar)');
  const fechado = contornoDoOlho(W, H, 0);
  ok(fechado.every((p) => perto(p.y, H / 2, 1e-6)), 'olho fechado = pálpebras encostadas no meio (quadro todo preto)');
}

console.log('\nTRANSIÇÕES DO VÍDEO — a mesma lista que o render desenha:');
{
  const janelas = [
    { id: 'a', start: 2, end: 5 },
    { id: 'b', start: 5, end: 8 }, // emendado no a
    { id: 'c', start: 11, end: 14 },
  ];
  const tipos: Record<string, TipoTransicao> = { a: 'luz-vermelha', b: 'escurecer', c: 'misto' };
  const tr = transicoesDasJanelas(janelas, (id) => tipos[id]);
  ok(tr.length === 5, `5 trocas (a borda colada a|b conta uma vez) — veio ${tr.length}`);
  const colada = tr.find((x) => x.t === 5)!;
  ok(colada.tipo === 'luz-vermelha' && colada.chave === 'a@saida', 'na borda colada vale a do primeiro, como no quadro');
  // paridade com o render: em cada borda, a cor do quadro é a do tipo resolvido
  const corDo = (t: string) => (t === 'escurecer' ? 'preto' : t === 'luz' ? 'branco' : t === 'luz-vermelha' ? 'vermelho' : 'olho');
  ok(tr.every((x) => {
    const c = coberturaNoInstante(x.t, janelas, (id) => tipos[id]);
    return !!c && (c.forma === 'olho' ? 'olho' : c.cor) === corDo(x.tipo);
  }), 'cada transição da lista é EXATAMENTE a que o render pinta naquele instante (misto já resolvido)');
  const misto = tr.filter((x) => x.insertId === 'c');
  ok(misto.length === 2 && misto[0].tipo !== misto[1].tipo, 'misto alterna entre as duas bordas');
  const comNenhuma = transicoesDasJanelas([{ id: 'x', start: 1, end: 2 }, { id: 'y', start: 2, end: 3 }], (id) => (id === 'x' ? 'nenhuma' : 'luz'));
  ok(comNenhuma.length === 2 && comNenhuma[0].chave === 'y@entrada', 'borda seca + borda com luz coladas: vale a luz (o render também)');
}

console.log('\nSMART SFX — a batida cai no pico da transição:');
{
  ok(SFX_IDS.length === 6, 'catálogo = Plim 1, Plim 15, Riser Metálico, Camera Flash, Click do Mouse e Boom');
  ok(SFX_IDS.every((id) => SFX_CATALOGO[id].hitSec >= 0 && SFX_CATALOGO[id].hitSec <= SFX_CATALOGO[id].usoSec),
    'todo hit calibrado cai dentro do trecho usado do arquivo');
  ok(SFX_CATALOGO['mouse-click'].hitSec > 1, 'o clique do mouse tem 1s de silêncio antes — calibrado, não começa no 0');
  ok(SFX_CATALOGO['riser-metalico'].encaixe === 'final', 'riser encaixa pelo FIM (termina na transição)');
  ok(SFX_IDS.every((id) => SFX_CATALOGO[id].ganho > 0 && SFX_CATALOGO[id].ganho < 0.5), 'volumes calibrados baixos — pontuam, não disputam com a voz');

  const tr = transicoesDasJanelas(
    [
      { id: 'v', start: 4, end: 7 },
      { id: 'p', start: 12, end: 15 },
      { id: 'l', start: 20, end: 24 },
      { id: 'e', start: 30, end: 33 },
    ],
    (id) => ({ v: 'luz-vermelha', p: 'piscar', l: 'luz', e: 'escurecer' } as Record<string, TipoTransicao>)[id],
  );
  const plano = planejarSfx(ligado({ boomNoGancho: false }), { transicoes: tr, durSec: 40 });
  const bate = (s: (typeof plano)[number]) => s.inicio - s.deSec + SFX_CATALOGO[s.sfx].hitSec;
  ok(plano.every((s) => perto(bate(s), s.t)), 'TODO som: começo do arquivo + hit calibrado = instante exato da transição');
  const risers = plano.filter((s) => s.sfx === 'riser-metalico');
  ok(risers.length === 2 && risers.every((s) => perto(s.inicio + s.dur, s.t, 1e-3) || perto(s.inicio + SFX_CATALOGO['riser-metalico'].hitSec, s.t)),
    'riser TERMINA no pico da luz vermelha (sobe antes, acaba no corte)');
  ok(plano.filter((s) => s.sfx === 'mouse-click').every((s) => s.motivo === 'piscar') && plano.some((s) => s.sfx === 'mouse-click'),
    'piscada recebe o clique do mouse');
  ok(plano.some((s) => s.sfx === 'camera-flash' && s.motivo === 'luz'), 'luz branca recebe o camera flash');
  ok(plano.some((s) => (s.sfx === 'plim-1' || s.sfx === 'plim-15') && s.motivo === 'escurecer'), 'escurecer recebe plim');
  ok(plano.every((s) => s.inicio >= 0 && s.inicio + s.dur <= 40 + 1e-9), 'nenhum som começa antes ou passa do fim do vídeo');

  // densidade: transições a cada 1s — equilibrado espaça, todas aceita mais
  const muitas = transicoesDasJanelas(Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, start: 2 + i * 2, end: 3 + i * 2 })), () => 'escurecer');
  const eq = planejarSfx(ligado({ boomNoGancho: false }), { transicoes: muitas, durSec: 30 });
  const todas = planejarSfx(ligado({ boomNoGancho: false, densidade: 'todas' }), { transicoes: muitas, durSec: 30 });
  const pontual = planejarSfx(ligado({ boomNoGancho: false, densidade: 'pontual' }), { transicoes: muitas, durSec: 30 });
  const gapMin = (p: typeof eq) => Math.min(...p.slice(1).map((s, i) => s.t - p[i].t));
  ok(gapMin(eq) >= GAP_POR_DENSIDADE.equilibrado - 1e-9, `equilibrado: batidas comuns a pelo menos ${GAP_POR_DENSIDADE.equilibrado}s`);
  ok(pontual.length < eq.length && eq.length < todas.length, `pontual < equilibrado < todas (${pontual.length} < ${eq.length} < ${todas.length})`);
  const plims = eq.map((s) => s.sfx);
  ok(plims.length > 2 && plims.every((id, i) => i === 0 || id !== plims[i - 1]),
    'escurecer alterna Plim 1 / Plim 15 entre os que ficaram (nunca o mesmo plim colado)');

  // assinatura nunca some por densidade; comum perto dela sai
  const disputa = transicoesDasJanelas([{ id: 'r', start: 10, end: 13 }, { id: 'e', start: 9.2, end: 9.6 }], (id) => (id === 'r' ? 'luz-vermelha' : 'escurecer'));
  const pd = planejarSfx(ligado({ boomNoGancho: false }), { transicoes: disputa, durSec: 20 });
  ok(pd.some((s) => s.sfx === 'riser-metalico' && s.t === 10), 'o riser casado com a luz vermelha nunca é o que sai');
  ok(!pd.some((s) => s.t > 10 - SFX_CATALOGO['riser-metalico'].hitSec && s.t < 10 && s.sfx !== 'riser-metalico'),
    'nada bate DENTRO da subida do riser (o som não embola)');
  const doisRisers = transicoesDasJanelas([{ id: 'a', start: 10, end: 11 }], () => 'luz-vermelha');
  const p2 = planejarSfx(ligado({ boomNoGancho: false }), { transicoes: doisRisers, durSec: 20 });
  ok(p2.filter((s) => s.sfx === 'riser-metalico').length === 1, 'dois risers colados: só um sobe (a subida não atropela o clímax do outro)');

  // pontas do vídeo
  const pontas = transicoesDasJanelas([{ id: 'z', start: 0, end: 19.95 }], () => 'escurecer');
  ok(planejarSfx(ligado(), { transicoes: pontas, durSec: 20 }).length === 0, `borda colada no começo/fim (< ${MARGEM_DAS_PONTAS_SEC}s) não toca som cortado`);

  // boom no gancho
  const comGancho = transicoesDasJanelas([{ id: 'h', start: 6.1, end: 9 }], () => 'escurecer');
  const pb = planejarSfx(ligado(), { transicoes: comGancho, durSec: 20, fimDoGancho: 6 });
  ok(pb.some((s) => s.sfx === 'boom' && s.chave === 'gancho' && s.t === 6.1), 'boom de suspense toma a transição da virada do gancho');
  const semTransicaoNoGancho = planejarSfx(ligado(), { transicoes: [], durSec: 20, fimDoGancho: 6 });
  ok(semTransicaoNoGancho.length === 1 && semTransicaoNoGancho[0].sfx === 'boom' && semTransicaoNoGancho[0].t === 6, 'sem transição na virada, o boom bate no próprio corte hook→body');
  ok(planejarSfx(ligado({ boomNoGancho: false }), { transicoes: [], durSec: 20, fimDoGancho: 6 }).length === 0, 'boom desligado = nada no gancho');
  const ganchoNoRiser = transicoesDasJanelas([{ id: 'r', start: 6, end: 9 }], () => 'luz-vermelha');
  ok(planejarSfx(ligado(), { transicoes: ganchoNoRiser, durSec: 20, fimDoGancho: 6 }).some((s) => s.sfx === 'riser-metalico'),
    'o boom não rouba o riser da luz vermelha');

  // edição ponto a ponto
  const ed = planejarSfx(ligado({ boomNoGancho: false, pontos: { 'l@entrada': 'boom', 'v@entrada': 'nenhum' } }), { transicoes: tr, durSec: 40 });
  ok(ed.some((s) => s.chave === 'l@entrada' && s.sfx === 'boom') && !ed.some((s) => s.chave === 'v@entrada'),
    'o editor troca o som de UM ponto (ou tira) e o resto segue smart');
  // volume
  const alto = planejarSfx(ligado({ boomNoGancho: false, volume: 2, volumePorSom: { 'camera-flash': 0.5 } }), { transicoes: tr, durSec: 40 });
  const flash = alto.find((s) => s.sfx === 'camera-flash')!;
  ok(perto(flash.ganho, SFX_CATALOGO['camera-flash'].ganho * 2 * 0.5), 'ganho = calibrado × volume geral × ajuste do som');
  ok(planejarSfx({ ...ligado(), on: false }, { transicoes: tr, durSec: 40 }).length === 0, 'Smart SFX desligado = nenhum som');

  const norm = normalizarSfxCfg({ on: true, porTransicao: { luz: 'xpto' }, volume: 99, densidade: 'louco', pontos: { a: 'boom', b: 'zzz' } });
  ok(norm.porTransicao.luz === 'camera-flash' && norm.volume === 2 && norm.densidade === 'equilibrado' && norm.pontos!.a === 'boom' && norm.pontos!.b === 'nenhum',
    'config estranha do localStorage vira config válida (som desconhecido nunca derruba a montagem)');
  ok(GAP_ABSOLUTO_SEC > 0.3, 'nem as de assinatura batem coladas');
}

console.log('\nTRILHA — sempre no tamanho do vídeo:');
{
  const longa = planoDaTrilha(60, 180);
  ok(longa.length === 1 && longa[0].dur === 60 && perto(longa[0].fadeOut, TRILHA_FADE_OUT_SEC), 'trilha de 3min num vídeo de 1min: toca 60s e morre com fade — não sobra 2min');
  const curta = planoDaTrilha(70, 30);
  const fim = Math.max(...curta.map((p) => p.inicio + p.dur));
  ok(perto(fim, 70, 1e-6) && curta.length === 3, `trilha curta repete com emenda até o último quadro (${curta.length} pedaços, termina em ${fim.toFixed(2)}s)`);
  ok(curta.slice(1).every((p, i) => p.inicio < curta[i].inicio + curta[i].dur && p.fadeIn > 0), 'emendas em crossfade (o pedaço novo entra antes do velho acabar)');
  ok(planoDaTrilha(0, 30).length === 0 && planoDaTrilha(30, 0).length === 0, 'sem vídeo ou sem trilha: nada');
  ok(perto(dbDoVolume(0.12), -18.42, 0.01), 'volume 12% = ~18 dB abaixo da voz');
  const g = ganhoDaTrilha(0.12, -16, -10);
  ok(perto(g, Math.pow(10, -6 / 20) * 0.12, 1e-9), 'trilha nivelada NA voz antes do volume relativo (trilha alta não estoura)');
  ok(ganhoDaTrilha(0, -16, -10) === 0, 'volume zero = muda');
  ok(normalizarTrilhaCfg({ on: true, trilhaId: '' }).on === false, 'sem arquivo a trilha não liga (montagem nunca procura arquivo inexistente)');
  ok(zipGroupId('pilotTrilha:abc') === 'pilotTrilha:abc' && grupoAutogerido('pilotTrilha:abc'),
    'biblioteca de trilhas tem ciclo de vida próprio (a faxina do cache não apaga a trilha do cliente)');
}

console.log('\nVELOCIDADE — a mesma régua do Mixer de Velocidade:');
{
  ok(velocidadeEfetiva({ on: false, velocidade: 1.3 }) === 1, 'desligado = 1x');
  ok(velocidadeEfetiva({ on: true, velocidade: 1.149999 }) === 1.15, 'na grade de 0,05 (1,149999 → 1,15)');
  ok(normalizarVelocidadeCfg({ on: true, velocidade: 9 }).velocidade === 3 && normalizarVelocidadeCfg({ on: true, velocidade: 0.1 }).velocidade === 0.5,
    'presa entre 0,5x e 3x (como no Mixer)');
  const partes = escalarTempos([10, 20], 1.25)!;
  ok(perto(partes[0], 8) && perto(partes[1], 16), 'fronteiras dos takes encolhem junto com o vídeo');
  const internos = escalarTempos([[2, 8], [5, 15]], 2)!;
  ok(perto(internos[1][1], 7.5), 'cortes internos da decupagem também');
  ok(escalarTempos(null, 1.5) === null, 'sem fronteira, sem conta');
}

console.log('\nLOUDNESS (BS.1770) e LIMITADOR:');
{
  const taxa = 48000;
  const seno = (amp: number, seg = 5, f = 997) => {
    const x = new Float32Array(taxa * seg);
    for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / taxa);
    return x;
  };
  const um = lufsIntegrado([seno(1)], taxa)!;
  ok(perto(um, -3.01, 0.05), `seno 1kHz em 0 dBFS num canal = -3,01 LUFS (calibração da norma) — deu ${um.toFixed(3)}`);
  const dois = lufsIntegrado([seno(0.1), seno(0.1)], taxa)!;
  ok(perto(dois, -20, 0.06), `estéreo a -20 dBFS = -20 LUFS — deu ${dois.toFixed(3)}`);
  ok(lufsIntegrado([new Float32Array(taxa * 3)], taxa) === null, 'silêncio = sem medida (não inventa número)');
  const grave = lufsIntegrado([seno(1, 5, 30)], taxa)!;
  ok(grave < um - 3, 'grave de 30 Hz pesa menos que 1 kHz no mesmo nível (ponderação K de verdade)');

  const voz = seno(0.6, 2, 220);
  const sfx = seno(0.6, 2, 3000);
  const mix = voz.map((v, i) => (i > taxa * 0.9 && i < taxa * 1.1 ? v + sfx[i] : v));
  const antes = mix.slice();
  const reducao = limitarPicos([mix], taxa, 0.97);
  const pico = mix.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  ok(pico <= 0.97 + 1e-6 && reducao < 0, `pico do SFX em cima da voz não estoura (pico ${pico.toFixed(3)}, ${reducao.toFixed(1)} dB)`);
  ok(perto(mix[taxa * 0.3], antes[taxa * 0.3], 1e-6) && perto(mix[Math.round(taxa * 1.6)], antes[Math.round(taxa * 1.6)], 1e-6),
    'longe do pico a voz não muda NADA (o limitador age só ali, não abaixa o AD inteiro)');
  const limpo = seno(0.5, 1);
  ok(limitarPicos([limpo], taxa) === 0, 'sem estouro, nada é tocado');
}

console.log('\nFIM DO GANCHO:');
{
  ok(fimDoGanchoNoVideo([3, 2, 10], ['HOOK 1', 'HOOK 1.2', 'BODY 1']) === 5, 'soma das partes de hook do começo');
  ok(fimDoGanchoNoVideo([3, 10], ['BODY 1', 'BODY 2']) === null, 'vídeo sem hook: sem boom');
  ok(fimDoGanchoNoVideo([3], ['HOOK 1']) === null, 'só hook: não há virada');
  ok(fimDoGanchoNoVideo([3, 10], ['HOOK 1']) === null, 'labels desencontradas: não chuta');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-sonoplastia: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
