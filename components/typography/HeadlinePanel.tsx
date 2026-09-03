'use client';

/**
 * HEADLINES — o painel que cria e edita o texto PARADO.
 *
 * Irmão da legenda, mas independente: a legenda nasce da transcrição e é
 * cronometrada palavra por palavra; a headline é escrita na mão, posicionada
 * onde o user quiser e dura o pedaço que ele marcar na faixa própria da
 * timeline. Uma não sabe da outra.
 *
 * Cada headline tem uma PRÉVIA ao vivo desenhada pelo mesmo `drawHeadline` do
 * preview e do export — o que aparece aqui é o que sai no MP4.
 */

import { useEffect, useMemo, useRef } from 'react';
import { ColorDot } from '@/components/typography/ColorDot';
import { registerCanvasJob } from '@/lib/typography/canvas-loop';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import {
  drawHeadline,
  getHeadlinePreset,
  HEADLINE_ANIMS,
  HEADLINE_PRESETS,
  HEADLINE_STYLE_DEFAULT,
  type Headline,
  type HeadlineAlign,
  type HeadlineStyle,
} from '@/lib/typography/headline';
import { formatTime } from '@/lib/utils';

const T3D =
  ' shadow-[0_2px_0_rgba(0,0,0,0.16),0_6px_12px_-6px_rgba(0,0,0,0.25)] hover:-translate-y-[1.5px] hover:shadow-[0_3.5px_0_rgba(0,0,0,0.16),0_10px_18px_-8px_rgba(0,0,0,0.3)] active:translate-y-[1px] active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.28)] transition-all duration-150 will-change-transform';

/** Amostra desenhada quando a headline ainda não tem texto. */
const TEXTO_AMOSTRA = 'Texto escrito aqui da headline';

/* ───────────────────────────── prévia ao vivo ─────────────────────────── */

/**
 * Miniatura de UM modelo, desenhada pelo motor real — escolher modelo lendo
 * nome ("Rasgado"?) obrigava a testar um por um. Estática: desenha uma vez
 * quando as fontes chegam.
 */
function ModeloThumb({ presetId }: { presetId: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let vivo = true;
    void ensureTypoFonts().then(() => {
      if (!vivo) return;
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      try {
        drawHeadline(
          ctx,
          {
            id: 'thumb-' + presetId,
            text: 'Sua headline aqui',
            start: 0,
            end: 1,
            style: {
              ...HEADLINE_STYLE_DEFAULT,
              presetId,
              posX: 0.5,
              posY: 0.5,
              width: 0.94,
              fontScale: 2.1,
            },
          },
          c.width,
          c.height,
        );
      } catch {
        /* thumb quebrada não derruba o painel */
      }
    });
    return () => {
      vivo = false;
    };
  }, [presetId]);
  return (
    <canvas
      ref={ref}
      width={220}
      height={116}
      className="block h-[58px] w-full rounded-[8px]"
    />
  );
}

function HeadlinePreview({ headline }: { headline: Headline }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(headline);
  live.current = headline;

  useEffect(() => {
    void ensureTypoFonts();
    const tick = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const h = live.current;
      // a prévia mostra a headline no MEIO do quadrinho, no tamanho relativo
      // certo — quem manda na posição real é o arrasto no preview do vídeo.
      // Sem texto ainda, entra a AMOSTRA: prévia vazia não mostra o modelo.
      const texto = h.text.trim() ? h.text : TEXTO_AMOSTRA;
      try {
        drawHeadline(
          ctx,
          { ...h, text: texto, style: { ...h.style, posX: 0.5, posY: 0.5 } },
          c.width,
          c.height,
        );
      } catch {
        /* um frame ruim não pode derrubar o relógio compartilhado */
      }
    };
    return registerCanvasJob(tick, { fps: 12, el: ref.current });
  }, []);

  return (
    <canvas
      ref={ref}
      width={360}
      height={202}
      className="hl-canvas block w-full"
      style={{ aspectRatio: '360 / 202' }}
    />
  );
}

/* ──────────────────────────────── controles ───────────────────────────── */

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: () => void;
  disabled?: boolean;
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
        disabled={disabled}
        onPointerDown={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fx-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:opacity-40"
        style={{
          background: `linear-gradient(90deg, rgb(var(--cyan)) ${pct}%, rgb(var(--line-strong)) ${pct}%)`,
        }}
      />
    </div>
  );
}

