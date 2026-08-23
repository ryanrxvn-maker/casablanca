'use client';

/**
 * AUTO CORTES — ajustar UM corte.
 *
 * Título e headline são texto livre; as bordas andam de meio em meio segundo
 * ou de frase em frase. O que aparece embaixo de cada borda é a frase real da
 * transcrição naquele ponto — é assim que dá pra ver se o corte está entrando
 * no meio de uma palavra sem precisar assistir.
 *
 * "Salvar" grava a edição (ela sobrevive a re-render); "Renderizar de novo"
 * refaz só este corte com o que está na tela.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Clip, Ms, Sentence } from '@/lib/auto-cortes/types';
import { MiniButton, fmtClock } from './ui';

const STEP_MS = 500;
const MIN_DUR_MS = 3000;

/** Frases que aparecem dentro do intervalo (a que começa antes e termina dentro conta). */
function sentencesIn(sentences: Sentence[], startMs: Ms, endMs: Ms): Sentence[] {
  return sentences.filter((s) => s.endMs > startMs && s.startMs < endMs);
}

/** Início da frase anterior ao ponto (pra "abrir" o corte 1 frase). */
function prevBoundary(sentences: Sentence[], t: Ms): Ms | null {
  let best: Ms | null = null;
  for (const s of sentences) {
    if (s.startMs < t - 50 && (best == null || s.startMs > best)) best = s.startMs;
  }
  return best;
}

/** Início da próxima frase (pra "fechar" o corte 1 frase). */
function nextBoundary(sentences: Sentence[], t: Ms): Ms | null {
  let best: Ms | null = null;
  for (const s of sentences) {
    if (s.startMs > t + 50 && (best == null || s.startMs < best)) best = s.startMs;
  }
  return best;
}

/** Fim da frase anterior / próxima (bordas do fim do corte). */
function prevEnd(sentences: Sentence[], t: Ms): Ms | null {
  let best: Ms | null = null;
  for (const s of sentences) {
    if (s.endMs < t - 50 && (best == null || s.endMs > best)) best = s.endMs;
  }
  return best;
}

function nextEnd(sentences: Sentence[], t: Ms): Ms | null {
  let best: Ms | null = null;
  for (const s of sentences) {
    if (s.endMs > t + 50 && (best == null || s.endMs < best)) best = s.endMs;
  }
  return best;
}

