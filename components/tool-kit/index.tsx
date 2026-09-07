'use client';

/**
 * tool-kit — primitives visuais reutilizáveis pra ferramentas.
 *
 * Filosofia: cada ferramenta é um fluxo de PASSOS visuais. Texto mínimo,
 * ícones grandes, animações sutis, microinterações no hover. Estética
 * HeyGen-like — cards com gradient sutil, headings com identidade,
 * actions com sheen.
 *
 * Use estes primitives PRA REORGANIZAR a UI das ferramentas SEM mexer
 * em lógica/estado. Cada componente é puramente visual.
 */

import Link from 'next/link';
import { ReactNode, useRef, type CSSProperties } from 'react';

/* ─────────────────── ToolHero ─────────────────── */
/**
 * Header da ferramenta — eyebrow + título + sub + ícone em tile 3D.
 * Cantos "tech" + hairline de gradiente na base + sheen que varre 1x.
 */
export function ToolHero({ title, subtitle, eyebrow, hue, icon }: { title: string; subtitle?: string; eyebrow?: string; hue?: string; icon?: ReactNode }) {
  return <header className="ae-tool-hero" style={{ '--tool-hue': hue ?? 'rgba(167,139,250,.45)' } as CSSProperties}>
    <Link href="/tools" className="ae-tool-back">← Todas as ferramentas</Link>
    {icon && <div className="ae-tool-hero-icon">{icon}</div>}
    <div className="ae-tool-hero-copy">{eyebrow && <p className="ae-tool-eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>
    {subtitle && <p className="ae-tool-subtitle">{subtitle}</p>}
  </header>;
}

export function ToolStep({ n, title, hint, hue, icon, action, still, children }: { n?: number | string; title: string; hint?: string; hue?: string; icon?: ReactNode; action?: ReactNode; still?: boolean; children: ReactNode }) {
  return <section className={'ae-tool-step' + (still ? ' ae-tool-step-still' : '')} style={{ '--tool-hue': hue ?? 'rgba(167,139,250,.45)' } as CSSProperties}>
    <div className="ae-tool-step-heading">
      {n != null && <span className="ae-tool-step-number" aria-label={'Etapa ' + n}>{String(n).padStart(2, '0')}</span>}
      {icon && <span className="ae-tool-step-icon">{icon}</span>}
      <div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
      {action && <div className="ae-tool-step-action">{action}</div>}
    </div>
    {children}
  </section>;
}

/* ─────────────────── ToolDropzone ─────────────────── */
/**
 * Área de upload visual. Drag-and-drop + click. Estado vazio com moldura
 * tech + anel pulsante; arquivo carregado ganha selo de ok.
 */
export function ToolDropzone({
  accept,
  file,
  onFile,
  hint,
  hue = 'rgba(167,139,250,0.45)',
  disabled,
  icon,
  multiple,
  onFiles,
}: {
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  hint?: string;
  hue?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** Quando true, aceita múltiplos arquivos e chama onFiles. Retrocompatível:
   *  sem multiple, comportamento single-file inalterado. */
  multiple?: boolean;
  onFiles?: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className={
        'tool-dropzone group relative overflow-hidden rounded-[16px] border-2 border-dashed transition-all duration-300 ' +
        (file
          ? 'border-violet/50 bg-violet/5'
          : 'border-line-strong bg-bg/40 hover:border-violet/45 hover:bg-violet/[0.03]')
      }
      role={file ? "group" : "button"} tabIndex={disabled || file ? -1 : 0} aria-disabled={disabled} aria-label={file ? 'Trocar arquivo: ' + file.name : 'Selecionar arquivo'} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!disabled) inputRef.current?.click(); } }}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (disabled) return;
        e.currentTarget.classList.add('drag-active');
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove('drag-active');
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (disabled) return;
        e.currentTarget.classList.remove('drag-active');
        if (multiple && onFiles) {
          const fs = Array.from(e.dataTransfer.files || []);
          if (fs.length) onFiles(fs);
          return;
        }
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (multiple && onFiles) {
            const fs = Array.from(e.target.files || []);
            if (fs.length) onFiles(fs);
            e.target.value = ''; // permite re-selecionar os mesmos
            return;
          }
          const selected = e.target.files?.[0];
          if (selected) onFile(selected);
          e.target.value = '';
        }}
      />

      {/* Glow no hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-60"
        style={{
          background: `radial-gradient(60% 80% at 50% 50%, ${hue}, transparent 70%)`,
        }}
      />

      {!file ? (
        <div className="relative flex flex-col items-center justify-center gap-3.5 px-6 py-12 text-center">
          {/* Cantos tech da área de drop */}
          <span aria-hidden className="dz-corner dz-corner--tl" />
          <span aria-hidden className="dz-corner dz-corner--tr" />
          <span aria-hidden className="dz-corner dz-corner--bl" />
          <span aria-hidden className="dz-corner dz-corner--br" />

          <div className="relative">
            <span
              aria-hidden
              className="dz-ring absolute inset-0 -m-2 rounded-[20px]"
              style={{ border: `1.5px solid ${hue}` }}
            />
            {icon ? (
              <div
                className="dropzone-icon relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-black/40"
                style={{
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 24px -6px ${hue}`,
                }}
              >
                {icon}
              </div>
            ) : (
              <DefaultUploadIcon />
            )}
          </div>
          <div>
            <div
              className="text-[13.5px] font-bold uppercase tracking-[0.16em] text-text"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {multiple ? 'Selecione ou arraste seus arquivos' : 'Selecione ou arraste um arquivo'}
            </div>
            {hint ? (
              <p className="mt-1 text-[12px] text-text-muted">{hint}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="relative flex items-center gap-3 px-5 py-4">
          <span
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-violet/45 bg-violet/10"
            style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px -4px ${hue}` }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            {/* Selo ok */}
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full"
              style={{
                height: 18,
                width: 18,
                background: 'linear-gradient(150deg, #d3e39a, #aab868)',
                boxShadow: '0 0 0 2px rgba(10,10,12,0.8), 0 3px 8px -2px rgba(170,190,90,0.7)',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="#141408" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-text">
              {file.name}
            </div>
            <div className="mono text-[11px] text-text-muted">
              {(file.size / (1024 * 1024)).toFixed(2)} MB
            </div>
          </div>
          <button type="button" className="ae-upload-change" disabled={disabled} onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Trocar arquivo</button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            disabled={disabled}
            className="shrink-0 rounded-full border border-red-500/40 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/10 active:scale-[0.95]"
          >
            Remover
          </button>
        </div>
      )}

      <style jsx>{`
        .tool-dropzone.drag-active {
          border-color: rgba(167, 139, 250, 0.65) !important;
          background: rgba(167, 139, 250, 0.08) !important;
          box-shadow: 0 0 32px -8px rgba(167, 139, 250, 0.6);
        }
        .dropzone-icon {
          transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .tool-dropzone:hover .dropzone-icon {
          transform: scale(1.08) rotate(-6deg);
        }
        .dz-ring {
          opacity: 0;
          animation: dz-pulse 2.6s ease-out infinite;
        }
        @keyframes dz-pulse {
          0% { opacity: 0.55; transform: scale(0.92); }
          70%, 100% { opacity: 0; transform: scale(1.25); }
        }
        .dz-corner {
          position: absolute;
          width: 14px;
          height: 14px;
          border-color: rgba(167, 139, 250, 0.4);
          border-style: solid;
          border-width: 0;
          transition: border-color 0.3s ease;
        }
        .tool-dropzone:hover .dz-corner {
          border-color: rgba(196, 181, 253, 0.75);
        }
        .dz-corner--tl { top: 10px; left: 10px; border-top-width: 2px; border-left-width: 2px; border-top-left-radius: 6px; }
        .dz-corner--tr { top: 10px; right: 10px; border-top-width: 2px; border-right-width: 2px; border-top-right-radius: 6px; }
        .dz-corner--bl { bottom: 10px; left: 10px; border-bottom-width: 2px; border-left-width: 2px; border-bottom-left-radius: 6px; }
        .dz-corner--br { bottom: 10px; right: 10px; border-bottom-width: 2px; border-right-width: 2px; border-bottom-right-radius: 6px; }
        @media (prefers-reduced-motion: reduce) {
          .dz-ring {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function DefaultUploadIcon() {
  return (
    <div
      className="dropzone-icon relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-black/40"
      style={{
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.1), 0 0 24px -6px rgba(167,139,250,0.55)',
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="up-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e9d5ff" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <path d="M12 16V4" stroke="url(#up-grad)" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M6 10l6-6 6 6" stroke="url(#up-grad)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 20h16" stroke="url(#up-grad)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ─────────────────── ToolChoice ─────────────────── */
/**
 * Grid de escolhas. Ativa = preenchimento em gradiente + check no canto;
 * inativas levantam no hover. Press com escala rápida.
 */
export function ToolChoice<T extends string>({
  value,
  onChange,
  options,
  disabled,
  hue = 'rgba(167,139,250,0.55)',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; sub?: string; icon?: ReactNode }[];
  disabled?: boolean;
  hue?: string;
}) {
  return (
    <div className="ae-choice-group grid gap-2.5" style={{ '--choice-columns': Math.min(options.length, 4), '--choice-columns-mobile': Math.min(options.length, 2) } as CSSProperties} role="group" aria-label="Opções">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={
              'ae-choice group relative overflow-hidden rounded-[14px] border px-3.5 py-3 text-left transition-all duration-300 active:scale-[0.97] ' +
              (active
                ? 'border-violet/70'
                : 'border-line-strong bg-bg-soft/60 hover:-translate-y-[1px] hover:border-violet/45')
            }
            style={
              active
                ? {
                    background:
                      'linear-gradient(160deg, rgba(167,139,250,0.2), rgba(124,58,237,0.08) 60%), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 24px -6px ${hue}`,
                  }
                : undefined
            }
          >
            {opt.icon ? <div className="mb-1.5">{opt.icon}</div> : null}
            <div
              className={
                'text-[12.5px] font-bold tracking-tight transition-colors ' +
                (active ? 'text-text' : 'text-text-muted group-hover:text-text')
              }
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              {opt.label}
            </div>
            {opt.sub ? (
              <div className="ae-choice-description mt-1 text-text-muted">
                {opt.sub}
              </div>
            ) : null}

            {active ? (
              <span
                aria-hidden
                className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full"
                style={{
                  background: 'linear-gradient(150deg, #c4b5fd, #7c3aed)',
                  boxShadow: '0 0 10px rgba(167,139,250,0.7)',
                }}
              >
                <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6.5l2.5 2.5 5-5.5"
                    stroke="#120b22"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────── ToolSlider ─────────────────── */
/**
 * Slider estilizado. O preenchimento de progresso da trilha vem de
 * `--range-fill` (consumido pelo CSS global do input[type=range]).
 */
export function ToolSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  display,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
  disabled?: boolean;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label
          className="ae-slider-label"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {label}
        </label>
        <span
          className="mono rounded-[8px] border border-violet/30 bg-violet/10 px-2 py-0.5 text-[11.5px] font-semibold text-violet"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {display ? display(value) : value}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={display ? display(value) : undefined}
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full"
        style={{ ['--range-fill' as string]: `${pct}%` }}
      />
    </div>
  );
}

/* ─────────────────── ToolAction ─────────────────── */
/**
 * Botão de ação principal grande. Loading com spinner de anel.
 */
export function ToolAction({
  children,
  onClick,
  loading,
  disabled,
  variant = 'primary',
  icon,
  fullWidth,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'lime' | 'secondary';
  icon?: ReactNode;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
}) {
  const base = variant === 'primary' ? 'btn-primary' : variant === 'lime' ? 'btn-lime' : 'btn-secondary';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-ripple
      className={
        base +
        ' ' +
        'ae-tool-action group !text-[14px] !py-3.5 ' +
        (fullWidth ? '!w-full ' : '')
      }
    >
      {loading ? (
        <span className="inline-flex items-center gap-2.5">
          <span className="ta-spinner" aria-hidden />
          <span>Processando…</span>
        </span>
      ) : (
        <>
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <span>{children}</span>
          <span className="shrink-0 transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </>
      )}
      <style jsx>{`
        .ta-spinner {
          display: inline-block;
          height: 15px;
          width: 15px;
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: rgba(255, 255, 255, 0.95);
          animation: ta-spin 0.7s linear infinite;
        }
        @keyframes ta-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
}

/* ─────────────────── ToolResultCard ─────────────────── */
/**
 * Card pra mostrar resultado da ferramenta (vídeo/áudio gerado).
 * Hairline lime no topo + selo PRONTO com dot.
 */
export function ToolResultCard({
  title,
  meta,
  children,
  hue = 'rgba(200,232,124,0.5)',
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  hue?: string;
}) {
  return (
    <div
      className="result-card relative overflow-hidden rounded-[18px] border p-5 shadow-depth-1 md:p-6"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        borderColor: 'rgba(200,232,124,0.32)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full opacity-70 blur-3xl"
        style={{ background: hue }}
      />
      {/* Hairline de sucesso no topo */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hue}, transparent)`,
        }}
      />
      <div className="relative">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <div
              className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em]"
              style={{ fontFamily: 'var(--font-tech)', color: 'rgb(var(--lime))' }}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: 'rgb(var(--lime))',
                  boxShadow: '0 0 8px rgba(200,232,124,0.8)',
                }}
              />
              PRONTO
            </div>
            <h3
              className="mt-1 text-[18px] font-extrabold tracking-tight text-text"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
            >
              {title}
            </h3>
          </div>
          {meta ? (
            <span className="mono rounded-[8px] border border-line bg-bg/50 px-2 py-0.5 text-[10.5px] text-text-muted">
              {meta}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────── ToolMetric ─────────────────── */
/**
 * "Métrica" — número grande estilizado + label. Pra mostrar duração,
 * tamanho de redução, qtd de takes, etc.
 */
export function ToolMetric({
  value,
  label,
  accent = 'violet',
}: {
  value: string;
  label: string;
  accent?: 'violet' | 'lime' | 'rose';
}) {
  // Usa as variáveis de tema (adaptam claro/escuro). No claro o --lime vira
  // verde-oliva escuro legível; hardcoded #c2cf86 sumia no fundo branco.
  const color =
    accent === 'lime'
      ? 'rgb(var(--lime))'
      : accent === 'rose'
        ? 'rgb(var(--pink))'
        : 'rgb(var(--violet))';
  return (
    <div className="rounded-[14px] border border-line bg-bg-soft/50 px-4 py-3.5 shadow-depth-1 transition-transform duration-300 hover:-translate-y-[1px]">
      <div
        className="text-[22px] font-extrabold leading-none tracking-tight md:text-[26px]"
        style={{
          fontFamily: 'var(--font-tech)',
          color,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted"
        style={{ fontFamily: 'var(--font-tech)' }}
      >
        {label}
      </div>
    </div>
  );
}