/* ──────────────────────────────── o painel ────────────────────────────── */

export function HeadlinePanel({
  headlines,
  selId,
  onSelect,
  onAdd,
  onRemove,
  onPatch,
  onCommit,
  onSeek,
  currentMs,
  durationMs,
  disabled,
}: {
  headlines: Headline[];
  selId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<Headline>) => void;
  onCommit: () => void;
  onSeek: (ms: number) => void;
  currentMs: number;
  durationMs: number;
  disabled?: boolean;
}) {
  const sel = useMemo(
    () => headlines.find((h) => h.id === selId) ?? headlines[0] ?? null,
    [headlines, selId],
  );
  const preset = sel ? getHeadlinePreset(sel.style.presetId) : HEADLINE_PRESETS[0];

  const setStyle = (patch: Partial<HeadlineStyle>) => {
    if (!sel) return;
    onPatch(sel.id, { style: { ...sel.style, ...patch } });
  };

  return (
    <div className="mt-5 rounded-[16px] bg-bg-soft/40 p-4 shadow-[inset_0_0_0_1px_rgb(var(--line))]">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <span className="hl-badge">Headlines</span>
        <span
          className="min-w-0 flex-1 truncate text-[11.5px] text-text-muted"
          title="Arrasta no preview pra posicionar; a faixa azul da timeline diz quando entra e quando sai."
        >
          Texto parado por cima do vídeo
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className={
            'shrink-0 rounded-[10px] px-3.5 py-2 text-[12px] font-bold text-cyan-500 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.55)] disabled:opacity-40' +
            T3D
          }
          style={{ background: 'rgba(34,211,238,0.12)' }}
        >
          + Nova headline
        </button>
      </div>

      {headlines.length === 0 ? (
        <p className="text-[12px] text-text-muted">
          Nenhuma headline ainda. Clica em <b>Nova headline</b> pra criar uma no
          ponto onde o vídeo está agora.
        </p>
      ) : (
        <>
          {/* abas: uma por headline */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {headlines.map((h, i) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onSelect(h.id);
                  onSeek(h.start);
                }}
                className={'hl-tab' + (sel?.id === h.id ? ' is-on' : '')}
                title={`${formatTime(h.start / 1000)} a ${formatTime(h.end / 1000)}`}
              >
                <span className="mono opacity-70">{i + 1}</span>
                <span className="max-w-[130px] truncate">
                  {h.text.replace(/\s+/g, ' ').trim() || 'sem texto'}
                </span>
              </button>
            ))}
          </div>

          {sel ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0">
                <label className="field-label mb-1 block text-[11.5px] text-text-muted">
                  Texto (Enter quebra a linha na mão)
                </label>
                <textarea
                  value={sel.text}
                  onChange={(e) => onPatch(sel.id, { text: e.target.value })}
                  onFocus={onCommit}
                  rows={3}
                  disabled={disabled}
                  placeholder="A GERAÇÃO DE MULHERES COM LIPEDEMA QUE FAZ DIETA JÁ ESTÁ ENTRE NÓS!"
                  className="roteiro-field w-full resize-y rounded-[12px] px-3 py-2.5 text-[13px] leading-relaxed text-text outline-none"
                />

                <div className="mt-3">
                  <span className="field-label mb-1.5 block text-[11.5px] text-text-muted">
                    Modelo
                  </span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {HEADLINE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onCommit();
                          setStyle({ presetId: p.id });
                        }}
                        className={
                          'group flex flex-col items-center gap-1 rounded-[12px] p-1.5 pb-1 transition-all ' +
                          (sel.style.presetId === p.id
                            ? 'bg-cyan-400/[0.09] shadow-[inset_0_0_0_1.5px_rgba(34,211,238,0.7)]'
                            : 'bg-black/25 shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.4)]')
                        }
                        title={p.name}
                      >
                        <span className="w-full overflow-hidden rounded-[8px] bg-[linear-gradient(135deg,#23272e,#141619)]">
                          <ModeloThumb presetId={p.id} />
                        </span>
                        <span
                          className={
                            'text-[10.5px] font-bold ' +
                            (sel.style.presetId === p.id ? 'text-cyan-500' : 'text-text-muted group-hover:text-text')
                          }
                        >
                          {p.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Slider
                    label="Tamanho"
                    min={0.4}
                    max={2.4}
                    step={0.05}
                    value={sel.style.fontScale}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setStyle({ fontScale: v })}
                    onCommit={onCommit}
                    disabled={disabled}
                  />
                  <Slider
                    label="Largura da caixa"
                    min={0.25}
                    max={0.98}
                    step={0.01}
                    value={sel.style.width}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setStyle({ width: v })}
                    onCommit={onCommit}
                    disabled={disabled}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(
                    [
                      ['left', 'Esquerda'],
                      ['center', 'Centro'],
                      ['right', 'Direita'],
                    ] as Array<[HeadlineAlign, string]>
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onCommit();
                        setStyle({ align: v });
                      }}
                      className={'fx-chip' + ((sel.style.align ?? preset.align) === v ? ' is-on' : '')}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="h-6 w-px bg-line" />
                  <ColorDot
                    label="Texto"
                    value={sel.style.color}
                    fallback={preset.color}
                    onPick={(v) => setStyle({ color: v })}
                    disabled={disabled}
                  />
                  <ColorDot
                    label="Painel"
                    value={sel.style.panelColor}
                    fallback={preset.panelColor}
                    onPick={(v) => setStyle({ panelColor: v })}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onCommit();
                      setStyle({ quote: !(sel.style.quote ?? preset.quote) });
                    }}
                    className={'fx-chip' + ((sel.style.quote ?? preset.quote) ? ' is-on' : '')}
                    title="Aspas decorativas no canto"
                  >
                    Aspas
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onCommit();
                      setStyle({ uppercase: !(sel.style.uppercase ?? preset.uppercase) });
                    }}
                    className={'fx-chip' + ((sel.style.uppercase ?? preset.uppercase) ? ' is-on' : '')}
                    title="Tudo em caixa alta"
                  >
                    TT
                  </button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Slider
                    label="Rotação"
                    min={-180}
                    max={180}
                    step={1}
                    value={sel.style.rotation ?? 0}
                    display={(v) => `${Math.round(v)}°`}
                    onChange={(v) => setStyle({ rotation: v })}
                    onCommit={onCommit}
                    disabled={disabled}
                  />
                  <Slider
                    label="Opacidade do painel"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sel.style.panelOpacity ?? preset.panelOpacity}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setStyle({ panelOpacity: v })}
                    onCommit={onCommit}
                    disabled={disabled}
                  />
                </div>

                {/* animação de entrada/saída — sóbria, é texto parado */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['animIn', 'Entrada'],
                      ['animOut', 'Saída'],
                    ] as Array<['animIn' | 'animOut', string]>
                  ).map(([campo, rotulo]) => (
                    <div key={campo}>
                      <span className="field-label mb-1.5 block text-[11.5px] text-text-muted">
                        {rotulo}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {HEADLINE_ANIMS.map((a) => (
                          <button
                            key={a.kind}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              onCommit();
                              setStyle({ [campo]: a.kind } as Partial<HeadlineStyle>);
                            }}
                            className={
                              'fx-chip' +
                              ((sel.style[campo] ?? 'nenhuma') === a.kind ? ' is-on' : '')
                            }
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* tempo */}
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <span className="field-label text-[11.5px] text-text-muted">Aparece de</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onCommit();
                      onPatch(sel.id, {
                        start: Math.max(0, Math.min(Math.round(currentMs), sel.end - 200)),
                      });
                    }}
                    className={'hl-time' + T3D}
                    title="Começar no ponto onde o vídeo está"
                  >
                    {formatTime(sel.start / 1000)}
                  </button>
                  <span className="field-label text-[11.5px] text-text-muted">até</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onCommit();
                      onPatch(sel.id, {
                        end: Math.min(
                          Math.max(Math.round(currentMs), sel.start + 200),
                          Math.max(durationMs, sel.start + 200),
                        ),
                      });
                    }}
                    className={'hl-time' + T3D}
                    title="Terminar no ponto onde o vídeo está"
                  >
                    {formatTime(sel.end / 1000)}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(sel.id)}
                    className={
                      'ml-auto rounded-[10px] bg-bg-soft px-3 py-1.5 text-[11.5px] font-semibold text-text-muted shadow-[inset_0_0_0_1px_rgb(var(--line))] hover:text-red-400' +
                      T3D
                    }
                  >
                    Excluir headline
                  </button>
                </div>
              </div>

              <div className="min-w-0">
                <HeadlinePreview headline={sel} />
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-muted">
                  Prévia no mesmo motor do vídeo final. A posição real vem do
                  arrasto no preview.
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
