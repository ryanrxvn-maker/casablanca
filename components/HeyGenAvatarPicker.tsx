'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LibraryAvatar,
  type LibraryAvatarGroup,
} from '@/lib/heygen-extension-bridge';
import {
  getLibrarySnapshot,
  reloadLibrary,
  subscribeLibrary,
} from '@/lib/heygen-library-cache';

/**
 * HeyGenAvatarPicker - espelho 1:1 da biblioteca de avatares da conta
 * HeyGen do user, com hierarquia AVATAR -> LOOKS (igual UI HeyGen).
 */

export type AvatarOption = {
  id: string;
  name: string;
  thumb: string | null;
  videoPreview: string | null;
  type: 'avatar' | 'photo';
  version: 'III' | 'IV' | 'V';
  groupId?: string;
  groupName?: string;
  premium?: boolean;
  gender?: string | null;
  isCustom?: boolean;
  /** voice_id default ja embutido no payload do look (extension v4.0.13+) */
  voiceId?: string | null;
  /** voice_name (geralmente @username do material clonado) — extension v4.0.17+
   *  Usado pelo matchAvatar pra cruzar com referencias @user dos briefings. */
  voiceName?: string | null;
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
    voiceId: (l as any).voiceId ?? null,
    voiceName: (l as any).voiceName ?? null,
  };
}

/**
 * Thumb com fallback automatico: tenta a URL primaria. Se falhar (404 expirou,
 * rede), tenta as fallbackUrls em ordem. Se TODAS falharem, mostra placeholder
 * com a inicial do nome (estilizado).
 */
function ThumbWithFallback({
  primary,
  fallbacks,
  alt,
  className,
  eager,
  onAllFailed,
}: {
  primary: string | null;
  fallbacks: (string | null)[];
  alt: string;
  className: string;
  eager?: boolean;
  onAllFailed?: () => void;
}) {
  // Lista ordenada de URLs candidatas (sem nulls/duplicatas)
  const candidates = useMemo(() => {
    const out: string[] = [];
    if (primary) out.push(primary);
    for (const f of fallbacks) {
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  }, [primary, fallbacks]);

  const [idx, setIdx] = useState(0);
  const [allFailed, setAllFailed] = useState(candidates.length === 0);

  // Reset quando candidates muda (novo avatar)
  useEffect(() => {
    setIdx(0);
    setAllFailed(candidates.length === 0);
  }, [candidates]);

  if (allFailed) {
    const initial = (alt || '?').trim().charAt(0).toUpperCase();
    return (
      <div
        className={
          className +
          ' flex items-center justify-center bg-gradient-to-br from-bg-soft to-line text-3xl font-bold text-text-muted'
        }
        aria-label={alt}
      >
        {initial}
      </div>
    );
  }

  const currentSrc = candidates[idx];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      // @ts-ignore - fetchPriority eh suportado mas nao tipado em todos os React
      fetchpriority={eager ? 'high' : 'low'}
      onError={() => {
        if (idx + 1 < candidates.length) {
          setIdx(idx + 1);
        } else {
          setAllFailed(true);
          onAllFailed?.();
        }
      }}
    />
  );
}

/**
 * Pre-warm: dispara um new Image().src = url pra cada URL unica
 * imediatamente quando a lista chega. Isso comeca o download em paralelo
 * em background, antes do React renderizar e antes do <img> aparecer no
 * viewport. Quando o <img> finalmente faz request, geralmente bate no
 * cache do browser instant.
 */
function usePreWarmImages(urls: (string | null)[]) {
  const warmedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const u of urls) {
      if (!u) continue;
      if (warmedRef.current.has(u)) continue;
      warmedRef.current.add(u);
      // Cria um Image fora do DOM apenas pra disparar o GET
      const img = new Image();
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = u;
    }
  }, [urls]);
}

