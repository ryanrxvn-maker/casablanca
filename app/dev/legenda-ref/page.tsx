'use client';

/**
 * PREVIEW DEV-ONLY (01.09) pra conferir um modelo de legenda contra a
 * referencia: desenha a MESMA frase em varios instantes da entrada, lado a
 * lado, pra dar pra ver a animacao quadro a quadro sem gravar video.
 *
 * Nao e linkada de lugar nenhum e fora do dev responde 404.
 */

import { notFound } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import { drawCaptions, type Block, type StyleState } from '@/lib/typography/engine';
import { getPreset } from '@/lib/typography/presets';

const FRASE = 'mas aí eu quero que tu me dê tua opinião, tá?';
/** palavras pintadas de destaque (indices) — como na referencia */
const DESTAQUES = [7, 8, 9];

function bloco(texto: string): Block {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const per = 260;
  return {
    id: 'ref',
    words: palavras.map((w, i) => ({ text: w, start: i * per, end: i * per + per })),
    start: 0,
    end: palavras.length * per + 4000,
  };
}

function Quadro({
  presetId,
  tMs,
  rodando,
  label,
}: {
  presetId: string;
  tMs: number;
  rodando: boolean;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ presetId, tMs, rodando });
  live.current = { presetId, tMs, rodando };

  useEffect(() => {
    void ensureTypoFonts();
    const t0 = performance.now();
    const tick = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const W = c.width;
      const H = c.height;
      // fundo marrom-quente, como no video da referencia
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#6b4a33');
      g.addColorStop(0.5, '#8a6242');
      g.addColorStop(1, '#4e3524');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const s = live.current;
      const b = bloco(FRASE);
      const st: StyleState = {
        presetId: s.presetId,
        fontScale: 1,
        posY: 0.5,
        posX: 0.5,
        primary: null,
        accent: null,
        uppercase: null,
        highlights: { ref: DESTAQUES },
        autoEmphasis: false,
      };
      const t = s.rodando ? (performance.now() - t0) % (b.end - 3200) : s.tMs;
      try {
        drawCaptions(ctx, [b], getPreset(s.presetId), st, t, W, H);
      } catch (e) {
        console.error('[legenda-ref]', e);
      }
    };
    return registerCanvasJob(tick, { fps: rodando ? 30 : 6, el: ref.current });
  }, [rodando]);

  return (
    <div>
      <canvas
        ref={ref}
        width={520}
        height={150}
        className="block w-full rounded-[8px]"
        style={{ aspectRatio: '520 / 150' }}
      />
      <div className="mono mt-1 text-center text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

export default function LegendaRefDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Inner />;
}

function Inner() {
  const [id, setId] = useState('papo-amarelo');
  const instantes = [180, 400, 620, 840, 1100, 1400, 1800, 2600];
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8">
      <h1 className="mb-1 text-[22px] font-bold text-text">Legenda x referência</h1>
      <p className="mb-4 text-[12px] text-text-muted">
        A mesma frase em instantes diferentes da entrada — dá pra ver a animação
        quadro a quadro. O primeiro quadro roda em loop.
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {['papo-amarelo', 'letterings-amarelo', 'faz-assim', 'comenta-pack'].map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setId(x)}
            className={'fx-chip' + (id === x ? ' is-on' : '')}
          >
            {getPreset(x).name}
          </button>
        ))}
      </div>
      <div className="mb-5">
        <Quadro presetId={id} tMs={0} rodando label="rodando em loop" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {instantes.map((t) => (
          <Quadro key={t} presetId={id} tMs={t} rodando={false} label={`${t} ms`} />
        ))}
      </div>
    </div>
  );
}
