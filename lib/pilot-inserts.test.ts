/**
 * GARANTIA dos INSERTS do Pilot — as três decisões difíceis.
 *
 * O que isto blinda:
 *  (a) ANCORAGEM: a palavra que o editor aponta na copy vira o instante certo
 *      no vídeo, mesmo com o ASR comendo/inventando palavra; e sem ASR
 *      confiável o insert cai perto, nunca fora do vídeo;
 *  (b) ENQUADRAMENTO: nenhum layout deixa borda (é COVER de verdade) e o
 *      avatar no split é ancorado no ROSTO, não no centro que decapita;
 *  (c) TRANSIÇÃO: o pico da cobertura cai EXATAMENTE na borda, que é onde a
 *      imagem troca — senão o flash aparece fora do corte.
 */
import {
  mapearPartesNoAsr,
  janelasDosInserts,
  coverComFoco,
  palcoDoLayout,
  coberturaDaTransicao,
  coberturaNoInstante,
  insertPadrao,
  planoDeVelocidade,
  normalizarInsert,
  blurDoSlowMotion,
  INSERT_BLUR_MAX,
  tempoNaMidia,
  encaixarNoCorte,
  cortesDoVideo,
  janelaDaHeadline,
  textoDaHeadline,
  INSERT_VEL_MIN,
  INSERT_FOCO_PADRAO,
  TRANSICAO_DUR_SEC,
  type Insert,
  type PalavraTempo,
} from './pilot-inserts';

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

console.log('\nGARANTIA — inserts do Pilot (âncora, enquadramento, transição):');

/* ─────────────────────── material de teste ─────────────────────── */

const PARTES = [
  { label: 'HOOK 1', text: 'como transformar um azeite comum no seu remedio' },
  { label: 'BODY 1', text: 'a maioria das pessoas usa ele do jeito errado' },
  { label: 'BODY 2', text: 'o composto que importa se chama oleocantal' },
];
/** ASR fiel: cada palavra 500ms, em sequência. */
function asrFiel(): PalavraTempo[] {
  const todas = PARTES.flatMap((p) => p.text.split(' '));
  return todas.map((t, i) => ({ text: t, start: i * 500, end: i * 500 + 420 }));
}
const DUR = PARTES.flatMap((p) => p.text.split(' ')).length * 0.5;

/* ════════════════ (1) ANCORAGEM: copy → palavras do ASR ════════════════ */
{
  const faixas = mapearPartesNoAsr(asrFiel().map((w) => w.text), PARTES);
  ok(faixas !== null, 'ASR fiel: o mapa das partes existe');
  if (faixas) {
    ok(faixas.length === 3, 'uma faixa por parte');
    ok(faixas[0].de === 0, 'o HOOK começa na palavra 0');
    ok(faixas[0].ate === 8, 'e termina onde o hook acaba (8 palavras)');
    ok(faixas[1].de === 8, 'o BODY 1 começa logo depois');
    ok(faixas[2].ate === 24, 'e o último fecha na última palavra (8+9+7)');
    let monotono = true;
    for (let i = 1; i < faixas.length; i++) if (faixas[i].de < faixas[i - 1].ate) monotono = false;
    ok(monotono, 'as faixas nunca voltam no tempo');
  }
}

// ⭐ O DEFEITO QUE ISTO EVITA: o ASR não fala o mesmo que o doc. Se a âncora
// fosse contagem cega, o insert entraria no meio da frase errada.
{
  const fiel = asrFiel();
  // ASR comeu 'comum' (palavra 4) e inventou 'ai' no body
  const podre: PalavraTempo[] = fiel
    .filter((w) => w.text !== 'comum')
    .flatMap((w, i) => (i === 9 ? [w, { text: 'ai', start: w.end, end: w.end + 200 }] : [w]));
  const faixas = mapearPartesNoAsr(podre.map((w) => w.text), PARTES);
  ok(faixas !== null, 'ASR com palavra comida E inventada ainda mapeia');
  if (faixas) {
    ok(faixas[0].ate === 7, 'o hook encolheu junto com o ASR (7, não 8)');
    ok(faixas[1].de >= faixas[0].ate, 'e o body continua começando depois dele');
  }
}

