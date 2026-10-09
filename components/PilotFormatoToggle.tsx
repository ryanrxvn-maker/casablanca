'use client';

import { FORMATOS, normalizarFormato, type FormatoVideo } from '@/lib/pilot-formato';

/**
 * FORMATO DO DISPARO — a mesma escolha Portrait/Landscape do HeyGen, feita
 * aqui ANTES de disparar. 9:16 = portrait, 16:9 = landscape.
 *
 * Mesmo desenho do botão de motor (pílula 3D, h-9). A escolha vale pro PRÓXIMO
 * disparo desta task: um disparo em andamento já carimbou o formato dele e não
 * muda no meio — retomar/regerar take sempre seguem o formato do disparo.
 */
export function PilotFormatoToggle({
  formato,
  onChange,
}: {
  formato: FormatoVideo;
  onChange: (f: FormatoVideo) => void;
}) {
  const atual = normalizarFormato(formato);
  return (
    <div
      role="radiogroup"
      aria-label="Formato do vídeo no HeyGen"
      className="inline-flex h-9 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      title="Formato do vídeo gerado no HeyGen (vale pro próximo disparo)"
    >
      {FORMATOS.map((f) => {
        const ativo = atual === f;
        const vertical = f === '9:16';
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => { if (!ativo) onChange(f); }}
            title={vertical ? 'Portrait — vertical 9:16 (1080x1920)' : 'Landscape — horizontal 16:9 (1920x1080)'}
            className={
              'label-tech inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[10px] font-bold uppercase tracking-[0.14em] transition-all ' +
              (ativo
                ? 'bg-gradient-to-b from-cyan-400/30 to-cyan-400/10 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-2px_rgba(34,211,238,0.4)]'
                : 'text-text-muted hover:text-white')
            }
          >
            <svg
              width={vertical ? 9 : 14}
              height={vertical ? 14 : 9}
              viewBox={vertical ? '0 0 9 14' : '0 0 14 9'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden
            >
              <rect x="0.8" y="0.8" width={vertical ? 7.4 : 12.4} height={vertical ? 12.4 : 7.4} rx="1.4" />
            </svg>
            {f}
          </button>
        );
      })}
    </div>
  );
}
