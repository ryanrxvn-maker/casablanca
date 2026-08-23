'use client';

/**
 * AUTO CORTES — pré-visualização do corte pronto.
 *
 * Modal com o MP4 FINAL (o mesmo arquivo que vai ser baixado — nada de
 * simulação). A object URL nasce ao abrir e é revogada ao fechar: sem isso
 * cada abertura segura o blob inteiro na memória até o F5.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AspectRatio, Clip } from '@/lib/auto-cortes/types';
import { toFriendlyMessage } from '@/lib/friendly-error';
import { ASPECT_CSS, ErrorNote, MiniButton, fmtClock } from './ui';

export function ClipPreview({
  clip,
  aspect,
  getClipBlob,
  onClose,
  onDownload,
}: {
  clip: Clip | null;
  aspect: AspectRatio;
  getClipBlob: (clipId: string) => Promise<Blob | null>;
  onClose: () => void;
  onDownload: (clip: Clip) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const clipId = clip?.id ?? null;

  useEffect(() => {
    if (!clipId) return;
    let alive = true;
    let created: string | null = null;
    setError(null);
    setUrl(null);
    void (async () => {
      try {
        const blob = await getClipBlob(clipId);
        if (!alive) return;
        if (!blob) {
          setError('Esse corte ainda não tem vídeo salvo. Renderize de novo pra assistir.');
          return;
        }
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch (e) {
        if (alive) setError(toFriendlyMessage(e, 'Não deu pra abrir esse corte.'));
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [clipId, getClipBlob]);

  useEffect(() => {
    if (!clipId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipId, onClose]);

  if (!clip || !mounted) return null;

  const title = clip.edited?.title ?? clip.plan.title;
  const startMs = clip.edited?.startMs ?? clip.startMs;
  const endMs = clip.edited?.endMs ?? clip.endMs;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Pré-visualização: ${title}`}
      onClick={onClose}
    >
      <div
        className="dark-island max-h-full w-full max-w-[420px] overflow-y-auto rounded-[18px] border border-line-strong bg-bg-elev p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="line-clamp-2 text-[14px] font-bold leading-snug text-text">{title}</h4>
            <span className="mono text-[11px] text-text-muted">
              {fmtClock(startMs / 1000)} → {fmtClock(endMs / 1000)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[13px] font-bold text-text-muted hover:border-red-500/50 hover:text-red-300"
          >
            ✕
          </button>
        </div>

        <div
          className="w-full overflow-hidden rounded-[12px] bg-black"
          style={{ aspectRatio: ASPECT_CSS[aspect] }}
        >
          {url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={url} controls autoPlay playsInline className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[12.5px] text-text-dim">
              {error ? 'Não carregou' : 'Abrindo o vídeo…'}
            </div>
          )}
        </div>

        {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <MiniButton tone="lime" onClick={() => onDownload(clip)} disabled={!url}>
            ⬇ Baixar este corte
          </MiniButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
