/**
 * PÓS-PRODUÇÃO DO CLICKUP PILOT (30.08) — legenda automática + dinâmica de
 * zoom aplicadas no MONTADO, depois da decupagem e antes da camuflagem.
 *
 * A regra de ouro: isto é REALCE, nunca conteúdo. Qualquer falha aqui (ASR
 * fora do ar, render abortado, copy curta demais) devolve o montado ORIGINAL
 * com um aviso — a task nunca trava e nunca perde vídeo por causa de legenda
 * ou zoom.
 *
 * As decisões puras (plano de zoom, separação hook×body, roteiro) moram aqui
 * pra serem testáveis sem navegador; o orquestrador que chama ASR + render
 * fica em `montarPosProducao` e só roda no browser.
 */

import {
  BUILTIN_TEMPLATES,
  templateToSegments,
  type CaptionSegment,
  type CaptionTemplate,
} from './typography/caption-script';

/** Mesmo shape do ZoomSeg do render (lib/typography/export) — declarado aqui
 *  pra este módulo compilar SOZINHO no harness de teste, sem arrastar o
 *  export.ts (que puxa mp4box/WebCodecs). Tipagem estrutural garante o par. */
export type ZoomSeg = {
  start: number;
  end: number;
  from: number;
  to: number;
  /** instante em que a rampa TERMINA; daí até `end` a escala fica parada em
   *  `to`, pro movimento resolver ANTES do corte. Ausente = rampa até `end`. */
  rampaAte?: number;
};

/* ═══════════════════════════ configs (persistidas) ═══════════════════════ */

export type LegendaCfg = {
  on: boolean;
  /** id do template das Legendas Automáticas (builtin ou salvo do user) */
  templateId: string;
  /** MAX QUALITY no render (mais lento). Ausente = render RÁPIDO. */
  qualidadeMax?: boolean;
};

export type ZoomModo = 'in' | 'out' | 'inout';
export type ZoomForca = 'leve' | 'medio' | 'forte' | 'smart';

export type ZoomCfg = {
  on: boolean;
  modo: ZoomModo;
  forca: ZoomForca;
};

export const LEGENDA_CFG_DEFAULT: LegendaCfg = { on: false, templateId: BUILTIN_TEMPLATES[0].id };
export const ZOOM_CFG_DEFAULT: ZoomCfg = { on: false, modo: 'in', forca: 'medio' };

/* ═══════════════════════════════ zoom ════════════════════════════════════ */

/**
 * Amplitude de cada força (escala máxima).
 *
 * Subidas em 31.08: no AD real o movimento não era percebido. A régua antiga
 * (4,5 / 9 / 16%) vinha do push-in do CapCut, que roda em plano ABERTO e por
 * 10-15s; aqui a janela é mais curta e o plano já é fechado no rosto, então a
 * mesma porcentagem "some". Estes valores foram calibrados pra SENTIR sem
 * borrar: o crop central de 1.26 em fonte 1080p ainda entrega ~857px de
 * origem pro frame final.
 */
export const ZOOM_AMP: Record<Exclude<ZoomForca, 'smart'>, number> = {
  leve: 1.08,
  medio: 1.16,
  forte: 1.26,
};

/** Cadência quando não há fronteiras de corte confiáveis. */
const CADENCIA_SEC = 8;
/**
 * DURAÇÃO ALVO da janela de zoom (31.08).
 *
 * A v1 abria uma janela POR CORTE. Num AD decupado os cortes caem a cada 2-3s,
 * então cada rampa tinha 2s pra acontecer — e um movimento de 2s é rápido
 * demais pra ser lido como movimento: o Silas viu "zoom nenhum".
 *
 * Agora a janela tem um ALVO e ATRAVESSA os cortes até alcançá-lo. Ela ainda
 * termina SEMPRE num corte real (o reset nunca cai no meio de um take), só que
 * agora num corte ESCOLHIDO, não em todos.
 */
const JANELA_ALVO_SEC = 7;
/** Janela nunca menor que isto (senão o movimento não é percebido). */
const JANELA_MIN_SEC = 4;
/**
 * Ao bater o alvo num corte FRACO (decupagem), vale esperar mais um pouco por
 * um corte FORTE (troca de take)? Sim, até este tanto a mais — o reset numa
 * troca de take é INVISÍVEL (o conteúdo muda), enquanto num corte de decupagem
 * o enquadramento é quase o mesmo e o salto de escala aparece.
 */
const ESPERA_POR_FORTE_SEC = 3;

