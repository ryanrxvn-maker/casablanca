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

import { ReactNode, useRef } from 'react';

/* ─────────────────── ToolHero ─────────────────── */
/**
 * Header da ferramenta — eyebrow + título + sub + ícone em tile 3D.
 * Cantos "tech" + hairline de gradiente na base + sheen que varre 1x.
 */
export function ToolHero({
  title,
  subtitle,
  eyebrow,
  hue = 'rgba(167,139,250,0.45)',
  icon,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  hue?: string;
  icon?: ReactNode;
}) {
  return (
    <header className="tool-hero relative overflow-hidden rounded-[24px] border border-line/60 shadow-depth-2">
      {/* Glow ambient duplo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-55 blur-3xl"
        style={{ background: hue }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full opacity-25 blur-3xl"
        style={{ background: hue }}
      />
      {/* Grid sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(80% 100% at 70% 0%, #000, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(80% 100% at 70% 0%, #000, transparent 85%)',
        }}
      />
      {/* Sheen que varre uma vez ao montar */}
      <div aria-hidden className="tool-hero-sheen pointer-events-none absolute inset-0" />

      <div
        className="relative flex flex-col gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between md:px-9 md:py-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.2)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        }}
      >
        <div className="flex-1">
          {eyebrow ? (
            <div
              className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-line/80 bg-bg/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted backdrop-blur-sm"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full"
                style={{ background: hue, boxShadow: `0 0 8px ${hue}` }}
              />
              {eyebrow}
            </div>
          ) : null}
          <h1
            className="text-[32px] font-extrabold leading-[1.02] tracking-tight text-text md:text-[42px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.025em' }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2.5 max-w-[580px] text-[14.5px] leading-relaxed text-text-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {icon ? (
          <div className="tool-hero-icon relative hidden md:block">
            <span
              aria-hidden
              className="absolute inset-0 -m-6 rounded-full opacity-70 blur-2xl"
              style={{ background: `radial-gradient(circle, ${hue}, transparent 70%)` }}
            />
            <span
              className="relative flex h-[88px] w-[88px] items-center justify-center rounded-[22px] border border-white/10"
              style={{
                background:
                  'linear-gradient(160deg, rgba(255,255,255,0.06), transparent 45%), rgba(0,0,0,0.45)',
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -6px 12px rgba(0,0,0,0.5), 0 18px 36px -14px rgba(0,0,0,0.7), 0 0 34px -8px ${hue}`,
              }}
            >
              {icon}
            </span>
          </div>
        ) : null}
      </div>

      {/* Hairline de acento na base */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hue}, transparent)`,
        }}
      />

      <style jsx>{`
        .tool-hero-icon {
          animation: tool-hero-float 4.5s ease-in-out infinite;
        }
        @keyframes tool-hero-float {
          0%, 100% { transform: translateY(0) rotate(0); }
          50% { transform: translateY(-6px) rotate(-2deg); }
        }
        .tool-hero-sheen {
          background: linear-gradient(
            105deg,
            transparent 40%,
            rgba(255, 255, 255, 0.06) 50%,
            transparent 60%
          );
          transform: translateX(-120%);
          animation: tool-hero-sweep 1.4s ease-out 0.35s 1 both;
        }
        @keyframes tool-hero-sweep {
          to { transform: translateX(120%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tool-hero-icon,
          .tool-hero-sheen {
            animation: none !important;
          }
        }
      `}</style>
    </header>
  );
}

/* ─────────────────── ToolStep ─────────────────── */
/**
 * Bloco de passo. Cartão com badge de ícone 3D, título e conteúdo.
 *
 * IMPORTANTE: o badge SEMPRE mostra um ícone — números (01/02/03) foram
 * removidos por completo do design. A prop `n` ainda existe pra
 * compatibilidade com a ordem dos steps no JSX, mas nunca é renderizada.
 */
export function ToolStep({
  n: _n,
  title,
  hint,
  hue = 'rgba(167,139,250,0.45)',
  icon,
  action,
  still,
  children,
}: {
  /** Mantido só pra compat — não é mais renderizado. */
  n?: number | string;
  title: string;
  hint?: string;
  hue?: string;
  icon?: ReactNode;
  /** Elemento opcional alinhado à direita do header (ex.: um toggle). */
  action?: ReactNode;
  /**
   * Cartão PARADO: sem overflow-hidden e sem o levanta-no-hover. Existe pro
   * passo que carrega uma coluna position:sticky por dentro (o editor de
   * legendas) — overflow-hidden e transform em ancestral MATAM o sticky.
   */
  still?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        'tool-step group relative rounded-[20px] border border-line/60 p-5 shadow-depth-1 transition-all duration-300 hover:border-violet/35 hover:shadow-depth-2 md:p-7 ' +
        (still ? '' : 'overflow-hidden hover:-translate-y-[2px]')
      }
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.028), rgba(0,0,0,0.16)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      {/* Glow do passo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-30 blur-3xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: hue }}
      />
      {/* Barra de acento à esquerda — acende no hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-r-full opacity-0 transition-opacity duration-400 group-hover:opacity-100"
        style={{ background: `linear-gradient(180deg, transparent, ${hue}, transparent)` }}
      />

      <div className="relative">
        <div className="mb-4 flex items-center gap-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border transition-transform duration-300 group-hover:scale-[1.06] group-hover:-rotate-3"
            style={{
              color: '#fff',
              borderColor: hue,
              background: `linear-gradient(150deg, ${hue}, transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.05), transparent 40%), rgba(0,0,0,0.5)`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.4), 0 0 20px -4px ${hue}`,
            }}
          >
            {icon ? (
              icon
            ) : (
              // Fallback: bullet genérico (NUNCA mostra número).
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <circle cx="5" cy="5" r="3" fill="currentColor" opacity="0.85" />
              </svg>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h3
              className="text-[15px] font-bold tracking-tight text-text md:text-[16.5px]"
              style={{
                fontFamily: 'var(--font-tech)',
                letterSpacing: '-0.015em',
              }}
            >
              {title}
            </h3>
            {hint ? (
              <p className="mt-0.5 text-[12px] leading-snug text-text-muted">{hint}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        <div className="divider-grad mb-4 -mt-1 opacity-70" aria-hidden />
        <div>{children}</div>
      </div>

      <style jsx>{`
        .tool-step {
          animation: tool-step-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes tool-step-in {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tool-step {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
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
          onFile(e.target.files?.[0] || null);
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
              Arraste ou clique pra subir
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            disabled={disabled}
            className="shrink-0 rounded-full border border-red-500/40 px-3 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/10 active:scale-[0.95]"
          >
            Trocar
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
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            className={
              'group relative overflow-hidden rounded-[14px] border px-3.5 py-3 text-left transition-all duration-300 active:scale-[0.97] ' +
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
              <div className="mono mt-0.5 text-[10px] text-text-muted">
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
          className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
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
      className={
        base +
        ' ' +
        'group !text-[14px] !py-3.5 ' +
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
