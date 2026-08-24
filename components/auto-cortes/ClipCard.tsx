'use client';

/**
 * AUTO CORTES — card de um corte (o grid do Opus Clip, melhorado).
 *
 * A miniatura já vem com a headline QUEIMADA (quem desenha é o pipeline, com
 * o mesmo compositor do MP4 — WYSIWYG). O score é um ranking RELATIVO dentro
 * deste vídeo: 92 não quer dizer "vai viralizar", quer dizer "é dos melhores
 * momentos que achamos aqui".
 */

import { useEffect, useRef, useState } from 'react';
import type { AspectRatio, Clip } from '@/lib/auto-cortes/types';
import { formatBytes } from '@/lib/utils';
import { ASPECT_CSS, MiniButton, ProgressBar, fmtClock } from './ui';

/** Verde do score — vai do lima ao âmbar conforme cai. */
function scoreColor(score: number): string {
  if (score >= 85) return 'rgb(var(--lime))';
  if (score >= 70) return '#8fd67a';
  if (score >= 55) return 'rgb(var(--amber))';
  return 'rgb(var(--text-muted))';
}

const STATUS_LABEL: Record<Clip['renderStatus'], string> = {
  pendente: 'Na fila',
  cortando: 'Cortando',
  enquadrando: 'Enquadrando',
  renderizando: 'Renderizando',
  audio: 'Fechando o áudio',
  pronto: 'Pronto',
  erro: 'Falhou',
};

export type ClipCardProps = {
  clip: Clip;
  aspect: AspectRatio;
  getThumbUrl: (clipId: string) => Promise<string | null>;
  onPreview: (clip: Clip) => void;
  onEdit: (clip: Clip) => void;
  onDownload: (clip: Clip) => void;
  onCopyTexts: (clip: Clip) => void;
  onSrt: (clip: Clip) => void;
  onRerender: (clip: Clip) => void;
  busy?: boolean;
};

export function ClipCard({
  clip,
  aspect,
  getThumbUrl,
  onPreview,
  onEdit,
  onDownload,
  onCopyTexts,
  onSrt,
  onRerender,
  busy,
}: ClipCardProps) {
  const [thumb, setThumb] = useState<string | null>(null);
  const askedRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const key = `${clip.id}:${clip.thumbKey ?? ''}`;
    if (!clip.thumbKey || askedRef.current === key) return;
    askedRef.current = key;
    void (async () => {
      try {
        const u = await getThumbUrl(clip.id);
        if (alive) setThumb(u);
      } catch {
        /* miniatura é enfeite: sem ela o card mostra o placeholder */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clip.id, clip.thumbKey, getThumbUrl]);

  const title = clip.edited?.title ?? clip.plan.title;
  const headline = clip.edited?.headline ?? clip.plan.headline;
  const startMs = clip.edited?.startMs ?? clip.startMs;
  const endMs = clip.edited?.endMs ?? clip.endMs;
  const durSec = Math.max(0, (endMs - startMs) / 1000);
  const pronto = clip.renderStatus === 'pronto';
  const falhou = clip.renderStatus === 'erro';
  const rodando = !pronto && !falhou;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[16px] border border-line-strong bg-bg-soft/50 shadow-depth-1 transition-all duration-300 hover:-translate-y-[2px] hover:border-pink-400/45">
      <div
        className="relative w-full overflow-hidden bg-black/60"
        style={{ aspectRatio: ASPECT_CSS[aspect] }}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt={`Miniatura do corte ${clip.rank}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <span className="text-[12px] leading-snug text-text-dim">
              {rodando ? 'Preparando a miniatura…' : 'Sem miniatura'}
            </span>
          </div>
        )}

        {/* score grande, canto superior esquerdo */}
        <span
          className="mono absolute left-2 top-2 rounded-[10px] border px-2 py-0.5 text-[20px] font-extrabold leading-tight backdrop-blur-sm"
          style={{
            color: scoreColor(clip.plan.score),
            borderColor: scoreColor(clip.plan.score),
            background: 'rgba(0,0,0,0.55)',
          }}
          title="Ranking relativo deste corte dentro do vídeo (0–99)"
        >
          {Math.round(clip.plan.score)}
        </span>

        <span className="mono absolute bottom-2 right-2 rounded-[8px] bg-black/65 px-2 py-0.5 text-[11.5px] font-semibold text-white backdrop-blur-sm">
          {fmtClock(durSec)}
        </span>

        {rodando ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.14em] text-pink-200" style={{ fontFamily: 'var(--font-tech)' }}>
              <span>{STATUS_LABEL[clip.renderStatus]}</span>
              <span className="mono">{Math.round((clip.renderProgress || 0) * 100)}%</span>
            </div>
            <ProgressBar ratio={clip.renderProgress || 0} height={4} />
          </div>
        ) : null}

        {falhou ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-3 text-center">
            <span className="text-[12px] font-semibold leading-snug text-red-300">
              {clip.renderError || 'Esse corte não renderizou.'}
            </span>
            <MiniButton tone="danger" onClick={() => onRerender(clip)} disabled={busy}>
              Renderizar de novo
            </MiniButton>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h4 className="line-clamp-2 text-[13.5px] font-bold leading-snug text-text">{title}</h4>
        {headline ? (
          <p className="line-clamp-1 text-[11.5px] text-text-muted">Headline: {headline}</p>
        ) : null}
        {clip.plan.why ? (
          <p
            className="line-clamp-2 text-[11.5px] leading-relaxed text-text-dim"
            title={clip.plan.why}
          >
            {clip.plan.why}
          </p>
        ) : null}

        <div className="mono mt-auto flex items-center gap-2 pt-1 text-[10.5px] text-text-dim">
          <span>{fmtClock(startMs / 1000)}</span>
          <span aria-hidden>→</span>
          <span>{fmtClock(endMs / 1000)}</span>
          {clip.outputBytes ? <span className="ml-auto">{formatBytes(clip.outputBytes)}</span> : null}
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          <MiniButton tone="pink" onClick={() => onPreview(clip)} disabled={!pronto || busy} title="Pré-visualizar">
            ▶ Ver
          </MiniButton>
          <MiniButton onClick={() => onEdit(clip)} disabled={busy} title="Ajustar bordas, título e headline">
            ✎ Ajustar
          </MiniButton>
          <MiniButton tone="lime" onClick={() => onDownload(clip)} disabled={!pronto || busy} title="Baixar o MP4">
            ⬇ Baixar
          </MiniButton>
          <MiniButton onClick={() => onCopyTexts(clip)} title="Copiar título, descrição e hashtags">
            ⧉ Textos
          </MiniButton>
          <MiniButton onClick={() => onSrt(clip)} title="Baixar a legenda em .srt">
            SRT
          </MiniButton>
        </div>
      </div>
    </article>
  );
}
