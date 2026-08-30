'use client';

/**
 * PREVIEW DEV-ONLY do ROTEIRO DE LEGENDA (30.08) — o botao de relevo, a
 * janelinha de hook x body e o chip de Templates ao lado dos favoritos.
 *
 * Existe pra ENXERGAR o design e conferir o comportamento sem precisar subir
 * video nem gastar transcricao: os blocos aqui sao de mentira, com o mesmo
 * formato que a Tipografia produz. Nao e linkada de lugar nenhum e fora do
 * dev responde 404.
 */

import { notFound } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CaptionScriptModal } from '@/components/typography/CaptionScriptModal';
import { PresetGallery } from '@/components/typography/PresetGallery';
import { blockText, groupWords } from '@/lib/typography/group';
import {
  regroupKeepingLocks,
  splitKeepingIdentity,
  type BlockIdentity,
} from '@/lib/typography/blocks-edit';
import { defaultSegments, type CaptionSegment } from '@/lib/typography/caption-script';
import type { Block, TWord } from '@/lib/typography/engine';

const COPY =
  'Para prostata inchada nao existe nada melhor do que isso aqui. ' +
  'A maioria das pessoas usa o azeite do jeito completamente errado e joga dinheiro fora todo mes.';

const WORDS: TWord[] = COPY.split(/\s+/).map((t, i) => ({
  text: t,
  start: i * 340,
  end: i * 340 + 310,
}));

export default function LegendaRoteiroPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Inner />;
}

function Inner() {
  const [blocks, setBlocks] = useState<Block[]>(() => groupWords(WORDS, 'equilibrado'));
  const [ident, setIdent] = useState<BlockIdentity>({
    locked: [],
    blockStyles: {},
    wordStyles: {},
    highlights: {},
  });
  const [segments, setSegments] = useState<CaptionSegment[]>(() => defaultSegments());
  const [open, setOpen] = useState(false);
  const [onTpls, setOnTpls] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const lockedSet = useMemo(() => new Set(ident.locked), [ident.locked]);

  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 8));

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 py-8">
      <h1 className="mb-1 text-[22px] font-bold tracking-tight text-text">
        Roteiro de legenda (preview dev)
      </h1>
      <p className="mb-6 text-[13px] text-text-muted">
        Trava alguns blocos, troca o ritmo e confere que eles nao se mexem.
        Depois abre a janelinha e aplica hook e body com letterings diferentes.
      </p>

      <div className="mb-6 rounded-[16px] border border-line bg-bg-soft/40 p-4">
        <PresetGallery
          presetId={'titulo-viral'}
          onPick={() => undefined}
          favs={favs}
          onToggleFav={(id) =>
            setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
          }
          compact
          presets={[]}
          extra={
            <button
              type="button"
              onClick={() => {
                setOnTpls(true);
                setOpen(true);
              }}
              className="roteiro-chip"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3.4" y="5" width="12.5" height="3.6" rx="1.8" fill="currentColor" />
                <rect x="3.4" y="10.7" width="17.2" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
                <rect x="3.4" y="15.6" width="13.4" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
                <circle cx="19.6" cy="6.8" r="2" fill="currentColor" opacity="0.85" />
              </svg>
              Templates
            </button>
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['palavra', 'rapido', 'equilibrado', 'frases'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              const r = regroupKeepingLocks(WORDS, p, blocks, ident);
              setBlocks(r.blocks);
              setIdent({
                locked: r.locked,
                blockStyles: r.blockStyles,
                wordStyles: r.wordStyles,
                highlights: r.highlights,
              });
              say(`ritmo ${p}: ${r.remade} remontados, ${r.kept} travados intactos`);
            }}
            className="rounded-[10px] border border-line bg-bg-soft px-3 py-1.5 text-[12px] text-text"
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const alvo = blocks.find((b) => b.words.length > 1);
            if (!alvo) return;
            const r = splitKeepingIdentity(blocks, alvo.id, ident);
            if (!r) return;
            setBlocks(r.blocks);
            setIdent({
              locked: r.locked,
              blockStyles: r.blockStyles,
              wordStyles: r.wordStyles,
              highlights: r.highlights,
            });
            say('dividiu o 1o bloco divisivel');
          }}
          className="rounded-[10px] border border-line bg-bg-soft px-3 py-1.5 text-[12px] text-text"
        >
          dividir
        </button>
      </div>

      <div className="mb-4 overflow-hidden rounded-[14px] border border-line">
        {blocks.map((b, i) => {
          const trancado = lockedSet.has(b.id);
          const st = ident.blockStyles[b.id];
          return (
            <div
              key={b.id}
              className={
                'flex items-center gap-3 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0 ' +
                (trancado ? 'bg-violet-500/[0.06]' : '')
              }
            >
              <span className="mono w-8 shrink-0 text-text-muted">{i + 1}</span>
              <button
                type="button"
                onClick={() =>
                  setIdent((p) => ({
                    ...p,
                    locked: p.locked.includes(b.id)
                      ? p.locked.filter((x) => x !== b.id)
                      : [...p.locked, b.id],
                  }))
                }
                className={
                  'shrink-0 rounded-[8px] border px-2 py-1 text-[11px] ' +
                  (trancado
                    ? 'border-violet-400/70 bg-violet-500/20 text-violet-300'
                    : 'border-line text-text-muted')
                }
              >
                {trancado ? 'travado' : 'livre'}
              </button>
              <span className="min-w-0 flex-1 truncate text-text">{blockText(b)}</span>
              <span className="mono shrink-0 text-[11px] text-text-muted">
                {st?.presetId ?? '—'} · {st?.posY != null ? `${Math.round(st.posY * 100)}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-[12px] border border-line bg-black/20 p-3 text-[12px] text-text-muted">
        {log.length === 0 ? 'sem acoes ainda' : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>

      <CaptionScriptModal
        open={open}
        onClose={() => setOpen(false)}
        blocks={blocks}
        ident={ident}
        fallbackPresetId="titulo-viral"
        segments={segments}
        onSegments={setSegments}
        favs={favs}
        onToggleFav={(id) =>
          setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
        }
        startOnTemplates={onTpls}
        onApply={(r) => {
          setBlocks(r.blocks);
          setIdent({
            locked: r.locked,
            blockStyles: r.blockStyles,
            wordStyles: r.wordStyles,
            highlights: r.highlights,
          });
          say(`aplicou o roteiro: ${r.styled} blocos, ${r.splits} partidos`);
        }}
      />
    </div>
  );
}
