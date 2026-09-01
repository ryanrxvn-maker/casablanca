/**
 * INSERTS DO CLICKUP PILOT (31.08) — b-roll entrando na MONTAGEM, ancorado no
 * TEXTO da copy.
 *
 * O que isto resolve: o AD sai do HeyGen só com o avatar falando. O insert é
 * o take extra (produto na mão, tela de app, depoimento) que entra por cima —
 * em tela cheia ou dividido com o avatar — num ponto que o editor escolhe
 * LENDO A COPY, não arrastando na timeline.
 *
 * Três decisões difíceis moram aqui, todas testáveis sem navegador:
 *
 *  1. ANCORAGEM texto → tempo. O user aponta uma palavra da copy; o vídeo tem
 *     segundos. A ponte é o ASR do montado, alinhado com a copy (mesma família
 *     do `palavrasDoHookNoAsr`). É o que faz o insert cair exatamente na fala.
 *
 *  2. ENQUADRAMENTO. Encaixar 16:9 num 9:16 pelo caminho ingênuo deixa borda
 *     preta; centralizar o avatar num split corta a cabeça. Aqui o insert faz
 *     COVER (preenche e corta o excesso) e o avatar é ancorado no ROSTO, não no
 *     centro geométrico.
 *
 *  3. TRANSIÇÃO. Escurecer/luz com a curva no lugar certo — metade fecha,
 *     metade abre, e o corte real acontece no meio, onde a tela está cheia da
 *     cor. Sem isso a transição "pisca" no lugar errado.
 */

/* ══════════════════════════════ tipos ═══════════════════════════════════ */

/** Como o insert divide a tela com o avatar. */
export type LayoutInsert =
  /** o insert toma a tela inteira (o avatar some enquanto ele roda) */
  | { tipo: 'cheia' }
  /** duas faixas coladas, avatar em cima ou embaixo */
  | { tipo: 'faixas'; avatar: 'cima' | 'baixo' }
  /** dois cards com respiro e cantos — o "split premium" */
  | { tipo: 'cards'; avatar: 'cima' | 'baixo' };

export type TipoTransicao = 'nenhuma' | 'escurecer' | 'luz' | 'misto';

export type MidiaTipo = 'video' | 'imagem';

export type Insert = {
  id: string;
  /** label da parte da copy onde ancora — 'HOOK 1', 'BODY 2'... */
  ancora: string;
  /** índice da palavra DENTRO da parte onde o insert entra (0 = no começo) */
  palavra: number;
  /** quanto tempo fica no ar. Vídeo: 0 = duração natural do arquivo. */
  duracaoSec: number;
  layout: LayoutInsert;
  transicao: TipoTransicao;
  /** chave do IndexedDB com os bytes da mídia */
  midiaKey: string;
  midiaNome: string;
  midiaTipo: MidiaTipo;
  /** largura/altura da mídia (pro enquadramento) */
  midiaW: number;
  midiaH: number;
  /**
   * Onde está o ROSTO do avatar, 0..1 de cima pra baixo. Default 0.34: nos
   * avatares do HeyGen o enquadramento é peito-pra-cima e o rosto vive no
   * terço superior. É o que impede o split de cortar a testa.
   */
  focoAvatarY: number;
};

export const INSERT_FOCO_PADRAO = 0.34;
export const INSERT_DUR_IMAGEM_PADRAO = 3;

/** Insert novo com os defaults do estúdio. */
export function insertPadrao(id: string, ancora: string, midia: {
  key: string;
  nome: string;
  tipo: MidiaTipo;
  w: number;
  h: number;
  durSec?: number;
}): Insert {
  return {
    id,
    ancora,
    palavra: 0,
    duracaoSec: midia.tipo === 'imagem' ? INSERT_DUR_IMAGEM_PADRAO : (midia.durSec || 0),
    layout: { tipo: 'cheia' },
    transicao: 'escurecer',
    midiaKey: midia.key,
    midiaNome: midia.nome,
    midiaTipo: midia.tipo,
    midiaW: midia.w,
    midiaH: midia.h,
    focoAvatarY: INSERT_FOCO_PADRAO,
  };
}

/* ═══════════════════ 1. ancoragem: texto → tempo ════════════════════════ */