export function HeyGenAvatarPicker({
  query,
  setQuery,
  selected,
  setSelected,
  disabled,
  label = 'Avatar (sua biblioteca HeyGen)',
  inlineMode = false,
}: {
  query: string;
  setQuery: (s: string) => void;
  selected: AvatarOption | null;
  setSelected: (a: AvatarOption | null) => void;
  motor?: 'III' | 'IV' | 'V';
  disabled?: boolean;
  label?: string;
  /** Se true, renderiza looks INLINE (substitui o grid de avatares) ao
   *  inves de abrir modal separado. Usado pelo CompactAvatarPicker (que
   *  ja é um popup ancorado). */
  inlineMode?: boolean;
}) {
  const [snap, setSnap] = useState(() => getLibrarySnapshot());
  const groups = snap.groups;
  const loading = snap.loading;
  const error = snap.error;
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const failedThumbsRef = useRef(0);
  const lastReloadRef = useRef(0);

  // Auto-reload se >30% das thumbs do grid principal falharem (URLs CloudFront
  // expiraram). Throttle 2 min entre reloads pra nao loopar.
  function reportThumbFailed() {
    failedThumbsRef.current += 1;
    const total = groups.length;
    if (total === 0) return;
    const failedPct = failedThumbsRef.current / total;
    const elapsed = Date.now() - lastReloadRef.current;
    if (failedPct > 0.3 && elapsed > 120_000 && !loading) {
      console.log('[HeyGenAvatarPicker] >30% thumbs falharam, auto-recarregando biblioteca');
      lastReloadRef.current = Date.now();
      failedThumbsRef.current = 0;
      loadLibrary();
    }
  }

  async function loadLibrary() {
    failedThumbsRef.current = 0;
    await reloadLibrary(true);
  }

  // Subscribe ao cache singleton (compartilha com CompactAvatarPicker no
  // modo dinamico — evita N fetches paralelos).
  useEffect(() => {
    const update = () => setSnap({ ...getLibrarySnapshot() });
    const unsub = subscribeLibrary(update);
    if (groups.length === 0 && !loading) {
      reloadLibrary(false);
    }
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-warm: TODAS as URLs (groups + looks) em paralelo assim que a lista chega
  const allUrls = useMemo(() => {
    const out: (string | null)[] = [];
    for (const g of groups) {
      if (g.thumb) out.push(g.thumb);
      for (const l of g.looks) {
        if (l.thumb) out.push(l.thumb);
      }
    }
    return out;
  }, [groups]);
  usePreWarmImages(allUrls);

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

      {/* Inline mode: quando um avatar foi aberto, mostra LOOKS no lugar
       *  do grid de avatares (com botao "voltar"). Sem segundo modal. */}
      {inlineMode && openGroup ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenGroupId(null)}
              className="mono rounded-md border border-line-strong bg-bg-soft px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
            >
              ← Voltar
            </button>
            <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full">
              <ThumbWithFallback
                primary={openGroup.thumb}
                fallbacks={openGroup.looks.map((l) => l.thumb)}
                alt={openGroup.name}
                className="h-full w-full object-cover"
                eager
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-semibold text-white">{openGroup.name}</div>
              <div className="mono text-[9px] uppercase text-text-muted">{openGroup.looksCount} look{openGroup.looksCount > 1 ? 's' : ''}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                    'group relative aspect-[3/4] overflow-hidden rounded-[10px] border text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.99] ' +
                    (isSelected
                      ? 'border-lime shadow-[0_0_14px_-4px_rgba(200,255,0,0.6)]'
                      : 'border-line-strong hover:border-lime/60')
                  }
                >
                  <ThumbWithFallback
                    primary={l.thumb}
                    fallbacks={[openGroup.thumb]}
                    alt={l.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    eager
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-1.5">
                    <div className="truncate text-[11px] font-semibold text-white">{l.name}</div>
                  </div>
                  {isSelected ? (
                    <div className="absolute right-1 top-1 rounded bg-lime px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black">
                      ✓ Use
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Grid de AVATARES (igual UI "Choose an Avatar" do HeyGen) */}
      {(!inlineMode || !openGroup) && filteredGroups.length > 0 ? (
        <div className="mt-3 grid max-h-[480px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
          {filteredGroups.map((g, i) => {
            const isSelectedGroup = selected?.groupId === g.id;
            // Fallbacks pro thumb do grupo: thumb do 1o look, 2o look, etc
            const fallbacks = g.looks.map((l) => l.thumb);
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
                title={`${g.name} - ${g.looksCount} look${g.looksCount > 1 ? 's' : ''}`}
              >
                <ThumbWithFallback
                  primary={g.thumb}
                  fallbacks={fallbacks}
                  alt={g.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  eager={i < 12}
                  onAllFailed={reportThumbFailed}
                />
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

      {/* Drawer dos LOOKS — so abre como modal se NAO for inlineMode.
       *  No inlineMode os looks aparecem inline acima (substituem o grid). */}
      {!inlineMode && openGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={() => setOpenGroupId(null)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-[20px] border border-line-strong bg-bg-base p-4 sm:rounded-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full">
                <ThumbWithFallback
                  primary={openGroup.thumb}
                  fallbacks={openGroup.looks.map((l) => l.thumb)}
                  alt={openGroup.name}
                  className="h-full w-full object-cover"
                  eager
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-lg font-semibold text-white">
                  {openGroup.name}
                </div>
                <div className="mono text-[10px] uppercase text-text-muted">
                  {openGroup.name}&apos;s Looks · {openGroup.looksCount}
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
                    <ThumbWithFallback
                      primary={l.thumb}
                      fallbacks={[openGroup.thumb]}
                      alt={l.name}
                      className="absolute inset-0 h-full w-full object-cover"
                      eager
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2">
                      <div className="truncate text-[12px] font-semibold text-white">
                        {l.name}
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
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md">
            <ThumbWithFallback
              primary={selected.thumb}
              fallbacks={[]}
              alt={selected.name}
              className="h-full w-full object-cover"
              eager
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate font-semibold">
              ✓ {selected.groupName ? `${selected.groupName} - ${selected.name}` : selected.name}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
