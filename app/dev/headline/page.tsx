'use client';

/**
 * PREVIEW DEV-ONLY das HEADLINES (01.09) — desenha os modelos em cima de uma
 * foto de mentira, no tamanho de um reel, pra comparar com a referencia que o
 * Silas mandou sem precisar subir video nem logar.
 *
 * Nao e linkada de lugar nenhum e fora do dev responde 404.
 */

import { notFound } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import {
  drawHeadline,
  HEADLINE_PRESETS,
  HEADLINE_STYLE_DEFAULT,
  type Headline,
} from '@/lib/typography/headline';

const TEXTO = 'A GERAÇÃO DE MULHERES COM LIPEDEMA QUE FAZ DIETA JÁ ESTÁ ENTRE NÓS!';

function Card({ presetId, texto }: { presetId: string; texto: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ presetId, texto });
  live.current = { presetId, texto };

  useEffect(() => {
    void ensureTypoFonts();
    const tick = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const W = c.width;
      const H = c.height;
      // "foto" de mentira: praia clara em cima, area escura embaixo
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#9fb7c9');
      g.addColorStop(0.42, '#cbb79a');
      g.addColorStop(1, '#4a3f36');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const h: Headline = {
        id: 'demo',
        text: live.current.texto,
        start: 0,
        end: 9000,
        style: { ...HEADLINE_STYLE_DEFAULT, presetId: live.current.presetId },
      };
      try {
        drawHeadline(ctx, h, W, H);
      } catch (e) {
        console.error('[headline-dev]', e);
      }
    };
    return registerCanvasJob(tick, { fps: 8, el: ref.current });
  }, []);

  return (
    <div>
      <canvas
        ref={ref}
        width={405}
        height={720}
        className="block w-full rounded-[12px]"
        style={{ aspectRatio: '405 / 720' }}
      />
      <div className="mt-1 text-center text-[11px] text-text-muted">{presetId}</div>
    </div>
  );
}

export default function HeadlineDev() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Inner />;
}

function Inner() {
  const [texto, setTexto] = useState(TEXTO);
  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <h1 className="mb-2 text-[22px] font-bold text-text">Headlines (preview dev)</h1>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        className="mb-5 w-full rounded-[10px] border border-line bg-black/20 px-3 py-2 text-[13px] text-text"
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        {HEADLINE_PRESETS.map((p) => (
          <Card key={p.id} presetId={p.id} texto={texto} />
        ))}
      </div>
    </div>
  );
}
