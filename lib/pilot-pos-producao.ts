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
export type ZoomSeg = { start: number; end: number; from: number; to: number };

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

/** Amplitude de cada força (escala máxima). Régua do feeling do estúdio:
 *  push-in lento do CapCut é ~+11%; "leve" fica perto da respiração (~4,5%). */
export const ZOOM_AMP: Record<Exclude<ZoomForca, 'misto'>, number> = {
  leve: 1.045,
  medio: 1.09,
  forte: 1.16,
};

/** Cadência quando não há fronteiras de corte confiáveis. */
const CADENCIA_SEC = 8;
/** Segmento mais curto que isto funde com o vizinho (zoom não "pisca"). */
const SEG_MIN_SEC = 1.5;

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
 * As janelas seguem as PARTES da montagem (cada troca de take é um corte real
 * — o reset da escala cai exatamente ali e não aparece). Sem durações
 * confiáveis (soma ≠ duração do vídeo), cai na cadência fixa de ~8s.
 *
 *  - modo `in`: cada janela empurra 1 → amp (push-in clássico).
 *  - modo `out`: amp → 1.
 *  - modo `inout`: alterna in/out por janela.
 *  - força `misto`: alterna leve/forte por janela.
 */
export function planejarZoom(cfg: ZoomCfg, durSec: number, partesSec: number[] | null | undefined): ZoomSeg[] {
  if (!cfg.on || !(durSec > 0.5)) return [];

  // janelas: partes reais quando batem com o vídeo; senão cadência
  let bordas = fronteirasDasPartes(partesSec || []);
  const soma = bordas.length ? bordas[bordas.length - 1] : 0;
  const confiaveis = bordas.length > 0 && Math.abs(soma - durSec) <= Math.max(1.5, durSec * 0.12);
  if (!confiaveis) {
    bordas = [];
    for (let t = CADENCIA_SEC; t < durSec; t += CADENCIA_SEC) bordas.push(t);
    bordas.push(durSec);
  } else {
    // garante que a última janela cobre até o fim do vídeo de fato
    bordas[bordas.length - 1] = Math.max(bordas[bordas.length - 1], durSec);
  }

  // funde janelas curtinhas com a SEGUINTE (um take de 0.8s não ganha rampa própria)
  const janelas: Array<{ start: number; end: number }> = [];
  let ini = 0;
  for (const fim of bordas) {
    if (fim - ini < SEG_MIN_SEC && janelas.length === 0 && fim < durSec) continue; // acumula no próximo
    if (fim - ini < SEG_MIN_SEC && janelas.length > 0) {
      janelas[janelas.length - 1].end = fim; // gruda na anterior
      ini = fim;
      continue;
    }
    janelas.push({ start: ini, end: Math.min(fim, durSec) });
    ini = fim;
    if (ini >= durSec) break;
  }
  if (janelas.length === 0) janelas.push({ start: 0, end: durSec });

  const ampDe = (i: number): number =>
    cfg.forca === 'misto' ? (i % 2 === 0 ? ZOOM_AMP.leve : ZOOM_AMP.forte) : ZOOM_AMP[cfg.forca];

  return janelas.map((j, i) => {
    const amp = ampDe(i);
    const zoomIn = cfg.modo === 'in' || (cfg.modo === 'inout' && i % 2 === 0);
    return { start: j.start, end: j.end, from: zoomIn ? 1 : amp, to: zoomIn ? amp : 1 };
  });
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
export function montarRoteiro(tpl: CaptionTemplate, hookText: string, bodyText: string): CaptionSegment[] {
  const segs = templateToSegments(tpl);
  const hookSeg = segs.find((s) => s.kind === 'hook');
  const bodySeg = [...segs].reverse().find((s) => s.kind === 'body') || segs[segs.length - 1];
  const out: CaptionSegment[] = [];
  if (hookSeg && hookText.trim()) {
    out.push({ ...hookSeg, text: hookText, words: null });
  }
  // o ÚLTIMO trecho é sempre "o resto": text vazio + words null
  out.push({ ...bodySeg, kind: 'body', text: '', words: null, label: bodySeg.label || 'Body' });
  void bodyText; // o texto do body corrige via correctBlocksByCopy; a fronteira é só do hook
  return out;
}