/* ─────────────────────────── SMART ZOOM (31.08) ───────────────────────────
 * Lido do draft do CapCut que o Silas montou à mão. O que aparece lá:
 *
 *   • CORTE SECO é o que MAIS tem: o take inteiro numa escala (100%, depois
 *     120%, depois 130%, depois 100% de novo) e a troca acontece EXATAMENTE no
 *     corte, sem rampa. É seco de propósito — dá ritmo sem chamar atenção.
 *   • ZOOM IN suavizado vem em segundo, e sempre RESOLVE antes do corte.
 *   • ZOOM OUT existe, mas é raro — um ou dois no AD inteiro.
 *
 * As três regras duras: a escala NUNCA passa de 135% (borra) e NUNCA fica
 * abaixo de 100% (apareceria borda preta); e toda troca de escala cai num
 * CORTE, nunca no meio da fala.
 */
/** Escala máxima — acima disto o upscale começa a borrar. */
const SMART_MAX = 1.35;
/** Escala mínima — abaixo de 1 o frame não preenche a tela (borda). */
const SMART_MIN = 1.0;
/**
 * A BOLSA de movimentos — 3 secos, 2 in, 1 out por ciclo de 6.
 *
 * Sorteio PURO não serve: com ~14 trechos num AD, a variância entregava 6 zoom
 * in contra 5 secos (medido) — o oposto da prioridade do draft. E sorteio puro
 * também produz "3 zoom in seguidos", que nenhum editor faz.
 *
 * A bolsa é embaralhada e esvaziada: a proporção 50/33/17 vale em QUALQUER
 * tamanho de AD, e a ordem varia sem nunca amontoar o mesmo movimento.
 */
// Retune 02.09 (2ª rodada): Silas viu o AD e pediu MAIS dinâmica — "demora
// até acontecer um zoom, tem que transicionar mais e ter mais zoom in".
// A bolsa foi de 3/2/1 pra 2/3/1: o zoom in vira o movimento mais comum,
// o corte seco continua à frente do out.
const SMART_BOLSA: Array<'seco' | 'in' | 'out'> = ['seco', 'seco', 'in', 'in', 'in', 'out'];
/**
 * A BOLSA DE DEGRAUS do corte seco.
 *
 * Sorteio uniforme entre os 5 degraus parecia justo e não era: medido em 5 ADs
 * (310s), o vídeo passava 33% do tempo em 121-135% e só 20% em 100-105% —
 * Silas, 02.09: *"o zoom tá se mantendo muito tempo em aproximado e pouco
 * tempo em 100%"*. As rampas empurram a escala pra cima e nada a trazia de
 * volta com regularidade.
 *
 * O 100% agora tem peso DOBRADO na bolsa. Mesma mecânica da bolsa de
 * movimentos: proporção garantida em qualquer tamanho de AD.
 */
const SMART_BOLSA_DEGRAUS = [1.0, 1.0, 1.0, 1.1, 1.2, 1.35];
/** A partir daqui o plano conta como "fechado" — e o próximo seco tem que abrir. */
const SMART_ALTO = 1.26;
/** O alívio depois de um trecho fechado: nada acima disto serve. */
const SMART_ALIVIO_MAX = 1.12;
/** Rampa com menos amplitude que isto pela frente vira seco: 4% em 5s não é
 *  movimento, é o vídeo parecendo travado num zoom que não acontece. */
const SMART_RAMPA_MIN_ESPACO = 0.06;
/**
 * Take mais longo que isto ganha DERIVA: a escala entra no corte, segura, e
 * escorrega de leve até o fim do take.
 *
 * Sem decupagem, os únicos cortes são as trocas de take — a cada ~10s. A
 * janela alvo de 2,3s não tinha onde terminar e o trecho saía com 10s de
 * mediana: o vídeo ficava parado numa escala só o take inteiro. Silas, 02.09:
 * *"tá demorando demais pra trocar de proporção"*.
 *
 * A deriva é uma RAMPA contínua (o `from` dela é o `to` do trecho anterior),
 * então nada pula no meio do take — o salto continua acontecendo só no corte,
 * onde é invisível.
 */
const SMART_SUBDIV_SEC = 4.2;
/** Amplitude da deriva — leve: ela acompanha a fala, não disputa com ela. */
const SMART_DERIVA_MIN = 0.08;
const SMART_DERIVA_MAX = 0.16;
/** Janela do corte seco: curta, é só o take numa escala. */
const SMART_SEG_SECO_SEC = 1.8;
/** Janela do movimento: precisa de tempo pra ser percebido. */
const SMART_SEG_RAMPA_SEC = 3.4;

function easeInOutSine(p: number): number {
  return -(Math.cos(Math.PI * p) - 1) / 2;
}

/**
 * A ESCALA no instante `t` — a mesma conta que o render usa por frame.
 *
 * Mora aqui, no arquivo puro, porque é ela que traduz o plano em movimento: um
 * teste que reimplementasse essa curva poderia passar enquanto o vídeo saía
 * diferente. [[lib/typography/export.ts]] importa daqui.
 */
