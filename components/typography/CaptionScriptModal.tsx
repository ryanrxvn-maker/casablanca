'use client';

/**
 * ROTEIRO DE LEGENDA — a janelinha do botao de relevo.
 *
 * Aqui o user separa HOOK e BODY (e divide o body em quantas partes quiser),
 * cola a copy de cada trecho e escolhe a legenda de cada um. O modulo puro
 * `lib/typography/caption-script.ts` faz a conta (quantas palavras, quais
 * blocos, onde parte) e este arquivo so' desenha e conversa com ela.
 *
 * Regras de casa seguidas de proposito: rotulo de campo em `.field-label`
 * (nada de eyebrow em caixa alta em cada label), sem nevoa roxa de fundo,
 * duplo bisel no gatilho, hairline no lugar de borda cinza e uma escala so'
 * de raio. O CSS mora em app/globals.css sob `.roteiro-*`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorDot } from '@/components/typography/ColorDot';
import { PresetGallery } from '@/components/typography/PresetGallery';
import { useCaptionTemplates } from '@/components/typography/useCaptionTemplates';
import {
  drawCaptions,
  type Block,
  type PerBlockStyle,
  type StyleState,
} from '@/lib/typography/engine';
import { getPreset } from '@/lib/typography/presets';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';
import type { BlockIdentity } from '@/lib/typography/blocks-edit';
import { FxPanel } from '@/components/typography/FxPanel';
import { normalizeFx, type FxState } from '@/lib/typography/fx';
import {
  applyCaptionScript,
  countScriptWords,
  newSegmentId,
  relabelSegments,
  resolveCaptionScript,
  segmentsToTemplate,
  templateToSegments,
  type ApplyResult,
  type CaptionSegment,
  type CaptionTemplate,
  type ResolvedSegment,
} from '@/lib/typography/caption-script';
import { formatTime } from '@/lib/utils';
import { travarScrollDaPagina } from '@/lib/trava-scroll';

const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

/* ───────────────────────── o gatilho (so' icone) ──────────────────────── */

/** Duas faixas de legenda em alturas diferentes = hook em cima, body embaixo. */
function IconRoteiro() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect className="roteiro-orb-hook" x="3.4" y="5" width="12.5" height="3.6" rx="1.8" fill="currentColor" />
      <rect x="3.4" y="10.7" width="17.2" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
      <rect x="3.4" y="15.6" width="13.4" height="2.6" rx="1.3" fill="currentColor" opacity="0.62" />
      <circle cx="19.6" cy="6.8" r="2" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export function RoteiroOrbButton({
  onClick,
  open,
  disabled,
  title = 'Roteiro de legenda: hook e body com letterings diferentes',
}: {
  onClick: () => void;
  open?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={'roteiro-orb' + (open ? ' is-open' : '')}
    >
      {!open && !disabled ? <span className="roteiro-orb-halo" aria-hidden /> : null}
      <IconRoteiro />
    </button>
  );
}

/* ─────────────────────────── controles miudos ─────────────────────────── */

function MiniSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="field-label text-[11.5px] text-text-muted">{label}</span>
        <span className="mono text-[11px] text-text">{display(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none"
        style={{
          background: `linear-gradient(90deg, rgb(var(--amber)) ${pct}%, rgb(var(--line-strong)) ${pct}%)`,
        }}
      />
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
  title,
  wide,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        'flex h-8 items-center justify-center rounded-[10px] px-2.5 text-[12px] font-semibold' +
        (wide ? ' min-w-[64px]' : ' min-w-[34px]') +
        T3D +
        ' ' +
        (on
          ? 'bg-amber-400/15 roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.6)]'
          : 'bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-text')
      }
    >
      {children}
    </button>
  );
}

/* ─────────────────── previa ao vivo do trecho (canvas) ────────────────── */

