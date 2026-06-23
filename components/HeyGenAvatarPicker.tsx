'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LibraryAvatar,
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
  withSkeleton,
}: {
  primary: string | null;
  fallbacks: (string | null)[];
  alt: string;
  className: string;
  eager?: boolean;
  onAllFailed?: () => void;
  /** Mostra skeleton shimmer atras + fade-in da img ao carregar. So usar
   *  em containers `relative overflow-hidden` (celulas do grid/looks). */
  withSkeleton?: boolean;
}) {
  // Lista ordenada de URLs candidatas (sem nulls/duplicatas).
  // Memoiza pela CHAVE estavel (string) e nao pela referencia do array
  // `fallbacks` — que vem novo a cada render do pai (ex.: g.looks.map(...)
  // inline). Sem isso, candidates mudava toda render → o effect abaixo
  // resetava TODAS as thumbs (setIdx/setAllFailed) a cada tecla no filtro.
  const fallbackKey = fallbacks.filter(Boolean).join('|');
  const candidates = useMemo(() => {
    const out: string[] = [];
    if (primary) out.push(primary);
    for (const f of fallbacks) {
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, fallbackKey]);

  const [idx, setIdx] = useState(0);
  const [allFailed, setAllFailed] = useState(candidates.length === 0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset quando candidates muda (novo avatar)
  useEffect(() => {
    setIdx(0);
    setAllFailed(candidates.length === 0);
    setLoaded(false);
  }, [candidates]);

  // Imagem ja em cache do browser pode estar `complete` antes do React
  // anexar o onLoad → marca como carregada na hora pra nao prender o skeleton.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [idx, candidates]);

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
    <>
      {withSkeleton && !loaded ? <div className="av-skel" aria-hidden /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        className={className + (withSkeleton ? ' av-img' + (loaded ? ' is-loaded' : '') : '')}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        // @ts-ignore - fetchPriority eh suportado mas nao tipado em todos os React
        fetchpriority={eager ? 'high' : 'low'}
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (idx + 1 < candidates.length) {
            setIdx(idx + 1);
          } else {
            setAllFailed(true);
            onAllFailed?.();
          }
        }}
      />
    </>
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
    const todo = urls.filter((u): u is string => !!u && !warmedRef.current.has(u));
    if (todo.length === 0) return;

    // Dispara em LOTES dentro do idle do browser — evita firar centenas de
    // GETs de uma vez no instante do open (era o que travava a abertura) e
    // deixa o paint/animacao do modal acontecer primeiro.
    const CHUNK = 8;
    const ric: (cb: () => void) => number =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 500 })
        : (cb) => window.setTimeout(cb, 16);
    const cancelRic: (id: number) => void =
      typeof window !== 'undefined' && 'cancelIdleCallback' in window
        ? (id) => (window as any).cancelIdleCallback(id)
        : (id) => window.clearTimeout(id);

    let cancelled = false;
    let i = 0;
    let handle = 0;
    const pump = () => {
      if (cancelled) return;
      const end = Math.min(i + CHUNK, todo.length);
      for (; i < end; i++) {
        const u = todo[i];
        if (warmedRef.current.has(u)) continue;
        warmedRef.current.add(u);
        // Cria um Image fora do DOM apenas pra disparar o GET
        const img = new Image();
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        // As ~8 primeiras (1a tela) vao com prioridade ALTA de rede pra
        // aparecerem antes; o resto fica baixa pra nao competir com elas.
        (img as any).fetchPriority = i < 8 ? 'high' : 'low';
        img.src = u;
      }
      if (i < todo.length) handle = ric(pump);
    };
    handle = ric(pump);

    return () => {
      cancelled = true;
      cancelRic(handle);
    };
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

  // Pre-warm so as thumbs da PRIMEIRA TELA do grid (~16), nao as 130 nem 30 —
  // com cards maiores cabem ~12 na 1a tela; aquecer 30 dividia a banda entre
  // visiveis e invisiveis e deixava as visiveis MAIS lentas. Focar nas ~16
  // primeiras (1a tela + 1 linha de folga) faz elas aparecerem mais rapido.
  // O resto carrega sob demanda (loading="lazy" + content-visibility) no scroll.
  const groupThumbUrls = useMemo(() => groups.slice(0, 16).map((g) => g.thumb), [groups]);
  usePreWarmImages(groupThumbUrls);

  // Filtro: busca em nome do AVATAR ou nome do LOOK.
  // useDeferredValue: a digitacao no input fica fluida (prioridade alta) e o
  // re-filtro/re-render das 130 celulas roda em prioridade BAIXA, sem travar
  // a tecla. Sem isso, cada tecla reconciliava as 130 na hora = engasgo.
  const q = query.trim().toLowerCase();
  const deferredQ = useDeferredValue(q);
  const filteredGroups = useMemo(() => {
    if (!deferredQ) return groups;
    return groups.filter((g) => {
      if (g.name.toLowerCase().includes(deferredQ)) return true;
      return g.looks.some((l) => l.name.toLowerCase().includes(deferredQ));
    });
  }, [groups, deferredQ]);

  const totalLooks = useMemo(
    () => groups.reduce((acc, g) => acc + g.looksCount, 0),
    [groups],
  );

  const openGroup = useMemo(
    () => groups.find((g) => g.id === openGroupId) ?? null,
    [groups, openGroupId],
  );

  // Pre-warm sob demanda: ao abrir um grupo, aquece SO os looks dele (em vez
  // de aquecer os 213 looks no open inicial). Mantem o drawer instantaneo.
  const openGroupLookUrls = useMemo(
    () => (openGroup ? openGroup.looks.map((l) => l.thumb) : []),
    [openGroup],
  );
  usePreWarmImages(openGroupLookUrls);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* icone pilha de avatares — 3 discos sobrepostos com glow */}
          <span className="relative flex h-7 w-9 shrink-0 items-center">
            <span className="absolute left-0 h-6 w-6 rounded-full border border-violet/50 bg-gradient-to-br from-violet/30 to-bg-soft shadow-[0_0_12px_-4px_rgba(167,139,250,0.7)]" />
            <span className="absolute left-1.5 h-6 w-6 rounded-full border border-cyan/40 bg-gradient-to-br from-cyan/20 to-bg-soft" />
            <span className="absolute left-3 h-6 w-6 rounded-full border border-lime/50 bg-gradient-to-br from-lime/25 to-bg-soft shadow-[0_0_12px_-4px_rgba(200,232,124,0.7)]" />
          </span>
          <h2
            className="!mb-0 truncate text-[12px] font-extrabold uppercase leading-none text-text"
            style={{ fontFamily: 'var(--font-tech), system-ui', letterSpacing: '0.16em' }}
          >
            {label}
          </h2>
        </div>
        <button
          type="button"
          onClick={loadLibrary}
          disabled={loading || disabled}
          className="group/rl flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-bg-soft/60 px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted backdrop-blur-sm transition-all hover:border-lime hover:text-lime hover:shadow-[0_0_18px_-6px_rgba(200,232,124,0.6)] disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            className={'h-3 w-3 transition-transform ' + (loading ? 'animate-spin' : 'group-hover/rl:rotate-180')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          {loading ? 'Atualizando...' : 'Recarregar'}
        </button>
      </div>

      {/* busca premium — anel gradiente sutil + lupa */}
      <div className="group/search relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted transition-colors group-focus-within/search:text-lime">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            groups.length > 0
              ? `Filtrar pelos seus ${groups.length} avatares (${totalLooks} looks)...`
              : 'Carregando biblioteca...'
          }
          className="input-field !pl-10 !pr-9 transition-shadow focus:!border-violet/60 focus:shadow-[0_0_0_3px_rgba(167,139,250,0.12),0_0_24px_-10px_rgba(167,139,250,0.5)]"
          disabled={disabled || loading}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-bg-soft/70 text-[10px] text-text-muted transition-all hover:border-lime hover:text-lime"
            aria-label="Limpar busca"
            tabIndex={-1}
          >
            ✕
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-lime">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
          </span>
          Lendo sua biblioteca via extensao...
        </div>
      ) : error ? (
        <div className="mt-2 rounded-[10px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          {(() => {
            const raw = String(error || '');
            const looksAuth = /401|403|login|sign[\s-]?in|unauthor|session|logad|entrar/i.test(raw);
            return looksAuth ? (
              <div>
                Você não está logado no HeyGen. Abra{' '}
                <a
                  href="https://app.heygen.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-100"
                >
                  app.heygen.com
                </a>
                , entre na sua conta e clique em <strong>Recarregar biblioteca</strong>.
              </div>
            ) : (
              <div>
                Não consegui carregar sua biblioteca de avatares agora. Confirme que
                está logado no HeyGen e clique em <strong>Recarregar biblioteca</strong>.
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 font-semibold tracking-wide text-violet">
            <span className="mono tabular-nums">{filteredGroups.length}</span>
            <span className="mono tabular-nums text-text-muted">/{groups.length}</span> avatares
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-bg-soft/50 px-2 py-0.5 tracking-wide text-text-muted">
            <span className="mono tabular-nums">{totalLooks}</span> looks
          </span>
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
              className="label-tech rounded-md border border-line-strong bg-bg-soft px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(162px,1fr))] gap-2.5">
            {openGroup.looks.map((l, i) => {
              const isSelected = selected?.id === l.id;
              return (
                <div key={l.id} className="aspect-[3/4]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(lookToOption(l));
                      setOpenGroupId(null);
                    }}
                    disabled={disabled}
                    className={'group av-cell' + (isSelected ? ' is-sel' : '')}
                  >
                    <ThumbWithFallback
                      primary={l.thumb}
                      fallbacks={[openGroup.thumb]}
                      alt={l.name}
                      className="absolute inset-0 h-full w-full object-cover"
                      eager={i < 6}
                      withSkeleton
                    />
                    <span className="av-gloss" aria-hidden />
                    <span className="av-spot" aria-hidden />
                    <span className="av-sheen" aria-hidden />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-1.5 pt-6">
                      <div className="truncate text-[11px] font-semibold" style={{ color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>{l.name}</div>
                    </div>
                    {isSelected ? (
                      <div className="absolute right-1 top-1 rounded-full bg-lime px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black shadow-[0_0_14px_-3px_rgba(200,232,124,0.9)]">
                        ✓ Use
                      </div>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Skeleton GRID no carregamento inicial — estrutura premium antes das
       *  thumbs chegarem (so quando ainda nao ha nenhum avatar). */}
      {(!inlineMode || !openGroup) && loading && groups.length === 0 ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-3 px-0.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square"
              style={{ animation: 'av-pop-in 0.4s ease both', animationDelay: `${Math.min(i, 10) * 28}ms` }}
            >
              <div className="av-skel-cell" />
            </div>
          ))}
        </div>
      ) : null}

      {/* Empty state — filtro nao casou nenhum avatar */}
      {(!inlineMode || !openGroup) && !loading && !error && groups.length > 0 && filteredGroups.length === 0 ? (
        <div className="mt-3 flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-strong bg-bg-soft/30 px-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-bg-soft/60 text-text-muted">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <div className="text-[13px] font-semibold text-white">Nenhum avatar encontrado</div>
          <div className="max-w-[260px] text-[11px] text-text-muted">
            Nada casou com <span className="font-semibold text-text">&ldquo;{query}&rdquo;</span>. Tente outro nome.
          </div>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-1 rounded-full border border-line-strong bg-bg-soft/60 px-3 py-1 text-[10px] uppercase tracking-widest text-text-muted transition-all hover:border-lime hover:text-lime"
          >
            Limpar busca
          </button>
        </div>
      ) : null}

      {/* Grid de AVATARES (igual UI "Choose an Avatar" do HeyGen) */}
      {(!inlineMode || !openGroup) && filteredGroups.length > 0 ? (
        <div
          className={
            'mt-3 grid grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-3 px-0.5 pb-1 ' +
            // No popup (inlineMode) o scroll é do corpo do popup → grid flui sem
            // segundo scrollbar. Na página cheia, o grid tem seu próprio scroll.
            (inlineMode ? '' : 'max-h-[540px] overflow-y-auto overflow-x-hidden pr-1')
          }
        >
          {filteredGroups.map((g, i) => {
            const isSelectedGroup = selected?.groupId === g.id;
            // Fallbacks pro thumb do grupo: thumb do 1o look, 2o look, etc
            const fallbacks = g.looks.map((l) => l.thumb);
            return (
              // Wrapper leve (div) só pro sizing do grid. av-cv
              // (content-visibility) vai no BOTAO: pula paint/decode das ~110
              // fora do viewport SEM cortar o glow do hover/selecionado (a paint
              // containment só clipa descendentes, não a box-shadow do próprio
              // elemento). Sem Tilt3D = sem 132 handlers de mousemove/estado =
              // abertura e scroll fluidos; hover é só lift CSS (discreto).
              <div key={g.id} className="aspect-square">
                <button
                  type="button"
                  onClick={() => setOpenGroupId(g.id)}
                  disabled={disabled}
                  className={'group av-cell av-cv' + (isSelectedGroup ? ' is-sel' : '')}
                  title={`${g.name} - ${g.looksCount} look${g.looksCount > 1 ? 's' : ''}`}
                >
                  <ThumbWithFallback
                    primary={g.thumb}
                    fallbacks={fallbacks}
                    alt={g.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    eager={i < 8}
                    onAllFailed={reportThumbFailed}
                    withSkeleton
                  />
                  <span className="av-gloss" aria-hidden />
                  <span className="av-spot" aria-hidden />
                  <span className="av-sheen" aria-hidden />
                  {/* chip de looks — canto sup. esq., glass sutil (so multi-look) */}
                  {g.looksCount > 1 ? (
                    <div className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full border border-white/15 bg-black/40 px-1.5 py-[3px] text-[8px] font-semibold text-white/90 backdrop-blur-sm">
                      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                        <rect x="3" y="3" width="13" height="13" rx="2" />
                        <path d="M8 21h11a2 2 0 0 0 2-2V8" />
                      </svg>
                      {g.looksCount}
                    </div>
                  ) : null}
                  {/* Overlay nome + hint "ver looks" no hover */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-2.5 pt-7">
                    {/* cor fixa inline (sem classe text-white) → não escurece no
                     *  tema claro: o texto vive sobre o scrim escuro da foto. */}
                    <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
                      {g.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[8.5px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                      <span className="group-hover:hidden"><span className="mono tabular-nums">{g.looksCount}</span> look{g.looksCount > 1 ? 's' : ''}</span>
                      <span className="hidden items-center gap-0.5 group-hover:inline-flex" style={{ color: '#fff' }}>Ver looks →</span>
                    </div>
                  </div>
                  {isSelectedGroup ? (
                    <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-lime text-[10px] font-bold text-black shadow-[0_0_14px_-3px_rgba(200,232,124,0.9)]">
                      ✓
                    </div>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Drawer dos LOOKS — so abre como modal se NAO for inlineMode.
       *  No inlineMode os looks aparecem inline acima (substituem o grid). */}
      {!inlineMode && openGroup ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-md sm:items-center"
          onClick={() => setOpenGroupId(null)}
          style={{ animation: 'fade-in-up 0.2s ease' }}
        >
          <div
            className="glass-panel relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-[22px] border border-violet/25 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85),0_0_60px_-24px_rgba(167,139,250,0.5)] sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'av-pop-in 0.28s cubic-bezier(.2,.8,.2,1)' }}
          >
            {/* faixa gradiente decorativa no topo */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet/60 to-transparent" />
            <div className="mb-4 flex items-center gap-3">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-violet/40 ring-offset-2 ring-offset-bg">
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
                <div className="mono text-[10px] uppercase tracking-wider text-text-muted">
                  {openGroup.looksCount} look{openGroup.looksCount > 1 ? 's' : ''} disponíve{openGroup.looksCount > 1 ? 'is' : 'l'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenGroupId(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-soft/60 text-text-muted transition-all hover:rotate-90 hover:border-lime hover:text-lime"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(162px,1fr))] gap-3">
              {openGroup.looks.map((l, i) => {
                const isSelected = selected?.id === l.id;
                return (
                  <div key={l.id} className="aspect-[3/4]">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(lookToOption(l));
                        setOpenGroupId(null);
                      }}
                      disabled={disabled}
                      className={'group av-cell' + (isSelected ? ' is-sel' : '')}
                    >
                      <ThumbWithFallback
                        primary={l.thumb}
                        fallbacks={[openGroup.thumb]}
                        alt={l.name}
                        className="absolute inset-0 h-full w-full object-cover"
                        eager={i < 9}
                        withSkeleton
                      />
                      <span className="av-gloss" aria-hidden />
                      <span className="av-spot" aria-hidden />
                      <span className="av-sheen" aria-hidden />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-2 pt-6">
                        <div className="truncate text-[12px] font-semibold" style={{ color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
                          {l.name}
                        </div>
                      </div>
                      {isSelected ? (
                        <div className="absolute right-1.5 top-1.5 rounded-full bg-lime px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-black shadow-[0_0_14px_-3px_rgba(200,232,124,0.9)]">
                          ✓ Use
                        </div>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Pill do selecionado embaixo */}
      {selected ? (
        <div
          className="mt-3 flex items-center gap-3 rounded-[14px] border border-lime/30 bg-gradient-to-r from-lime/10 to-lime/[0.03] px-3 py-2 text-xs text-lime shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_24px_-12px_rgba(200,232,124,0.6)]"
          style={{ animation: 'av-pop-in 0.3s cubic-bezier(.2,.8,.2,1)' }}
        >
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-lime/40">
            <ThumbWithFallback
              primary={selected.thumb}
              fallbacks={[]}
              alt={selected.name}
              className="h-full w-full object-cover"
              eager
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="mono text-[8px] uppercase tracking-[0.16em] text-lime/60">Selecionado</div>
            <div className="truncate font-semibold text-white">
              {selected.groupName ? `${selected.groupName} · ${selected.name}` : selected.name}
            </div>
          </div>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime text-[10px] font-bold text-black shadow-[0_0_12px_-2px_rgba(200,232,124,0.9)]">✓</span>
        </div>
      ) : null}
    </div>
  );
}
