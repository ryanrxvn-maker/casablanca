'use client';

/**
 * PREVIEW DEV-ONLY: emoji no meio de texto MULTI-LINHA no export do FakePass.
 * Reproduz a reclamação de cliente (06.10): no PNG o emoji subia pra cima da
 * linha de cima ("papinho de coach 😅", "ler 🙏", "revender 😭🙏"). Monta os
 * casos com o pipeline REAL de export e mostra prévia × PNG lado a lado.
 * Uso (console): await window.__fpEmojiRun(i) → dataURL do PNG do caso i.
 */

import { useEffect, useRef } from 'react';
import { notFound } from 'next/navigation';
import { MODELS } from '../../tools/fakepass/models';
import { uiFont, defaultStatus, renderNodeToCanvas, type FakeModel } from '../../tools/fakepass/shared';
import { newMsg } from '../../tools/fakepass/builder';

const byId = (id: string) => MODELS.find((m) => m.id === id) as FakeModel<any>;

const dmConversa = [
  newMsg({ kind: 'text', me: false, text: 'Nu' }),
  newMsg({ kind: 'text', me: false, text: 'confesso q pensava q isso tudo fosse papinho de coach 😅' }),
  newMsg({ kind: 'text', me: false, text: 'pra ser sincera nunca tinha sobrado dinheiro p mim no final do mês' }),
  newMsg({ kind: 'text', me: false, text: 'essa foi a primeira vez' }),
  newMsg({ kind: 'text', me: false, text: 'Gratidão Roberta ❤️' }),
  newMsg({ kind: 'text', me: true, text: 'Oii Ana Clara!' }),
  newMsg({ kind: 'text', me: true, text: 'É uma alegria enorme ler mensagens como essa 🙏' }),
  newMsg({ kind: 'text', me: true, text: 'Fico muito feliz em poder ajudar, pode contar comigo!' }),
];

const CASES: Array<{ id: string; patch: Record<string, any> }> = [
  { id: 'ig-question', patch: { header: 'MENTORIA GRÁTIS', pergunta: 'uma renda extra que não seja uber, revender ou virar influencer😭🙏' } },
  { id: 'ig-dm', patch: { dark: true, conversa: dmConversa, visto: false } },
  { id: 'ig-dm', patch: { dark: false, conversa: dmConversa, visto: false } },
  { id: 'whatsapp', patch: { conversa: dmConversa } },
];

function Stage({ i }: { i: number }) {
  const c = CASES[i];
  const model = byId(c.id);
  const ref = useRef<HTMLDivElement | null>(null);
  const s = { ...model.defaultState, ...c.patch };
  useEffect(() => {
    const w = window as any;
    w.__fpEmojiNodes = w.__fpEmojiNodes || {};
    w.__fpEmojiNodes[i] = { node: ref.current, model, s };
  });
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
      <div data-fp-zoom style={{ zoom: 1 }}>
        <div ref={ref} className={uiFont.variable} style={{ display: 'inline-block', lineHeight: 0 }}>
          {model.Preview({ s, status: defaultStatus })}
        </div>
      </div>
      <img data-out={i} alt="" style={{ width: model.stageW, outline: '1px solid #f0f' }} />
    </div>
  );
}

export default function DevFakepassEmoji() {
  if (process.env.NODE_ENV !== 'development') notFound();
  useEffect(() => {
    (window as any).__fpEmojiRun = async (i: number) => {
      await (document as any).fonts?.ready;
      const { node, model, s } = (window as any).__fpEmojiNodes[i];
      const dims = model.dims ? model.dims(s) : { stageW: model.stageW, exportW: model.exportW };
      const canvas = await renderNodeToCanvas(node, dims.exportW, dims.stageW);
      const url = canvas.toDataURL('image/png');
      const img = document.querySelector<HTMLImageElement>(`img[data-out="${i}"]`);
      if (img) img.src = url;
      return url;
    };
  }, []);
  return (
    <div style={{ padding: 24, background: '#17131f', minHeight: '100vh' }}>
      {CASES.map((_, i) => <Stage key={i} i={i} />)}
    </div>
  );
}
