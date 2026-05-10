'use client';

import { useState } from 'react';
import { HeyGenAvatarPicker, type AvatarOption } from './HeyGenAvatarPicker';

/**
 * Picker compacto pra usar inline em listas (modo dinamico).
 *
 * Mostra: thumb pequena + nome do avatar selecionado + botao "Trocar".
 * Clicando "Trocar" abre o HeyGenAvatarPicker em overlay modal. Compartilha
 * o cache singleton da biblioteca, entao nao re-busca avatares.
 */
export function CompactAvatarPicker({
  selected,
  setSelected,
  fallback,
  disabled,
  label,
}: {
  selected: AvatarOption | null;
  setSelected: (a: AvatarOption | null) => void;
  /** Mostrado quando selected=null (ex: avatar global) */
  fallback?: AvatarOption | null;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const display = selected ?? fallback ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={
          'group flex w-full items-center gap-2 rounded-[10px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition hover:border-lime hover:bg-lime/5 disabled:opacity-50 ' +
          (selected ? 'border-lime/40' : '')
        }
        title={display?.name ?? 'Escolher avatar'}
      >
        {display?.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={display.thumb}
            alt={display.name}
            className="h-7 w-7 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg text-[10px] font-bold text-text-muted">
            {display?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">
            {display?.name ?? <span className="text-text-muted">Sem avatar</span>}
          </div>
          {selected ? null : (
            <div className="mono text-[8px] uppercase tracking-widest text-text-muted">
              padrao (global)
            </div>
          )}
        </div>
        <span className="mono shrink-0 rounded-full border border-line-strong px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-text-muted group-hover:border-lime group-hover:text-lime">
          Trocar
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-[16px] border border-lime/30 bg-bg p-4 shadow-[0_0_40px_-10px_rgba(200,255,0,0.4)]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="mono text-xs uppercase tracking-widest text-lime">
                {label ?? 'Escolher avatar pra essa parte'}
              </h3>
              <div className="flex items-center gap-2">
                {selected ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setOpen(false);
                    }}
                    className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                  >
                    Voltar pro padrao
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
                >
                  Fechar
                </button>
              </div>
            </div>
            <HeyGenAvatarPicker
              query={query}
              setQuery={setQuery}
              selected={selected}
              setSelected={(a) => {
                setSelected(a);
                setOpen(false);
              }}
              disabled={false}
              label="Biblioteca"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
