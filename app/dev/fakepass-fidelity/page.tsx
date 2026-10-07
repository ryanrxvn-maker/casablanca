'use client';

/**
 * PREVIEW DEV-ONLY: FIDELIDADE do download do FakePass (prévia × PNG).
 * Monta UM modelo com um estado qualquer (dirigido por script — Playwright) e
 * expõe o export REAL. O script fotografa o palco com o próprio Chrome na
 * resolução do PNG (deviceScaleFactor = exportW/stageW) e compara com o
 * download — qualquer coisa que o html2canvas desenhe fora do lugar aparece.
 *
 * Console/script:
 *   __fpModels                       → [{id, label, category, stageW, exportW, defaultState}]
 *   await __fpSet(id, state, status?) → monta o caso e espera fontes+imagens
 *   __fpDims()                        → {stageW, exportW, ratio}
 *   await __fpExport()                → dataURL do PNG (motor real)
 *   __fpEmojiSet('apple' | 'google')  → estilo dos emojis (iPhone / Android)
 */

import { useEffect, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import { MODELS } from '../../tools/fakepass/models';
import { uiFont, defaultStatus, renderNodeToCanvas, type FakeModel } from '../../tools/fakepass/shared';
import { setEmojiSet, type EmojiSet } from '../../tools/fakepass/emoji-style';

type Case = { id: string; s: any; status: any };

const byId = (id: string) => MODELS.find((m) => m.id === id) as FakeModel<any> | undefined;

async function settle(node: HTMLElement | null) {
  await (document as any).fonts?.ready;
  for (let round = 0; round < 6; round++) {
    await new Promise((r) => setTimeout(r, 120));
    const imgs = node ? Array.from(node.querySelectorAll('img')) : [];
    if (imgs.every((i) => i.complete)) break;
  }
  await new Promise((r) => setTimeout(r, 300));
}

export default function DevFakepassFidelity() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const [cs, setCs] = useState<Case | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const done = useRef<(() => void) | null>(null);

  useEffect(() => {
    const w = window as any;
    w.__fpModels = MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      category: m.category,
      stageW: m.stageW,
      exportW: m.exportW,
      usesPhone: m.usesPhone,
      defaultState: m.defaultState,
    }));
    w.__fpDefaultStatus = defaultStatus;
    w.__fpEmojiSet = (v: EmojiSet) => setEmojiSet(v);
    w.__fpSet = (id: string, s: any, status?: any) =>
      new Promise<void>((res) => {
        const m = byId(id);
        if (!m) throw new Error('modelo inexistente: ' + id);
        done.current = res;
        setCs({ id, s: { ...m.defaultState, ...(s || {}) }, status: { ...defaultStatus, ...(status || {}) } });
      });
    w.__fpDims = () => {
      const c = w.__fpCur as Case;
      const m = byId(c.id)!;
      const d = m.dims ? m.dims(c.s) : { stageW: m.stageW, ratio: m.ratio, exportW: m.exportW };
      return d;
    };
    w.__fpExport = async () => {
      const d = w.__fpDims();
      const canvas = await renderNodeToCanvas(ref.current!, d.exportW, d.stageW);
      return canvas.toDataURL('image/png');
    };
  }, []);

  useEffect(() => {
    if (!cs) return;
    (window as any).__fpCur = cs;
    let alive = true;
    (async () => {
      await settle(ref.current);
      if (alive) done.current?.();
    })();
    return () => {
      alive = false;
    };
  }, [cs]);

  const m = cs ? byId(cs.id) : null;
  return (
    <div style={{ padding: 0, margin: 0, background: '#7f7f7f', minHeight: '100vh' }}>
      {m && cs ? (
        // mesmo invólucro do shell (page.tsx): zoom no wrapper, line-height 0 no palco
        <div data-fp-zoom style={{ zoom: 1 }}>
          <div key={cs.id} ref={ref} data-fp-stage className={uiFont.variable} style={{ display: 'inline-block', lineHeight: 0 }}>
            {m.Preview({ s: cs.s, status: cs.status })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