/** normaliza pra COMPARAR (minúsculas, sem acento, sem pontuação) */
function norm(x: string): string {
  return x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function edit(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function sim(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  return 1 - edit(a, b) / Math.max(a.length, b.length);
}

/** Palavra do ASR com o tempo dela (o que o transcritor devolve). */
export type PalavraTempo = { text: string; start: number; end: number };

/** Onde cada parte da copy começa e termina, em índice de palavra DO ASR. */
export type FaixaDaParte = {
  label: string;
  /** primeira palavra do ASR desta parte (inclusive) */
  de: number;
  /** primeira palavra DEPOIS desta parte (exclusive) */
  ate: number;
};

/**
 * Casa as PARTES da copy com as palavras do ASR.
 *
 * Alinhamento global (Needleman-Wunsch) da copy inteira contra o ASR inteiro,
 * anotando em que palavra do ASR cada fronteira de parte cai. É o mesmo motor
 * que arrumou a fronteira hook×body da legenda — aqui ele serve pra saber
 * QUANDO cada parágrafo é falado.
 *
 * Devolve `null` quando não dá pra confiar (ASR vazio, copy curta, casamento
 * fraco). O caller então cai no rateio proporcional, que é grosseiro mas nunca
 * põe o insert fora do vídeo.
 */
export function mapearPartesNoAsr(
  palavrasAsr: string[],
  partes: Array<{ label: string; text: string }>,
): FaixaDaParte[] | null {
  const A = palavrasAsr.map(norm);
  const validas = partes.filter((p) => (p.text || '').trim().length > 0);
  if (A.length < 4 || validas.length === 0) return null;

  // copy achatada, guardando de que parte veio cada palavra
  const B: string[] = [];
  const donoDaPalavra: number[] = [];
  validas.forEach((p, idx) => {
    for (const w of p.text.split(/\s+/)) {
      const n = norm(w);
      if (!n) continue;
      B.push(n);
      donoDaPalavra.push(idx);
    }
  });
  if (B.length < 4) return null;

  const n = A.length;
  const m = B.length;
  // material grande demais pro DP quadrático: o caller cai no rateio
  if (n * m > 4_000_000) return null;

  const GAP = -0.6;
  const score = (i: number, j: number): number => {
    const s = sim(A[i], B[j]);
    if (s >= 0.999) return 2;
    if (s >= 0.55) return 0.4 + 1.2 * s;
    return -1.1;
  };

  const W = m + 1;
  const dp = new Float64Array((n + 1) * W);
  const bt = new Uint8Array((n + 1) * W); // 1=diag 2=cima(gap na copy) 3=esq(gap no asr)
  for (let i = 1; i <= n; i++) {
    dp[i * W] = i * GAP;
    bt[i * W] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[j] = j * GAP;
    bt[j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[(i - 1) * W + (j - 1)] + score(i - 1, j - 1);
      const up = dp[(i - 1) * W + j] + GAP;
      const lf = dp[i * W + (j - 1)] + GAP;
      let melhor = d;
      let dir = 1;
      if (up > melhor) {
        melhor = up;
        dir = 2;
      }
      if (lf > melhor) {
        melhor = lf;
        dir = 3;
      }
      dp[i * W + j] = melhor;
      bt[i * W + j] = dir;
    }
  }
  // casamento fraco: não inventa mapa
  if (dp[n * W + m] < m * 2 * 0.4) return null;

  // volta pelo caminho anotando, pra cada palavra da COPY, a palavra do ASR
  const asrDaCopy = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const dir = bt[i * W + j];
    if (dir === 1) {
      asrDaCopy[j - 1] = i - 1;
      i--;
      j--;
    } else if (dir === 2) {
      i--;
    } else {
      j--;
    }
  }

  // fronteiras de cada parte: primeira palavra do ASR casada dentro dela
  const faixas: FaixaDaParte[] = validas.map((p) => ({ label: p.label, de: -1, ate: -1 }));
  for (let k = 0; k < m; k++) {
    const dono = donoDaPalavra[k];
    const a = asrDaCopy[k];
    if (a < 0) continue;
    if (faixas[dono].de < 0) faixas[dono].de = a;
    faixas[dono].ate = a + 1;
  }
  // parte que não casou nenhuma palavra herda a fronteira da vizinha (nunca
  // devolvemos faixa vazia — o insert dela cairia em t=0)
  for (let k = 0; k < faixas.length; k++) {
    if (faixas[k].de >= 0) continue;
    const antes = k > 0 ? faixas[k - 1].ate : 0;
    faixas[k].de = antes;
    faixas[k].ate = antes;
  }
  // monotonia: uma parte nunca começa antes do fim da anterior
  for (let k = 1; k < faixas.length; k++) {
    if (faixas[k].de < faixas[k - 1].ate) faixas[k].de = faixas[k - 1].ate;
    if (faixas[k].ate < faixas[k].de) faixas[k].ate = faixas[k].de;
  }
  return faixas;
}

/** Janela de tempo (segundos) que um insert ocupa no vídeo final. */
export type JanelaInsert = { id: string; start: number; end: number };

/**
 * Converte cada insert em janela de tempo.
 *
 * A palavra escolhida vira instante pelo tempo da palavra do ASR. Sem mapa
 * confiável, RATEIA proporcionalmente pelas palavras da copy — grosseiro, mas
 * o insert cai perto e NUNCA fora do vídeo.
 *
 * Janelas que se sobrepõem são resolvidas por ordem: quem começa antes manda,
 * e o seguinte é empurrado. Dois inserts em cima um do outro entregariam um
 * frame com duas mídias.
 */
export function janelasDosInserts(
  inserts: Insert[],
  partes: Array<{ label: string; text: string }>,
  palavras: PalavraTempo[],
  durSec: number,
  duracaoNatural?: (id: string) => number | null,
): JanelaInsert[] {
  if (inserts.length === 0 || !(durSec > 0)) return [];
  const faixas = mapearPartesNoAsr(palavras.map((p) => p.text), partes);
  const validas = partes.filter((p) => (p.text || '').trim().length > 0);

  const instanteDe = (ancora: string, palavraIdx: number): number => {
    const iParte = validas.findIndex((p) => p.label === ancora);
    if (iParte < 0) return 0;
    if (faixas && faixas[iParte]) {
      const f = faixas[iParte];
      const alvo = Math.min(f.ate - 1, f.de + Math.max(0, palavraIdx));
      const w = palavras[Math.max(0, Math.min(palavras.length - 1, alvo))];
      if (w) return Math.max(0, Math.min(durSec, w.start / 1000));
    }
    // rateio proporcional: cada parte ocupa uma fatia do vídeo do tamanho da
    // sua copy — sem ASR confiável é o melhor palpite honesto.
    const tam = validas.map((p) => p.text.split(/\s+/).filter(Boolean).length);
    const total = tam.reduce((a, b) => a + b, 0) || 1;
    const antes = tam.slice(0, iParte).reduce((a, b) => a + b, 0);
    const dentro = Math.min(tam[iParte], Math.max(0, palavraIdx));
    return Math.max(0, Math.min(durSec, ((antes + dentro) / total) * durSec));
  };

  const brutas = inserts.map((ins) => {
    const start = instanteDe(ins.ancora, ins.palavra);
    const natural = duracaoNatural?.(ins.id) ?? null;
    const dur =
      ins.duracaoSec > 0
        ? ins.duracaoSec
        : natural && natural > 0
          ? natural
          : INSERT_DUR_IMAGEM_PADRAO;
    return { id: ins.id, start, end: Math.min(durSec, start + dur) };
  });

  brutas.sort((a, b) => a.start - b.start);
  const out: JanelaInsert[] = [];
  for (const j of brutas) {
    const ultimo = out[out.length - 1];
    let { start, end } = j;
    if (ultimo && start < ultimo.end) {
      // empurra pra depois do anterior, preservando a duração quando cabe
      const dur = end - start;
      start = ultimo.end;
      end = Math.min(durSec, start + dur);
    }
    if (end - start < 0.25 || start >= durSec) continue; // não cabe mais: descarta
    out.push({ id: j.id, start, end });
  }
  return out;
}

/* ════════════════════ 2. enquadramento (sem borda) ══════════════════════ */

export type Retangulo = { x: number; y: number; w: number; h: number };
/** Recorte da fonte que preenche um destino (drawImage de 9 argumentos). */
export type Recorte = { sx: number; sy: number; sw: number; sh: number };

/**
 * COVER com âncora: o recorte da fonte que preenche o destino INTEIRO, sem
 * borda, cortando só o excesso.
 *
 * `focoY` (0..1) decide o que sobrevive quando a altura sobra: 0.5 corta topo e
 * base por igual (o jeito ingênuo, que decapita o avatar), 0.34 mantém o rosto.
 * `focoX` faz o mesmo na horizontal.
 *
 * É esta função que faz um insert 16:9 caber num 9:16 sem tarja preta.
 */
export function coverComFoco(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  focoY = 0.5,
  focoX = 0.5,
): Recorte {
  if (!(srcW > 0) || !(srcH > 0) || !(dstW > 0) || !(dstH > 0)) {
    return { sx: 0, sy: 0, sw: Math.max(1, srcW), sh: Math.max(1, srcH) };
  }
  const escala = Math.max(dstW / srcW, dstH / srcH); // COVER: a maior
  const sw = Math.min(srcW, dstW / escala);
  const sh = Math.min(srcH, dstH / escala);
  const fx = Math.min(1, Math.max(0, focoX));
  const fy = Math.min(1, Math.max(0, focoY));
  // o ponto de foco vai pro centro do recorte, mas o recorte nunca sai da fonte
  const sx = Math.min(srcW - sw, Math.max(0, srcW * fx - sw / 2));
  const sy = Math.min(srcH - sh, Math.max(0, srcH * fy - sh / 2));
  return { sx, sy, sw, sh };
}

/** Respiro (px) entre os dois cards do layout premium, em 1080 de largura. */
const CARD_GAP_REL = 0.022;
const CARD_MARGEM_REL = 0.028;
const CARD_RAIO_REL = 0.035;

/** Onde ficam o avatar e o insert na tela, pro layout escolhido. */
export type Palco = {
  avatar: Retangulo | null;
  insert: Retangulo;
  /** raio dos cantos (0 = quadrado) */
  raio: number;
};

export function palcoDoLayout(layout: LayoutInsert, W: number, H: number): Palco {
  if (layout.tipo === 'cheia') {
    return { avatar: null, insert: { x: 0, y: 0, w: W, h: H }, raio: 0 };
  }
  if (layout.tipo === 'faixas') {
    const meio = Math.round(H / 2);
    const cima = { x: 0, y: 0, w: W, h: meio };
    const baixo = { x: 0, y: meio, w: W, h: H - meio };
    return layout.avatar === 'cima'
      ? { avatar: cima, insert: baixo, raio: 0 }
      : { avatar: baixo, insert: cima, raio: 0 };
  }
  // cards: margem por fora, respiro no meio, cantos arredondados
  const m = Math.round(W * CARD_MARGEM_REL);
  const gap = Math.round(W * CARD_GAP_REL);
  const raio = Math.round(W * CARD_RAIO_REL);
  const alturaUtil = H - m * 2 - gap;
  const h = Math.round(alturaUtil / 2);
  const cima = { x: m, y: m, w: W - m * 2, h };
  const baixo = { x: m, y: m + h + gap, w: W - m * 2, h: alturaUtil - h };
  return layout.avatar === 'cima'
    ? { avatar: cima, insert: baixo, raio }
    : { avatar: baixo, insert: cima, raio };
}

/* ═══════════════════════════ 3. transição ═══════════════════════════════ */

/**
 * A cobertura da transição num instante: cor + alfa.
 *
 * A curva é um V: sobe até cobrir a tela no MEIO da transição — que é onde o
 * corte de verdade acontece — e desce do outro lado. Assim a troca de imagem
 * fica escondida no pico, em vez de piscar antes ou depois dele.
 *
 * `misto` alterna escurecer/luz por ocorrência (o índice), pra o AD não ficar
 * com seis flashes iguais.
 */
export type Cobertura = { cor: 'preto' | 'branco'; alpha: number } | null;

export const TRANSICAO_DUR_SEC = 0.28;

export function coberturaDaTransicao(
  tipo: TipoTransicao,
  t: number,
  borda: number,
  ocorrencia = 0,
): Cobertura {
  if (tipo === 'nenhuma') return null;
  const meia = TRANSICAO_DUR_SEC / 2;
  const d = Math.abs(t - borda);
  if (d > meia) return null;
  const alpha = 1 - d / meia; // pico exatamente na borda
  const cor: 'preto' | 'branco' =
    tipo === 'escurecer' ? 'preto' : tipo === 'luz' ? 'branco' : ocorrencia % 2 === 0 ? 'preto' : 'branco';
  return { cor, alpha: Math.min(1, Math.max(0, alpha)) };
}

/**
 * A cobertura ATIVA num instante, olhando todas as janelas. Cada janela tem
 * duas bordas (entrada e saída) e cada borda é uma ocorrência — é o que faz o
 * `misto` alternar ao longo do vídeo.
 */
export function coberturaNoInstante(
  t: number,
  janelas: JanelaInsert[],
  tipoPorId: (id: string) => TipoTransicao,
): Cobertura {
  let n = 0;
  for (const j of janelas) {
    for (const borda of [j.start, j.end]) {
      const c = coberturaDaTransicao(tipoPorId(j.id), t, borda, n);
      if (c) return c;
      n++;
    }
  }
  return null;
}
