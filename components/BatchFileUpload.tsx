'use client';

import { useRef, useState } from 'react';
import { cn, formatBytes } from '@/lib/utils';

/**
 * Area de upload em lote: aceita multiplos arquivos (drag & drop ou clique)
 * ate o limite `max`. Mostra mini-lista dos arquivos aceitos.
 */
export function BatchFileUpload({
  accept,
  label = 'Selecione ou arraste arquivos',
  hint,
  max = 20,
  value,
  onChange,
  disabled = false,
}: {
  accept?: string;
  label?: string;
  hint?: string;
  max?: number;
  value: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function merge(incoming: File[]) {
    const map = new Map<string, File>();
    for (const f of value) map.set(f.name + ':' + f.size, f);
    for (const f of incoming) map.set(f.name + ':' + f.size, f);
    onChange(Array.from(map.values()).slice(0, max));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) merge(files);
  }

  const totalBytes = value.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-5 py-8 text-center transition',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          dragging
            ? 'border-lime bg-lime/5'
            : 'border-line-strong bg-bg hover:border-lime/60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept={accept}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) merge(files);
            e.target.value = '';
          }}
        />
        <div className="text-sm text-white">{label}</div>
        <div className="text-xs text-text-muted">
          {hint ? hint + ' — ' : ''}ate {max} arquivos por lote
        </div>
      </div>

      {value.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-[12px] border border-line bg-bg/50 p-3">
          <div className="flex items-center justify-between pb-2 text-xs text-text-muted">
            <span>
              {value.length} arquivo{value.length === 1 ? '' : 's'} ·{' '}
              <span className="mono">{formatBytes(totalBytes)}</span>
            </span>
            {!disabled ? (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-red-300 hover:text-red-400"
              >
                Limpar tudo
              </button>
            ) : null}
          </div>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
            {value.map((f, i) => (
              <li
                key={f.name + ':' + f.size + ':' + i}
                className="flex items-center justify-between gap-2 rounded border border-line/40 bg-bg px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-white">
                  {f.name}
                </span>
                <span className="mono shrink-0 text-text-muted">
                  {formatBytes(f.size)}
                </span>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((_, idx) => idx !== i));
                    }}
                    className="shrink-0 text-text-dim transition hover:text-red-400"
                    aria-label="Remover"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