// o mapa SE RECUSA quando não dá pra confiar
{
  ok(mapearPartesNoAsr([], PARTES) === null, 'ASR vazio → sem mapa');
  ok(mapearPartesNoAsr(['a', 'b'], PARTES) === null, 'ASR curtíssimo → sem mapa');
  ok(
    mapearPartesNoAsr(['xis', 'zeta', 'plutonio', 'gamba', 'quiabo', 'lasanha'], PARTES) === null,
    'ASR sem NADA a ver com a copy → sem mapa (não inventa âncora)',
  );
  ok(mapearPartesNoAsr(asrFiel().map((w) => w.text), []) === null, 'sem partes → sem mapa');
}

/* ══════════════ (2) as janelas caem no ponto certo do vídeo ═════════════ */
{
  // trecho: palavras 0..3 do BODY 1 (que começa na palavra 8 do ASR, 0.5s cada)
  const ins: Insert[] = [
    { ...insertPadrao('a', 'BODY 1', { key: 'k', nome: 'n', tipo: 'imagem', w: 1920, h: 1080 }), palavraDe: 0, palavraAte: 3 },
  ];
  const j = janelasDosInserts(ins, PARTES, asrFiel(), DUR);
  ok(j.length === 1, 'uma janela');
  ok(aprox(j[0].start, 4.0, 0.01), 'começa no INÍCIO da 1ª palavra do trecho (4.0s)');
  ok(j[0].end > 5.5 && j[0].end < 6.2, `e termina no FIM da última (deu ${j[0].end.toFixed(2)}s)`);
}

// a PALAVRA escolhida manda — é o "aparecer antes da parte acabar"
{
  const ins: Insert[] = [
    { ...insertPadrao('a', 'BODY 1', { key: 'k', nome: 'n', tipo: 'imagem', w: 100, h: 100 }), palavraDe: 5, palavraAte: 6 },
  ];
  const j = janelasDosInserts(ins, PARTES, asrFiel(), DUR);
  ok(aprox(j[0].start, 6.5, 0.01), 'trecho começando na palavra 5 → 6.5s (não o começo da parte)');
}

// SOBREPOSIÇÃO: dois inserts no mesmo ponto não podem tocar juntos
{
  const base = insertPadrao('x', 'HOOK 1', { key: 'k', nome: 'n', tipo: 'imagem', w: 100, h: 100 });
  const ins: Insert[] = [
    { ...base, id: 'a', palavraDe: 0, palavraAte: 5 },
    { ...base, id: 'b', palavraDe: 1, palavraAte: 6 },
  ];
  const j = janelasDosInserts(ins, PARTES, asrFiel(), DUR);
  ok(j.length === 2, 'os dois sobrevivem');
  ok(j[0].end <= j[1].start + 0.001, 'o segundo é EMPURRADO pra depois do primeiro (nunca sobrepõem)');
}

// nada escapa da duração do vídeo
{
  const ins: Insert[] = [
    { ...insertPadrao('a', 'BODY 2', { key: 'k', nome: 'n', tipo: 'imagem', w: 100, h: 100 }), palavraDe: 90, palavraAte: 99 },
  ];
  const j = janelasDosInserts(ins, PARTES, asrFiel(), DUR);
  ok(j.every((x) => x.start >= 0 && x.end <= DUR + 0.001), 'janela nunca passa do fim do vídeo');
}

// sem ASR confiável, RATEIA — grosseiro, mas dentro do vídeo e na ordem certa
{
  const ins: Insert[] = [
    { ...insertPadrao('a', 'HOOK 1', { key: 'k', nome: 'n', tipo: 'imagem', w: 1, h: 1 }), palavraDe: 0, palavraAte: 2 },
    { ...insertPadrao('b', 'BODY 2', { key: 'k', nome: 'n', tipo: 'imagem', w: 1, h: 1 }), palavraDe: 0, palavraAte: 2 },
  ];
  const semAsr = janelasDosInserts(ins, PARTES, [], 30);
  ok(semAsr.length === 2, 'sem ASR os dois inserts continuam existindo');
  ok(semAsr[0].start < semAsr[1].start, 'e o do HOOK vem ANTES do que está no fim da copy');
  ok(semAsr.every((x) => x.end <= 30.001), 'e nenhum passa do fim');
}

