'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HistoryVideo } from '@/lib/heygen-api-direct';

// The batch started on 29 Sep 2026 at 20:22 UTC. Only show projects
// submitted since then; older videos with the same AD title are unrelated.
const BATCH_STARTED_AT = Date.parse('2026-09-29T20:22:00Z');
const TITLE = /^(AD\d+VN)_(HOOK|BODY)\s+(\d+)$/i;

export function PilotHeyGenActivity({ active }: { active: boolean }) {
  const [videos, setVideos] = useState<HistoryVideo[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const { listMyVideos } = await import('@/lib/heygen-api-direct');
        const found: HistoryVideo[] = [];
        for (let page = 1; page <= 8; page++) {
          const result = await listMyVideos({ limit: 100, page });
          if (cancelled) return;
          found.push(...result.items);
          if (!result.hasMore || result.items.some((v) => v.createdAt > 0 && v.createdAt < BATCH_STARTED_AT)) break;
        }
        const unique = new Map<string, HistoryVideo>();
        for (const video of found) {
          if (!TITLE.test(video.name) || video.createdAt < BATCH_STARTED_AT || !video.createdAt) continue;
          unique.set(video.videoId, video);
        }
        if (!cancelled) setVideos([...unique.values()]);
      } catch (error) {
        // This is supplemental visibility. A failed HeyGen read must not
        // replace or mutate the Pilot's actual background queue.
        console.warn('[Pilot] HeyGen activity could not be read:', error);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active]);

  const groups = useMemo(() => {
    const byAd = new Map<string, HistoryVideo[]>();
    for (const video of videos) {
      const ad = video.name.match(TITLE)?.[1];
      if (ad) byAd.set(ad, [...(byAd.get(ad) || []), video]);
    }
    return [...byAd.entries()].sort((a, b) => Math.max(...b[1].map((v) => v.createdAt)) - Math.max(...a[1].map((v) => v.createdAt)));
  }, [videos]);

  if (!active || groups.length === 0) return null;
  return (
    <section className="mt-4 rounded-[18px] border border-fuchsia-500/25 bg-bg-soft p-4" aria-label="Takes no HeyGen">
      <h2 className="label-tech mb-3 text-[10px] tracking-widest text-fuchsia-200">
        Em produção no HeyGen · {groups.length} ADs · {videos.length} takes
      </h2>
      <div className="grid gap-2">
        {groups.map(([ad, takes]) => {
          const pending = takes.filter((v) => v.status === 'pending' || v.status === 'unknown').length;
          const failed = takes.filter((v) => v.status === 'failed').length;
          return (
            <details key={ad} className="rounded-[10px] border border-line bg-bg/60 px-3 py-2">
              <summary className="cursor-pointer text-[12px] text-white">
                <strong>{ad}</strong> · {takes.length} takes · {pending ? `${pending} gerando` : 'renderizados'}{failed ? ` · ${failed} falha(s)` : ''}
              </summary>
              <ul className="mt-2 grid gap-1 text-[11px] text-text-muted">
                {takes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((take) => (
                  <li key={take.videoId}>
                    <a className="hover:text-white hover:underline" href={`https://app.heygen.com/videos/${take.videoId}`} target="_blank" rel="noreferrer">
                      {take.name} · {take.status === 'completed' ? 'pronto' : take.status === 'failed' ? 'falhou' : 'gerando'}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