export function escalaNoInstante(plano: ZoomSeg[] | undefined, t: number): number {
  if (!plano || plano.length === 0) return 1;
  for (const seg of plano) {
    if (t >= seg.start && t < seg.end) {
      // A rampa vai até `rampaAte` (quando existe) e DESCANSA em `to` até o
      // corte — o clamp do `p` em 1 é o que segura a escala parada ali.
      const fim = seg.rampaAte != null && seg.rampaAte > seg.start ? seg.rampaAte : seg.end;
      const dur = Math.max(0.001, fim - seg.start);
      const p = easeInOutSine(Math.min(1, Math.max(0, (t - seg.start) / dur)));
      const e = seg.from + (seg.to - seg.from) * p;
      // DEFESA DE FUNDO: escala não-finita chega no drawImage como NaN e
      // apaga o quadro. Nenhum plano corrompido pode apagar a entrega —
      // 1 (tamanho natural) é sempre uma saída válida.
      return Number.isFinite(e) ? e : 1;
    }
  }
  return 1;
}

/**
 * ENCAIXA a fronteira hook→body da LEGENDA num corte (03.09).
 *
 * A regra é a mesma da headline: mudança de estilo no MEIO da fala denuncia o
 * automático, porque nada mais na tela muda junto. No corte, a troca de
 * imagem mascara — e o primeiro corte costuma ser exatamente a troca de take
 * hook→body, então quase sempre há um corte a fração de segundo da fronteira
 * que o alinhamento achou.
 *
 * `finsDasPalavras` = fim (s) de cada palavra do ASR, na ordem. `fronteira` =
 * quantas palavras são do hook. Devolve a fronteira ajustada: a palavra cujo
 * fim cai mais perto do corte vizinho — deslocando NO MÁXIMO `maxDesloc`
 * palavras, e só quando existe corte a até `tolSec` da troca original.
 * Fora disso, devolve intacta: melhor trocar no meio da fala do que engolir
 * meia frase de hook no estilo do body.
 */
export function encaixarFronteiraNoCorte(
  finsDasPalavras: number[],
  fronteira: number,
  cortes: number[],
  tolSec = 0.9,
  maxDesloc = 3,
): number {
  const n = finsDasPalavras.length;
  if (fronteira <= 0 || fronteira >= n || cortes.length === 0) return fronteira;
  const tTroca = finsDasPalavras[fronteira - 1];
  if (!(tTroca > 0) || !isFinite(tTroca)) return fronteira;

  let corte = cortes[0];
  for (const c of cortes) if (Math.abs(c - tTroca) < Math.abs(corte - tTroca)) corte = c;
  if (Math.abs(corte - tTroca) > tolSec) return fronteira;

  let melhor = fronteira;
  let melhorDist = Math.abs(tTroca - corte);
  const de = Math.max(1, fronteira - maxDesloc);
  const ate = Math.min(n - 1, fronteira + maxDesloc);
  for (let idx = de; idx <= ate; idx++) {
    const fim = finsDasPalavras[idx - 1];
    if (!(fim > 0) || !isFinite(fim)) continue;
    const d = Math.abs(fim - corte);
    if (d < melhorDist) {
      melhorDist = d;
      melhor = idx;
    }
  }
  return melhor;
}

/** PRNG determinístico (mulberry32): o MESMO vídeo dá o MESMO plano — sem
 *  isso, um RETOMAR entregaria um AD com dinâmica diferente do primeiro. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente estável: sai do próprio material (durações), não do relógio. */
function sementeDoPlano(durSec: number, cortes: Array<{ t: number }>): number {
  let h = Math.round(durSec * 1000);
  for (const c of cortes) h = (Math.imul(h, 31) + Math.round(c.t * 1000)) >>> 0;
  return h || 1;
}

const clampEscala = (x: number) => Math.min(SMART_MAX, Math.max(SMART_MIN, x));
/**
 * RESPIRO ANTES DO CORTE (31.08). O movimento tem que RESOLVER antes do corte
 * e ficar parado até ele — zoom cruzando um corte é a marca de edição
 * automática. Fração da janela reservada pro descanso, com piso e teto em
 * segundos pra valer tanto no take de 2s quanto no de 40s.
 */
const RESPIRO_FRACAO = 0.18;
const RESPIRO_MIN_SEC = 0.25;
const RESPIRO_MAX_SEC = 0.9;

/** Fronteiras (fim de cada trecho) a partir das durações das partes. */
export function fronteirasDasPartes(partesSec: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of partesSec) {
    if (!(d > 0) || !isFinite(d)) return [];
    acc += d;
    out.push(acc);
  }
  return out;
}