/* ══════════ (3) ENQUADRAMENTO: cover de verdade, sem borda ══════════ */
{
  // 16:9 dentro de 9:16 — o caso que deixaria tarja preta se fosse "contain"
  const r = coverComFoco(1920, 1080, 1080, 1920);
  const escalaX = 1080 / r.sw;
  const escalaY = 1920 / r.sh;
  ok(aprox(escalaX, escalaY, 0.01), 'o recorte tem a MESMA proporção do destino (sem distorcer)');
  ok(r.sw <= 1920.001 && r.sh <= 1080.001, 'o recorte cabe dentro da fonte');
  ok(aprox(r.sw * (1920 / 1080), r.sh * 1, 1) || r.sw < 1920, 'corta a largura (o excesso do 16:9)');
  ok(r.sx >= 0 && r.sy >= 0, 'o recorte nunca começa fora da imagem');

  // 9:16 dentro de 16:9 — o inverso
  const r2 = coverComFoco(1080, 1920, 1920, 1080);
  ok(aprox(1920 / r2.sw, 1080 / r2.sh, 0.01), 'proporção mantida no caso inverso');
  ok(r2.sy >= 0 && r2.sy + r2.sh <= 1920.001, 'e o recorte continua dentro da fonte');

  // quadrado em 9:16
  const r3 = coverComFoco(1000, 1000, 1080, 1920);
  ok(aprox(1080 / r3.sw, 1920 / r3.sh, 0.01), 'quadrado também preenche sem borda');
}

// ⭐ O FOCO NO ROSTO: é o que separa "avatar no split" de "avatar decapitado"
{
  const dst = { w: 1080, h: 960 }; // metade de um 9:16 — o split
  const centro = coverComFoco(1080, 1920, dst.w, dst.h, 0.5);
  const rosto = coverComFoco(1080, 1920, dst.w, dst.h, INSERT_FOCO_PADRAO);
  ok(rosto.sy < centro.sy, 'com foco no rosto o recorte sobe (pega a cabeça, não a barriga)');
  ok(rosto.sy >= 0, 'e nunca sai por cima da imagem');
  ok(aprox(rosto.sw, centro.sw) && aprox(rosto.sh, centro.sh), 'o TAMANHO do recorte não muda — só a posição');

  // foco extremo não quebra: satura nas bordas
  const topo = coverComFoco(1080, 1920, dst.w, dst.h, 0);
  const base = coverComFoco(1080, 1920, dst.w, dst.h, 1);
  ok(topo.sy === 0, 'foco 0 gruda no topo');
  ok(aprox(base.sy + base.sh, 1920, 0.01), 'foco 1 gruda na base');
}

// entrada inválida não gera NaN (um NaN aqui viraria frame preto no render)
{
  const r = coverComFoco(0, 0, 1080, 1920);
  ok(Number.isFinite(r.sx) && Number.isFinite(r.sw) && r.sw > 0, 'fonte 0×0 devolve recorte finito');
}

