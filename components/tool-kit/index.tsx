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
 * Header da ferramenta — substitui o ToolShell antigo com algo mais
 * cinematográfico. Eyebrow + título + sub + ícone gigante decorativo.
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
    <header className="tool-hero relative overflow-hidden rounded-[24px] border border-line/60">
      {/* Glow ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full opacity-60 blur-3xl"
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
        }}
      />

      <div
        className="relative flex flex-col gap-3 px-6 py-8 md:flex-row md:items-center md:justify-between md:px-8 md:py-10"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        }}
      >
        <div className="flex-1">
          {eyebrow ? (
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted"
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
            className="text-[32px] font-extrabold leading-[1] tracking-tight text-white md:text-[42px]"
            style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.025em' }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-text-muted">
              {subtitle}
            </p>
          ) : null}
        </div>
        {icon ? (
          <div
            className="hidden md:block tool-hero-icon"
            style={{
              filter: `drop-shadow(0 0 32px ${hue})`,
            }}
          >
            {icon}
          </div>
        ) : null}
      </div>

      <style jsx>{`
        .tool-hero-icon {
          animation: tool-hero-float 4.5s ease-in-out infinite;
        }
        @keyframes tool-hero-float {
          0%, 100% { transform: translateY(0) rotate(0); }
          50% { transform: translateY(-6px) rotate(-3deg); }
        }
      `}</style>
    </header>
  );
}

/* ─────────────────── ToolStep ─────────────────── */
/**
 * Bloco de passo. Visual de cartão tipo HeyGen com badge (ícone),
 * título e conteúdo.
 *
 * IMPORTANTE: o badge SEMPRE mostra um ícone — números (01/02/03) foram
 * removidos por completo do design. A prop `n` ainda existe pra
 * compatibilidade com a ordem dos steps no JSX, mas nunca é renderizada.
 * Se nenhum `icon` for passado, cai num bullet genérico (•) — mas o
 * correto é cada step passar um ícone simbólico do que faz.
 */
export function ToolStep({
  n: _n,
  title,
  hint,
  hue = 'rgba(167,139,250,0.45)',
  icon,
  children,
}: {
  /** Mantido só pra compat — não é mais renderizado. */
  n?: number | string;
  title: string;
  hint?: string;
  hue?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="tool-step relative overflow-hidden rounded-[20px] border border-line/60 p-5 transition-colors duration-300 hover:border-violet/30 md:p-7"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.16)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
      }}
    >
      {/* Glow do passo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-30 blur-3xl"
        style={{ background: hue }}
      />

      <div className="relative">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border"
            style={{
              color: '#fff',
              borderColor: hue,
              background: `linear-gradient(135deg, ${hue}, transparent 70%), rgba(0,0,0,0.5)`,
              boxShadow: `0 0 18px -4px ${hue}`,
            }}
          >
            {icon ? (
              icon
            ) : (
              // Fallback: bullet genérico (NUNCA mostra número).
              // Significa "esqueci de passar icon" — visualmente neutro
              // até alguém adicionar o ícone real.
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <circle cx="5" cy="5" r="3" fill="currentColor" opacity="0.85" />
              </svg>
            )}
          </span>
          <div className="flex-1">
            <h3
              className="text-[15px] font-bold tracking-tight text-white md:text-[16.5px]"
              style={{
                fontFamily: 'var(--font-tech)',
                letterSpacing: '-0.015em',
              }}
            >
              {title}
            </h3>
            {hint ? (
              <p className="mt-0.5 text-[12px] text-text-muted">{hint}</p>
            ) : null}
          </div>
        </div>
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
      `}</style>
    </section>
  );
}

/* ─────────────────── ToolDropzone ─────────────────── */
/**
 * Área de upload visual. Drag-and-drop + click. Mostra estado vazio
 * elegante com ícone gigante, ou o arquivo selecionado.
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
        <div className="relative flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          {icon ? (
            <div
              className="dropzone-icon flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-black/40"
              style={{
                boxShadow: `0 0 24px -6px ${hue}, inset 0 1px 0 rgba(255,255,255,0.1)`,
              }}
            >
              {icon}
            </div>
          ) : (
            <DefaultUploadIcon />
          )}
          <div>
            <div
              className="text-[13.5px] font-bold uppercase tracking-[0.16em] text-white"
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-violet/45 bg-violet/10"
            style={{ boxShadow: `0 0 20px -4px ${hue}` }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-white">
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
      `}</style>
    </div>
  );
}

function DefaultUploadIcon() {
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-black/40"
      style={{
        boxShadow:
          '0 0 24px -6px rgba(167,139,250,0.55), inset 0 1px 0 rgba(255,255,255,0.1)',
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
 * Grid de escolhas (chip de tab). Visual maior e mais "premium" que
 * o chip antigo. Use pra escolher formato, modo, qualidade, etc.
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
              'group relative overflow-hidden rounded-[14px] border px-3.5 py-3 text-left transition-all duration-300 ' +
              (active
                ? 'border-violet/65 bg-violet/12'
                : 'border-line-strong bg-bg-soft/60 hover:border-violet/45 hover:-translate-y-[1px]')
            }
            style={
              active
                ? { boxShadow: `0 0 22px -6px ${hue}` }
                : undefined
            }
          >
            {opt.icon ? (
              <div className="mb-1.5">
                {opt.icon}
              </div>
            ) : null}
            <div
              className="text-[12.5px] font-bold tracking-tight text-white"
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
                className="absolute right-2 top-2 inline-block h-2 w-2 rounded-full"
                style={{
                  background: '#c084fc',
                  boxShadow: '0 0 10px rgba(192,132,252,0.85)',
                }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────── ToolSlider ─────────────────── */
/**
 * Slider estilizado pra valores numéricos (volume, tolerância, etc).
 * Mostra label + valor em mono.
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
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label
          className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {label}
        </label>
        <span
          className="mono text-[12.5px] text-violet"
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
      />
    </div>
  );
}

/* ─────────────────── ToolAction ─────────────────── */
/**
 * Botão de ação principal grande. Suporta loading state e ícone.
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
        <span className="loading-dots">Processando</span>
      ) : (
        <>
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <span>{children}</span>
          <span className="shrink-0 transition-transform duration-300 group-hover:translate-x-1">
            →
          </span>
        </>
      )}
    </button>
  );
}

/* ─────────────────── ToolResultCard ─────────────────── */
/**
 * Card pra mostrar resultado da ferramenta (vídeo/áudio gerado).
 * Suporta player + download.
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
      className="result-card relative overflow-hidden rounded-[18px] border p-5 md:p-6"
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
      <div className="relative">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <div
              className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-lime"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              PRONTO
            </div>
            <h3
              className="mt-1 text-[18px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
            >
              {title}
            </h3>
          </div>
          {meta ? (
            <span className="mono text-[11px] text-text-muted">{meta}</span>
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
    <div className="rounded-[14px] border border-line bg-bg-soft/50 px-4 py-3.5">
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