/**
 * SMART ZOOM — o plano com o feeling do editor (31.08).
 *
 * Lido do draft que o Silas montou à mão no CapCut. Três movimentos, nesta
 * ordem de frequência:
 *
 *   1. CORTE SECO (metade das janelas) — o trecho inteiro numa escala fixa e a
 *      troca acontece EXATAMENTE no corte. É o que dá o ritmo do draft:
 *      100% · 120% · 130% · 100%…
 *   2. ZOOM IN suavizado (~1/3) — rampa que RESOLVE antes do corte.
 *   3. ZOOM OUT (~1/6) — o tempero; um ou dois no AD inteiro.
 *
 * Invariantes duras (testadas): escala sempre em [100%, 135%]; toda troca cai
 * num CORTE, nunca no meio da fala; rampa sempre resolvida antes do corte.
 *
 * O sorteio é DETERMINÍSTICO (semente vinda das próprias durações): o mesmo
 * vídeo dá exatamente o mesmo plano, então um RETOMAR não muda a dinâmica.
 */
/**
 * Próximo degrau do corte seco.
 *
 * Duas regras, nesta ordem: (1) vindo de um trecho FECHADO, o corte abre — é o
 * que devolve o 100% ao vídeo; (2) senão, o primeiro da bolsa que seja
 * diferente o bastante da escala atual pra troca ser percebida no corte.
 */
function proximoDegrau(bolsa: number[], escala: number, encher: () => void): number {
  if (bolsa.length === 0) encher();
  const tirar = (i: number) => bolsa.splice(i, 1)[0];

  if (escala >= SMART_ALTO) {
    const i = bolsa.findIndex((d) => d <= SMART_ALIVIO_MAX);
    if (i >= 0) return tirar(i);
    // a bolsa não tem alívio agora: enche de novo e procura outra vez, senão
    // o vídeo ficaria fechado por mais um trecho inteiro.
    encher();
    const j = bolsa.findIndex((d) => d <= SMART_ALIVIO_MAX);
    if (j >= 0) return tirar(j);
  }

  // A VOLTA AO 100% é exceção do filtro (02.09). Com a escala em 1,06 depois
  // de uma deriva, o 100% ficava a 6% de distância e o filtro de "diferente o
  // bastante" o descartava — o plano nunca voltava ao repouso e morava no
  // meio (medido: 55% do tempo em 106-120%). Voltar pro 100% não é uma troca
  // qualquer, é o respiro do vídeo: ele passa com 4,5%.
  const serve = (d: number) =>
    Math.abs(d - escala) >= 0.08 || (d <= SMART_MIN + 0.001 && escala >= 1.045);
  const i = bolsa.findIndex(serve);
  if (i >= 0) return tirar(i);
  encher();
  const j = bolsa.findIndex(serve);
  return j >= 0 ? tirar(j) : 1.0;
}

