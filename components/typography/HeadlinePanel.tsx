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
 *
 * 07.10: o painel MINIMIZA (pedido do Silas: "clico pra colocar headline, fica
 * na tela e não tem botão de minimizar"). Minimizado sobra só o cabeçalho e as
 * abas; a escolha fica no localStorage do navegador. Os controles foram
 * agrupados em seções (texto, modelo, tamanho e posição, estilo, animação) e o
 * TEMPO + excluir desceram pra baixo da prévia, que antes deixava a coluna da
 * direita vazia. Nenhum controle saiu, nenhum comportamento mudou.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { TYPO_FONTS, type FontKey } from '@/lib/typography/fonts';
import { formatTime } from '@/lib/utils';

/** Amostra desenhada quando a headline ainda não tem texto. */
const TEXTO_AMOSTRA = 'Texto escrito aqui da headline';

/** Aberto/minimizado sobrevive ao F5 (conveniência do navegador, não do projeto). */
const ABERTO_KEY = 'tipografia:headlines-aberto';

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
  return <canvas ref={ref} width={220} height={116} className="hlp-thumb" />;
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
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="hlp-campo">{label}</span>
        <span className="hlp-valor">{display(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onPointerDown={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fx-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:opacity-40"
        style={{
          background: `linear-gradient(90deg, rgb(var(--cyan)) ${pct}%, var(--range-rest) ${pct}%)`,
        }}
      />
    </div>
  );
}

/** Bloco com título em frase: separa o painel em partes que se leem num relance. */
function Secao({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <div className="hlp-secao">
      <div className="hlp-rotulo">
        <span>{titulo}</span>
        {nota ? <span className="hlp-rotulo-nota">{nota}</span> : null}
      </div>
      {children}
    </div>
  );
}

function IconeHeadline() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 10h10M9.5 14h5" />
    </svg>
  );
}

