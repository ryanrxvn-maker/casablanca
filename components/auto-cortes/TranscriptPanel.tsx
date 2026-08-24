'use client';

/**
 * AUTO CORTES — a transcrição inteira, do lado.
 *
 * Serve pra duas coisas: conferir se o ASR entendeu o vídeo e achar um
 * momento que a IA não escolheu. As frases que caíram dentro de algum corte
 * ficam marcadas — bate o olho e vê o que o lote cobriu.
 */

import { useMemo, useState } from 'react';
import type { Clip, Sentence, Transcript } from '@/lib/auto-cortes/types';
import { fmtClock } from './ui';

const PAGE = 120;

export function TranscriptPanel({
  transcript,
  clips,
  onPick,
}: {
  transcript: Transcript | null;
  clips: Clip[];
  /** clique numa frase — a página decide o que fazer (abrir o corte dela) */
  onPick?: (sentence: Sentence, clip: Clip | null) => void;
}) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(false);

  const rangos = useMemo(
    () =>
      clips.map((c) => ({
        clip: c,
        startMs: c.edited?.startMs ?? c.startMs,
        endMs: c.edited?.endMs ?? c.endMs,
      })),
    [clips],
  );

  const sentences = transcript?.sentences ?? [];
  const filtradas = useMemo(() => {
    const termo = q.trim().toLowerCase();
    if (!termo) return sentences;
    return sentences.filter((s) => s.text.toLowerCase().includes(termo));
  }, [q, sentences]);

  if (!transcript || sentences.length === 0) return null;

  const clipDe = (s: Sentence): Clip | null => {
    const hit = rangos.find((r) => s.endMs > r.startMs && s.startMs < r.endMs);
    return hit ? hit.clip : null;
  };

  return (
    <section className="rounded-[16px] border border-line bg-bg-soft/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span
            className="block text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Transcrição
          </span>
          <span className="mt-0.5 block text-[13px] font-semibold text-text">
            {sentences.length} frases · {transcript.language.toUpperCase()}
          </span>
        </span>
        <span className="shrink-0 text-[11.5px] font-bold text-violet">
          {open ? 'Fechar ▴' : 'Abrir ▾'}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line p-3.5">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Buscar na transcrição…"
            className="mb-3 w-full rounded-[11px] border border-line bg-bg px-3 py-2 text-[12.5px] text-text outline-none placeholder:text-text-dim focus:border-pink-400/60"
          />
          {filtradas.length === 0 ? (
            <p className="px-1 py-4 text-[12.5px] text-text-muted">
              Nenhuma frase com esse texto.
            </p>
          ) : null}
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {filtradas.slice(0, limit).map((s) => {
              const c = clipDe(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick?.(s, c)}
                  className={
                    'flex w-full gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors ' +
                    (c
                      ? 'border-pink-400/40 bg-pink-400/[0.07] hover:border-pink-400/70'
                      : 'border-transparent hover:border-line-strong hover:bg-black/10')
                  }
                >
                  <span className="mono shrink-0 pt-[1px] text-[10.5px] text-text-dim">
                    {fmtClock(s.startMs / 1000)}
                  </span>
                  <span
                    className={
                      'text-[12.5px] leading-relaxed ' + (c ? 'text-text' : 'text-text-muted')
                    }
                  >
                    {s.text}
                  </span>
                </button>
              );
            })}
          </div>
          {filtradas.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE)}
              className="mt-2 w-full rounded-[10px] border border-line py-2 text-[12px] font-bold text-text-muted hover:border-violet/45 hover:text-text"
            >
              Mostrar mais ({filtradas.length - limit} restantes)
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
