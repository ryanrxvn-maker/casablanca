'use client';

import { useEffect, useMemo, useState } from 'react';
import { CoverBackground } from '@/components/CoverBackground';

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

type PublicProfile = {
  name: string | null;
  avatar_url: string | null;
  whatsapp: string | null;
  showAvatar: boolean;
  cover: string;
};

type Tab = 'videos' | 'proofs';

function whatsappHref(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}`;
}

function coverBackground(cover: string): string {
  switch (cover) {
    case 'matrix':
      return 'bg-[radial-gradient(ellipse_at_top,_rgba(132,204,22,0.18),_transparent_60%),linear-gradient(180deg,_#080c06,_#030503)]';
    case 'dollars':
      return 'bg-[radial-gradient(ellipse_at_top,_rgba(34,197,94,0.2),_transparent_60%),linear-gradient(180deg,_#030b06,_#020302)]';
    case 'tech':
      return 'bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.15),_transparent_60%),linear-gradient(180deg,_#030712,_#020409)]';
    case 'minimal':
      return 'bg-[linear-gradient(180deg,_#0a0a0a,_#020202)]';
    default:
      return 'bg-[radial-gradient(ellipse_at_top,_rgba(132,204,22,0.12),_transparent_55%),linear-gradient(180deg,_#0a0a0a,_#030303)]';
  }
}

export function PublicPortfolioLayout({
  profile,
  videos,
  proofs,
}: {
  profile: PublicProfile;
  videos: VideoItem[];
  proofs: ProofItem[];
}) {
  const [tab, setTab] = useState<Tab>(videos.length > 0 ? 'videos' : 'proofs');
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const [zoomProof, setZoomProof] = useState<ProofItem | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

  const categories = useMemo(() => {
    const s = new Set<string>();
    videos.forEach((v) => s.add(v.category));
    return Array.from(s);
  }, [videos]);
  const [activeCat, setActiveCat] = useState<string>(categories[0] ?? '');

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCat)) {
      setActiveCat(categories[0]);
    }
  }, [categories, activeCat]);

  // Escape fecha modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPlaying(null);
        setZoomProof(null);
        setZoomScale(1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const whatsapp = profile.whatsapp ? whatsappHref(profile.whatsapp) : '';
  const displayName = profile.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  const filteredVideos = videos.filter((v) => v.category === activeCat);

  return (
    <div className={'relative flex min-h-screen flex-col ' + coverBackground(profile.cover)}>
      {/* Hero / cabecalho com foto circular */}
      <header className="relative overflow-hidden">
        <CoverBackground cover={profile.cover} />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-lime/10 blur-3xl" />
          <div className="absolute -right-32 top-16 h-96 w-96 rounded-full bg-lime/5 blur-3xl" />
        </div>

        <div className="container-app relative flex flex-col items-center gap-6 py-16 text-center md:py-20">
          {profile.showAvatar ? (
            <div className="relative">
              <div className="absolute inset-0 -m-1 rounded-full bg-gradient-to-br from-lime/60 via-lime/20 to-transparent blur-sm" />
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={displayName}
                  className="relative h-28 w-28 rounded-full border-2 border-lime/60 object-cover shadow-[0_8px_40px_rgba(132,204,22,0.25)] md:h-32 md:w-32"
                />
              ) : (
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-2 border-lime/60 bg-bg text-4xl font-black text-lime shadow-[0_8px_40px_rgba(132,204,22,0.25)] md:h-32 md:w-32">
                  {initial}
                </div>
              )}
            </div>
          ) : null}

          <div>
            <h1 className="text-4xl font-black tracking-tight md:text-6xl">
              {displayName}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-text-muted md:text-base">
              Trabalhos selecionados, resultados de clientes e antes/depois.
            </p>
          </div>
        </div>
      </header>

      {/* Switch principal Videos / Resultados */}
      <div className="container-app sticky top-0 z-20 -mb-px border-b border-line/60 bg-bg/80 py-3 backdrop-blur-md">
        <div className="flex items-center justify-center gap-1 rounded-full border border-line bg-bg/60 p-1 text-xs font-semibold uppercase tracking-widest md:text-sm">
          <button
            onClick={() => setTab('videos')}
            className={
              'rounded-full px-5 py-2 transition ' +
              (tab === 'videos'
                ? 'bg-lime text-bg shadow'
                : 'text-text-muted hover:text-white')
            }
          >
            Videos
          </button>
          <button
            onClick={() => setTab('proofs')}
            className={
              'rounded-full px-5 py-2 transition ' +
              (tab === 'proofs'
                ? 'bg-lime text-bg shadow'
                : 'text-text-muted hover:text-white')
            }
          >
            Resultados
          </button>
        </div>
      </div>

      <main className="container-app flex-1 py-10 md:py-14">
        {tab === 'videos' ? (
          <>
            {categories.length > 1 ? (
              <div className="mb-8 flex flex-wrap justify-center gap-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setActiveCat(c)}
                    className={
                      'rounded-full border px-4 py-1.5 text-xs font-medium transition ' +
                      (c === activeCat
                        ? 'border-lime bg-lime/10 text-lime'
                        : 'border-line bg-bg text-text-muted hover:border-lime/40 hover:text-white')
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}

            {filteredVideos.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-line/60 bg-bg/40 p-14 text-center text-sm text-text-muted">
                Nenhum video por aqui ainda.
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filteredVideos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => v.video_url && setPlaying(v)}
                    className="group relative flex flex-col overflow-hidden rounded-[16px] border border-line/60 bg-bg-soft/60 text-left transition duration-300 hover:-translate-y-1 hover:border-lime/60 hover:shadow-[0_12px_40px_rgba(132,204,22,0.18)]"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-black">
                      {v.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.thumbnail_url}
                          alt={v.title}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-text-dim">
                          sem thumbnail
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition group-hover:opacity-100">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-lime text-bg shadow-lg">
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M6 4.75v10.5a.75.75 0 001.16.62l8.25-5.25a.75.75 0 000-1.24L7.16 4.13A.75.75 0 006 4.75z" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 p-4">
                      <div className="truncate text-sm font-semibold">{v.title}</div>
                      {v.niche ? (
                        <div className="mt-1 text-xs text-text-muted">{v.niche}</div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {proofs.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-line/60 bg-bg/40 p-14 text-center text-sm text-text-muted">
                Nenhum resultado publicado ainda.
              </div>
            ) : (
              <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
                {proofs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setZoomProof(p);
                      setZoomScale(1);
                    }}
                    className="mb-5 block w-full break-inside-avoid overflow-hidden rounded-[14px] border border-line/60 bg-bg-soft/60 text-left transition duration-300 hover:-translate-y-0.5 hover:border-lime/60 hover:shadow-[0_10px_30px_rgba(132,204,22,0.15)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image_url}
                      alt={p.caption ?? ''}
                      className="w-full transition duration-500 hover:scale-[1.01]"
                    />
                    {p.caption ? (
                      <div className="border-t border-line/40 px-3 py-2 text-xs text-text-muted">
                        {p.caption}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-line/40 bg-bg/40 backdrop-blur-sm">
        <div className="container-app flex h-14 items-center justify-center text-xs text-text-muted">
          Feito com <span className="mx-1 text-lime">CASABLANCA</span>
        </div>
      </footer>

      {/* Modal video player */}
      {playing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={() => setPlaying(null)}
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-[16px] border border-line bg-bg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlaying(null)}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-bg/80 text-white backdrop-blur transition hover:bg-red-500/80"
              aria-label="Fechar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
            {playing.video_url ? (
              <video
                src={playing.video_url}
                controls
                autoPlay
                className="aspect-video w-full bg-black"
              />
            ) : null}
            <div className="border-t border-line px-4 py-3">
              <div className="font-semibold">{playing.title}</div>
              {playing.niche ? (
                <div className="mt-0.5 text-xs text-text-muted">{playing.niche}</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal zoom social proof */}
      {zoomProof ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
          onClick={() => {
            setZoomProof(null);
            setZoomScale(1);
          }}
        >
          <div
            className="relative flex max-h-full max-w-5xl flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 py-2 backdrop-blur">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <button
                  type="button"
                  onClick={() => setZoomScale((s) => Math.max(0.5, s - 0.25))}
                  className="rounded-full border border-line px-2 py-1 text-xs hover:border-lime hover:text-lime"
                  aria-label="Diminuir zoom"
                >
                  −
                </button>
                <span className="mono min-w-[40px] text-center">
                  {Math.round(zoomScale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomScale((s) => Math.min(4, s + 0.25))}
                  className="rounded-full border border-line px-2 py-1 text-xs hover:border-lime hover:text-lime"
                  aria-label="Aumentar zoom"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setZoomScale(1)}
                  className="ml-1 rounded-full border border-line px-2 py-1 text-xs hover:border-lime hover:text-lime"
                >
                  100%
                </button>
              </div>
              <button
                onClick={() => {
                  setZoomProof(null);
                  setZoomScale(1);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-bg/80 text-white transition hover:bg-red-500/80"
                aria-label="Fechar"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black/40 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={zoomProof.image_url}
                alt={zoomProof.caption ?? ''}
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'center top',
                  transition: 'transform 150ms ease',
                }}
                className="mx-auto block max-h-[70vh] max-w-full"
              />
            </div>
            {zoomProof.caption ? (
              <div className="border-t border-line bg-bg/80 px-4 py-3 text-center text-xs text-text-muted backdrop-blur">
                {zoomProof.caption}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* WhatsApp flutuante */}
      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noreferrer"
          className="group fixed bottom-6 left-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_10px_30px_rgba(37,211,102,0.35)] transition duration-200 hover:scale-110 active:scale-95"
          aria-label="Falar no WhatsApp"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-[#25D366] opacity-40" />
          <svg
            viewBox="0 0 32 32"
            fill="currentColor"
            className="relative h-7 w-7"
            aria-hidden
          >
            <path d="M16.003 3C9.378 3 4 8.378 4 15.003c0 2.56.823 4.992 2.29 7.036L4 29l7.147-2.249a11.946 11.946 0 004.856 1.038h.004C22.632 27.79 28 22.412 28 15.79 28 12.64 26.79 9.684 24.6 7.49A11.9 11.9 0 0016.003 3zm0 21.827h-.002a9.82 9.82 0 01-5.003-1.37l-.36-.214-4.24 1.33 1.352-4.13-.234-.376a9.793 9.793 0 01-1.517-5.234c0-5.413 4.4-9.813 9.816-9.813 2.62 0 5.082 1.022 6.937 2.877a9.747 9.747 0 012.873 6.936c0 5.414-4.4 9.994-9.62 9.994zm5.39-7.338c-.296-.148-1.75-.864-2.023-.963-.271-.1-.469-.148-.666.149-.198.296-.764.963-.937 1.16-.173.198-.347.223-.643.074-.296-.148-1.25-.46-2.38-1.467-.88-.786-1.475-1.756-1.648-2.053-.173-.297-.018-.457.13-.605.133-.132.296-.347.444-.52.148-.173.198-.296.296-.494.099-.198.05-.37-.025-.519-.075-.148-.666-1.61-.913-2.203-.24-.575-.484-.497-.666-.506-.173-.008-.37-.01-.568-.01a1.091 1.091 0 00-.79.37c-.272.296-1.037 1.013-1.037 2.47 0 1.457 1.062 2.866 1.21 3.063.148.198 2.09 3.19 5.065 4.473.708.306 1.26.488 1.692.625.71.225 1.357.193 1.869.117.57-.085 1.75-.716 2-1.408.247-.692.247-1.284.173-1.407-.074-.123-.272-.198-.568-.346z" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}
