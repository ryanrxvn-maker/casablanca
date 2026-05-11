'use client';

import { useEffect, useState } from 'react';

type VoiceOption = { id: string; name: string; gender?: string | null; language?: string | null };

/**
 * Picker de voz compacto pra usar inline em listas.
 * Default null = usar voz padrao do avatar. Click pra abrir modal +
 * escolher voz custom (override). Reset volta pra null.
 *
 * Reusa /api/heygen/voices que ja existe no projeto.
 */
export function CompactVoiceSelector({
  selected,
  setSelected,
}: {
  selected: { id: string; name: string } | null;
  setSelected: (v: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/heygen/voices?q=${encodeURIComponent(query.trim())}&lang=pt`);
        const j = await r.json();
        if (r.ok && Array.isArray(j.voices)) setResults(j.voices);
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          'group flex w-full max-w-[400px] items-center gap-2 rounded-[10px] border border-line-strong bg-bg-soft/40 px-2 py-1.5 text-left transition hover:border-lime hover:bg-lime/5 ' +
          (selected ? 'border-lime/40' : '')
        }
        title={selected?.name ?? 'Voz padrao do avatar'}
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg text-[10px] font-bold text-text-muted">
          🎤
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs">
            {selected ? selected.name : <span className="text-text-muted">Voz padrao do avatar</span>}
          </div>
          {!selected ? (
            <div className="mono text-[8px] uppercase tracking-widest text-text-muted">
              click pra escolher voz custom
            </div>
          ) : null}
        </div>
        <span className="mono shrink-0 rounded-full border border-line-strong px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-text-muted group-hover:border-lime group-hover:text-lime">
          Trocar
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[16px] border border-lime/30 bg-bg p-4 shadow-[0_0_40px_-10px_rgba(200,255,0,0.4)]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="mono text-xs uppercase tracking-widest text-lime">Escolher voz custom</h3>
              <div className="flex items-center gap-2">
                {selected ? (
                  <button
                    type="button"
                    onClick={() => { setSelected(null); setOpen(false); }}
                    className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                  >
                    Voltar pra voz padrao
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
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar voz HeyGen (pt-BR)..."
              className="input-field"
              autoFocus
            />
            {loading ? (
              <div className="mt-2 text-[11px] text-lime">Buscando...</div>
            ) : null}
            <div className="mt-3 grid gap-1">
              {results.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { setSelected({ id: v.id, name: v.name }); setOpen(false); }}
                  className={
                    'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ' +
                    (selected?.id === v.id ? 'border-lime bg-lime/10' : 'border-line bg-bg-soft/40 hover:border-lime/60')
                  }
                >
                  <span>
                    <span className="text-white">{v.name}</span>
                    {v.gender ? <span className="ml-2 mono text-[10px] uppercase text-text-muted">· {v.gender}</span> : null}
                  </span>
                  {v.language ? <span className="mono text-[10px] uppercase text-text-muted">{v.language}</span> : null}
                </button>
              ))}
              {!loading && results.length === 0 && query ? (
                <div className="text-[11px] text-text-muted">Nenhuma voz encontrada pra "{query}".</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
