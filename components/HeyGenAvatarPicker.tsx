'use client';

import { useEffect, useState } from 'react';
import {
  listMyHeyGenAvatars,
  type LibraryAvatar,
} from '@/lib/heygen-extension-bridge';

/**
 * HeyGenAvatarPicker — espelho 1:1 da biblioteca de avatares da conta
 * HeyGen do user.
 *
 * Como funciona:
 *   - Pede pra extensao (via bridge) listar os avatares da conta logada.
 *     A extensao chama o endpoint INTERNO do HeyGen com cookies de sessao,
 *     que retorna EXATAMENTE os mesmos avatares que aparecem em
 *     https://app.heygen.com/avatars (modal "Choose an Avatar").
 *   - User pode filtrar por nome localmente (instantaneo, sem rede).
 *   - Motor (III/IV/V) NAO filtra a busca — e' so um marcador pra hora
 *     de gerar (avatar_style no payload).
 *
 * Se a extensao nao estiver instalada, mostra mensagem clara.
 */

export type AvatarOption = {
  id: string;
  name: string;
  thumb: string | null;
  videoPreview: string | null;
  type: 'avatar' | 'photo';
  version: 'III' | 'IV' | 'V';
  // Mantido por compat — sempre false (eliminamos a noção)
  premium?: boolean;
  gender?: string | null;
  isCustom?: boolean;
};

function libraryToOption(a: LibraryAvatar): AvatarOption {
  return {
    id: a.id,
    name: a.name,
    thumb: a.thumb,
    videoPreview: a.videoPreview,
    type: a.type,
    version: a.version,
  };
}

export function HeyGenAvatarPicker({
  query,
  setQuery,
  selected,
  setSelected,
  disabled,
  label = 'Avatar (sua biblioteca HeyGen)',
}: {
  query: string;
  setQuery: (s: string) => void;
  selected: AvatarOption | null;
  setSelected: (a: AvatarOption | null) => void;
  // Mantido por compat com chamadas existentes — nao afeta busca
  motor?: 'III' | 'IV' | 'V';
  disabled?: boolean;
  label?: string;
}) {
  const [allAvatars, setAllAvatars] = useState<AvatarOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLibrary() {
    setLoading(true);
    setError(null);
    try {
      const r = await listMyHeyGenAvatars();
      if (r.ok) {
        setAllAvatars(r.avatars.map(libraryToOption));
      } else {
        setError(
          r.error ??
            'Nao consegui ler a biblioteca. Verifique se a extensao esta instalada e voce esta logado em app.heygen.com.',
        );
      }
    } catch (e) {
      setError((e as Error).message ?? 'Falha ao listar avatares.');
    } finally {
      setLoading(false);
    }
  }

  // Carrega a biblioteca uma vez ao montar
  useEffect(() => {
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtro local (instantaneo) por nome
  const q = query.trim().toLowerCase();
  const filtered = q
    ? allAvatars.filter((a) => a.name.toLowerCase().includes(q))
    : allAvatars;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label-field !mb-0">{label}</h2>
        <button
          type="button"
          onClick={loadLibrary}
          disabled={loading || disabled}
          className="rounded-md border border-line-strong bg-bg-soft px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime disabled:opacity-50"
        >
          {loading ? 'Atualizando...' : 'Recarregar biblioteca'}
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          allAvatars.length > 0
            ? `Filtrar pelos seus ${allAvatars.length} avatares...`
            : 'Carregando biblioteca...'
        }
        className="input-field"
        disabled={disabled || loading}
      />

      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-lime">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
          </span>
          Lendo sua biblioteca via extensao...
        </div>
      ) : error ? (
        <div className="mt-2 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <div>⚠ {error}</div>
          <div className="mt-2 text-[10px] text-red-300/70">
            <strong>Pra debug:</strong> abre app.heygen.com numa aba, F12 →
            Console, procura linhas{' '}
            <code className="mono">[DARKO LAB]</code> e me cola.
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-text-muted">
          {filtered.length} de {allAvatars.length} avatares
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="mt-3 grid max-h-96 gap-2 overflow-y-auto">
          {filtered.map((a) => {
            const active = selected?.id === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a)}
                disabled={disabled}
                className={
                  'flex items-center gap-3 rounded-[12px] border px-3 py-2 text-left transition-all duration-200 active:scale-[0.99] ' +
                  (active
                    ? 'border-lime bg-lime/10 shadow-[0_0_14px_-4px_rgba(200,255,0,0.5)]'
                    : 'border-line-strong bg-bg-soft/30 hover:border-lime')
                }
              >
                {a.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.thumb}
                    alt={a.name}
                    className="h-12 w-12 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-md bg-line" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-white">
                    {a.name}
                  </div>
                  <div className="mono text-[11px] uppercase text-text-muted">
                    {a.type === 'photo' ? 'photo' : 'studio'} · v{a.version}
                  </div>
                </div>
                {active ? (
                  <span className="mono shrink-0 text-xs text-lime">
                    SELECIONADO
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-lime/30 bg-lime/5 px-3 py-2 text-xs text-lime">
          {selected.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.thumb}
              alt={selected.name}
              className="h-8 w-8 rounded-md object-cover"
              loading="lazy"
            />
          ) : null}
          <span className="font-semibold">✓ {selected.name}</span>
          <span className="mono ml-auto text-[10px] text-text-muted">
            avatar v{selected.version}
          </span>
        </div>
      ) : null}
    </div>
  );
}
