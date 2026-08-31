'use client';

/**
 * FakePass — AUDITORIA de export (dev-only; em produção devolve vazio).
 *
 * Percorre TODOS os modelos com o estado padrão, roda o pipeline REAL de
 * export (renderNodeToCanvas) e mede objetivamente o alinhamento do PNG:
 *
 *  • driftTotal  — altura do PNG vs altura do palco × scale (layout global);
 *  • por FOLHA de texto — renderiza uma 2ª vez com TODO texto transparente e
 *    diff A−B isola a TINTA de cada texto; compara o centro da tinta com o
 *    centro do texto no DOM (resíduo vertical) e acusa tinta SUMIDA/comida.
 *    Emojis (<img>) aparecem nos dois renders e se cancelam no diff.
 *  • cada PNG é salvo em .dev-fp-audit/ (rota dev) pra inspeção visual.
 *
 * Uso (console): window.__fpAuditStart() → poll window.__fpAuditResults.
 */

import { useEffect, useRef, useState } from 'react';
import { MODELS } from '../models';
import { uiFont, defaultStatus, renderNodeToCanvas } from '../shared';

type LeafResult = {
  text: string;
  errPx: number | null; // resíduo vertical em px CSS (+ = tinta baixa demais)
  missing: boolean; // texto visível no DOM sem tinta no PNG
};

function collectLeafBoxes(node: HTMLElement) {
  const stage = node.getBoundingClientRect();
  const out: { x0: number; x1: number; y0: number; y1: number; text: string }[] = [];
  node.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.08) return;
    if (cs.writingMode !== 'horizontal-tb') return; // rotacionado: fora do eixo
    if (parseFloat(cs.fontSize) < 8) return;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 3 || !(n.textContent || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 4 || r.height < 6) continue;
      // fora do palco (ex.: conteúdo clipado de propósito) não conta
      if (r.bottom < stage.top + 1 || r.top > stage.bottom - 1) continue;
      out.push({
        x0: r.left - stage.left,
        x1: r.right - stage.left,
        y0: r.top - stage.top,
        y1: r.bottom - stage.top,
        text: (n.textContent || '').trim().slice(0, 40),
      });
    }
  });
  return out;
}

function measureLeaves(
  A: HTMLCanvasElement,
  B: HTMLCanvasElement,
  leaves: ReturnType<typeof collectLeafBoxes>,
  scale: number,
): LeafResult[] {
  const W = Math.min(A.width, B.width);
  const H = Math.min(A.height, B.height);
  const a = A.getContext('2d')!.getImageData(0, 0, W, H).data;
  const b = B.getContext('2d')!.getImageData(0, 0, W, H).data;
  const res: LeafResult[] = [];
  for (const lf of leaves) {
    const x0 = Math.max(0, Math.round(lf.x0 * scale) + 1);
    const x1 = Math.min(W, Math.round(lf.x1 * scale) - 1);
    const y0 = Math.max(0, Math.round(lf.y0 * scale - 5 * scale));
    const y1 = Math.min(H, Math.round(lf.y1 * scale + 8 * scale));
    if (x1 - x0 < 3 || y1 - y0 < 3) continue;
    const cols = x1 - x0;
    const thr = Math.max(2, cols * 0.03);
    let minY = -1;
    let maxY = -1;
    for (let y = y0; y < y1; y++) {
      let cnt = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const d = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
          Math.abs(a[i + 3] - b[i + 3]),
        );
        if (d > 40) cnt++;
      }
      if (cnt >= thr) {
        if (minY < 0) minY = y;
        maxY = y;
      }
    }
    if (minY < 0) {
      res.push({ text: lf.text, errPx: null, missing: true });
      continue;
    }
    const inkMid = (minY + maxY) / 2;
    const domMid = ((lf.y0 + lf.y1) / 2) * scale;
    res.push({ text: lf.text, errPx: +((inkMid - domMid) / scale).toFixed(2), missing: false });
  }
  return res;
}

/** Estado ESTRESSADO: estica todo campo textual com texto longo + emojis —
 *  simula o conteúdo real do cliente (nada de default curtinho). Campos que
 *  parecem cor/URL/número/hora ficam intactos. Determinístico. */
const STRESS_SUFIXO = ' aumentando bastante esse texto com emoji 🔥😱💯 pra estressar o layout e conferir que nada quebra nem desalinha no download';
function stressify(s: any): any {
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    if (/^#|^https?:|^data:/.test(v) || /^[\d.,:%\sh]+$/i.test(v)) {
      out[k] = v;
      continue;
    }
    const textual = (v.includes(' ') && v.length >= 4) || v.length >= 12;
    if (!textual) {
      out[k] = v;
      continue;
    }
    if (v.includes('\n')) {
      out[k] = v
        .split('\n')
        .map((l) => (l.trim() ? l + ' — e uma resposta beeem mais looonga 😂🙏 pra testar a quebra' : l))
        .join('\n');
    } else {
      out[k] = v + STRESS_SUFIXO;
    }
  }
  return out;
}