function planejarSmartZoom(
  durSec: number,
  cortes: Array<{ t: number; forte: boolean }>,
): ZoomSeg[] {
  const rnd = prng(sementeDoPlano(durSec, cortes));
  const segs: ZoomSeg[] = [];
  let escala = 1.0; // começa SEMPRE em 100% (nada de borda no primeiro frame)
  let ini = 0;
  let c = 0;
  let bolsa: Array<'seco' | 'in' | 'out'> = [];
  // bolsa PARALELA, dos degraus — é ela que devolve o 100% ao vídeo
  const bolsaDeg: number[] = [];
  const encherDegraus = () => {
    bolsaDeg.length = 0;
    bolsaDeg.push(...SMART_BOLSA_DEGRAUS);
    for (let k = bolsaDeg.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [bolsaDeg[k], bolsaDeg[j]] = [bolsaDeg[j], bolsaDeg[k]];
    }
  };

  while (ini < durSec - 0.05 && c < cortes.length) {
    // 1) que movimento vem agora? sai da BOLSA (proporção garantida)
    if (bolsa.length === 0) {
      bolsa = [...SMART_BOLSA];
      // embaralho determinístico (Fisher-Yates com o mesmo PRNG)
      for (let k = bolsa.length - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [bolsa[k], bolsa[j]] = [bolsa[j], bolsa[k]];
      }
    }
    let tipo: 'seco' | 'in' | 'out' = bolsa.pop()!;
    /* ⚠ O PRIMEIRO TRECHO NUNCA É `out` (04.09). `out` por definição começa
     * FECHADO e abre — no instante zero isso faz o AD abrir no enquadramento
     * mais fechado e mais borrado, e sem corte nenhum antes que justifique.
     * Vira `in`, que começa em 100% e fecha: mesmo movimento, sentido certo
     * pro gancho. Os `out` seguintes continuam intactos. */
    if (segs.length === 0 && ini === 0 && tipo === 'out') tipo = 'in';
    // Sem ESPAÇO pra uma rampa que se perceba, cai no seco — nunca no outro
    // movimento. Converter out→in inflava o zoom in acima do seco e quebrava a
    // prioridade do draft (medido: 7 in contra 4 secos). O piso subiu de 2%
    // pra 6% em 02.09: uma rampa de 4% em 5s lê como vídeo travado.
    //
    // EXCEÇÃO do out (02.09): com o vídeo passando muito mais tempo em 100%, o
    // out no piso virava seco SEMPRE e o zoom out sumiu do plano (0 em 310s de
    // medição). Mas o corte já mascara um salto — então o out no piso vira
    // "entra fechado no corte e abre": pula pra cima NO CORTE (invisível) e
    // desce. É movimento de verdade, e a prioridade do seco continua intacta.
    let outDoPiso = false;
    if (tipo === 'out' && escala <= SMART_MIN + SMART_RAMPA_MIN_ESPACO) outDoPiso = true;
    if (tipo === 'in' && escala >= SMART_MAX - SMART_RAMPA_MIN_ESPACO) tipo = 'seco';

    // 2) a janela: o seco é curto (só o take numa escala), a rampa é longa
    const alvo = tipo === 'seco' ? SMART_SEG_SECO_SEC : SMART_SEG_RAMPA_SEC;
    let fim = durSec;
    let usou = cortes.length;
    for (let k = c; k < cortes.length; k++) {
      if (cortes[k].t - ini >= alvo || k === cortes.length - 1) {
        fim = Math.min(cortes[k].t, durSec);
        usou = k + 1;
        break;
      }
    }
    // a última janela sempre fecha no fim do vídeo
    if (usou >= cortes.length) fim = durSec;
    const dur = fim - ini;
    if (dur < 0.4) break; // resto insignificante

    // 3) a escala de destino
    if (tipo === 'seco') {
      /* ⚠ O AD ABRE EM 100% (04.09). `proximoDegrau` devolve por definição um
       * degrau DIFERENTE do atual — então, quando o primeiro trecho saía
       * "seco", o vídeo COMEÇAVA em 110/120/135%: o gancho (os 3 segundos que
       * mais importam) abria no enquadramento mais fechado e mais borrado, e
       * ainda por cima sem corte nenhum antes que justificasse o salto. O
       * comentário do topo e o teste (18) já afirmavam "começa SEMPRE em
       * 100%" — só não era verdade em todo sorteio.
       * Vale só pro SECO no instante zero: `in` e `out` são movimentos
       * deliberados e continuam como o Silas aprovou. */
      const nova =
        segs.length === 0 && ini === 0
          ? 1.0
          : clampEscala(proximoDegrau(bolsaDeg, escala, encherDegraus));
      if (dur >= SMART_SUBDIV_SEC) {
        // TAKE LONGO: cadeia de SEGURA→ESCORREGA→SEGURA→ESCORREGA até o fim
        // do take (02.09, 2ª rodada — Silas: "tem que transicionar mais entre
        // as proporções"). Cada elo é rampa CONTÍNUA: nada pula no meio do
        // take, mas a proporção nunca fica parada por muito tempo.
        let cursor = ini;
        let escalaAtual = nova;
        let elo = 0;
        while (fim - cursor > 0.35 && elo < 8) {
          const resta = fim - cursor;
          // segura curto, escorrega um pouco mais longo
          const durSegura = Math.min(resta, SMART_SEG_SECO_SEC * (0.7 + rnd() * 0.5));
          segs.push({ start: cursor, end: Math.min(fim, cursor + durSegura), from: escalaAtual, to: escalaAtual, rampaAte: Math.min(fim, cursor + durSegura) });
          cursor = Math.min(fim, cursor + durSegura);
          if (fim - cursor <= 0.35) break;

          const aberto = escalaAtual <= 1.08;
          // Saindo do aberto a deriva é menor: senão o 100% dura um sopro.
          const dMin = aberto ? 0.05 : SMART_DERIVA_MIN;
          const dMax = aberto ? 0.1 : SMART_DERIVA_MAX;
          const deriva = dMin + rnd() * (dMax - dMin);
          // Fechado desce, aberto sobe, o meio pende pra baixo — é o conjunto
          // que impede o plano de morar no teto.
          const paraBaixo = escalaAtual >= 1.2 ? true : aberto ? false : rnd() < 0.62;
          const alvoDeriva = clampEscala(paraBaixo ? escalaAtual - deriva : escalaAtual + deriva);
          const durDeriva = Math.min(fim - cursor, SMART_SEG_RAMPA_SEC * (0.6 + rnd() * 0.5));
          const fimDeriva = Math.min(fim, cursor + durDeriva);
          segs.push({ start: cursor, end: fimDeriva, from: escalaAtual, to: alvoDeriva, rampaAte: fimDeriva });
          cursor = fimDeriva;
          escalaAtual = alvoDeriva;
          elo++;
        }
        /* ⚠ NADA DE BURACO NO PLANO (04.09). O teto de 0,01s deixava uma
         * fresta de até 10ms sem nenhum segmento cobrindo. Um quadro tem 33ms,
         * então essa fresta cai DENTRO de um quadro: o `escalaNoInstante` não
         * acha segmento, devolve 1, e o AD dá uma PISCADA de volta ao 100% no
         * meio do movimento. Qualquer sobra vira segmento. */
        if (fim - cursor > 0) {
          segs.push({ start: cursor, end: fim, from: escalaAtual, to: escalaAtual, rampaAte: fim });
        }
        escala = escalaAtual;
      } else {
        segs.push({ start: ini, end: fim, from: nova, to: nova, rampaAte: fim });
        escala = nova;
      }
    } else {
      // rampa: alguns leves, outros mais curtos e por isso mais agressivos —
      // mas o teto de 135% e o piso de 100% valem sempre.
      const passo = 0.07 + rnd() * 0.11; // 7% a 18%
      // no out-do-piso a ENTRADA é que sobe (no corte); o destino é o piso
      const partida = outDoPiso ? clampEscala(escala + passo + 0.06) : escala;
      const destino = clampEscala(tipo === 'in' ? partida + passo : partida - passo);
      if (Math.abs(destino - partida) < 0.02) {
        // não sobrou amplitude: entrega como seco em vez de uma rampa morta
        segs.push({ start: ini, end: fim, from: partida, to: partida, rampaAte: fim });
        escala = partida;
      } else {
        const respiro = Math.min(RESPIRO_MAX_SEC, Math.max(RESPIRO_MIN_SEC, dur * RESPIRO_FRACAO));
        const rampaAte = dur > respiro * 2 ? fim - respiro : ini + dur / 2;
        segs.push({ start: ini, end: fim, from: partida, to: destino, rampaAte });
        escala = destino;
      }
    }

    ini = fim;
    c = usou;
  }

  if (segs.length === 0) segs.push({ start: 0, end: durSec, from: 1, to: 1, rampaAte: durSec });
  // o plano SEMPRE cobre o vídeo inteiro (buraco = frame sem escala definida)
  segs[segs.length - 1].end = durSec;
  return segs;
}

