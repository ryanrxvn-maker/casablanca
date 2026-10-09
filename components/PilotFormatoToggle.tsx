'use client';

import { FORMATOS, normalizarFormato, type FormatoVideo } from '@/lib/pilot-formato';

/**
 * FORMATO DO DISPARO — a mesma escolha Portrait/Landscape do HeyGen, feita
 * aqui ANTES de disparar. 9:16 = portrait, 16:9 = landscape.
 *
 * Visual: o trilho segmentado do design system do Pilot (.pl-seg). A escolha vale pro PRÓXIMO
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
      className="pl-seg"
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
            className="pl-seg__it"
            style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5 }}
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
