'use client';

import { useEffect, useState } from 'react';

/**
 * HeyGenAvatarPicker — busca avatares HeyGen por nome com preview thumbnail.
 *
 * Compartilhado entre HeyGen Auto Avatar e Mind Ads Suite. Faz lookup
 * via /api/heygen/avatars (que usa a API HeyGen pra previews).
 */

export type AvatarOption = {
  id: string;
  name: string;
  thumb: string | null;
  videoPreview: string | null;
  gender: string | null;
  premium: boolean;
  type: 'avatar' | 'photo';
  isCustom?: boolean;
};

export function HeyGenAvatarPicker({
  query,
  setQuery,
  selected,
  setSelected,
  motor,
  disabled,
  label = 'Avatar (busca por nome)',
}: {
  query: string;
  setQuery: (s: string) => void;
  selected: AvatarOption | null;
  setSelected: (a: AvatarOption | null) => void;
  motor?: 'III' | 'IV' | 'V';
  disabled?: boolean;
  label?: string;
}) {
  const [results, setResults] = useState<AvatarOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    // Busca mesmo com query vazia se motor estiver setado
    // (assim mostra a lista filtrada por motor antes do user digitar)
    if (!query.trim() && !motor) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (motor) params.set('motor', motor);
        const res = await fetch(`/api/heygen/avatars?${params.toString()}`);
        const json = await res.json();
        if (res.ok && Array.isArray(json.avatars)) {
          setResults(json.avatars);
          setTotal(Number(json.total ?? 0));
        }
      } catch {
        /* ignora */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, motor]);

  return (
    <div>
      <h2 className="label-field !mb-3">{label}</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          motor
            ? `Avatar ${motor} — digite pra filtrar (deixa vazio pra ver todos)`
            : 'Digite o nome do avatar (ex: Maya, Lucas...)'
        }
        className="input-field"
        disabled={disabled}
      />
      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-lime">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
          </span>
          Buscando no HeyGen...
        </div>
      ) : results.length > 0 ? (
        <div className="mt-2 text-[11px] text-text-muted">
          {results.length} de {total} avatares
          {motor ? ` (motor ${motor})` : ''}
        </div>
      ) : null}
      {results.length > 0 ? (
        <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto">
          {results.map((a) => {
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
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    {a.name}
                    {a.isCustom ? (
                      <span className="mono rounded-full bg-lime/15 px-1.5 py-0 text-[9px] uppercase text-lime">
                        custom
                      </span>
                    ) : null}
                  </div>
                  <div className="mono text-[11px] uppercase text-text-muted">
                    {a.type === 'photo' ? 'avatar III · photo' : a.premium ? 'avatar V · premium' : 'avatar IV · studio'}
                    {a.gender ? ' · ' + a.gender : ''}
                  </div>
                </div>
                {active ? (
                  <span className="mono text-xs text-lime">SELECIONADO</span>
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
            id: {selected.id.slice(0, 12)}...
          </span>
        </div>
      ) : null}
    </div>
  );
}
