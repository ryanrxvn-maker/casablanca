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
  /**
   * O TRECHO da copy que o insert cobre — índices de palavra DENTRO da parte,
   * os dois inclusive.
   *
   * ⚠ Isto substituiu uma "palavra única + duração manual" (01.09). Marcar uma
   * palavra só não descreve nada: o editor pensa em TRECHO DE FALA ("do 'Para'
   * até o 'nada'"), e é o trecho que define quanto tempo o insert fica no ar.
   * A duração deixou de ser controle e virou CONSEQUÊNCIA — a mídia é que se
   * ajusta a ela (ver `planoDeVelocidade`).
   */
  palavraDe: number;
  palavraAte: number;
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

  /* ── RECORTE DA MÍDIA (02.09) ────────────────────────────────────────
   * Qual PEDAÇO do arquivo importado vira o insert, em segundos dentro do
   * arquivo. Silas: *"se eu tiver um vídeo longo de 3 min e tem um insert lá
   * no meio, tem que ter como eu selecionar qual parte do vídeo vira insert"*.
   *
   * `undefined` nos dois = o arquivo inteiro (é o que todo insert já salvo
   * tem). Só o pedaço entre eles é lido — o resto do arquivo nunca aparece. */
  recorteDe?: number;
  recorteAte?: number;
};

export const INSERT_FOCO_PADRAO = 0.34;
/** Recorte não pode ser mais curto que isto — abaixo disso não se vê nada. */
export const INSERT_RECORTE_MIN_SEC = 0.4;
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
    palavraDe: 0,
    palavraAte: 0,
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

/**
 * Normaliza um insert vindo do localStorage.
 *
 * O formato antigo tinha `palavra` (uma só) e `duracaoSec`. Sem isto, um
 * insert salvo antes de 01.09 viraria `palavraDe: undefined` e a janela dele
 * cairia em NaN — o vídeo sairia com o b-roll no lugar errado, calado.
 */
