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
/* ⭐ SMART ZOOM v3 (04.09) — o modelo do Silas, nas palavras dele:
 *   "1 TAKE 100% SEM ZOOM, DEPOIS EM ALGUM CORTE 135/130%, AI DEPOIS CORTE
 *    PRA 100% DE NOVO, ISSO SEM ZOOM. AI EM ALGUM, MENOS QUE ESSA DINAMICA DE
 *    SO MUDAR PROPORCAO, ALGUNS QUE VAO SER ZOOM IN, DO 100% AO 135% —
 *    CUIDADO NAO DEIXAR MUITO LONGO E NEM MUITO CURTO."
 *
 * Dois NÍVEIS parados — ABERTO (100%) e FECHADO (130 ou 135%) — e três ações
 * por corte: SEGURA (mesmo nível, corte sem troca), TROCA (seca pro outro
 * nível) e IN (rampa 100→fechado com duração calibrada, depois PARA no fechado
 * até o corte). Não há deriva nos takes parados: "sem zoom" é sem zoom. Não
 * há zoom out em rampa: a troca seca 135→100 já é o "abre" do modelo.
 *
 * A versão anterior (bolsa seco/in/out + deriva dentro do take) media 73% do
 * tempo com a escala se movendo — ele viu como "zoom in leve o tempo todo". */
const SMART_FECHADO = [1.3, 1.35];
/** Quanto uma janela acumula antes de fechar no próximo corte: SEGURA/TROCA
 *  valem um pedaço da decupagem; a rampa IN precisa de mais pra não sair curta. */
const SMART_JANELA_SECA_SEC = 1.8;
const SMART_JANELA_IN_SEC = 2.4;
/** A rampa IN 100→135: "nem muito longo nem muito curto". Abaixo do mínimo a
 *  janela vira TROCA (um pulo de 35% em 1,5s é tranco, não zoom). Acima do
 *  máximo a rampa para e o take SEGURA no fechado até o corte. */
const SMART_IN_MIN_SEC = 2.2;
const SMART_IN_MAX_SEC = 3.6;
/** Take LONGO (vídeo sem decupagem) aberto vira IN mesmo sem a bolsa pedir —
 *  10 segundos parados em 100% seria vídeo morto. */
const SMART_TAKE_LONGO_SEC = 5.5;
/** Bolsa de ações. "TRABALHA MAIS COM A TROCA DE PROPORÇÃO E ALGUNS ZOOM IN
 *  ÀS VEZES": troca 4/8, segura 2/8 (é o que dá o "1 take 100%... depois em
 *  ALGUM corte"), in 2/8 — menos que a troca, como ele pediu. */
const SMART_ACOES: Array<'troca' | 'segura' | 'in'> = ['troca', 'troca', 'troca', 'troca', 'segura', 'segura', 'in', 'in'];

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
function planejarSmartZoom(
  durSec: number,
  cortes: Array<{ t: number; forte: boolean }>,
): ZoomSeg[] {
  const rnd = prng(sementeDoPlano(durSec, cortes));
  const segs: ZoomSeg[] = [];
  const ABERTO = SMART_MIN;

  // estado: em que nível o vídeo está PARADO agora
  let nivel: 'aberto' | 'fechado' = 'aberto';
  let escala = ABERTO; // começa SEMPRE em 100% — "1 take 100% sem zoom"
  let ini = 0;
  let c = 0;
  let bolsa: Array<'troca' | 'segura' | 'in'> = [];
  let inPendente = false; // um IN sorteado no nível fechado espera o próximo take aberto

  const sortearFechado = () => clampEscala(SMART_FECHADO[Math.floor(rnd() * SMART_FECHADO.length)]);

  const proximaAcao = (): 'troca' | 'segura' | 'in' => {
    if (bolsa.length === 0) {
      bolsa = [...SMART_ACOES];
      for (let k = bolsa.length - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [bolsa[k], bolsa[j]] = [bolsa[j], bolsa[k]];
      }
    }
    return bolsa.pop()!;
  };

  let primeira = true;
  while (ini < durSec - 0.05 && c < cortes.length) {
    // 1) a ação deste take
    let acao: 'troca' | 'segura' | 'in';
    if (primeira) {
      acao = 'segura'; // o AD abre num take de 100% parado
    } else if (inPendente && nivel === 'aberto') {
      acao = 'in';
      inPendente = false;
    } else {
      acao = proximaAcao();
    }

    // 2) até onde a janela vai: fecha no 1º corte depois do alvo
    const alvo = acao === 'in' ? SMART_JANELA_IN_SEC : SMART_JANELA_SECA_SEC;
    let fim = durSec;
    let usou = cortes.length;
    for (let k = c; k < cortes.length; k++) {
      if (cortes[k].t - ini >= alvo || k === cortes.length - 1) {
        fim = Math.min(cortes[k].t, durSec);
        usou = k + 1;
        break;
      }
    }
    if (usou >= cortes.length) fim = durSec;
    const dur = fim - ini;
    if (dur < 0.4) break; // resto insignificante

    // 3) um IN só nasce do ABERTO e só se couber a rampa; senão vira troca
    //    (e, se estava fechado, o IN fica pendente pro próximo take aberto —
    //    a sequência lê 135 →corte→ 100 →rampa→ 135, que é o desenho dele)
    if (acao === 'in') {
      if (nivel === 'fechado') {
        inPendente = true;
        acao = 'troca';
      } else if (dur < SMART_IN_MIN_SEC) {
        acao = 'troca';
      }
    }
    // take LONGO aberto (vídeo sem decupagem): parado em 100% por 6-10s é
    // vídeo morto — vira IN. Fechado longo fica parado: "sem zoom".
    if (acao !== 'in' && nivel === 'aberto' && dur >= SMART_TAKE_LONGO_SEC && !primeira) acao = 'in';

    // 4) emite o trecho
    if (acao === 'segura') {
      segs.push({ start: ini, end: fim, from: escala, to: escala, rampaAte: fim });
    } else if (acao === 'troca') {
      const nova = nivel === 'aberto' ? sortearFechado() : ABERTO;
      segs.push({ start: ini, end: fim, from: nova, to: nova, rampaAte: fim });
      escala = nova;
      nivel = nivel === 'aberto' ? 'fechado' : 'aberto';
    } else {
      // IN: rampa do 100% ao fechado com duração calibrada; o que sobrar do
      // take SEGURA no fechado. A rampa sempre termina ANTES do corte.
      const destino = sortearFechado();
      const respiro = Math.min(RESPIRO_MAX_SEC, Math.max(RESPIRO_MIN_SEC, dur * RESPIRO_FRACAO));
      const durRampa = Math.min(SMART_IN_MAX_SEC, dur - respiro);
      const rampaAte = ini + durRampa;
      segs.push({ start: ini, end: fim, from: ABERTO, to: destino, rampaAte });
      escala = destino;
      nivel = 'fechado';
    }

    primeira = false;
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
