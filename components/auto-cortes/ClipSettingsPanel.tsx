'use client';

/**
 * AUTO CORTES — passo 2: os AJUSTES.
 *
 * Todas as opções da tabela da ARQUITETURA §2, com os rótulos exatos que o
 * cliente vê. As galerias de legenda e headline abrem em painel dobrável pra
 * o passo não virar uma parede de 500 cards.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { ToolChoice } from '@/components/tool-kit';
import { LangPicker } from '@/components/typography/LangPicker';
import {
  GENRE_LABEL,
  type AspectRatio,
  type CaptionPace,
  type ClipCountPreset,
  type ClipLengthPreset,
  type ClipSettings,
  type Genre,
  type HeadlineDuration,
  type ReframeMode,
} from '@/lib/auto-cortes/types';
import { CaptionPresetPicker, captionPresetLabel } from './CaptionPresetPicker';
import { HeadlinePresetPicker, headlinePresetLabel } from './HeadlinePresetPicker';
import { ReframePicker } from './ReframePicker';
import { AC_HUE, FieldLabel, MiniButton, fmtClock, parseClock } from './ui';

const ASPECT_OPTIONS: Array<{ value: AspectRatio; label: string; sub: string }> = [
  { value: '9:16', label: '9:16', sub: 'Reels / Shorts' },
  { value: '4:5', label: '4:5', sub: 'feed' },
  { value: '1:1', label: '1:1', sub: 'quadrado' },
  { value: '16:9', label: '16:9', sub: 'YouTube' },
];

const LENGTH_OPTIONS: Array<{ value: ClipLengthPreset; label: string; sub?: string }> = [
  { value: 'auto', label: 'Automático', sub: 'a IA decide' },
  { value: 'lt30', label: 'Até 30 s' },
  { value: '30-59', label: '30 – 59 s' },
  { value: '60-89', label: '60 – 89 s' },
  { value: '90-180', label: '90 s – 3 min' },
  { value: '180-300', label: '3 – 5 min' },
];

const COUNT_OPTIONS: Array<{ value: string; label: string; sub?: string }> = [
  { value: 'auto', label: 'Automático', sub: '≈1 a cada 6 min' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '15', label: '15' },
  { value: '20', label: '20' },
  { value: '30', label: '30' },
];

const PACE_OPTIONS: Array<{ value: CaptionPace; label: string; sub: string }> = [
  { value: 'palavra', label: 'Palavra', sub: '1 por vez' },
  { value: 'rapido', label: 'Rápido', sub: '2–3 palavras' },
  { value: 'equilibrado', label: 'Equilibrado', sub: '4–6 palavras' },
  { value: 'frases', label: 'Frases', sub: 'linha inteira' },
];

const HEADLINE_DUR_OPTIONS: Array<{ value: HeadlineDuration; label: string }> = [
  { value: 'todo', label: 'Todo o corte' },
  { value: 'primeiros5s', label: 'Primeiros 5 s' },
];

const GENRE_ORDER: Genre[] = [
  'auto',
  'podcast',
  'entrevista',
  'comentario',
  'marketing',
  'webinar',
  'motivacional',
  'academico',
  'lista',
  'review',
  'tutorial',
  'comedia',
  'esporte',
  'igreja',
  'noticias',
  'vlog',
  'games',
  'outros',
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  );
}

/** Painel dobrável — a galeria só monta (e só desenha canvas) quando aberta. */
function Collapsible({
  label,
  summary,
  children,
  disabled,
}: {
  label: string;
  summary: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[14px] border border-line bg-bg-soft/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left disabled:opacity-50"
      >
        <span className="min-w-0">
          <span
            className="block text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {label}
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-semibold text-text">
            {summary}
          </span>
        </span>
        <span className="shrink-0 text-[11.5px] font-bold text-violet">
          {open ? 'Fechar ▴' : 'Trocar ▾'}
        </span>
      </button>
      {open ? <div className="border-t border-line px-3.5 py-3.5">{children}</div> : null}
    </div>
  );
}

