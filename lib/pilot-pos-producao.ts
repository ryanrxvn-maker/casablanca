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
};

export type ZoomModo = 'in' | 'out' | 'inout';
export type ZoomForca = 'leve' | 'medio' | 'forte' | 'misto';

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
export const ZOOM_AMP: Record<Exclude<ZoomForca, 'misto'>, number> = {
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

  const ampDe = (i: number): number =>
    cfg.forca === 'misto' ? (i % 2 === 0 ? ZOOM_AMP.leve : ZOOM_AMP.forte) : ZOOM_AMP[cfg.forca];

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