/* ══════════════════ (4) LAYOUTS: o palco de cada modo ═══════════════════ */
{
  const W = 1080;
  const H = 1920;

  const cheia = palcoDoLayout({ tipo: 'cheia' }, W, H);
  ok(cheia.avatar === null, 'tela cheia: o avatar sai de cena');
  ok(cheia.insert.w === W && cheia.insert.h === H, 'e o insert toma a tela inteira');

  const faixasCima = palcoDoLayout({ tipo: 'faixas', avatar: 'cima' }, W, H);
  ok(faixasCima.avatar!.y === 0, 'faixas/avatar em cima: o avatar fica no topo');
  ok(faixasCima.insert.y === faixasCima.avatar!.h, 'e o insert começa exatamente onde ele acaba');
  ok(
    faixasCima.avatar!.h + faixasCima.insert.h === H,
    'as duas faixas somam a tela inteira (sem faixa preta no meio)',
  );

  const faixasBaixo = palcoDoLayout({ tipo: 'faixas', avatar: 'baixo' }, W, H);
  ok(faixasBaixo.avatar!.y > faixasBaixo.insert.y, 'faixas/avatar embaixo: inverte de verdade');

  const cards = palcoDoLayout({ tipo: 'cards', avatar: 'cima' }, W, H);
  ok(cards.raio > 0, 'cards têm canto arredondado');
  ok(cards.avatar!.x > 0 && cards.avatar!.x + cards.avatar!.w < W, 'e margem nos dois lados');
  ok(cards.insert.y > cards.avatar!.y + cards.avatar!.h, 'com respiro entre os dois');
  ok(cards.insert.y + cards.insert.h <= H, 'sem estourar a tela');

  const cardsBaixo = palcoDoLayout({ tipo: 'cards', avatar: 'baixo' }, W, H);
  ok(cardsBaixo.avatar!.y > cardsBaixo.insert.y, 'cards/avatar embaixo também inverte');
}

/* ═════════════════════════ (5) TRANSIÇÃO ══════════════════════════ */
{
  const borda = 10;
  ok(coberturaDaTransicao('nenhuma', 10, borda) === null, 'sem transição, nunca cobre');
  const noPico = coberturaDaTransicao('escurecer', borda, borda);
  ok(noPico !== null && aprox(noPico.alpha, 1, 0.001), 'o PICO cai EXATAMENTE na borda (onde a imagem troca)');
  ok(noPico!.cor === 'preto', 'escurecer usa preto');

  const antes = coberturaDaTransicao('escurecer', borda - TRANSICAO_DUR_SEC / 4, borda);
  ok(antes !== null && antes.alpha > 0.4 && antes.alpha < 0.6, 'na metade do caminho, meia cobertura');
  ok(coberturaDaTransicao('escurecer', borda - 1, borda) === null, 'longe da borda não cobre nada');

  ok(coberturaDaTransicao('luz', borda, borda)!.cor === 'branco', 'luz usa branco');
  ok(coberturaDaTransicao('misto', borda, borda, 0)!.cor === 'preto', 'misto: 1ª ocorrência escurece');
  ok(coberturaDaTransicao('misto', borda, borda, 1)!.cor === 'branco', 'misto: 2ª ocorrência clareia');

  // a curva é simétrica — abre igual ao que fechou
  const e1 = coberturaDaTransicao('escurecer', borda - 0.07, borda)!.alpha;
  const e2 = coberturaDaTransicao('escurecer', borda + 0.07, borda)!.alpha;
  ok(aprox(e1, e2, 0.001), 'a cobertura é simétrica em torno da borda');
}

// no vídeo inteiro: cobre nas bordas das janelas, e só nelas
{
  const janelas = [
    { id: 'a', start: 5, end: 8 },
    { id: 'b', start: 20, end: 23 },
  ];
  const tipo = () => 'escurecer' as const;
  ok(coberturaNoInstante(5, janelas, tipo) !== null, 'cobre na ENTRADA do insert');
  ok(coberturaNoInstante(8, janelas, tipo) !== null, 'cobre na SAÍDA do insert');
  ok(coberturaNoInstante(6.5, janelas, tipo) === null, 'NÃO cobre no meio do insert (o take tem que ser visto)');
  ok(coberturaNoInstante(14, janelas, tipo) === null, 'nem longe de qualquer janela');
  // misto alterna ao longo do vídeo
  const m = () => 'misto' as const;
  const c1 = coberturaNoInstante(5, janelas, m);
  const c2 = coberturaNoInstante(8, janelas, m);
  ok(c1!.cor !== c2!.cor, 'misto ALTERNA entre as bordas (não vira seis flashes iguais)');
}