export type ClipSettingsPanelProps = {
  value: ClipSettings;
  onChange: (next: ClipSettings) => void;
  disabled?: boolean;
  /** duração da fonte, quando já conhecida (habilita o campo de trecho) */
  durationSec?: number | null;
  /** proporção do vídeo-fonte, pra saber se há reenquadro */
  sourceAspect?: number | null;
  onSaveDefaults: () => void;
  /** feedback do "Salvar como padrão" */
  savedDefaults?: boolean;
};

export function ClipSettingsPanel({
  value,
  onChange,
  disabled,
  durationSec,
  sourceAspect,
  onSaveDefaults,
  savedDefaults,
}: ClipSettingsPanelProps) {
  const set = <K extends keyof ClipSettings>(k: K, v: ClipSettings[K]) =>
    onChange({ ...value, [k]: v });

  const genreOptions = useMemo(
    () => GENRE_ORDER.map((g) => ({ value: g, label: GENRE_LABEL[g] })),
    [],
  );

  const targetRatio = useMemo(() => {
    const [w, h] = value.aspect.split(':').map(Number);
    return w / h;
  }, [value.aspect]);
  const sameAspect =
    sourceAspect != null && isFinite(sourceAspect) && Math.abs(sourceAspect - targetRatio) < 0.02;

  const range = value.range;
  const [rangeStart, setRangeStart] = useState(() => (range ? fmtClock(range.startSec) : ''));
  const [rangeEnd, setRangeEnd] = useState(() => (range ? fmtClock(range.endSec) : ''));
  const [rangeError, setRangeError] = useState<string | null>(null);

  function applyRange(startRaw: string, endRaw: string) {
    const s = parseClock(startRaw);
    const e = parseClock(endRaw);
    if (s == null || e == null) {
      setRangeError('Use minuto:segundo — por exemplo 12:30.');
      return;
    }
    if (e <= s) {
      setRangeError('O fim tem que vir depois do início.');
      return;
    }
    setRangeError(null);
    set('range', { startSec: s, endSec: e });
  }

  return (
    <div className="space-y-5">
      <MissingKeyBanner services={['groq', 'anthropic']} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Row label="Proporção">
          <ToolChoice<AspectRatio>
            value={value.aspect}
            onChange={(v) => set('aspect', v)}
            options={ASPECT_OPTIONS}
            disabled={disabled}
            hue={AC_HUE}
          />
        </Row>

        <Row label="Duração do corte">
          <ToolChoice<ClipLengthPreset>
            value={value.length}
            onChange={(v) => set('length', v)}
            options={LENGTH_OPTIONS}
            disabled={disabled}
            hue={AC_HUE}
          />
        </Row>

        <Row label="Quantidade">
          <ToolChoice<string>
            value={String(value.count)}
            onChange={(v) =>
              set('count', (v === 'auto' ? 'auto' : (Number(v) as ClipCountPreset)) as ClipCountPreset)
            }
            options={COUNT_OPTIONS}
            disabled={disabled}
            hue={AC_HUE}
          />
        </Row>

        <Row label="Gênero" hint="muda o jeito de escolher os momentos">
          <ToolChoice<Genre>
            value={value.genre}
            onChange={(v) => set('genre', v)}
            options={genreOptions}
            disabled={disabled}
            hue={AC_HUE}
          />
        </Row>
      </div>

      <div className="flex flex-wrap items-end gap-5">
        <LangPicker
          value={value.language}
          onChange={(v) => set('language', v)}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Collapsible
          label="Legenda"
          summary={captionPresetLabel(value.captionPresetId)}
          disabled={disabled}
        >
          <CaptionPresetPicker
            value={value.captionPresetId}
            onChange={(id) => set('captionPresetId', id)}
            disabled={disabled}
            compact
          />
        </Collapsible>

        <Collapsible
          label="Headline"
          summary={headlinePresetLabel(value.headlinePresetId)}
          disabled={disabled}
        >
          <HeadlinePresetPicker
            value={value.headlinePresetId}
            onChange={(id) => set('headlinePresetId', id)}
            disabled={disabled}
            compact
          />
        </Collapsible>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Row label="Ritmo da legenda">
          <ToolChoice<CaptionPace>
            value={value.captionPace}
            onChange={(v) => set('captionPace', v)}
            options={PACE_OPTIONS}
            disabled={disabled || value.captionPresetId == null}
            hue={AC_HUE}
          />
        </Row>

        <Row label="Headline aparece">
          <ToolChoice<HeadlineDuration>
            value={value.headlineDuration}
            onChange={(v) => set('headlineDuration', v)}
            options={HEADLINE_DUR_OPTIONS}
            disabled={disabled || value.headlinePresetId == null}
            hue={AC_HUE}
          />
        </Row>
      </div>

      <Row label="Reenquadro">
        <ReframePicker
          value={value.reframe}
          onChange={(v: ReframeMode) => set('reframe', v)}
          disabled={disabled}
          sameAspect={sameAspect}
        />
      </Row>

      <Row label="Momentos específicos" hint="opcional">
        <textarea
          value={value.focusPrompt}
          disabled={disabled}
          rows={2}
          maxLength={400}
          placeholder="Ex.: encontra tudo que ele fala sobre tráfego pago"
          onChange={(e) => set('focusPrompt', e.target.value)}
          className="w-full resize-y rounded-[12px] border border-line bg-bg-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-text-dim focus:border-pink-400/60 disabled:opacity-50"
        />
      </Row>

      <Row
        label="Trecho do vídeo"
        hint={durationSec ? `vídeo inteiro: ${fmtClock(durationSec)}` : 'opcional'}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-text-muted">
            <input
              type="checkbox"
              checked={value.range == null}
              disabled={disabled}
              onChange={(e) => {
                if (e.target.checked) {
                  setRangeError(null);
                  set('range', null);
                } else {
                  const s = 0;
                  const en = Math.max(60, Math.round(durationSec ?? 600));
                  setRangeStart(fmtClock(s));
                  setRangeEnd(fmtClock(en));
                  set('range', { startSec: s, endSec: en });
                }
              }}
              className="h-4 w-4 accent-pink-400"
            />
            Analisar o vídeo inteiro
          </label>
          {value.range != null ? (
            <>
              <input
                value={rangeStart}
                disabled={disabled}
                placeholder="0:00"
                onChange={(e) => setRangeStart(e.target.value)}
                onBlur={() => applyRange(rangeStart, rangeEnd)}
                className="mono w-[92px] rounded-[10px] border border-line bg-bg-soft px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-pink-400/60"
                aria-label="Início do trecho"
              />
              <span className="text-[12px] text-text-dim">até</span>
              <input
                value={rangeEnd}
                disabled={disabled}
                placeholder="20:00"
                onChange={(e) => setRangeEnd(e.target.value)}
                onBlur={() => applyRange(rangeStart, rangeEnd)}
                className="mono w-[92px] rounded-[10px] border border-line bg-bg-soft px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-pink-400/60"
                aria-label="Fim do trecho"
              />
            </>
          ) : null}
        </div>
        {rangeError ? (
          <p className="mt-1.5 text-[11.5px] text-red-300">{rangeError}</p>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-text-dim">
            Analisar só um pedaço economiza transcrição e tempo.
          </p>
        )}
      </Row>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <MiniButton onClick={onSaveDefaults} disabled={disabled} tone="neutral">
          Salvar como padrão
        </MiniButton>
        {savedDefaults ? (
          <span className="text-[11.5px] font-semibold text-lime">
            Salvo — a próxima vez já abre assim.
          </span>
        ) : (
          <span className="text-[11.5px] text-text-dim">
            Guarda estes ajustes neste navegador pros próximos vídeos.
          </span>
        )}
      </div>
    </div>
  );
}