/**
 * Monta o plano de zoom do vídeo FINAL.
 *
 * Cada janela é uma rampa de escala que TERMINA num corte real — o reset nunca
 * cai no meio de um take. Mas ela não morre em TODO corte: acumula até ter uns
 * 7s (tempo de o movimento ser percebido), atravessando os cortes do caminho, e
 * fecha de preferência numa TROCA DE TAKE, onde o reset é invisível. Sem
 * durações confiáveis (soma ≠ duração do vídeo), cai na cadência fixa de ~8s.
 *
 *  - modo `in`: cada janela empurra 1 → amp (push-in clássico).
 *  - modo `out`: amp → 1.
 *  - modo `inout`: alterna in/out por janela.
 *  - força `misto`: alterna leve/forte por janela.
 */
export function planejarZoom(
  cfg: ZoomCfg,
  durSec: number,
  partesSec: number[] | null | undefined,
  /** cortes INTERNOS de cada parte (decupagem), na mesma ordem de `partesSec`.
   *  Cada item é a lista de durações dos pedaços daquela parte. O zoom nunca
   *  atravessa nenhum deles. */
  cortesInternosSec?: number[][] | null,
): ZoomSeg[] {
  if (!cfg.on || !(durSec > 0.5)) return [];

  // ── FRONTEIRAS COM FORÇA ──
  // FORTE = troca de take (o conteúdo muda; o reset da escala é INVISÍVEL).
  // FRACA = corte da decupagem (mesmo enquadramento; resetar aqui APARECE
  //         como pulo, então só usamos quando o take é longo demais).
  const partes = partesSec || [];
  const cortes: Array<{ t: number; forte: boolean }> = [];
  let base = 0;
  let podre = false;
  for (let i = 0; i < partes.length; i++) {
    if (!(partes[i] > 0) || !isFinite(partes[i])) { podre = true; break; }
    const internos = cortesInternosSec?.[i];
    if (internos && internos.length > 1 && internos.every((d) => d > 0 && isFinite(d))) {
      let acc = 0;
      for (let k = 0; k < internos.length - 1; k++) {
        acc += internos[k];
        cortes.push({ t: base + acc, forte: false }); // corte de decupagem
      }
    }
    base += partes[i];
    cortes.push({ t: base, forte: true }); // fim da parte = troca de take
  }

  const soma = base;
  const confiaveis = !podre && cortes.length > 0 && Math.abs(soma - durSec) <= Math.max(1.5, durSec * 0.12);
  if (!confiaveis) {
    cortes.length = 0;
    for (let t = CADENCIA_SEC; t < durSec; t += CADENCIA_SEC) cortes.push({ t, forte: true });
    cortes.push({ t: durSec, forte: true });
  } else {
    cortes[cortes.length - 1].t = Math.max(cortes[cortes.length - 1].t, durSec);
  }

  // SMART ZOOM tem o próprio ritmo (seco/in/out) — ele monta as janelas dele.
  if (cfg.forca === 'smart') return planejarSmartZoom(durSec, cortes);

  // ── AGRUPA cortes até a janela ter TEMPO de mostrar o movimento ──
  // O zoom ATRAVESSA os cortes intermediários (num jump cut do mesmo take o
  // movimento contínuo até ajuda: dá continuidade) e só RESETA no corte que
  // fecha a janela — de preferência uma troca de take.
  const janelas: Array<{ start: number; end: number }> = [];
  let ini = 0;
  for (let c = 0; c < cortes.length; c++) {
    const { t, forte } = cortes[c];
    const dur = t - ini;
    if (dur < JANELA_ALVO_SEC && c < cortes.length - 1) continue; // ainda curta: atravessa

    // Bateu o alvo num corte FRACO: vale esperar por um FORTE logo à frente?
    if (!forte && c < cortes.length - 1) {
      const proxForte = cortes.slice(c + 1).find((x) => x.forte);
      if (proxForte && proxForte.t - t <= ESPERA_POR_FORTE_SEC) continue;
    }
    janelas.push({ start: ini, end: Math.min(t, durSec) });
    ini = t;
    if (ini >= durSec) break;
  }
  if (ini < durSec - 0.01) {
    // sobra do fim: gruda na última (nunca abre uma janela curtinha no final)
    if (janelas.length > 0) janelas[janelas.length - 1].end = durSec;
    else janelas.push({ start: 0, end: durSec });
  }
  if (janelas.length === 0) janelas.push({ start: 0, end: durSec });

  // Janela que ficou abaixo do mínimo funde com a anterior — movimento curto
  // demais não é lido como movimento, é como falha.
  for (let i = janelas.length - 1; i > 0; i--) {
    if (janelas[i].end - janelas[i].start < JANELA_MIN_SEC) {
      janelas[i - 1].end = janelas[i].end;
      janelas.splice(i, 1);
    }
  }

  /* ⚠ `forca` VINDA DO localStorage NÃO É CONFIÁVEL (04.09). O `getZoomCfg`
   * do Pilot devolve o objeto salvo VERBATIM, sem merge com o padrão. Uma
   * config antiga (o `misto` que existiu antes) ou qualquer valor estranho
   * fazia `ZOOM_AMP[cfg.forca]` virar `undefined` — daí a amplitude vira NaN,
   * o plano inteiro fica NaN e o render entrega o AD com a tela apagada, sem
   * um erro. Cair no `medio` é sempre melhor que apagar a entrega. */
  const ampDe = (i: number): number =>
    cfg.forca === 'smart'
      ? i % 2 === 0
        ? ZOOM_AMP.leve
        : ZOOM_AMP.forte
      : (ZOOM_AMP[cfg.forca] ?? ZOOM_AMP.medio);

  return janelas.map((j, i) => {
    const amp = ampDe(i);
    const zoomIn = cfg.modo === 'in' || (cfg.modo === 'inout' && i % 2 === 0);
    // A RAMPA TERMINA ANTES DO CORTE: `end` recua o respiro e, do respiro até
    // o corte, o `zoomScaleAt` segura a escala final (a janela continua
    // cobrindo o trecho, só que já resolvida). É o que separa "zoom de editor"
    // de "zoom automático atravessando corte".
    const dur = j.end - j.start;
    const respiro = Math.min(RESPIRO_MAX_SEC, Math.max(RESPIRO_MIN_SEC, dur * RESPIRO_FRACAO));
    // janela curta demais pra ter respiro: encurta a rampa pela metade
    const fimRampa = dur > respiro * 2 ? j.end - respiro : j.start + dur / 2;
    return {
      start: j.start,
      end: j.end,
      rampaAte: fimRampa,
      from: zoomIn ? 1 : amp,
      to: zoomIn ? amp : 1,
    };
  });
}