function IconeAlinhar({ lado }: { lado: HeadlineAlign }) {
  const linhas =
    lado === 'left'
      ? ['M4 7h16', 'M4 12h10', 'M4 17h13']
      : lado === 'right'
        ? ['M4 7h16', 'M10 12h10', 'M7 17h13']
        : ['M4 7h16', 'M7 12h10', 'M5.5 17h13'];
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      {linhas.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
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

  // aberto por padrão; o minimizado da última vez volta depois do F5
  const [aberto, setAberto] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(ABERTO_KEY) === '0') setAberto(false);
    } catch {
      /* sem localStorage: fica aberto */
    }
  }, []);
  const trocarAberto = (v: boolean) => {
    setAberto(v);
    try {
      localStorage.setItem(ABERTO_KEY, v ? '1' : '0');
    } catch {
      /* quota/bloqueado: só não lembra */
    }
  };

  const setStyle = (patch: Partial<HeadlineStyle>) => {
    if (!sel) return;
    onPatch(sel.id, { style: { ...sel.style, ...patch } });
  };

  const temHeadline = headlines.length > 0;
  const mostraCorpo = aberto && !!sel;
  const duracaoSeg = sel ? Math.max(0, (sel.end - sel.start) / 1000) : 0;

  return (
    <section className={'hlp' + (mostraCorpo ? ' is-aberto' : '')}>
      {/* ── cabeçalho: sempre visível, aberto ou minimizado ── */}
      <div className="hlp-cab">
        <span className="hlp-tile">
          <IconeHeadline />
        </span>
        <div className="hlp-cab-txt">
          <div className="hlp-titulo">
            Headlines
            {temHeadline ? <span className="hlp-conta">{headlines.length}</span> : null}
          </div>
          <div
            className="hlp-sub"
            title="Arrasta no preview pra posicionar; a faixa azul da timeline diz quando entra e quando sai."
          >
            Texto parado por cima do vídeo
          </div>
        </div>
        <div className="hlp-acoes">
          <button
            type="button"
            onClick={() => {
              onAdd();
              trocarAberto(true);
            }}
            disabled={disabled}
            className="hlp-nova"
          >
            <span className="hlp-nova-mais" aria-hidden>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            Nova headline
          </button>
          {temHeadline ? (
            <button
              type="button"
              onClick={() => trocarAberto(!aberto)}
              className="hlp-min"
              aria-expanded={aberto}
              title={aberto ? 'Minimizar o painel de headlines' : 'Abrir o painel de headlines'}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={'hlp-min-seta' + (aberto ? ' is-aberto' : '')}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
              {aberto ? 'Minimizar' : 'Abrir'}
            </button>
          ) : null}
        </div>
      </div>

      {!temHeadline ? (
        <p className="hlp-vazio">
          Nenhuma headline ainda. Clica em <b>Nova headline</b> pra criar uma no
          ponto onde o vídeo está agora.
        </p>
      ) : (
        <>
          {/* abas: uma por headline (minimizado, clicar numa abre o painel nela) */}
          <div className="hlp-abas">
            {headlines.map((h, i) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onSelect(h.id);
                  onSeek(h.start);
                  if (!aberto) trocarAberto(true);
                }}
                className={'hl-tab' + (sel?.id === h.id ? ' is-on' : '')}
                title={`${formatTime(h.start / 1000)} a ${formatTime(h.end / 1000)}`}
              >
                <span className="mono opacity-70">{i + 1}</span>
                <span className="max-w-[150px] truncate">
                  {h.text.replace(/\s+/g, ' ').trim() || 'sem texto'}
                </span>
              </button>
            ))}
          </div>

          {mostraCorpo && sel ? (
            <div className="hlp-corpo">
              <div className="min-w-0">
                <Secao titulo="Texto" nota="Enter quebra a linha na mão">
                  <textarea
                    value={sel.text}
                    onChange={(e) => onPatch(sel.id, { text: e.target.value })}
                    onFocus={onCommit}
                    rows={3}
                    disabled={disabled}
                    aria-label="Texto da headline"
                    placeholder="A GERAÇÃO DE MULHERES COM LIPEDEMA QUE FAZ DIETA JÁ ESTÁ ENTRE NÓS!"
                    className="hlp-texto"
                  />
                </Secao>

                <Secao titulo="Modelo">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {HEADLINE_PRESETS.map((p) => {
                      const on = sel.style.presetId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            onCommit();
                            setStyle({ presetId: p.id });
                          }}
                          className={'hlp-modelo' + (on ? ' is-on' : '')}
                          aria-pressed={on}
                          title={p.name}
                        >
                          <span className="hlp-modelo-quadro">
                            <ModeloThumb presetId={p.id} />
                          </span>
                          <span className="hlp-modelo-nome">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </Secao>

                <Secao titulo="Tamanho e posição">
                  <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    <div className="hlp-seg" role="group" aria-label="Alinhamento do texto">
                      {(
                        [
                          ['left', 'Esquerda'],
                          ['center', 'Centro'],
                          ['right', 'Direita'],
                        ] as Array<[HeadlineAlign, string]>
                      ).map(([v, label]) => {
                        const on = (sel.style.align ?? preset.align) === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              onCommit();
                              setStyle({ align: v });
                            }}
                            className={'hlp-seg-item' + (on ? ' is-on' : '')}
                            aria-pressed={on}
                          >
                            <IconeAlinhar lado={v} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onCommit();
                        setStyle({ fullBleed: !(sel.style.fullBleed ?? preset.fullBleed) });
                      }}
                      className={'hlp-chip' + ((sel.style.fullBleed ?? preset.fullBleed) ? ' is-on' : '')}
                      aria-pressed={!!(sel.style.fullBleed ?? preset.fullBleed)}
                      title="Painel de borda a borda da tela. Desliga pra soltar a cartela e mover pros lados"
                    >
                      Borda a borda
                    </button>
                  </div>
                </Secao>

                {/* ── TEXTO AVANÇADO (02.09): fonte, B/I/U, caixa, aspas, cores, traço, sombra, brilho ── */}
                <Secao titulo="Estilo do texto">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={sel.style.font ?? preset.font}
                      disabled={disabled}
                      onChange={(e) => {
                        onCommit();
                        setStyle({ font: e.target.value as FontKey });
                      }}
                      className="hlp-select"
                      title="Fonte da headline"
                      aria-label="Fonte da headline"
                    >
                      {Object.entries(TYPO_FONTS).map(([k, f]) => (
                        <option key={k} value={k}>{f.label}</option>
                      ))}
                    </select>
                    <div className="hlp-grupo">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => { onCommit(); setStyle({ bold: !(sel.style.bold ?? false) }); }}
                        className={'hlp-chip is-q is-b' + ((sel.style.bold ?? false) ? ' is-on' : '')}
                        aria-pressed={sel.style.bold ?? false}
                        title="Negrito"
                      >B</button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => { onCommit(); setStyle({ italic: !(sel.style.italic ?? false) }); }}
                        className={'hlp-chip is-q italic' + ((sel.style.italic ?? false) ? ' is-on' : '')}
                        aria-pressed={sel.style.italic ?? false}
                        title="Itálico"
                      >I</button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => { onCommit(); setStyle({ underline: !(sel.style.underline ?? false) }); }}
                        className={'hlp-chip is-q underline' + ((sel.style.underline ?? false) ? ' is-on' : '')}
                        aria-pressed={sel.style.underline ?? false}
                        title="Sublinhado"
                      >S</button>
                    </div>
                    <div className="hlp-grupo">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onCommit();
                          setStyle({ uppercase: !(sel.style.uppercase ?? preset.uppercase) });
                        }}
                        className={'hlp-chip' + ((sel.style.uppercase ?? preset.uppercase) ? ' is-on' : '')}
                        aria-pressed={!!(sel.style.uppercase ?? preset.uppercase)}
                        title="Tudo em caixa alta"
                      >
                        TT
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onCommit();
                          setStyle({ quote: !(sel.style.quote ?? preset.quote) });
                        }}
                        className={'hlp-chip' + ((sel.style.quote ?? preset.quote) ? ' is-on' : '')}
                        aria-pressed={!!(sel.style.quote ?? preset.quote)}
                        title="Aspas decorativas no canto"
                      >
                        Aspas
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="hlp-campo mr-0.5">Cores</span>
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
                    <ColorDot
                      label="Traço"
                      value={sel.style.strokeColor ?? null}
                      fallback="#000000"
                      onPick={(v) => setStyle({ strokeColor: v, stroke: (sel.style.stroke ?? 0) > 0 ? sel.style.stroke : 0.4 })}
                      disabled={disabled}
                    />
                    <ColorDot
                      label="Brilho"
                      value={sel.style.glowColor ?? null}
                      fallback={sel.style.color ?? preset.color}
                      onPick={(v) => setStyle({ glowColor: v, glow: (sel.style.glow ?? 0) > 0 ? sel.style.glow : 0.5 })}
                      disabled={disabled}
                    />
                  </div>

                  <div className="mt-3.5 grid gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Slider
                      label="Traço"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sel.style.stroke ?? 0}
                      display={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'off')}
                      onChange={(v) => setStyle({ stroke: v })}
                      onCommit={onCommit}
                      disabled={disabled}
                    />
                    <Slider
                      label="Sombra"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sel.style.shadowForca ?? preset.shadow}
                      display={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'off')}
                      onChange={(v) => setStyle({ shadowForca: v })}
                      onCommit={onCommit}
                      disabled={disabled}
                    />
                    <Slider
                      label="Brilho"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sel.style.glow ?? 0}
                      display={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'off')}
                      onChange={(v) => setStyle({ glow: v })}
                      onCommit={onCommit}
                      disabled={disabled}
                    />
                  </div>
                </Secao>

                {/* animação de entrada/saída — sóbria, é texto parado */}
                <Secao titulo="Animação">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['animIn', 'Entrada'],
                        ['animOut', 'Saída'],
                      ] as Array<['animIn' | 'animOut', string]>
                    ).map(([campo, rotulo]) => (
                      <div key={campo}>
                        <span className="hlp-campo mb-1.5 block">{rotulo}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {HEADLINE_ANIMS.map((a) => {
                            const on = (sel.style[campo] ?? 'nenhuma') === a.kind;
                            return (
                              <button
                                key={a.kind}
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  onCommit();
                                  setStyle({ [campo]: a.kind } as Partial<HeadlineStyle>);
                                }}
                                className={'hlp-chip' + (on ? ' is-on' : '')}
                                aria-pressed={on}
                              >
                                {a.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </Secao>
              </div>

              {/* coluna da prévia: acompanha a rolagem dos controles */}
              <aside className="hlp-lado">
                <div>
                  <HeadlinePreview headline={sel} />
                  <p className="hlp-nota">
                    Prévia no mesmo motor do vídeo final. A posição real vem do
                    arrasto no preview.
                  </p>
                </div>

                <div className="hlp-tempo">
                  <div className="hlp-rotulo">
                    <span>Quando aparece</span>
                    <span className="hlp-rotulo-nota mono">
                      {duracaoSeg.toFixed(1).replace('.', ',')}s na tela
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onCommit();
                        onPatch(sel.id, {
                          start: Math.max(0, Math.min(Math.round(currentMs), sel.end - 200)),
                        });
                      }}
                      className="hl-time hlp-hora"
                      title="Começar no ponto onde o vídeo está"
                    >
                      {formatTime(sel.start / 1000)}
                    </button>
                    <span className="hlp-campo">até</span>
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
                      className="hl-time hlp-hora"
                      title="Terminar no ponto onde o vídeo está"
                    >
                      {formatTime(sel.end / 1000)}
                    </button>
                  </div>
                  <p className="hlp-nota">
                    Clica num horário pra trocar pelo ponto atual do vídeo, ou
                    arrasta a faixa azul na timeline.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(sel.id)}
                  className="hlp-excluir"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  Excluir headline
                </button>
              </aside>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
