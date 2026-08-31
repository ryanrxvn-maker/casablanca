'use client';

/**
 * EFEITOS DA LEGENDA — quatro cartões (Traço, Sombra, Brilho, Fumaça), cada
 * um com um INTERRUPTOR que liga o efeito mesmo num modelo que não o tem,
 * controles próprios e uma PRÉVIA ao vivo desenhada pelo mesmo engine do
 * export.
 *
 * Antes eram quatro sliders que só multiplicavam o que o modelo trazia — num
 * modelo sem traço, arrastar não fazia nada. A regra dos três estados
 * (`auto` segue o modelo · `on` força com os parâmetros do user · `off`
 * remove) mora em lib/typography/fx.ts; aqui é só a pele.
 *
 * Design da casa: rótulo em `.field-label` (sem eyebrow em caixa alta em cada
 * campo), hairline no lugar de borda cinza, uma escala de raio, curva de
 * mola. CSS em app/globals.css sob `.fx-*`.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ColorDot } from '@/components/typography/ColorDot';
import {
  drawCaptions,
  type Block,
  type StyleState,
  type TypoPreset,
} from '@/lib/typography/engine';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import {
  applyFx,
  fxDefault,
  fxIsOn,
  fxPresence,
  normalizeFx,
  seedFxFromPreset,
  type FxState,
  type GlowFx,
  type GlowKind,
  type ShadowFx,
  type ShadowKind,
  type SmokeFx,
  type SmokeKind,
  type StrokeFx,
} from '@/lib/typography/fx';

type FxKey = keyof FxState;

const KINDS_SHADOW: Array<{ k: ShadowKind; label: string; hint: string }> = [
  { k: 'suave', label: 'Suave', hint: 'Deslocada e borrada, como sombra de verdade' },
  { k: 'dura', label: 'Dura', hint: 'Cópia sólida deslocada, sem desfoque (cartaz)' },
  { k: 'contorno', label: 'Contorno', hint: 'Halo escuro em volta inteira, sem lado — segura a leitura sobre vídeo claro' },
];
const KINDS_GLOW: Array<{ k: GlowKind; label: string; hint: string }> = [
  { k: 'suave', label: 'Suave', hint: 'Brilho curto e discreto colado na letra' },
  { k: 'neon', label: 'Neon', hint: 'Brilho + anéis de contorno, estilo letreiro' },
  { k: 'halo', label: 'Halo', hint: 'Brilho largo e difuso ao redor do bloco' },
  { k: 'pulsante', label: 'Pulsante', hint: 'Neon que respira (anéis pulsando no tempo)' },
];
const KINDS_SMOKE: Array<{ k: SmokeKind; label: string; hint: string }> = [
  { k: 'nevoa', label: 'Névoa', hint: 'Nuvens grandes vagando atrás do texto' },
  { k: 'subindo', label: 'Subindo', hint: 'Colunas nascendo embaixo e subindo' },
  { k: 'rasteira', label: 'Rasteira', hint: 'Névoa baixa e achatada no rodapé do bloco' },
  { k: 'poeira', label: 'Poeira', hint: 'Partículas miúdas em suspensão' },
];

/* ─────────────────────────── prévia de um efeito ──────────────────────── */

/**
 * Desenha "Legenda" com o preset e o FX pedidos. Recebe um `only`: a prévia
 * do cartão do Traço mostra SÓ o traço, a do Brilho só o brilho — é o efeito
 * daquele cartão isolado, sem o resto do modelo confundir o olho.
 */
