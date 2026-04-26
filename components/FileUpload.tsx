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
}: {
  accept?: string;
  label?: string;
  hint?: string;
  value?: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onChange(f);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[12px] border border-dashed px-5 py-8 text-center transition-all duration-300',
        dragging
          ? 'scale-[1.02] border-lime bg-lime/10 shadow-[0_0_40px_-8px_rgba(200,255,0,0.6)]'
          : 'border-line-strong bg-bg hover:-translate-y-[1px] hover:border-lime/60 hover:bg-bg-soft/40'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {value ? (
        <>
          <div className="text-sm text-white">{value.name}</div>
          <div className="mono text-xs text-text-muted">
            {formatBytes(value.size)}
          </div>
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
      ) : (
        <>
          <div className="text-sm text-white">{label}</div>
          {hint && <div className="text-xs text-text-muted">{hint}</div>}
        </>
      )}
    </div>
  );
}