export default function FpAuditPage() {
  const [idx, setIdx] = useState(-1);
  const [stress, setStress] = useState(false);
  // patch de estado aplicado por cima do defaultState (ex.: {format:'portrait'}
  // pra auditar os SITES em cada formato, ou {orient:'portrait'} pros jornais).
  const [patch, setPatch] = useState<Record<string, any>>({});
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (window as any).__fpAuditStart = (
      from = 0,
      opts: { stress?: boolean; patch?: Record<string, any>; until?: number } = {},
    ) => {
      (window as any).__fpAuditResults = [];
      (window as any).__fpAuditUntil = typeof opts.until === 'number' ? opts.until : MODELS.length;
      setStress(!!opts.stress);
      setPatch(opts.patch || {});
      setIdx(from);
    };
  }, []);

  const stateFor = (model: any) => {
    const base = stress ? stressify(model.defaultState) : model.defaultState;
    const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k in base) extra[k] = v; // só aplica em modelo que TEM o campo
    }
    return { ...base, ...extra };
  };

  useEffect(() => {
    const until = (window as any).__fpAuditUntil ?? MODELS.length;
    if (idx < 0 || idx >= Math.min(MODELS.length, until)) return;
    let cancel = false;
    (async () => {
      // FitText/efeitos/fontes assentarem antes de medir
      await (document as any).fonts?.ready;
      await new Promise((r) => setTimeout(r, 700));
      if (cancel) return;
      const node = stageRef.current;
      const model = MODELS[idx];
      const s = stateFor(model);
      const dims = model.dims
        ? model.dims(s)
        : { stageW: model.stageW, ratio: model.ratio, exportW: model.exportW };
      const out: any = { id: model.id, label: model.label, stress, patch };
      try {
        if (!node) throw new Error('sem stage');
        const scale = dims.exportW / dims.stageW;
        const stageRect = node.getBoundingClientRect();
        const leaves = collectLeafBoxes(node);
        const t0 = performance.now();
        const A = await renderNodeToCanvas(node, dims.exportW, dims.stageW);
        out.ms = Math.round(performance.now() - t0);
        node.setAttribute('data-audit-hide', '1');
        const B = await renderNodeToCanvas(node, dims.exportW, dims.stageW);
        node.removeAttribute('data-audit-hide');
        out.pngW = A.width;
        out.pngH = A.height;
        out.driftTotal = +(A.height - stageRect.height * scale).toFixed(2);
        const leafResults = measureLeaves(A, B, leaves, scale);
        out.leafCount = leafResults.length;
        out.missing = leafResults.filter((l) => l.missing);
        out.desalinhado = leafResults.filter((l) => l.errPx !== null && Math.abs(l.errPx) > 2.5);
        out.maxErr = leafResults.reduce((m, l) => Math.max(m, Math.abs(l.errPx ?? 0)), 0);
        const blob: Blob | null = await new Promise((r) => A.toBlob(r, 'image/png'));
        const pTag = Object.values(patch).join('-');
        if (blob) await fetch(`/api/dev-fp-save?name=audit-${stress ? 'stress-' : ''}${pTag ? pTag + '-' : ''}${model.id}`, { method: 'POST', body: blob });
      } catch (e: any) {
        out.error = String(e?.message || e);
      }
      (window as any).__fpAuditResults.push(out);
      if (!cancel) setIdx((i) => i + 1);
    })();
    return () => {
      cancel = true;
    };
  }, [idx]);

  if (process.env.NODE_ENV === 'production') return null;

  const model = idx >= 0 && idx < MODELS.length ? MODELS[idx] : null;

  return (
    <div style={{ padding: 24, background: '#17131f', minHeight: '100vh' }}>
      <style>{`[data-audit-hide], [data-audit-hide] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }`}</style>
      <p style={{ color: '#fff', fontSize: 13, marginBottom: 16 }} data-audit-status>
        {idx < 0
          ? 'parada — rode window.__fpAuditStart()'
          : idx >= MODELS.length
            ? `CONCLUÍDA (${MODELS.length} modelos)`
            : `${idx + 1}/${MODELS.length} — ${model?.id}`}
      </p>
      {model ? (
        <div data-fp-zoom style={{ zoom: 1, lineHeight: 0 }}>
          <div ref={stageRef} className={uiFont.variable} style={{ display: 'inline-block', lineHeight: 0 }}>
            {model.Preview({ s: stateFor(model), status: defaultStatus })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
