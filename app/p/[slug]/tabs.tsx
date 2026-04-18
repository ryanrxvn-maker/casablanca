'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type VideoItem = {
  id: string;
  title: string;
  category: string;
  niche: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
};

type ProofItem = {
  id: string;
  image_url: string;
  caption: string | null;
};

export function PublicPortfolioTabs({
  videos,
  proofs,
}: {
  videos: VideoItem[];
  proofs: ProofItem[];
}) {
  // Agrupa categorias + aba "Resultados" no final se houver provas
  const categories = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => set.add(v.category));
    const arr = Array.from(set);
    if (proofs.length) arr.push('__proofs__');
    return arr;
  }, [videos, proofs]);

  const [active, setActive] = useState<string>(categories[0] ?? '');

  const filtered = videos.filter((v) => v.category === active);

  return (
    <section>
      <div className="mb-8 -mb-px flex gap-1 overflow-x-auto border-b border-line">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={cn(
              'tab-link',
              active === c && 'tab-link-active'
            )}
          >
            {c === '__proofs__' ? 'Resultados' : c}
          </button>
        ))}
      </div>

      {active === '__proofs__' ? (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {proofs.map((p) => (
            <figure
              key={p.id}
              className="mb-4 break-inside-avoid overflow-hidden rounded-[12px] border border-line bg-bg-soft transition hover:border-lime/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image_url} alt={p.caption ?? ''} className="w-full" />
              {p.caption && (
                <figcaption className="px-3 py-2 text-xs text-text-muted">
                  {p.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.length === 0 && (
            <div className="col-span-full rounded-[12px] border border-dashed border-line-strong p-10 text-center text-sm text-text-muted">
              Nenhum vídeo ainda nesta categoria.
            </div>
          )}
          {filtered.map((v) => (
            <a
              key={v.id}
              href={v.video_url ?? '#'}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-[12px] border border-line bg-bg-soft transition hover:border-lime"
            >
              <div className="aspect-video w-full bg-black">
                {v.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{v.title}</div>
                {v.niche && (
                  <div className="text-xs text-text-muted">{v.niche}</div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
