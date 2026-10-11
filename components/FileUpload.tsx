'use client';

import { useRef, useState } from 'react';
import { cn, formatBytes } from '@/lib/utils';

/**
 * Área de upload com drag & drop e fallback para clique.
 * Aceita um único arquivo; usar múltiplos `<FileUpload>` para lotes.
 */
export function FileUpload({
  accept,
  label = 'Selecione ou arraste um arquivo',
  hint,
  value,
  onChange,
  disabled = false,
}: {
  accept?: string;
  label?: string;
  hint?: string;
  value?: File | null;
  onChange: (file: File | null) => void;
  /** Trava a troca de arquivo (ex.: durante o processamento — 10.10). */
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onChange(f);
  }

  return (
    <div
      role={value ? 'group' : 'button'}
      tabIndex={value || disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-[12px] border border-dashed px-5 py-8 text-center transition-all duration-300',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        dragging
          ? 'scale-[1.02] border-lime bg-lime/10 shadow-[0_0_40px_-8px_rgba(200,232,124,0.6)]'
          : 'border-line-strong bg-bg hover:-translate-y-[1px] hover:border-lime/60 hover:bg-bg-soft/40'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        disabled={disabled}
        onChange={(e) => { const selected = e.target.files?.[0]; if (selected) onChange(selected); e.target.value = ''; }}
      />
      {value ? (
        <>
          <div className="text-sm text-white">{value.name}</div>
          <div className="mono text-xs text-text-muted">
            {formatBytes(value.size)}
          </div>
          {!disabled ? (
            <>
              <button type="button" className="ae-upload-change" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Trocar arquivo</button>
              <button
                type="button"
                className="btn-ghost mt-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                Remover
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="text-sm text-text">{label}</div>
          {hint && <div className="text-xs text-text-muted">{hint}</div>}
        </>
      )}
    </div>
  );
}
