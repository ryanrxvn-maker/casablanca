'use client';

/**
 * FakePass — kit dos stickers de STORY.
 *
 * Helpers compartilhados por todos os stickers que vivem sobre um fundo de
 * story (caixinha de pergunta, enquete, quiz, slider, contagem, localização…):
 * as dimensões do palco, a paleta de fundos, o palco em si e o bloco de
 * controle de fundo. Modelos de chat/post/notif NÃO usam isto (têm palco
 * próprio com barra de status) — importam direto de ./shared.
 */

import type { ReactNode } from 'react';
import { Field, Swatches } from './shared';

export const STORY_W = 340;
export const STORY_RATIO = 16 / 9;

export const STORY_BGS: { id: string; label: string; css: string; solid?: string }[] = [
  { id: 'azul', label: 'Azul', css: '#4aa0e6', solid: '#4aa0e6' },
  { id: 'insta', label: 'Instagram', css: 'linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)' },
  { id: 'sol', label: 'Pôr do sol', css: 'linear-gradient(160deg,#f6d365 0%,#fda085 100%)' },
  { id: 'roxo', label: 'Roxo', css: '#7b4de0', solid: '#7b4de0' },
  { id: 'verde', label: 'Verde', css: '#22b573', solid: '#22b573' },
  { id: 'preto', label: 'Preto', css: '#101010', solid: '#101010' },
  { id: 'grafite', label: 'Grafite', css: 'linear-gradient(160deg,#3a3a3f 0%,#141416 100%)' },
];

/** Palco de Story: fundo (cor/gradiente) com o sticker centralizado. */
export function StoryStage({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: STORY_W,
        height: Math.round(STORY_W * STORY_RATIO),
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

/** Bloco de controle de fundo (swatches + cor livre) reusado pelos stickers. */
export function BgControls({ bg, set }: { bg: string; set: (p: any) => void }) {
  const isGrad = bg.startsWith('linear-gradient');
  const solid = STORY_BGS.find((f) => f.css === bg)?.solid ?? (bg.startsWith('#') ? bg : '#4aa0e6');
  return (
    <Field label="Fundo">
      <div className="flex flex-wrap items-center gap-2.5">
        <Swatches value={bg} colors={STORY_BGS.map((f) => f.css)} onChange={(v) => set({ bg: v })} />
        <label
          className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white/25 transition hover:border-white/60"
          title="Cor personalizada"
          style={{ background: isGrad ? 'conic-gradient(from 0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : solid }}
        >
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={solid} onChange={(e) => set({ bg: e.target.value })} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="relative">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
          </svg>
        </label>
      </div>
    </Field>
  );
}
