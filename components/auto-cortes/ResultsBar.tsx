'use client';

/**
 * AUTO CORTES — barra de ações do resultado.
 *
 * Regra de blindagem: nenhum estado terminal fica sem saída. Tudo que dá pra
 * refazer sem jogar trabalho fora está aqui — trocar o estilo re-renderiza
 * sem transcrever nem analisar de novo; "Refazer análise" mantém a
 * transcrição; "Retomar" existe sempre que o projeto parou com erro.
 */

import { useState } from 'react';
import { ToolChoice } from '@/components/tool-kit';
import type {
  CaptionPace,
  ClipSettings,
  Clip,
  HeadlineDuration,
  ProjectPhase,
} from '@/lib/auto-cortes/types';
import { CaptionPresetPicker } from './CaptionPresetPicker';
import { HeadlinePresetPicker } from './HeadlinePresetPicker';
import { AC_HUE, MiniButton, ProgressBar } from './ui';

const PACE_OPTIONS: Array<{ value: CaptionPace; label: string }> = [
  { value: 'palavra', label: 'Palavra' },
  { value: 'rapido', label: 'Rápido' },
  { value: 'equilibrado', label: 'Equilibrado' },
  { value: 'frases', label: 'Frases' },
];

const HEADLINE_DUR_OPTIONS: Array<{ value: HeadlineDuration; label: string }> = [
  { value: 'todo', label: 'Todo o corte' },
  { value: 'primeiros5s', label: 'Primeiros 5 s' },
];

export function ResultsBar({
  clips,
  phase,
  settings,
  onZip,
  zipRatio,
  onRerenderAll,
  onReanalyze,
  onResume,
  busy,
}: {
  clips: Clip[];
  phase: ProjectPhase;
  settings: ClipSettings;
  onZip: () => void;
  /** 0..1 enquanto o ZIP monta; null quando não está montando */
  zipRatio: number | null;
  onRerenderAll: (patch: Partial<ClipSettings>) => void;
  onReanalyze: () => void;
  onResume: () => void;
  busy?: boolean;
}) {
  const [openSwap, setOpenSwap] = useState(false);
  const [caption, setCaption] = useState<string | null>(settings.captionPresetId);
  const [pace, setPace] = useState<CaptionPace>(settings.captionPace);
  const [headline, setHeadline] = useState<string | null>(settings.headlinePresetId);
  const [headDur, setHeadDur] = useState<HeadlineDuration>(settings.headlineDuration);

  const prontos = clips.filter((c) => c.renderStatus === 'pronto');
  if (clips.length === 0 && phase !== 'erro') return null;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2.5 rounded-[16px] border border-line/70 p-3.5"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.16)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        }}
      >
        <button
          type="button"
          onClick={onZip}
          disabled={busy || prontos.length === 0 || zipRatio != null}
          className="btn-lime !py-2.5 text-[13px] disabled:opacity-40"
        >
          {zipRatio != null
            ? `Montando o ZIP… ${Math.round(zipRatio * 100)}%`
            : `Baixar todos (ZIP) · ${prontos.length}`}
        </button>

        <MiniButton
          tone="pink"
          onClick={() => setOpenSwap((v) => !v)}
          disabled={busy || clips.length === 0}
        >
          {openSwap ? 'Fechar troca de estilo' : 'Trocar legenda/headline'}
        </MiniButton>

        <MiniButton onClick={onReanalyze} disabled={busy}>
          Refazer análise
        </MiniButton>

        {phase === 'erro' ? (
          <button type="button" onClick={onResume} className="btn-primary !py-2.5 text-[13px]">
            Retomar
          </button>
        ) : null}

        <span className="ml-auto text-[11.5px] text-text-dim">
          {prontos.length === clips.length
            ? 'Todos os cortes prontos.'
            : `${clips.length - prontos.length} ainda em produção.`}
        </span>
      </div>

      {zipRatio != null ? <ProgressBar ratio={zipRatio} color="rgb(var(--lime))" /> : null}

      {openSwap ? (
        <div className="space-y-4 rounded-[16px] border border-line bg-bg-soft/40 p-4">
          <p className="text-[12px] leading-relaxed text-text-muted">
            Trocar o estilo re-renderiza os cortes com a transcrição e a análise que já existem —
            não gasta transcrição nem IA de novo.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div
                className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Legenda
              </div>
              <CaptionPresetPicker value={caption} onChange={setCaption} disabled={busy} compact />
            </div>
            <div>
              <div
                className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Headline
              </div>
              <HeadlinePresetPicker value={headline} onChange={setHeadline} disabled={busy} compact />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div
                className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Ritmo da legenda
              </div>
              <ToolChoice<CaptionPace>
                value={pace}
                onChange={setPace}
                options={PACE_OPTIONS}
                disabled={busy || caption == null}
                hue={AC_HUE}
              />
            </div>
            <div>
              <div
                className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Headline aparece
              </div>
              <ToolChoice<HeadlineDuration>
                value={headDur}
                onChange={setHeadDur}
                options={HEADLINE_DUR_OPTIONS}
                disabled={busy || headline == null}
                hue={AC_HUE}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onRerenderAll({
                captionPresetId: caption,
                captionPace: pace,
                headlinePresetId: headline,
                headlineDuration: headDur,
              });
              setOpenSwap(false);
            }}
            className="btn-primary !py-2.5 text-[13px] disabled:opacity-40"
          >
            Aplicar e renderizar de novo
          </button>
        </div>
      ) : null}
    </div>
  );
}