function SegPreview({
  style,
  words,
  fallbackPresetId,
}: {
  style: PerBlockStyle;
  words: string[];
  fallbackPresetId: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ style, words, fallbackPresetId });
  stateRef.current = { style, words, fallbackPresetId };

  useEffect(() => {
    void ensureTypoFonts();
    const t0 = performance.now();
    const tick = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) {
          const s = stateRef.current;
          const texto = s.words.length > 0 ? s.words : ['Sua', 'legenda', 'aqui'];
          const per = 340;
          const dur = Math.max(1200, texto.length * per + 900);
          const bloco: Block = {
            id: 'previa',
            words: texto.map((w, i) => ({ text: w, start: i * per, end: i * per + per - 40 })),
            start: 0,
            end: dur,
          };
          const st: StyleState = {
            presetId: s.style.presetId ?? s.fallbackPresetId,
            fontScale: s.style.fontScale ?? 1,
            posY: s.style.posY ?? 0.76,
            posX: s.style.posX ?? 0.5,
            primary: s.style.primary ?? null,
            accent: s.style.accent ?? null,
            uppercase: null,
            textCase: s.style.textCase ?? null,
            bold: s.style.bold,
            italic: s.style.italic,
            underline: s.style.underline,
            autoFit: s.style.autoFit,
            singleLine: s.style.singleLine,
            fx: s.style.fx,
            bgMode: s.style.bgMode,
            bgColor: s.style.bgColor,
            bgOpacity: s.style.bgOpacity,
            animIn: s.style.animIn ?? null,
            animOut: s.style.animOut ?? null,
            fontOverride: s.style.fontOverride ?? null,
            highlights: {},
          };
          ctx.clearRect(0, 0, c.width, c.height);
          const t = (performance.now() - t0) % dur;
          drawCaptions(
            ctx,
            [bloco],
            getPreset(st.presetId),
            st,
            t,
            c.width,
            c.height,
          );
        }
      }
    };
    return registerCanvasJob(tick, { fps: 24, el: ref.current });
  }, []);

  return (
    <canvas
      ref={ref}
      width={306}
      height={172}
      className="block w-full rounded-[12px]"
      style={{
        aspectRatio: '306 / 172',
        background: 'linear-gradient(150deg, #1a1b21 0%, #101116 55%, #1c1d24 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
      }}
    />
  );
}

/* ───────────────────────────── a janelinha ────────────────────────────── */

export type CaptionScriptModalProps = {
  open: boolean;
  onClose: () => void;
  blocks: Block[];
  ident: BlockIdentity;
  /** modelo global (o que vale onde o roteiro nao manda) */
  fallbackPresetId: string;
  segments: CaptionSegment[];
  onSegments: (segs: CaptionSegment[]) => void;
  favs: string[];
  onToggleFav: (id: string) => void;
  onApply: (r: ApplyResult) => void;
  /** abre direto na aba de templates (chip ao lado dos favoritos) */
  startOnTemplates?: boolean;
};

