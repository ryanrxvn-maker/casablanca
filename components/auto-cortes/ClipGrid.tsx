'use client';

/**
 * AUTO CORTES — a grade de cortes.
 *
 * Aparece assim que a análise termina, ANTES de renderizar: cada card já
 * mostra score, título e headline enquanto o vídeo ainda está sendo montado.
 * Ver o resultado cedo é o que faz a espera parecer curta.
 */

import type { AspectRatio, Clip } from '@/lib/auto-cortes/types';
import { ClipCard } from './ClipCard';

export function ClipGrid({
  clips,
  aspect,
  getThumbUrl,
  onPreview,
  onEdit,
  onDownload,
  onCopyTexts,
  onSrt,
  onRerender,
  busy,
}: {
  clips: Clip[];
  aspect: AspectRatio;
  getThumbUrl: (clipId: string) => Promise<string | null>;
  onPreview: (clip: Clip) => void;
  onEdit: (clip: Clip) => void;
  onDownload: (clip: Clip) => void;
  onCopyTexts: (clip: Clip) => void;
  onSrt: (clip: Clip) => void;
  onRerender: (clip: Clip) => void;
  busy?: boolean;
}) {
  if (clips.length === 0) return null;
  const prontos = clips.filter((c) => c.renderStatus === 'pronto').length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="text-[15px] font-bold tracking-tight text-text"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {clips.length} {clips.length === 1 ? 'corte' : 'cortes'}
        </h3>
        <span className="mono text-[11.5px] text-text-muted">
          {prontos} de {clips.length} prontos
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            aspect={aspect}
            getThumbUrl={getThumbUrl}
            onPreview={onPreview}
            onEdit={onEdit}
            onDownload={onDownload}
            onCopyTexts={onCopyTexts}
            onSrt={onSrt}
            onRerender={onRerender}
            busy={busy}
          />
        ))}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-text-dim">
        O número no canto de cada corte é um ranking <strong>relativo</strong> deste vídeo — serve
        pra ordenar o que sai primeiro, não pra prever audiência.
      </p>
    </section>
  );
}