/* ═════════════════ fronteira do HOOK (alinhamento, 31.08) ════════════════ */

/** normaliza pra COMPARAR (minúsculas, sem acento, sem pontuação) */
function normPal(x: string): string {
  return x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** distância de edição entre duas palavras já normalizadas */
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

function simPal(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  return 1 - edit(a, b) / Math.max(a.length, b.length);
}

/**
 * QUANTAS palavras do ASR o HOOK ocupa de verdade.
 *
 * ⚠ Esta função existe por causa de um defeito REAL (31.08): a fronteira
 * hook×body era a CONTAGEM de palavras da copy do doc. Só que o ASR não conta
 * igual — ele come uma palavra, junta duas, inventa um "é" — e uma única
 * palavra de diferença faz a legenda TROCAR DE ESTILO ANTES DA HORA. Foi assim
 * que o "daqui." (última palavra do hook) saiu com o estilo do body.
 *
 * Aqui a fronteira sai de ALINHAMENTO (Needleman-Wunsch semi-global, mesma
 * família do correctBlocksByCopy): as palavras do hook são casadas com as do
 * ASR e o corte cai onde o hook REALMENTE acaba no áudio. Sobra do ASR depois
 * do hook é gap grátis — o body começa exatamente ali.
 *
 * Devolve `null` quando não dá pra confiar (hook curto demais, ASR vazio, ou
 * casamento fraco) — aí o caller cai na contagem de antes, que é o
 * comportamento que já rodava.
 */
export function palavrasDoHookNoAsr(
  palavrasAsr: string[],
  hookText: string,
): number | null {
  const A = palavrasAsr.map(normPal).filter((x) => x.length > 0);
  const B = hookText
    .split(/\s+/)
    .map(normPal)
    .filter((x) => x.length > 0);
  // hook curto demais pra alinhar com segurança → contagem de antes
  if (B.length < 3 || A.length < B.length * 0.4) return null;

  const n = Math.min(A.length, B.length * 3 + 20); // o hook não some no fim do vídeo
  const m = B.length;
  const GAP = -0.6;
  const score = (i: number, j: number): number => {
    const sm = simPal(A[i], B[j]);
    if (sm >= 0.999) return 2;
    if (sm >= 0.55) return 0.4 + 1.2 * sm;
    return -1.1;
  };

  const W = m + 1;
  const dp = new Float64Array((n + 1) * W);
  for (let i = 1; i <= n; i++) dp[i * W] = i * GAP;
  for (let j = 1; j <= m; j++) dp[j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[(i - 1) * W + (j - 1)] + score(i - 1, j - 1);
      const up = dp[(i - 1) * W + j] + GAP;
      const lf = dp[i * W + (j - 1)] + GAP;
      dp[i * W + j] = Math.max(d, up, lf);
    }
  }

  // SEMI-GLOBAL: o hook tem que ser consumido INTEIRO (coluna m), mas o ASR
  // pode continuar depois — então procuramos o i que melhor fecha o hook.
  let melhorI = 0;
  let melhor = -Infinity;
  for (let i = 1; i <= n; i++) {
    const v = dp[i * W + m];
    if (v > melhor) {
      melhor = v;
      melhorI = i;
    }
  }
  // casamento fraco (menos de ~55% do teto teórico) → não confia
  const teto = m * 2;
  if (melhorI === 0 || melhor < teto * 0.55) return null;
  return melhorI;
}