function FxPreview({
  preset,
  fx,
  only,
  height = 92,
}: {
  preset: TypoPreset;
  fx: FxState;
  only: FxKey;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ preset, fx, only });
  live.current = { preset, fx, only };
  const avisou = useRef(false);

  useEffect(() => {
    void ensureTypoFonts();
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const { preset: p, fx: f, only: o } = live.current;
        // isola o efeito do cartão: os outros três saem de cena
        const iso: FxState = {
          stroke: o === 'stroke' ? f.stroke : { ...f.stroke, mode: 'off' },
          shadow: o === 'shadow' ? f.shadow : { ...f.shadow, mode: 'off' },
          glow: o === 'glow' ? f.glow : { ...f.glow, mode: 'off' },
          smoke: o === 'smoke' ? f.smoke : { ...f.smoke, mode: 'off' },
        };
        // o modelo entra PELADO no que não é o efeito do cartão (o preview
        // fala do efeito, não do lettering) — só a fonte/cor continuam
        const base: TypoPreset = {
          ...p,
          extrude: undefined,
          chroma: undefined,
          shine: undefined,
          glitchBands: false,
          patternFill: undefined,
          echoes: undefined,
          sticky: undefined,
          box: undefined,
          frameLines: undefined,
          swoosh: undefined,
          mix: undefined,
          autoEmphasis: false,
          in: { kind: 'none', dur: 0 },
          out: { kind: 'none', dur: 0 },
          loop: undefined,
        };
        const eff = applyFx(base, iso);
        const bloco: Block = {
          id: 'fxdemo',
          words: [{ text: 'Legenda', start: 0, end: 4000 }],
          start: 0,
          end: 5000,
        };
        const st: StyleState = {
          presetId: eff.id,
          fontScale: 1,
          posY: 0.52,
          posX: 0.5,
          primary: null,
          accent: null,
          uppercase: null,
          highlights: {},
          autoEmphasis: false,
        };
        // ⚠ o tempo do loop NUNCA pode passar do fim do bloco: o engine
        // desenha o bloco cuja janela contém o instante, e fora dela o
        // cartão piscaria em branco (e ficaria em branco de vez se a aba
        // perdesse o foco justo nesse frame — o rAF congela escondido).
        const t = 1200 + ((performance.now() - t0) % 2400);
        ctx.clearRect(0, 0, c.width, c.height);
        try {
          drawCaptions(ctx, [bloco], eff, st, t, c.width, c.height);
        } catch (e) {
          // um frame ruim não pode matar o loop pra sempre
          if (!avisou.current) {
            avisou.current = true;
            console.error('[fx-preview] frame falhou', o, e);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      width={420}
      height={Math.round((420 * height) / 240)}
      className="fx-canvas block w-full"
      style={{ aspectRatio: `240 / ${height}` }}
    />
  );
}

/* ──────────────────────────── peças de controle ───────────────────────── */

function FxSlider({
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
        onKeyDown={onCommit}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fx-range h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:opacity-40"
        style={{
          background: `linear-gradient(90deg, rgb(var(--amber)) ${pct}%, rgb(var(--line-strong)) ${pct}%)`,
        }}
      />
    </div>
  );
}

function KindChips<K extends string>({
  value,
  options,
  onPick,
  disabled,
}: {
  value: K;
  options: Array<{ k: K; label: string; hint: string }>;
  onPick: (k: K) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.k}
          type="button"
          title={o.hint}
          disabled={disabled}
          onClick={() => onPick(o.k)}
          className={'fx-chip' + (value === o.k ? ' is-on' : '')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Interruptor físico (o "botão que adiciona" o efeito). */
function FxSwitch({
  on,
  onChange,
  disabled,
  title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={'fx-switch' + (on ? ' is-on' : '')}
    >
      <span className="fx-switch-knob" />
    </button>
  );
}

/* ───────────────────────────── cartão de efeito ───────────────────────── */

function FxCard({
  title,
  icon,
  fxKey,
  fx,
  preset,
  presetHas,
  multiplier,
  onFx,
  onMultiplier,
  onCommit,
  disabled,
  children,
}: {
  title: string;
  icon: ReactNode;
  fxKey: FxKey;
  fx: FxState;
  preset: TypoPreset;
  presetHas: boolean;
  multiplier: number;
  onFx: (patch: Partial<FxState>) => void;
  onMultiplier: (v: number) => void;
  onCommit: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const entry = fx[fxKey];
  const mode = entry.mode;
  const ligado = fxIsOn(mode, presetHas);

  const alternar = (v: boolean) => {
    onCommit();
    if (!v) {
      onFx({ [fxKey]: { ...entry, mode: 'off' } } as Partial<FxState>);
      return;
    }
    // ligar: se o modelo já tem, basta voltar pro automático (o visual dele
    // continua igual); se não tem, entra com a semente pra APARECER na hora
    if (presetHas && mode === 'off') {
      onFx({ [fxKey]: { ...entry, mode: 'auto' } } as Partial<FxState>);
      return;
    }
    onFx({ [fxKey]: seedFxFromPreset(preset, fxKey) } as Partial<FxState>);
  };

  const personalizar = () => {
    onCommit();
    onFx({ [fxKey]: seedFxFromPreset(preset, fxKey) } as Partial<FxState>);
  };
  const voltarAoModelo = () => {
    onCommit();
    onFx({ [fxKey]: { ...fxDefault()[fxKey], mode: 'auto' } } as Partial<FxState>);
  };

  return (
    <div className={'fx-card' + (ligado ? ' is-on' : '')}>
      <div className="flex items-center gap-2.5 px-3 pt-2.5">
        <span className={'fx-icon' + (ligado ? ' is-on' : '')}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold tracking-tight text-text" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </span>
          <span className="mono block text-[9.5px] uppercase tracking-wider text-text-muted">
            {mode === 'auto' ? (presetHas ? 'do modelo' : 'o modelo não tem') : mode === 'on' ? 'personalizado' : 'desligado'}
          </span>
        </span>
        <FxSwitch
          on={ligado}
          disabled={disabled}
          onChange={alternar}
          title={ligado ? `Tirar ${title.toLowerCase()} desta legenda` : `Adicionar ${title.toLowerCase()} nesta legenda`}
        />
      </div>

      <div className="mt-2 px-3">
        <FxPreview preset={preset} fx={fx} only={fxKey} />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        {!ligado ? (
          <p className="text-[11px] leading-relaxed text-text-muted">
            Liga o interruptor pra {title.toLowerCase()} aparecer nesta legenda,
            mesmo que o modelo não traga.
          </p>
        ) : mode === 'auto' ? (
          <div className="flex flex-col gap-2.5">
            <FxSlider
              label="Intensidade"
              min={0}
              max={2}
              step={0.05}
              value={multiplier}
              display={(v) => `${Math.round(v * 100)}%`}
              onChange={onMultiplier}
              onCommit={onCommit}
              disabled={disabled}
            />
            <button type="button" className="fx-link self-start" onClick={personalizar} disabled={disabled}>
              Ajustar tudo
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {children}
            <button type="button" className="fx-link self-start" onClick={voltarAoModelo} disabled={disabled}>
              Voltar ao modelo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────── o painel todo ─────────────────────────── */

export function FxPanel({
  preset,
  fx: fxIn,
  onFx,
  fxStroke,
  fxShadow,
  fxGlow,
  fxSmoke,
  onMultiplier,
  onCommit,
  defaultPrimary,
  disabled,
}: {
  /** modelo EFETIVO do que está sendo editado (global ou bloco travado) */
  preset: TypoPreset;
  fx: FxState;
  onFx: (patch: Partial<FxState>) => void;
  fxStroke: number;
  fxShadow: number;
  fxGlow: number;
  fxSmoke: number;
  onMultiplier: (patch: { fxStroke?: number; fxShadow?: number; fxGlow?: number; fxSmoke?: number }) => void;
  /** grava um passo no histórico antes de mexer (Ctrl+Z) */
  onCommit: () => void;
  defaultPrimary: string;
  disabled?: boolean;
}) {
  const fx = useMemo(() => normalizeFx(fxIn), [fxIn]);
  const has = useMemo(() => fxPresence(preset), [preset]);
  const set = <K extends FxKey>(k: K, patch: Partial<FxState[K]>) =>
    onFx({ [k]: { ...fx[k], ...patch } } as Partial<FxState>);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FxCard
        title="Traço"
        icon={<IconStroke />}
        fxKey="stroke"
        fx={fx}
        preset={preset}
        presetHas={has.stroke}
        multiplier={fxStroke}
        onFx={onFx}
        onMultiplier={(v) => onMultiplier({ fxStroke: v })}
        onCommit={onCommit}
        disabled={disabled}
      >
        <FxSlider
          label="Espessura"
          min={0.005}
          max={0.16}
          step={0.005}
          value={(fx.stroke as StrokeFx).width}
          display={(v) => `${Math.round((v / 0.16) * 100)}%`}
          onChange={(v) => set('stroke', { width: v })}
          onCommit={onCommit}
          disabled={disabled}
        />
        <div className="flex items-center gap-2">
          <ColorDot
            label="Cor do traço"
            value={(fx.stroke as StrokeFx).color}
            fallback="#000000"
            onPick={(v) => set('stroke', { color: v ?? '#000000' })}
            disabled={disabled}
          />
        </div>
      </FxCard>

      <FxCard
        title="Sombra"
        icon={<IconShadow />}
        fxKey="shadow"
        fx={fx}
        preset={preset}
        presetHas={has.shadow}
        multiplier={fxShadow}
        onFx={onFx}
        onMultiplier={(v) => onMultiplier({ fxShadow: v })}
        onCommit={onCommit}
        disabled={disabled}
      >
        <KindChips
          value={(fx.shadow as ShadowFx).kind}
          options={KINDS_SHADOW}
          onPick={(k) => {
            onCommit();
            set('shadow', { kind: k });
          }}
          disabled={disabled}
        />
        <div className="flex items-center gap-2">
          <ColorDot
            label="Cor"
            value={(fx.shadow as ShadowFx).color}
            fallback="#000000"
            onPick={(v) => set('shadow', { color: v ?? '#000000' })}
            disabled={disabled}
          />
        </div>
        <FxSlider
          label="Opacidade"
          min={0.05}
          max={1}
          step={0.05}
          value={(fx.shadow as ShadowFx).opacity}
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('shadow', { opacity: v })}
          onCommit={onCommit}
          disabled={disabled}
        />
        {(fx.shadow as ShadowFx).kind !== 'dura' ? (
          <FxSlider
            label="Desfoque"
            min={0}
            max={0.5}
            step={0.01}
            value={(fx.shadow as ShadowFx).blur}
            display={(v) => `${Math.round((v / 0.5) * 100)}%`}
            onChange={(v) => set('shadow', { blur: v })}
            onCommit={onCommit}
            disabled={disabled}
          />
        ) : null}
        {(fx.shadow as ShadowFx).kind !== 'contorno' ? (
          <>
            <FxSlider
              label="Distância"
              min={0}
              max={0.3}
              step={0.005}
              value={(fx.shadow as ShadowFx).dist}
              display={(v) => `${Math.round((v / 0.3) * 100)}%`}
              onChange={(v) => set('shadow', { dist: v })}
              onCommit={onCommit}
              disabled={disabled}
            />
            <FxSlider
              label="Ângulo"
              min={0}
              max={360}
              step={5}
              value={(fx.shadow as ShadowFx).angle}
              display={(v) => `${Math.round(v)}°`}
              onChange={(v) => set('shadow', { angle: v })}
              onCommit={onCommit}
              disabled={disabled}
            />
          </>
        ) : null}
      </FxCard>

      <FxCard
        title="Brilho"
        icon={<IconGlow />}
        fxKey="glow"
        fx={fx}
        preset={preset}
        presetHas={has.glow}
        multiplier={fxGlow}
        onFx={onFx}
        onMultiplier={(v) => onMultiplier({ fxGlow: v })}
        onCommit={onCommit}
        disabled={disabled}
      >
        <KindChips
          value={(fx.glow as GlowFx).kind}
          options={KINDS_GLOW}
          onPick={(k) => {
            onCommit();
            set('glow', { kind: k });
          }}
          disabled={disabled}
        />
        <div className="flex items-center gap-2">
          <ColorDot
            label="Cor do brilho"
            value={(fx.glow as GlowFx).color}
            fallback={defaultPrimary}
            onPick={(v) => set('glow', { color: v })}
            disabled={disabled}
          />
        </div>
        <FxSlider
          label="Alcance"
          min={0.04}
          max={0.6}
          step={0.01}
          value={(fx.glow as GlowFx).blur}
          display={(v) => `${Math.round((v / 0.6) * 100)}%`}
          onChange={(v) => set('glow', { blur: v })}
          onCommit={onCommit}
          disabled={disabled}
        />
      </FxCard>

      <FxCard
        title="Fumaça"
        icon={<IconSmoke />}
        fxKey="smoke"
        fx={fx}
        preset={preset}
        presetHas={has.smoke}
        multiplier={fxSmoke}
        onFx={onFx}
        onMultiplier={(v) => onMultiplier({ fxSmoke: v })}
        onCommit={onCommit}
        disabled={disabled}
      >
        <KindChips
          value={(fx.smoke as SmokeFx).kind}
          options={KINDS_SMOKE}
          onPick={(k) => {
            onCommit();
            set('smoke', { kind: k });
          }}
          disabled={disabled}
        />
        <FxSlider
          label="Densidade"
          min={0.05}
          max={1}
          step={0.05}
          value={(fx.smoke as SmokeFx).alpha}
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('smoke', { alpha: v })}
          onCommit={onCommit}
          disabled={disabled}
        />
      </FxCard>
    </div>
  );
}

/* ─────────────────────────────── iconezinhos ──────────────────────────── */

function IconStroke() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 18V7.5h4.2a3.3 3.3 0 0 1 0 6.6H6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconShadow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" fill="currentColor" opacity="0.32" />
      <rect x="4.5" y="4.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function IconGlow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.75">
        <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6" />
        <path d="M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9" />
      </g>
    </svg>
  );
}
function IconSmoke() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 16.5a3.5 3.5 0 0 1 .4-7 4.6 4.6 0 0 1 8.8-1.1 3.6 3.6 0 0 1 1.6 7.1z"
        fill="currentColor"
        opacity="0.4"
      />
      <path d="M6 20h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