/* ═══════════════════ (6) o insert padrão é sensato ═══════════════════ */
{
  const img = insertPadrao('i1', 'HOOK 1', { key: 'k', nome: 'foto.jpg', tipo: 'imagem', w: 1920, h: 1080 });
  // Desde 01.09 não existe "duração do insert": ele cobre o TRECHO marcado na
  // copy, e a mídia é que se ajusta (corta ou desacelera).
  ok(img.palavraDe === 0 && img.palavraAte === 0, 'nasce marcando a 1ª palavra — o editor estende dali');
  ok(img.layout.tipo === 'cheia', 'e em tela cheia');
  ok(img.focoAvatarY === INSERT_FOCO_PADRAO, 'com o foco no rosto já ligado');
  const vid = insertPadrao('v1', 'BODY 1', { key: 'k', nome: 'v.mp4', tipo: 'video', w: 1920, h: 1080, durSec: 4.2 });
  ok(!('duracaoSec' in vid), 'a duração do arquivo NÃO vira campo — ela vira velocidade');
}


/* ══════ (7) o insert PREENCHE a parte: longo CORTA, curto DESACELERA ══════ */
{
  // exato
  const e = planoDeVelocidade(4, 4);
  ok(e.velocidade === 1 && !e.corta && e.motivo === 'exato', 'mídia do tamanho da janela: nada a fazer');

  // LONGO demais → corta (roda normal e morre no fim da parte)
  const c = planoDeVelocidade(12, 4);
  ok(c.velocidade === 1, 'mídia longa NÃO acelera (ficaria cômico) — roda normal');
  ok(c.corta === true && c.motivo === 'cortou', 'ela é CORTADA onde a parte da fala morre');

  // CURTO demais → desacelera
  const d = planoDeVelocidade(3, 4);
  ok(aprox(d.velocidade, 0.75), 'mídia curta desacelera na razão exata (3/4 = 0.75x)');
  ok(!d.corta && d.congelaApos === 0 && d.motivo === 'desacelerou', 'e cobre a janela inteira');

  /* ── CLIPE CURTO DEMAIS: não estica NADA (02.09) ────────────────────
   * Silas fez uma tela dividida com o insert mais longo que o hook e o AD
   * saiu numa câmera lenta que *"parece que tá indo de quadro em quadro"*.
   * Duas regras nasceram daí: mídia que SOBRA nunca muda de velocidade, e
   * clipe abaixo de 2s nunca é esticado — ele roda no tempo dele e o último
   * quadro segura. */
  const x = planoDeVelocidade(1, 10);
  ok(x.velocidade === 1, 'clipe de 1s NÃO é esticado — rodaria a 0,1x e viraria slideshow');
  ok(aprox(x.congelaApos, 1), 'ele roda inteiro (1s) e o último quadro segura o resto');
  ok(x.motivo === 'desacelerou-e-congelou', 'o motivo é honesto');
  ok(x.blur === 0, 'e sem borrão: não há câmera lenta pra mascarar');

  // no limite do piso de esticar
  ok(planoDeVelocidade(1.9, 12).velocidade === 1, '1,9s ainda é curto demais pra esticar');
  ok(planoDeVelocidade(2.5, 3).velocidade < 1, '2,5s já pode desacelerar de leve');

  // ── a desaceleração NUNCA passa do piso suave ──
  for (const [nat, jan] of [[3, 20], [2.5, 30], [4, 9], [2.2, 100]] as Array<[number, number]>) {
    const pv = planoDeVelocidade(nat, jan);
    ok(pv.velocidade >= INSERT_VEL_MIN - 1e-9,
      `${nat}s em ${jan}s não desce de ${INSERT_VEL_MIN}x (deu ${pv.velocidade.toFixed(2)}x)`);
  }
  ok(INSERT_VEL_MIN >= 0.7, 'o piso é SUAVE: abaixo de 0,7x o olho começa a contar quadro');
  const quase = planoDeVelocidade(8.01, 8);
  ok(quase.velocidade === 1 && quase.motivo === 'exato', 'diferença de 1 centésimo é "exato" — não corta nem desacelera');

  // ── mídia que SOBRA jamais muda de velocidade ──
  for (const [nat, jan] of [[12, 4], [180, 6], [8.2, 8]] as Array<[number, number]>) {
    const pv = planoDeVelocidade(nat, jan);
    ok(pv.velocidade === 1 && pv.corta && pv.blur === 0,
      `${nat}s numa janela de ${jan}s: corta a 1x, sem câmera lenta nenhuma`);
  }

  // imagem / mídia sem duração: não há o que ajustar
  ok(planoDeVelocidade(0, 5).motivo === 'sem-duracao', 'imagem não tem velocidade');
  ok(planoDeVelocidade(5, 0).velocidade === 1, 'janela zero não quebra');
}