export function CaptionScriptModal({
  open,
  onClose,
  blocks,
  ident,
  fallbackPresetId,
  segments,
  onSegments,
  favs,
  onToggleFav,
  onApply,
  startOnTemplates,
}: CaptionScriptModalProps) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<'roteiro' | 'templates'>('roteiro');
  const [galleryFor, setGalleryFor] = useState<string | null>(null);
  const [cortar, setCortar] = useState(true);
  const [travar, setTravar] = useState(true);
  const [tplName, setTplName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const { templates, saveTemplate, removeTemplate } = useCaptionTemplates();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setTab(startOnTemplates ? 'templates' : 'roteiro');
  }, [open, startOnTemplates]);

  // Esc fecha; a pagina para' de rolar por tras
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const destravarScroll = travarScrollDaPagina();
    return () => {
      window.removeEventListener('keydown', onKey);
      destravarScroll();
    };
  }, [open, onClose]);

  const resolved = useMemo(
    () => resolveCaptionScript(blocks, segments),
    [blocks, segments],
  );

  const patch = useCallback(
    (id: string, fn: (s: CaptionSegment) => CaptionSegment) => {
      onSegments(segments.map((s) => (s.id === id ? fn(s) : s)));
    },
    [segments, onSegments],
  );
  const patchStyle = useCallback(
    (id: string, st: PerBlockStyle) => {
      patch(id, (s) => ({ ...s, style: { ...s.style, ...st } }));
    },
    [patch],
  );

  const addBody = () => {
    const ultimo = segments[segments.length - 1];
    onSegments(
      relabelSegments([
        ...segments,
        {
          id: newSegmentId(),
          kind: 'body',
          label: 'Body',
          text: '',
          words: null,
          style: { ...(ultimo?.style ?? {}) },
        },
      ]),
    );
  };
  const removeSeg = (id: string) => {
    const next = segments.filter((s) => s.id !== id);
    if (next.length === 0) return;
    onSegments(relabelSegments(next));
  };

  const aplicar = () => {
    const r = applyCaptionScript(blocks, segments, ident, {
      splitAtBoundary: cortar,
      lock: travar,
    });
    onApply(r);
    const inexatos = r.resolved.segments.filter((s) => !s.exact && s.blockIds.length > 0);
    setFeedback(
      `Roteiro aplicado em ${r.styled} bloco${r.styled === 1 ? '' : 's'}` +
        (r.splits > 0 ? `, ${r.splits} partido${r.splits === 1 ? '' : 's'} na palavra exata` : '') +
        (inexatos.length > 0
          ? `. ${inexatos.length} fronteira${inexatos.length === 1 ? '' : 's'} nao fechou na palavra certa (liga "cortar na palavra exata").`
          : '. Ctrl+Z desfaz.'),
    );
  };

  if (!mounted || !open) return null;

  const totalPalavras = resolved.totalWords;
  const usadas = resolved.segments.reduce((s, r) => s + r.got, 0);

  return createPortal(
    <div
      className="roteiro-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="roteiro-window" role="dialog" aria-modal="true" aria-label="Roteiro de legenda">
        {/* ── cabecalho ── */}
        <div className="flex items-start gap-3 px-6 pb-4 pt-5">
          <span
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] roteiro-accent"
            style={{
              background: 'linear-gradient(160deg, rgba(255,159,10,0.2), rgba(255,159,10,0.05))',
              boxShadow: 'inset 0 0 0 1px rgba(255,159,10,0.35)',
            }}
          >
            <IconRoteiro />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-[19px] font-bold leading-tight tracking-tight text-text"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Roteiro de legenda
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
              Cola o hook e o body separados (o body pode virar quantas partes
              quiser) e escolhe a legenda de cada trecho. A fronteira sai da
              contagem de palavras da copy, e o bloco pode ser partido na
              palavra exata.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Fechar"
            aria-label="Fechar"
            className={
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-text' +
              T3D
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>

        {/* ── abas ── */}
        <div className="flex items-center gap-2 border-b border-line/70 px-6 pb-3">
          {(
            [
              ['roteiro', 'Trechos'],
              ['templates', 'Templates'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={
                'rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold' +
                T3D +
                ' ' +
                (tab === k
                  ? 'bg-amber-400/15 roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.55)]'
                  : 'bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-text')
              }
            >
              {label}
              {k === 'templates' ? (
                <span className="ml-1.5 opacity-60">{templates.length}</span>
              ) : null}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-text-muted">
            {blocks.length} bloco{blocks.length === 1 ? '' : 's'} · {totalPalavras} palavras
          </span>
        </div>

        <div className="max-h-[64vh] overflow-y-auto px-6 py-5">
          {tab === 'templates' ? (
            <TemplatesTab
              templates={templates}
              segments={segments}
              tplName={tplName}
              setTplName={setTplName}
              onUse={(t) => {
                onSegments(templateToSegments(t, segments));
                setTab('roteiro');
                setFeedback(`Template "${t.name}" carregado nos trechos. Confere e clica em aplicar.`);
              }}
              onSave={() => {
                const nome = tplName.trim() || `Template ${templates.length + 1}`;
                saveTemplate(segmentsToTemplate(segments, nome, `u${Date.now().toString(36)}`));
                setTplName('');
                setFeedback(`Template "${nome}" salvo na sua conta.`);
              }}
              onRemove={removeTemplate}
              fallbackPresetId={fallbackPresetId}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {segments.map((seg, i) => (
                <SegmentCard
                  key={seg.id}
                  seg={seg}
                  res={resolved.segments[i]}
                  blocks={blocks}
                  fallbackPresetId={fallbackPresetId}
                  canRemove={
                    seg.kind === 'body' && segments.filter((x) => x.kind === 'body').length > 1
                  }
                  galleryOpen={galleryFor === seg.id}
                  onToggleGallery={() => setGalleryFor((g) => (g === seg.id ? null : seg.id))}
                  favs={favs}
                  onToggleFav={onToggleFav}
                  onPatch={(fn) => patch(seg.id, fn)}
                  onPatchStyle={(st) => patchStyle(seg.id, st)}
                  onRemove={() => removeSeg(seg.id)}
                />
              ))}
              <button
                type="button"
                onClick={addBody}
                className={
                  'flex items-center justify-center gap-2 rounded-[16px] px-4 py-3 text-[12.5px] font-semibold text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-text' +
                  T3D
                }
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Dividir o body em mais uma parte
              </button>

              {resolved.leftover > 0 ? (
                <p className="text-[11.5px] text-text-muted">
                  {resolved.leftover} bloco{resolved.leftover === 1 ? '' : 's'} no fim
                  {resolved.leftover === 1 ? ' fica' : ' ficam'} de fora do roteiro e
                  {resolved.leftover === 1 ? ' segue' : ' seguem'} no estilo geral. Deixa
                  o ultimo trecho sem copy pra ele levar todo o resto.
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* ── rodape ── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line/70 px-6 py-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
            <input
              type="checkbox"
              checked={cortar}
              onChange={(e) => setCortar(e.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            Cortar o bloco na palavra exata
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
            <input
              type="checkbox"
              checked={travar}
              onChange={(e) => setTravar(e.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            Travar os blocos aplicados
          </label>
          <span className="mono text-[11px] text-text-muted">
            {usadas}/{totalPalavras} palavras no roteiro
          </span>
          <button
            type="button"
            onClick={aplicar}
            disabled={blocks.length === 0}
            className={
              'ml-auto rounded-[12px] bg-amber-400/15 px-5 py-2.5 text-[13px] font-bold roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.6)] disabled:opacity-40' +
              T3D
            }
          >
            Aplicar na legenda
          </button>
        </div>
        {feedback ? (
          <div className="border-t border-line/70 px-6 py-3 text-[12px] text-lime">{feedback}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────── card de um trecho ────────────────────────── */

function SegmentCard({
  seg,
  res,
  blocks,
  fallbackPresetId,
  canRemove,
  galleryOpen,
  onToggleGallery,
  favs,
  onToggleFav,
  onPatch,
  onPatchStyle,
  onRemove,
}: {
  seg: CaptionSegment;
  res: ResolvedSegment | undefined;
  blocks: Block[];
  fallbackPresetId: string;
  canRemove: boolean;
  galleryOpen: boolean;
  onToggleGallery: () => void;
  favs: string[];
  onToggleFav: (id: string) => void;
  onPatch: (fn: (s: CaptionSegment) => CaptionSegment) => void;
  onPatchStyle: (st: PerBlockStyle) => void;
  onRemove: () => void;
}) {
  const [fxOpen, setFxOpen] = useState(false);
  const preset = getPreset(seg.style.presetId ?? fallbackPresetId);
  const isHook = seg.kind === 'hook';
  const contadas = countScriptWords(seg.text);
  // palavras REAIS dos blocos que caem no trecho (previa fiel); sem eles,
  // a copy colada; sem ela, o texto de demonstracao
  const previa = useMemo(() => {
    if (res && res.blockIds.length > 0) {
      const ids = new Set(res.blockIds);
      const w = blocks
        .filter((b) => ids.has(b.id))
        .flatMap((b) => b.words.map((x) => x.text));
      if (w.length > 0) return w.slice(0, 6);
    }
    const c = seg.text.trim().split(/\s+/).filter(Boolean);
    return c.length > 0 ? c.slice(0, 6) : [];
  }, [res, blocks, seg.text]);

  const caseBtn = (mode: 'upper' | 'lower' | 'original', label: string, title: string) => (
    <Toggle
      key={mode}
      title={title}
      on={seg.style.textCase === mode}
      onClick={() => onPatchStyle({ textCase: seg.style.textCase === mode ? null : mode })}
    >
      {label}
    </Toggle>
  );

  return (
    <div className={'roteiro-seg p-4' + (isHook ? ' is-hook' : '')}>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span
          className={
            'label-tech rounded-full px-2.5 py-1 text-[10px] ' +
            (isHook
              ? 'bg-amber-400/15 roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.5)]'
              : 'bg-cyan-400/10 text-cyan-500 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.4)]')
          }
        >
          {seg.label}
        </span>
        <button
          type="button"
          onClick={onToggleGallery}
          className={
            'rounded-[10px] bg-bg-soft px-3 py-1.5 text-[12px] font-semibold text-text shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:roteiro-accent' +
            T3D
          }
          title="Trocar o modelo de lettering deste trecho"
        >
          {preset.name}
          <span className="ml-1.5 text-text-muted">{galleryOpen ? 'fechar' : 'trocar'}</span>
        </button>
        <button
          type="button"
          onClick={() => setFxOpen((v) => !v)}
          className={
            'rounded-[10px] px-3 py-1.5 text-[12px] font-semibold' +
            T3D +
            ' ' +
            (fxOpen
              ? 'bg-amber-400/15 roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.55)]'
              : 'bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-text')
          }
          title="Traço, sombra, brilho e fumaça deste trecho"
        >
          Efeitos
        </button>
        {res && res.blockIds.length > 0 ? (
          <span className="mono text-[11px] text-text-muted">
            blocos {res.from + 1} a {res.to + 1} · {formatTime(res.startMs / 1000)} a{' '}
            {formatTime(res.endMs / 1000)} · {res.got} palavras
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">nenhum bloco neste trecho</span>
        )}
        {res && !res.exact && res.demand !== null && res.blockIds.length > 0 ? (
          <span
            className="rounded-full bg-amber-400/12 px-2.5 py-1 text-[10.5px] font-semibold roteiro-accent"
            title="A copy pede uma fronteira no meio de um bloco. Com 'cortar na palavra exata' ligado, o bloco e partido no lugar certo ao aplicar."
          >
            a copy pede {res.demand}, o bloco fecha em {res.got}
          </span>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            title="Tirar esta parte do body"
            aria-label="Tirar esta parte do body"
            className={
              'ml-auto flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-red-400' +
              T3D
            }
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_306px]">
        <div className="min-w-0">
          <label className="field-label mb-1 block text-[11.5px] text-text-muted">
            Copy do {isHook ? 'hook' : 'trecho'}
            {seg.text.trim() === '' && seg.words === null ? ' (vazio = leva todo o resto)' : ''}
          </label>
          <textarea
            value={seg.text}
            onChange={(e) => onPatch((s) => ({ ...s, text: e.target.value }))}
            rows={3}
            placeholder={
              isHook
                ? 'Cola aqui o hook, igualzinho ao da copy'
                : 'Cola a parte do body. Deixa vazio pra levar todo o resto.'
            }
            className="roteiro-field w-full resize-y rounded-[12px] px-3 py-2.5 text-[13px] leading-relaxed text-text outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span className="text-[11.5px] text-text-muted">
              {contadas} palavra{contadas === 1 ? '' : 's'} na copy
            </span>
            <span className="h-3.5 w-px bg-line" />
            <label className="field-label flex items-center gap-1.5 text-[11.5px] text-text-muted">
              Ajustar na mao
              <input
                type="number"
                min={0}
                value={seg.words ?? ''}
                placeholder={contadas > 0 ? String(contadas) : 'auto'}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  onPatch((s) => ({ ...s, words: v === '' ? null : Math.max(0, Number(v)) }));
                }}
                className="roteiro-field mono w-[68px] rounded-[8px] px-2 py-1 text-[11.5px] text-text outline-none"
              />
            </label>
            {res?.cut && !res.exact ? (
              <span className="text-[11px] text-text-muted">
                ao aplicar, o bloco {blocks.findIndex((b) => b.id === res.cut?.blockId) + 1} e
                partido depois da palavra {res.cut.wordIndex}
              </span>
            ) : null}
          </div>

          {/* estilo do trecho */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MiniSlider
              label="Tamanho"
              min={0.5}
              max={2}
              step={0.05}
              value={seg.style.fontScale ?? 1}
              display={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onPatchStyle({ fontScale: v })}
            />
            <MiniSlider
              label="Altura na tela"
              min={0.05}
              max={0.95}
              step={0.01}
              value={seg.style.posY ?? 0.76}
              display={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onPatchStyle({ posY: v })}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ColorDot
              label="Texto"
              value={seg.style.primary ?? null}
              fallback={preset.defaultPrimary}
              onPick={(v) => onPatchStyle({ primary: v })}
            />
            <ColorDot
              label="Destaque"
              value={seg.style.accent ?? null}
              fallback={preset.defaultAccent}
              onPick={(v) => onPatchStyle({ accent: v })}
            />
            <span className="h-6 w-px bg-line" />
            {caseBtn('upper', 'TT', 'Tudo em caixa alta')}
            {caseBtn('lower', 'tt', 'Tudo em caixa baixa')}
            {caseBtn('original', 'Tt', 'Como foi falado')}
            <span className="h-6 w-px bg-line" />
            <Toggle title="Negrito" on={seg.style.bold === true} onClick={() => onPatchStyle({ bold: !seg.style.bold })}>
              <span className="font-black">B</span>
            </Toggle>
            <Toggle title="Italico" on={seg.style.italic === true} onClick={() => onPatchStyle({ italic: !seg.style.italic })}>
              <span className="italic">I</span>
            </Toggle>
            <Toggle title="Sublinhado" on={seg.style.underline === true} onClick={() => onPatchStyle({ underline: !seg.style.underline })}>
              <span className="underline">U</span>
            </Toggle>
            <span className="h-6 w-px bg-line" />
            <Toggle
              wide
              title="Caixa de fundo atras do texto"
              on={(seg.style.bgMode ?? 'preset') === 'on'}
              onClick={() =>
                onPatchStyle({ bgMode: (seg.style.bgMode ?? 'preset') === 'on' ? 'preset' : 'on' })
              }
            >
              Fundo
            </Toggle>
            <Toggle
              wide
              title="Sem caixa nem barra, mesmo que o modelo tenha"
              on={seg.style.bgMode === 'off'}
              onClick={() =>
                onPatchStyle({ bgMode: seg.style.bgMode === 'off' ? 'preset' : 'off' })
              }
            >
              Sem fundo
            </Toggle>
            <Toggle
              wide
              title="O bloco nunca desce pra uma segunda linha — encolhe pra caber e a frase seguinte entra no próximo bloco"
              on={seg.style.singleLine === true}
              onClick={() => onPatchStyle({ singleLine: !seg.style.singleLine })}
            >
              Linha única
            </Toggle>
          </div>
        </div>

        <div className="min-w-0">
          <SegPreview style={seg.style} words={previa} fallbackPresetId={fallbackPresetId} />
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-muted">
            Previa ao vivo com as palavras deste trecho, na altura e no tamanho
            que voce escolheu.
          </p>
        </div>
      </div>

      {fxOpen ? (
        <div className="roteiro-field mt-4 rounded-[14px] p-3">
          <FxPanel
            preset={preset}
            fx={normalizeFx(seg.style.fx)}
            onFx={(patch) =>
              onPatchStyle({ fx: { ...normalizeFx(seg.style.fx), ...patch } as FxState })
            }
            fxStroke={seg.style.fxStroke ?? 1}
            fxShadow={seg.style.fxShadow ?? 1}
            fxGlow={seg.style.fxGlow ?? 1}
            fxSmoke={seg.style.fxSmoke ?? 1}
            onMultiplier={(patch) => onPatchStyle(patch)}
            onCommit={() => undefined}
            defaultPrimary={preset.defaultPrimary}
          />
        </div>
      ) : null}

      {galleryOpen ? (
        <div className="roteiro-field mt-4 rounded-[14px] p-3">
          <PresetGallery
            presetId={seg.style.presetId ?? fallbackPresetId}
            onPick={(id) => {
              onPatchStyle({ presetId: id });
              onToggleGallery();
            }}
            favs={favs}
            onToggleFav={onToggleFav}
            compact
          />
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── aba templates ─────────────────────────── */

function TemplatesTab({
  templates,
  segments,
  tplName,
  setTplName,
  onUse,
  onSave,
  onRemove,
  fallbackPresetId,
}: {
  templates: CaptionTemplate[];
  segments: CaptionSegment[];
  tplName: string;
  setTplName: (v: string) => void;
  onUse: (t: CaptionTemplate) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
  fallbackPresetId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} className="roteiro-seg p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className="text-[13.5px] font-bold tracking-tight text-text"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {t.name}
              </span>
              {t.builtin ? (
                <span className="label-tech rounded-full bg-lime/10 px-2 py-0.5 text-[9.5px] text-lime shadow-[inset_0_0_0_1px_rgba(200,232,124,0.35)]">
                  de fabrica
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onUse(t)}
                  className={
                    'rounded-[10px] bg-amber-400/15 px-3 py-1.5 text-[11.5px] font-bold roteiro-accent shadow-[inset_0_0_0_1px_rgba(251,191,36,0.55)]' +
                    T3D
                  }
                >
                  Usar
                </button>
                {!t.builtin ? (
                  <button
                    type="button"
                    onClick={() => onRemove(t.id)}
                    title="Apagar este template"
                    aria-label="Apagar este template"
                    className={
                      'flex h-8 w-8 items-center justify-center rounded-[10px] bg-bg-soft text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-red-400' +
                      T3D
                    }
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
            {t.hint ? (
              <p className="mb-2.5 text-[11.5px] text-text-muted">{t.hint}</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {t.segments.slice(0, 2).map((s, i) => (
                <div key={i} className="min-w-0">
                  <span className="field-label mb-1 block text-[11px] text-text-muted">
                    {s.label}
                  </span>
                  <SegPreview
                    style={s.style}
                    words={s.kind === 'hook' ? ['Seu', 'hook', 'aqui'] : ['E', 'o', 'body', 'aqui']}
                    fallbackPresetId={fallbackPresetId}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="roteiro-seg flex flex-wrap items-end gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <label className="field-label mb-1 block text-[11.5px] text-text-muted">
            Salvar os trechos de agora como template
          </label>
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder={`Template ${templates.length + 1}`}
            className="roteiro-field w-full rounded-[10px] px-3 py-2 text-[12.5px] text-text outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onSave}
          className={
            'rounded-[10px] bg-bg-soft px-4 py-2 text-[12.5px] font-bold text-text shadow-[inset_0_0_0_1px_rgb(var(--line-strong))] hover:roteiro-accent' +
            T3D
          }
        >
          Salvar template
        </button>
        <p className="w-full text-[11px] text-text-muted">
          Guarda so os estilos dos {segments.length} trecho
          {segments.length === 1 ? '' : 's'} de agora (a copy colada nao vai
          junto) e fica salvo na sua conta.
        </p>
      </div>
    </div>
  );
}
