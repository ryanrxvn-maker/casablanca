'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';

type Mode = 'video' | 'audio-mp3' | 'audio-wav';
type Quality = '1080' | '720' | '480' | 'best';
type JobState = 'queued' | 'running' | 'done' | 'error';

type Job = {
  id: string;
  url: string;
  state: JobState;
  filename: string | null;
  error: string | null;
};

const MODES: { value: Mode; label: string }[] = [
  { value: 'video', label: 'Vídeo (MP4)' },
  { value: 'audio-mp3', label: 'Áudio (MP3)' },
  { value: 'audio-wav', label: 'Áudio (WAV)' },
];

const QUALITIES: { value: Quality; label: string }[] = [
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: 'best', label: 'Máxima' },
];

function detectSource(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('tiktok')) return 'TikTok';
  if (u.includes('instagr')) return 'Instagram';
  if (u.includes('youtu')) return 'YouTube';
  return '—';
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
}

export default function DownloaderPage() {
  const [raw, setRaw] = useToolState<string>('downloader:urls', '');
  const [mode, setMode] = useToolState<Mode>('downloader:mode', 'video');
  const [quality, setQuality] = useToolState<Quality>(
    'downloader:quality',
    '1080',
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);

  const urls = raw
    .split(/[\n\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  async function processOne(url: string, idx: number) {
    setJobs((prev) =>
      prev.map((j, i) => (i === idx ? { ...j, state: 'running' } : j)),
    );
    try {
      const res = await fetch('/api/downloader', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, mode, quality }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {
          /* binário/sem json */
        }
        throw new Error(msg);
      }

      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/i);
      const filename = m ? m[1] : `download-${Date.now()}`;
      const blob = await res.blob();
      triggerDownload(blob, filename);

      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx ? { ...j, state: 'done', filename } : j,
        ),
      );
    } catch (e) {
      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx
            ? {
                ...j,
                state: 'error',
                error: e instanceof Error ? e.message : String(e),
              }
            : j,
        ),
      );
    }
  }

  async function handleStart() {
    if (urls.length === 0 || running) return;
    const initial: Job[] = urls.map((url, i) => ({
      id: `${Date.now()}-${i}`,
      url,
      state: 'queued',
      filename: null,
      error: null,
    }));
    setJobs(initial);
    setRunning(true);
    for (let i = 0; i < urls.length; i++) {
      // sequencial: evita saturar banda/CPU do servidor
      // eslint-disable-next-line no-await-in-loop
      await processOne(urls[i], i);
    }
    setRunning(false);
  }

  return (
    <ToolShell
      title="Downloader"
      description="Baixe vídeos ou áudio do YouTube, Instagram (Reels/posts) e TikTok. Usa yt-dlp + ffmpeg no servidor — cole um ou vários links (um por linha)."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field" htmlFor="urls">
            Links (um por linha)
          </label>
          <textarea
            id="urls"
            rows={4}
            placeholder={
              'https://youtube.com/watch?v=...\nhttps://instagram.com/reel/...\nhttps://tiktok.com/@user/video/...'
            }
            className="input-field font-mono text-xs"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            disabled={running}
          />
          {urls.length > 0 && (
            <p className="mono mt-2 text-[11px] text-text-muted">
              {urls.length} link{urls.length > 1 ? 's' : ''} detectado
              {urls.length > 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label-field">Formato</span>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={running}
                  onClick={() => setMode(m.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-[0.95] ${
                    mode === m.value
                      ? 'border-lime text-lime'
                      : 'border-line-strong text-text-muted hover:border-lime hover:text-lime'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label-field">
              Qualidade {mode !== 'video' && '(só vídeo)'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  disabled={running || mode !== 'video'}
                  onClick={() => setQuality(q.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-[0.95] disabled:opacity-40 ${
                    quality === q.value && mode === 'video'
                      ? 'border-lime text-lime'
                      : 'border-line-strong text-text-muted hover:border-lime hover:text-lime'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={urls.length === 0 || running}
          onClick={handleStart}
        >
          {running
            ? 'Baixando…'
            : urls.length > 1
              ? `Baixar ${urls.length} arquivos`
              : 'Baixar'}
        </button>

        {jobs.length > 0 && (
          <div className="flex flex-col gap-2">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="card-3d card-pad flex items-center justify-between gap-3 !py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-xs text-white">
                    {j.filename || j.url}
                  </div>
                  <div className="mono mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">
                    {detectSource(j.url)}
                    {j.error ? ` · ${j.error}` : ''}
                  </div>
                </div>
                <span
                  className={`mono shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest ${
                    j.state === 'done'
                      ? 'border-lime text-lime'
                      : j.state === 'error'
                        ? 'border-red-500/60 text-red-300'
                        : j.state === 'running'
                          ? 'border-lime/60 text-lime'
                          : 'border-line-strong text-text-muted'
                  }`}
                >
                  {j.state === 'queued'
                    ? 'fila'
                    : j.state === 'running'
                      ? 'baixando'
                      : j.state === 'done'
                        ? 'ok'
                        : 'erro'}
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mono text-[10px] leading-relaxed text-text-muted">
          Requer <span className="text-white">yt-dlp</span> e{' '}
          <span className="text-white">ffmpeg</span> no servidor. Links
          privados (Instagram/TikTok fechados) exigem login e não são
          suportados. Use apenas para conteúdo que você tem direito de baixar.
        </p>
      </div>
    </ToolShell>
  );
}