export function normalizarInsert(x: Insert & { palavra?: number; duracaoSec?: number }): Insert {
  const de = Number.isFinite(x.palavraDe) ? x.palavraDe : Number.isFinite(x.palavra) ? (x.palavra as number) : 0;
  const ate = Number.isFinite(x.palavraAte) ? x.palavraAte : de;
  return {
    ...x,
    palavraDe: Math.max(0, Math.min(de, ate)),
    palavraAte: Math.max(0, Math.max(de, ate)),
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

  /** Instante da palavra `palavraIdx` da parte — começo dela ou fim dela. */
  const instanteDe = (ancora: string, palavraIdx: number, fim = false): number => {
    const iParte = validas.findIndex((p) => p.label === ancora);
    if (iParte < 0) return 0;
    if (faixas && faixas[iParte]) {
      const f = faixas[iParte];
      const alvo = Math.min(f.ate - 1, f.de + Math.max(0, palavraIdx));
      const w = palavras[Math.max(0, Math.min(palavras.length - 1, alvo))];
      if (w) return Math.max(0, Math.min(durSec, (fim ? w.end : w.start) / 1000));
    }
    // rateio proporcional: cada parte ocupa uma fatia do vídeo do tamanho da
    // sua copy — sem ASR confiável é o melhor palpite honesto.
    const tam = validas.map((p) => p.text.split(/\s+/).filter(Boolean).length);
    const total = tam.reduce((a, b) => a + b, 0) || 1;
    const antes = tam.slice(0, iParte).reduce((a, b) => a + b, 0);
    const dentro = Math.min(tam[iParte], Math.max(0, palavraIdx) + (fim ? 1 : 0));
    return Math.max(0, Math.min(durSec, ((antes + dentro) / total) * durSec));
  };

  // A JANELA É O TRECHO: da primeira palavra marcada ao FIM da última. Não há
  // duração pra escolher — o texto marcado É a duração.
  const brutas = inserts.map((raw) => {
    const ins = normalizarInsert(raw as never);
    const start = instanteDe(ins.ancora, ins.palavraDe);
    let end = instanteDe(ins.ancora, ins.palavraAte, true);
    if (!(end > start + 0.2)) end = Math.min(durSec, start + INSERT_DUR_IMAGEM_PADRAO);
    return { id: ins.id, start, end: Math.min(durSec, end) };
  });
  void duracaoNatural;

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

/* ═════════════ o insert PREENCHE a parte: corta ou desacelera ═════════════ */

/**
 * Velocidade MÍNIMA do insert. Abaixo disto o slow motion deixa de parecer
 * escolha e passa a parecer travamento — aí é melhor segurar o último frame.
 */
export const INSERT_VEL_MIN = 0.75;

/**
 * Clipe mais curto que isto NÃO é esticado — nem um pouco.
 *
 * Silas, 02.09, sobre uma tela dividida que saiu em câmera lenta extrema:
 * *"super câmera lenta parece que tá indo de quadro em quadro, horrível"*.
 * Esticar 1s sobre 8s é 0,12x: o olho vê os quadros um a um. Abaixo deste
 * piso o clipe roda na velocidade dele e o último quadro segura o resto.
 */
export const INSERT_DUR_MIN_PARA_ESTICAR = 2.0;

export type PlanoVelocidade = {
  /** multiplicador aplicado ao tempo da mídia (1 = normal, 0.6 = mais lento) */
  velocidade: number;
  /** a mídia é mais longa que a janela e vai ser cortada? */
  corta: boolean;
  /** a partir deste instante DA JANELA o último frame congela (0 = nunca) */
  congelaApos: number;
  /**
   * MASCARAMENTO do slow motion, em px de blur na régua de 1080 de largura.
   *
   * Slow motion sem interpolação mostra o mesmo frame várias vezes seguidas — o
   * olho lê isso como travamento, não como escolha. Um borrão de movimento leve
   * cobre o degrau: é o que separa "b-roll em câmera lenta" de "vídeo travando".
   * Cresce com o quanto se desacelerou e satura, pra nunca virar sujeira.
   */
  blur: number;
  /** pro log/UI: o que foi feito */
  motivo: 'exato' | 'cortou' | 'desacelerou' | 'desacelerou-e-congelou' | 'sem-duracao';
};

/** Blur máximo do mascaramento (px na régua de 1080 de largura). */
export const INSERT_BLUR_MAX = 3.2;

/** Quanto borrar pra esconder o degrau do slow motion. */
export function blurDoSlowMotion(velocidade: number): number {
  if (!(velocidade > 0) || velocidade >= 0.92) return 0; // quase normal: nada
  const t = Math.min(1, (0.92 - velocidade) / (0.92 - INSERT_VEL_MIN));
  return Math.round(INSERT_BLUR_MAX * t * 10) / 10;
}

/**
 * Como encaixar uma mídia de `naturalSec` numa janela de `janelaSec`.
 *
 * Regra do estúdio (31.08):
 *   • LONGA demais  → corta. O insert morre onde a parte da fala morre.
 *   • CURTA demais  → desacelera pra caber (slow motion é linguagem de b-roll).
 *   • curta DEMAIS  → desacelera até o piso e congela o resto, em vez de virar
 *     um quase-still de 0.1x.
 *
 * Imagem (sem duração natural) não tem o que ajustar: ela fica parada mesmo.
 */
export function planoDeVelocidade(naturalSec: number, janelaSec: number): PlanoVelocidade {
  if (!(janelaSec > 0)) {
    return { velocidade: 1, corta: false, congelaApos: 0, blur: 0, motivo: 'sem-duracao' };
  }
  if (!(naturalSec > 0)) {
    return { velocidade: 1, corta: false, congelaApos: 0, blur: 0, motivo: 'sem-duracao' };
  }
  const razao = naturalSec / janelaSec;
  if (razao >= 0.995 && razao <= 1.005) {
    return { velocidade: 1, corta: false, congelaApos: 0, blur: 0, motivo: 'exato' };
  }
  if (razao > 1) {
    // SOBRA mídia: roda na velocidade dela e corta no fim da janela. Nunca
    // mexe na velocidade — Silas, 02.09: *"se o vídeo do insert tem tamanho
    // maior que o tempo de duração de onde ele está, não deveria nem mexer na
    // velocidade dele"*.
    return { velocidade: 1, corta: true, congelaApos: 0, blur: 0, motivo: 'cortou' };
  }

  // CLIPE CURTO DEMAIS: não estica. Um clipe de 1s sobre 8s viraria 0,12x e o
  // olho conta os quadros. Ele roda inteiro, no tempo dele, e o último quadro
  // segura até o corte.
  if (naturalSec < INSERT_DUR_MIN_PARA_ESTICAR) {
    return {
      velocidade: 1,
      corta: false,
      congelaApos: Math.min(janelaSec, naturalSec),
      blur: 0,
      motivo: 'desacelerou-e-congelou',
    };
  }

  // falta mídia: desacelera — mas só até o piso, que agora é suave (0,75x).
  const vel = Math.max(INSERT_VEL_MIN, razao);
  if (vel <= INSERT_VEL_MIN + 1e-9 && razao < INSERT_VEL_MIN) {
    // nem no piso cobre: o que a mídia alcança + congelado até o fim
    const cobre = naturalSec / vel;
    return {
      velocidade: vel,
      corta: false,
      congelaApos: Math.min(janelaSec, cobre),
      blur: blurDoSlowMotion(vel),
      motivo: 'desacelerou-e-congelou',
    };
  }
  return { velocidade: vel, corta: false, congelaApos: 0, blur: blurDoSlowMotion(vel), motivo: 'desacelerou' };
}

/**
 * O RECORTE efetivo da mídia: início e duração, em segundos do ARQUIVO.
 *
 * Devolve o arquivo inteiro quando não há recorte. Prende tudo dentro do
 * arquivo real — um recorte salvo com um arquivo e reaberto com outro (ou uma
 * duração lida errada) poria o seek fora do fim, que dá quadro preto.
 */
export function recorteDaMidia(
  ins: Pick<Insert, 'recorteDe' | 'recorteAte'>,
  arquivoSec: number,
): { de: number; dur: number } {
  if (!(arquivoSec > 0)) return { de: 0, dur: 0 };
  const de = Math.min(Math.max(0, Number(ins.recorteDe) || 0), Math.max(0, arquivoSec - INSERT_RECORTE_MIN_SEC));
  const ateBruto = Number.isFinite(ins.recorteAte as number) ? (ins.recorteAte as number) : arquivoSec;
  const ate = Math.min(Math.max(ateBruto, de + INSERT_RECORTE_MIN_SEC), arquivoSec);
  return { de, dur: Math.max(0, ate - de) };
}

/**
 * Que instante do ARQUIVO mostrar, dado o instante da JANELA.
 *
 * `naturalSec` aqui é a duração do RECORTE (não a do arquivo) — é ela que o
 * plano de velocidade usou. `inicioSec` desloca pro ponto onde o recorte
 * começa dentro do arquivo.
 */
export function tempoNaMidia(
  tRelJanela: number,
  plano: PlanoVelocidade,
  naturalSec: number,
  inicioSec = 0,
): number {
  const t = Math.max(0, tRelJanela) * plano.velocidade;
  if (!(naturalSec > 0)) return inicioSec;
  return inicioSec + Math.min(t, Math.max(0, naturalSec - 0.04));
}

/* ═══════════ a REGRA DO CORTE: nada entra nem sai no meio da fala ═══════════
 *
 * Texto que aparece/some no MEIO de um take é a assinatura do automático: o
 * olho vê a mudança porque nada mais na tela muda junto. No corte, a troca de
 * imagem MASCARA a saída — o texto some e o espectador registra só o corte.
 *
 * Vale pra headline (entrada e saída) e pra legenda do HOOK (a virada de
 * estilo hook→body). É a mesma regra, então mora num lugar só.
 */

/** Tolerância padrão pra puxar uma borda até o corte (segundos). */
export const ENCAIXE_TOL_SEC = 0.9;

/**
 * Puxa `t` pro corte mais próximo, se houver um dentro da tolerância.
 *
 * Fora da tolerância devolve `t` intacto: é melhor um texto saindo no meio da
 * fala do que um texto cortado 3s antes do que o editor pediu.
 */
export function encaixarNoCorte(t: number, cortes: number[], tol = ENCAIXE_TOL_SEC): number {
  if (!cortes || cortes.length === 0 || !isFinite(t)) return t;
  let melhor = t;
  let dist = Infinity;
  for (const c of cortes) {
    const d = Math.abs(c - t);
    if (d < dist) {
      dist = d;
      melhor = c;
    }
  }
  return dist <= tol ? melhor : t;
}

/** Todos os cortes do vídeo final, em segundos — partes + decupagem. */
export function cortesDoVideo(
  partesSec: number[] | null | undefined,
  cortesInternosSec?: number[][] | null,
): number[] {
  const partes = partesSec || [];
  const out: number[] = [];
  let base = 0;
  for (let i = 0; i < partes.length; i++) {
    if (!(partes[i] > 0) || !isFinite(partes[i])) return [];
    const internos = cortesInternosSec?.[i];
    if (internos && internos.length > 1 && internos.every((d) => d > 0 && isFinite(d))) {
      let acc = 0;
      for (let k = 0; k < internos.length - 1; k++) {
        acc += internos[k];
        out.push(base + acc);
      }
    }
    base += partes[i];
    out.push(base);
  }
  return out;
}

/* ══════════════════════════ headline no Pilot ═══════════════════════════ */

export type HeadlineCfg = {
  /** ligada? */
  on: boolean;
  /** id do modelo (HEADLINE_PRESETS das Legendas Automáticas) */
  presetId: string;
  /** o texto. Vazio = usa a 1ª frase do HOOK. */
  texto: string;
  /** centro vertical no frame, 0..1 */
  posY: number;
  /** ONDE COMEÇA: label da parte da copy (vazio = do início do vídeo) */
  ancoraDe: string;
  /** ATÉ ONDE FICA: label da parte em que ela sai */
  ancoraAte: string;

  /* ── APARÊNCIA (02.09) ───────────────────────────────────────────────
   * O motor de headline já sabia posicionar, redimensionar, alinhar e
   * pintar — mas a janela do Pilot só mandava `presetId` e `posY`, e todo o
   * resto ia no default. Silas: *"aqui eu escolho a headline, mas não
   * escolho a posição, tamanho, nem nada"*.
   *
   * Tudo aqui é OPCIONAL: `null`/ausente = o que o MODELO manda. Sem isso o
   * ajuste fino apagaria a identidade do preset (foi o bug do alinhamento da
   * cartela de citação, que saía à esquerda por causa de um default concreto). */
  /** centro horizontal, 0..1 (0.5 = centro) */
  posX?: number;
  /** multiplicador do corpo da fonte (1 = o do modelo) */
  fontScale?: number;
  /** largura máxima do bloco, fração do frame — é daqui que sai a quebra */
  width?: number;
  /** null/ausente = o alinhamento do modelo */
  align?: 'left' | 'center' | 'right' | null;
  /** null/ausente = a caixa do modelo */
  uppercase?: boolean | null;
  /** fundo atrás do texto; null/ausente = o do modelo */
  panel?: 'solido' | 'faixa' | 'nenhum' | null;
  /** 0..1; null/ausente = a do modelo */
  panelOpacity?: number | null;
  /** cor do texto (hex); null/ausente = a do modelo */
  color?: string | null;
};

export const HEADLINE_CFG_DEFAULT: HeadlineCfg = {
  on: false,
  presetId: 'aspas-escura',
  texto: '',
  posY: 0.24,
  ancoraDe: '',
  ancoraAte: '',
  // aparência: tudo herdado do modelo até alguém mexer
  posX: 0.5,
  fontScale: 1,
  width: 0.9,
  align: null,
  uppercase: null,
  panel: null,
  panelOpacity: null,
  color: null,
};

/** Limites do ajuste fino — fora deles a headline sai da tela ou ilegível. */
export const HEADLINE_LIMITES = {
  fontScale: { min: 0.55, max: 2.0 },
  width: { min: 0.35, max: 1.0 },
  pos: { min: 0.04, max: 0.96 },
} as const;

/** Prende a aparência dentro do que é desenhável. Config vinda do
 *  localStorage de uma versão antiga não tem estes campos — e um `undefined`
 *  virando NaN poria a headline fora do frame, calada. */
export function normalizarHeadlineCfg(cfg: HeadlineCfg): HeadlineCfg {
  const prender = (v: number | undefined, lim: { min: number; max: number }, padrao: number) =>
    Number.isFinite(v as number) ? Math.min(lim.max, Math.max(lim.min, v as number)) : padrao;
  return {
    ...cfg,
    posX: prender(cfg.posX, HEADLINE_LIMITES.pos, 0.5),
    posY: prender(cfg.posY, HEADLINE_LIMITES.pos, 0.24),
    fontScale: prender(cfg.fontScale, HEADLINE_LIMITES.fontScale, 1),
    width: prender(cfg.width, HEADLINE_LIMITES.width, 0.9),
  };
}

/**
 * A janela da headline, em segundos, JÁ ENCAIXADA nos cortes.
 *
 * Começa no início da parte `ancoraDe` (ou no vídeo) e sai no FIM da parte
 * `ancoraAte`. As duas bordas são puxadas pro corte mais próximo — é o que
 * faz a headline sumir escondida pela troca de cena em vez de piscar no meio
 * da frase.
 */
export function janelaDaHeadline(
  cfg: HeadlineCfg,
  partes: Array<{ label: string; text: string }>,
  palavras: PalavraTempo[],
  durSec: number,
  cortes: number[],
): { start: number; end: number } | null {
  if (!cfg.on || !(durSec > 0)) return null;
  const validas = partes.filter((p) => (p.text || '').trim().length > 0);
  if (validas.length === 0) return null;
  const faixas = mapearPartesNoAsr(palavras.map((w) => w.text), partes);

  const tempoDe = (idx: number, fim: boolean): number => {
    if (faixas && faixas[idx]) {
      const f = faixas[idx];
      const i = fim ? Math.max(0, f.ate - 1) : f.de;
      const w = palavras[Math.max(0, Math.min(palavras.length - 1, i))];
      if (w) return Math.max(0, Math.min(durSec, (fim ? w.end : w.start) / 1000));
    }
    // sem ASR: rateio proporcional pela copy
    const tam = validas.map((p) => p.text.split(/\s+/).filter(Boolean).length);
    const total = tam.reduce((a, b) => a + b, 0) || 1;
    const antes = tam.slice(0, idx).reduce((a, b) => a + b, 0);
    const acc = fim ? antes + tam[idx] : antes;
    return Math.max(0, Math.min(durSec, (acc / total) * durSec));
  };

  const iDe = cfg.ancoraDe ? validas.findIndex((p) => p.label === cfg.ancoraDe) : -1;
  const iAte = cfg.ancoraAte ? validas.findIndex((p) => p.label === cfg.ancoraAte) : 0;
  const start = iDe >= 0 ? tempoDe(iDe, false) : 0;
  const end = iAte >= 0 ? tempoDe(iAte, true) : tempoDe(0, true);

  // ⭐ AS BORDAS VÃO PRO CORTE: é isto que mascara a entrada e a saída.
  const s = encaixarNoCorte(start, cortes);
  const e = encaixarNoCorte(end, cortes);
  if (!(e > s + 0.3)) return null; // janela degenerada: melhor não pôr nada
  return { start: Math.max(0, s), end: Math.min(durSec, e) };
}

/** O texto da headline: o escolhido, ou a 1ª frase do HOOK. */
export function textoDaHeadline(cfg: HeadlineCfg, partes: Array<{ label: string; text: string }>): string {
  const escrito = (cfg.texto || '').trim();
  if (escrito) return escrito;
  const hook = partes.find((p) => /^(hook|gancho)/i.test(p.label) && (p.text || '').trim());
  if (!hook) return '';
  const frase = hook.text.split(/(?<=[.!?])\s+/)[0] || hook.text;
  return frase.trim().slice(0, 120);
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