// o mapeamento tempo-da-janela → tempo-da-mídia
{
  const d = planoDeVelocidade(3, 4); // 0.75x
  ok(aprox(tempoNaMidia(0, d, 3), 0), 'começo da janela = começo da mídia');
  ok(aprox(tempoNaMidia(2, d, 3), 1.5), 'a 2s da janela, 1,5s da mídia (0,75x)');
  ok(tempoNaMidia(100, d, 3) <= 3, 'NUNCA passa do fim da mídia (seek fora = frame preto)');
  const c = planoDeVelocidade(12, 4); // corta
  ok(aprox(tempoNaMidia(3, c, 12), 3), 'cortando, o tempo anda 1:1');
}

/* ═════════ (8) a duração AUTOMÁTICA vai até o fim da parte ═════════ */
{
  // O TRECHO manda: a duração do ARQUIVO (99s) não tem voz nenhuma na janela.
  const ins: Insert[] = [
    { ...insertPadrao('a', 'BODY 1', { key: 'k', nome: 'n', tipo: 'video', w: 1, h: 1, durSec: 99 }), palavraDe: 0, palavraAte: 8 },
  ];
  const j = janelasDosInserts(ins, PARTES, asrFiel(), DUR);
  ok(aprox(j[0].start, 4.0, 0.05), 'começa no início do trecho');
  ok(j[0].end > 8 && j[0].end < 9, `e morre no FIM do trecho (deu ${j[0].end.toFixed(2)}s), não nos 99s do arquivo`);

  // trecho MAIOR = janela MAIOR. É a única alavanca, e é a certa.
  const curto: Insert[] = [{ ...ins[0], palavraAte: 2 }];
  const jc = janelasDosInserts(curto, PARTES, asrFiel(), DUR);
  ok(jc[0].end < j[0].end, 'marcar menos palavras encurta o insert');
}

/* ═══════ (8b) MIGRAÇÃO: insert salvo no formato antigo não vira NaN ═══════ */
{
  const antigo = {
    id: 'v', ancora: 'HOOK 1', palavra: 3, duracaoSec: 4,
    layout: { tipo: 'cheia' as const }, transicao: 'escurecer' as const,
    midiaKey: 'k', midiaNome: 'n', midiaTipo: 'video' as const,
    midiaW: 1, midiaH: 1, focoAvatarY: 0.34,
  };
  const n = normalizarInsert(antigo as never);
  ok(n.palavraDe === 3 && n.palavraAte === 3, 'insert velho (palavra única) vira um trecho de 1 palavra');
  ok(Number.isFinite(n.palavraDe), 'e nunca NaN — NaN poria o b-roll no lugar errado, calado');

  // e ordem invertida é consertada
  const inv = normalizarInsert({ ...antigo, palavraDe: 9, palavraAte: 2 } as never);
  ok(inv.palavraDe === 2 && inv.palavraAte === 9, 'trecho invertido é endireitado');
}

