'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listMyHeyGenAvatars,
  type LibraryAvatar,
  type LibraryAvatarGroup,
} from '@/lib/heygen-extension-bridge';

/**
 * HeyGenAvatarPicker - espelho 1:1 da biblioteca de avatares da conta
 * HeyGen do user, com hierarquia AVATAR -> LOOKS (igual UI HeyGen).
 *
 * UI:
 *   - Tela 1 (lista): grid de cards de AVATARES (Emma, Johan...) com thumb
 *     do avatar, nome HeyGen exato, e badge "N looks".
 *   - Tela 2 (looks): user clica num avatar -> drawer abre listando os looks
 *     daquele avatar (Radiant Redhead, Photo Avatar, etc) pra selecao precisa.
 *   - Selecionar um look retorna o look.id (que vai pro generate).
 */

export type AvatarOption = {
  id: string;          // ID do LOOK (passado pro generate HeyGen)
  name: string;        // Nome do LOOK
  thumb: string | null;
  videoPreview: string | null;
  type: 'avatar' | 'photo';
  version: 'III' | 'IV' | 'V';
  groupId?: string;
  groupName?: string;  // Nome do AVATAR pai (Emma, Johan...)
  // Compat
  premium?: boolean;
  gender?: string | null;
  isCustom?: boolean;
};

function lookToOption(l: LibraryAvatar): AvatarOption {
  return {
    id: l.id,
    name: l.name,
    thumb: l.thumb,
    videoPreview: l.videoPreview,
    type: l.type,
    version: l.version,
    groupId: l.groupId,
    groupName: l.groupName,
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
  motor?: 'III' | 'IV' | 'V';
  disabled?: boolean;
  label?: string;
}) {
  const [groups, setGroups] = useState<LibraryAvatarGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  async function loadLibrary() {
    setLoading(true);
    setError(null);
    try {
      const r = await listMyHeyGenAvatars();
      if (r.ok) {
        setGroups(r.groups ?? []);
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

  useEffect(() => {
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtro: busca em nome do AVATAR ou nome do LOOK
  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups.filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      return g.looks.some((l) => l.name.toLowerCase().includes(q));
    });
  }, [groups, q]);

  const totalLooks = useMemo(
    () => groups.reduce((acc, g) => acc + g.looksCount, 0),
    [groups],
  );

  const openGroup = useMemo(
    () => groups.find((g) => g.id === openGroupId) ?? null,
    [groups, openGroupId],
  );

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
          groups.length > 0
            ? `Filtrar pelos seus ${groups.length} avatares (${totalLooks} looks)...`
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
          {filteredGroups.length} de {groups.length} avatares · {totalLooks} looks total
        </div>
      )}

      {/* Grid de AVATARES (igual UI "Choose an Avatar" do HeyGen) */}
      {filteredGroups.length > 0 ? (
        <div className="mt-3 grid max-h-[480px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
          {filteredGroups.map((g) => {
            const isSelectedGroup = selected?.groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpenGroupId(g.id)}
                disabled={disabled}
                className={
                  'group relative aspect-square overflow-hidden rounded-[12px] border text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.99] ' +
                  (isSelectedGroup
                    ? 'border-lime shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                    : 'border-line-strong hover:border-lime/60')
                }
                title={`${g.name} — ${g.looksCount} look${g.looksCount > 1 ? 's' : ''}`}
              >
                {g.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.thumb}
                    alt={g.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 bg-line" />
                )}
                {/* Overlay dark */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2">
                  <div className="truncate text-[12px] font-semibold text-white">
                    {g.name}
                  </div>
                  <div className="mono text-[9px] uppercase text-text-muted">
                    {g.looksCount} look{g.looksCount > 1 ? 's' : ''}
                  </div>
                </div>
                {isSelectedGroup ? (
                  <div className="absolute right-1.5 top-1.5 rounded bg-lime px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black">
                    Selecionado
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Drawer dos LOOKS quando user clica num avatar */}
      {openGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={() => setOpenGroupId(null)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-[20px] border border-line-strong bg-bg-base p-4 sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              {openGroup.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={openGroup.thumb}
                  alt={openGroup.name}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <div className="flex-1 min-w-0">
                <div className="truncate text-lg font-semibold text-white">
                  {openGroup.name}
                </div>
                <div className="mono text-[10px] uppercase text-text-muted">
                  {openGroup.name}'s Looks · {openGroup.looksCount}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenGroupId(null)}
                className="rounded-md border border-line-strong bg-bg-soft px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime"
              >
                Fechar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {openGroup.looks.map((l) => {
                const isSelected = selected?.id === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setSelected(lookToOption(l));
                      setOpenGroupId(null);
                    }}
                    disabled={disabled}
                    className={
                      'group relative aspect-[3/4] overflow-hidden rounded-[12px] border text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.99] ' +
                      (isSelected
                        ? 'border-lime shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                        : 'border-line-strong hover:border-lime/60')
                    }
                  >
                    {l.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.thumb}
                        alt={l.name}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-line" />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2">
                      <div className="truncate text-[12px] font-semibold text-white">
                        {l.name}
                      </div>
                      <div className="mono text-[9px] uppercase text-text-muted">
                        {l.type === 'photo' ? 'photo' : 'studio'} · v{l.version}
                      </div>
                    </div>
                    {isSelected ? (
                      <div className="absolute right-1.5 top-1.5 rounded bg-lime px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black">
                        ✓ Use
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Pill do selecionado embaixo */}
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
          <div className="flex-1 min-w-0">
            <div className="truncate font-semibold">
              ✓ {selected.groupName ? `${selected.groupName} — ${selected.name}` : selected.name}
            </div>
            <div className="mono text-[9px] uppercase text-lime/60">
              look v{selected.version} · {selected.type}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