export function ClipEditor({
  clip,
  sentences,
  durationSec,
  onSave,
  onRerender,
  onClose,
  busy,
}: {
  clip: Clip | null;
  sentences: Sentence[];
  /** duração da fonte, pra não deixar a borda passar do fim */
  durationSec: number | null;
  onSave: (clipId: string, patch: NonNullable<Clip['edited']>) => void;
  onRerender: (clipId: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(0);

  const clipId = clip?.id ?? null;

  useEffect(() => {
    if (!clip) return;
    setTitle(clip.edited?.title ?? clip.plan.title);
    setHeadline(clip.edited?.headline ?? clip.plan.headline);
    setStartMs(clip.edited?.startMs ?? clip.startMs);
    setEndMs(clip.edited?.endMs ?? clip.endMs);
  }, [clip]);

  useEffect(() => {
    if (!clipId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipId, onClose]);

  const maxMs = durationSec != null ? Math.round(durationSec * 1000) : Number.MAX_SAFE_INTEGER;

  const dentro = useMemo(() => sentencesIn(sentences, startMs, endMs), [sentences, startMs, endMs]);
  const primeira = dentro[0] ?? null;
  const ultima = dentro.length > 0 ? dentro[dentro.length - 1] : null;

  if (!clip || !mounted) return null;

  const setStart = (v: number) => setStartMs(Math.max(0, Math.min(v, endMs - MIN_DUR_MS)));
  const setEnd = (v: number) => setEndMs(Math.min(maxMs, Math.max(v, startMs + MIN_DUR_MS)));

  const dirty =
    title !== (clip.edited?.title ?? clip.plan.title) ||
    headline !== (clip.edited?.headline ?? clip.plan.headline) ||
    startMs !== (clip.edited?.startMs ?? clip.startMs) ||
    endMs !== (clip.edited?.endMs ?? clip.endMs);

  const patch = () => ({ title, headline, startMs, endMs });

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Ajustar o corte"
      onClick={onClose}
    >
      <div
        className="dark-island my-6 w-full max-w-[560px] rounded-[18px] border border-line-strong bg-bg-elev p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h4
            className="text-[15px] font-bold text-text"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Ajustar corte {clip.rank}
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[13px] font-bold text-text-muted hover:border-red-500/50 hover:text-red-300"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Título do post
            </label>
            <input
              value={title}
              maxLength={90}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-[11px] border border-line bg-bg-soft px-3 py-2.5 text-[13px] text-text outline-none focus:border-pink-400/60"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Headline no vídeo
            </label>
            <input
              value={headline}
              maxLength={80}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Deixe vazio pra ficar sem headline"
              className="w-full rounded-[11px] border border-line bg-bg-soft px-3 py-2.5 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-pink-400/60"
            />
            <p className="mt-1 text-[11px] text-text-dim">
              Até 8 palavras cabem bem em 2 linhas. Mudou aqui? Renderize de novo pra queimar no
              vídeo.
            </p>
          </div>

          <div className="rounded-[13px] border border-line bg-bg-soft/50 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span
                className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Bordas
              </span>
              <span className="mono text-[11.5px] text-text-muted">
                {fmtClock(startMs / 1000)} → {fmtClock(endMs / 1000)} ·{' '}
                {fmtClock((endMs - startMs) / 1000)}
              </span>
            </div>

            <BorderRow
              label="Início"
              onMinusHalf={() => setStart(startMs - STEP_MS)}
              onPlusHalf={() => setStart(startMs + STEP_MS)}
              onMinusSentence={() => {
                const b = prevBoundary(sentences, startMs);
                if (b != null) setStart(b);
              }}
              onPlusSentence={() => {
                const b = nextBoundary(sentences, startMs);
                if (b != null) setStart(b);
              }}
              disabled={busy}
              text={primeira ? primeira.text : '—'}
            />

            <div className="my-2 h-px bg-line" aria-hidden />

            <BorderRow
              label="Fim"
              onMinusHalf={() => setEnd(endMs - STEP_MS)}
              onPlusHalf={() => setEnd(endMs + STEP_MS)}
              onMinusSentence={() => {
                const b = prevEnd(sentences, endMs);
                if (b != null) setEnd(b);
              }}
              onPlusSentence={() => {
                const b = nextEnd(sentences, endMs);
                if (b != null) setEnd(b);
              }}
              disabled={busy}
              text={ultima ? ultima.text : '—'}
            />

            <p className="mt-2.5 text-[11px] leading-relaxed text-text-dim">
              {dentro.length} {dentro.length === 1 ? 'frase' : 'frases'} dentro do corte.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => {
              onSave(clip.id, patch());
              onClose();
            }}
            className="btn-primary !py-2.5 text-[13px] disabled:opacity-40"
          >
            Salvar
          </button>
          <MiniButton
            tone="pink"
            disabled={busy}
            onClick={() => {
              if (dirty) onSave(clip.id, patch());
              onRerender(clip.id);
              onClose();
            }}
          >
            Renderizar de novo
          </MiniButton>
          <MiniButton onClick={onClose}>Cancelar</MiniButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BorderRow({
  label,
  text,
  onMinusHalf,
  onPlusHalf,
  onMinusSentence,
  onPlusSentence,
  disabled,
}: {
  label: string;
  text: string;
  onMinusHalf: () => void;
  onPlusHalf: () => void;
  onMinusSentence: () => void;
  onPlusSentence: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="w-[54px] shrink-0 text-[11.5px] font-bold text-text"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {label}
        </span>
        <MiniButton onClick={onMinusSentence} disabled={disabled} title="Uma frase pra trás">
          − 1 frase
        </MiniButton>
        <MiniButton onClick={onMinusHalf} disabled={disabled} title="Meio segundo pra trás">
          − 0,5 s
        </MiniButton>
        <MiniButton onClick={onPlusHalf} disabled={disabled} title="Meio segundo pra frente">
          + 0,5 s
        </MiniButton>
        <MiniButton onClick={onPlusSentence} disabled={disabled} title="Uma frase pra frente">
          + 1 frase
        </MiniButton>
      </div>
      <p className="mt-1.5 line-clamp-2 pl-[54px] text-[11.5px] italic leading-relaxed text-text-muted">
        “{text}”
      </p>
    </div>
  );
}