/* ═════ (8c) MASCARAMENTO do slow motion — o que separa lento de travado ═════ */
{
  ok(blurDoSlowMotion(1) === 0, 'velocidade normal não borra nada');
  ok(blurDoSlowMotion(0.95) === 0, 'desaceleração imperceptível também não');
  const meio = blurDoSlowMotion(0.86);
  const forte = blurDoSlowMotion(INSERT_VEL_MIN);
  ok(meio > 0, 'a partir de um ponto, começa a borrar');
  ok(forte > meio, 'quanto mais lento, mais borrão (o degrau é maior)');
  ok(forte <= INSERT_BLUR_MAX, 'e satura — borrão demais viraria sujeira');

  // o plano carrega o blur junto
  const p1 = planoDeVelocidade(3, 4); // 0.75x
  ok(p1.blur > 0, 'quem desacelera sai com máscara');
  ok(planoDeVelocidade(12, 4).blur === 0, 'quem corta não precisa de máscara');
  ok(planoDeVelocidade(4, 4).blur === 0, 'e quem cabe exato também não');
}

/* ═══════════ (9) a REGRA DO CORTE: nada some no meio da fala ═══════════ */
{
  const cortes = [3, 7.5, 12, 20];
  ok(encaixarNoCorte(7.2, cortes) === 7.5, 'borda perto de um corte é PUXADA pra ele');
  ok(encaixarNoCorte(7.9, cortes) === 7.5, 'e de qualquer um dos lados');
  ok(encaixarNoCorte(15, cortes) === 15, 'longe de todo corte, fica onde estava (melhor que cortar 3s antes)');
  ok(encaixarNoCorte(5, [], 1) === 5, 'sem cortes, não mexe');
  ok(encaixarNoCorte(3.05, cortes, 0.01) === 3.05, 'a tolerância é respeitada');
}

{
  const c = cortesDoVideo([10, 5], [[4, 6], [5]]);
  ok(JSON.stringify(c) === '[4,10,15]', 'cortes = internos da decupagem + fim de cada parte');
  ok(cortesDoVideo([10, NaN]).length === 0, 'duração podre não vira lista meia-boca');
  ok(JSON.stringify(cortesDoVideo([8, 7])) === '[8,15]', 'sem decupagem, só as trocas de take');
}

/* ═══════════════════ (10) HEADLINE: janela e texto ═══════════════════ */
{
  const cortes = cortesDoVideo([4, 4.5, 3.5], null); // [4, 8.5, 12]
  const cfg = { on: true, presetId: 'aspas-escura', texto: '', posY: 0.24, ancoraDe: '', ancoraAte: 'HOOK 1' };
  const j = janelaDaHeadline(cfg, PARTES, asrFiel(), DUR, cortes);
  ok(j !== null, 'a headline tem janela');
  if (j) {
    ok(j.start === 0, 'sem âncora de início, começa no vídeo');
    // o hook acaba em ~4.0s e há um corte em 4 → tem que ENCAIXAR
    ok(cortes.some((c) => aprox(c, j.end, 0.001)), `a SAÍDA cai num corte (${j.end}) — é o que mascara o sumiço`);
  }

  // desligada não produz nada
  ok(janelaDaHeadline({ ...cfg, on: false }, PARTES, asrFiel(), DUR, cortes) === null, 'desligada = sem janela');
  // janela degenerada é recusada
  ok(
    janelaDaHeadline({ ...cfg, ancoraDe: 'BODY 2', ancoraAte: 'HOOK 1' }, PARTES, asrFiel(), DUR, cortes) === null,
    'fim antes do começo é recusado (nada de headline invertida)',
  );
}

{
  const cfg = { on: true, presetId: 'aspas-escura', texto: '', posY: 0.24, ancoraDe: '', ancoraAte: 'HOOK 1' };
  const t = textoDaHeadline(cfg, PARTES);
  ok(t.length > 0 && t.startsWith('como transformar'), 'sem texto escrito, usa a 1ª frase do HOOK');
  ok(textoDaHeadline({ ...cfg, texto: '  MEU TITULO  ' }, PARTES) === 'MEU TITULO', 'texto escrito manda (e vem aparado)');
  ok(textoDaHeadline(cfg, [{ label: 'BODY 1', text: 'so corpo' }]) === '', 'sem hook, sem texto automático');
}


console.log(`\n${failed === 0 ? '✓' : '✗'} pilot-inserts: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