/* ═══════════════════════════ legenda (roteiro) ═══════════════════════════ */

/** Separa a copy das partes em HOOK × BODY (mesma régua dos diagnostics). */
export function separarHookBody(partes: Array<{ label: string; text: string }>): { hook: string; body: string } {
  const hook: string[] = [];
  const body: string[] = [];
  for (const p of partes) {
    const t = (p.text || '').trim();
    if (!t) continue;
    if (/^(hook|gancho)/i.test(p.label || '')) hook.push(t);
    else body.push(t);
  }
  return { hook: hook.join('\n'), body: body.join('\n') };
}

/**
 * Roteiro pronto pro `applyCaptionScript`: hook com a copy do doc (a fronteira
 * é a contagem de palavras dela) e body como "o resto do vídeo" — assim
 * nenhuma sobra do ASR fica sem estilo. Template sem hook (ou task sem hook)
 * degrada pra um único trecho de body.
 */
export function montarRoteiro(
  tpl: CaptionTemplate,
  hookText: string,
  bodyText: string,
  /** palavras que o hook ocupa NO ÁUDIO (de `palavrasDoHookNoAsr`). Quando
   *  vem, VENCE a contagem da copy — é ela que impede a legenda de trocar de
   *  estilo antes da hora. `null` cai na contagem de antes. */
  palavrasDoHook?: number | null,
): CaptionSegment[] {
  const segs = templateToSegments(tpl);
  const hookSeg = segs.find((s) => s.kind === 'hook');
  const bodySeg = [...segs].reverse().find((s) => s.kind === 'body') || segs[segs.length - 1];
  const out: CaptionSegment[] = [];
  if (hookSeg && hookText.trim()) {
    const medido = palavrasDoHook != null && palavrasDoHook > 0 ? palavrasDoHook : null;
    out.push({ ...hookSeg, text: hookText, words: medido });
  }
  // o ÚLTIMO trecho é sempre "o resto": text vazio + words null
  out.push({ ...bodySeg, kind: 'body', text: '', words: null, label: bodySeg.label || 'Body' });
  void bodyText; // o texto do body corrige via correctBlocksByCopy; a fronteira é só do hook
  return out;
}
