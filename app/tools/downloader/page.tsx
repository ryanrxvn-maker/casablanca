'use client';

import { useEffect, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { createClient } from '@/lib/supabase/client';

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

const ADULT_SITES = [
  'pornhub.com',
  'xvideos.com',
  'xhamster.com',
  'redtube.com',
  'youporn.com',
  'xvideosputaria.com',
  'buceteiro.com',
];

function detectSource(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('tiktok')) return 'TikTok';
  if (u.includes('pinterest') || u.includes('pin.it')) return 'Pinterest';
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
  // Detecção automática da extensão (igual Magnific/HeyGen): se a
  // extensão estiver instalada ela responde DL_PONG -> mostramos a
  // pílula verde no lugar das instruções.
  const [ext, setExt] = useState<{
    connected: boolean;
    version?: string;
    engine?: boolean;
  }>({ connected: false });

  useEffect(() => {
    let alive = true;
    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || d.source !== 'darko-dl-ext' || d.type !== 'DL_PONG') return;
      if (!alive) return;
      setExt({
        connected: true,
        version: d.version,
        engine: d.engine === true,
      });
    }
    window.addEventListener('message', onMsg);
    const ping = () =>
      window.postMessage({ source: 'darko-dl', type: 'DL_PING' }, '*');
    ping();
    // re-tenta: a bridge pode anexar logo após o load
    const t1 = setTimeout(ping, 600);
    const t2 = setTimeout(ping, 1800);
    const t3 = setTimeout(ping, 3500);
    return () => {
      alive = false;
      window.removeEventListener('message', onMsg);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  // Modo +18 — visivel/utilizavel SO por admin. O gate real e no
  // servidor (requireAdmin); aqui e so UI.
  const [isAdmin, setIsAdmin] = useState(false);
  const [adult, setAdult] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', u.user.id)
          .maybeSingle();
        if (alive) setIsAdmin(!!data?.is_admin);
      } catch {
        /* sem sessao = nao admin */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
        body: JSON.stringify({ url, mode, quality, adult: isAdmin && adult }),
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
    // Pool concorrente: ate 3 downloads em paralelo (lote rapido sem
    // saturar banda/CPU do servidor).
    const CONCURRENCY = 3;
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        // eslint-disable-next-line no-await-in-loop
        await processOne(urls[i], i);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker),
    );
    setRunning(false);
  }

  return (
    <ToolShell
      title="Downloader"
      eyebrow="WEB"
      description="Baixa vídeos, áudios e imagens do YouTube, Instagram, TikTok e Pinterest. Cola um link ou vários, um por linha."
    >
      <div className="flex flex-col gap-6">
        {/* Extensão detectada -> pílula verde (igual Magnific/HeyGen).
            Não detectada -> instruções de instalação. */}
        {ext.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-lime">
                Extensão DARKO LAB Downloader v{ext.version}
              </span>
              <span
                className={`mono ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase ${
                  ext.engine
                    ? 'bg-lime/15 text-lime'
                    : 'bg-red-500/15 text-red-300'
                }`}
              >
                {ext.engine ? '✓ motor online' : '✗ motor offline'}
              </span>
            </div>
          </div>
        ) : (
        <div className="rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lime">⬇</span>
            <strong className="flex-1 text-sm text-lime">
              Extensão + Motor (clica e baixa em qualquer site, no seu PC)
            </strong>
          </div>
          <p className="mono mt-1 text-[11px] text-text-muted">
            Instala uma vez, em 1 clique. Aí aparece um botão <b>Baixar</b>{' '}
            direto nos vídeos do YouTube, Instagram, TikTok, Pinterest (e
            +18) — sem código, sem pareamento, sem servidor.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="/api/downloader-engine/download"
              className="btn-primary !py-2 text-xs"
              download
            >
              1. Instalar o Motor (1 clique)
            </a>
            <a
              href="/api/downloader-extension/download"
              className="btn-secondary !py-2 text-xs"
              download
            >
              2. Baixar a Extensão
            </a>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-lime/80 hover:text-lime">
              Como instalar (passo a passo)
            </summary>
            <ol className="mono mt-2 list-decimal space-y-1 pl-5 text-[11px] text-text-muted">
              <li>
                Clica em <b>1. Instalar o Motor</b> e dá <b>duplo-clique</b>{' '}
                no{' '}
                <code className="mono text-white">
                  DarkoDownloaderSetup.exe
                </code>{' '}
                (ícone DARKO). Se o Windows avisar (SmartScreen),
                &quot;Mais informações&quot; → &quot;Executar assim
                mesmo&quot;. A UI DARKO mostra o progresso e finaliza com{' '}
                <b>&quot;Instalado e vinculado!&quot;</b>.
              </li>
              <li>
                Clica em <b>2. Baixar a Extensão</b> e extrai numa pasta.
                Abre{' '}
                <code className="mono text-white">chrome://extensions</code>,
                liga o <i>Modo de desenvolvedor</i>, clica{' '}
                <i>Carregar sem compactação</i> e seleciona a pasta.
              </li>
              <li>
                Pronto. <b>Não precisa colar código nem parear nada</b> — a
                extensão pega o token do motor sozinha. Abre um vídeo em
                qualquer site suportado e clica no botão{' '}
                <b>⬇ Baixar</b> que aparece na página.
              </li>
            </ol>
            <p className="mono mt-2 text-[10px] text-text-muted">
              Requer Windows 64-bit. O motor roda no PC do usuário (não
              precisa do seu PC ligado nem de servidor). +18 já vem
              habilitado. O instalador é leve (~50&nbsp;KB) e baixa Node +
              yt-dlp + ffmpeg + Chromium (~250&nbsp;MB, uma vez,
              ~1–2&nbsp;min) automaticamente. Componentes já presentes são
              pulados.
            </p>
          </details>
        </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0" htmlFor="urls">
              Links (um por linha)
            </label>
            {isAdmin && (
              <button
                type="button"
                aria-label="Modo +18"
                title={
                  adult
                    ? 'Modo +18 ativado (Full HD, otimizado)'
                    : 'Ativar modo +18 (admin)'
                }
                onClick={() => setAdult((v) => !v)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[8px] font-black leading-none tracking-tight transition-all duration-200 active:scale-90 ${
                  adult
                    ? 'border-red-500 bg-red-600 text-white shadow-[0_0_10px_rgba(220,38,38,0.6)]'
                    : 'border-red-900/60 bg-transparent text-red-700/70 hover:border-red-600 hover:text-red-500'
                }`}
              >
                +18
              </button>
            )}
          </div>
          <textarea
            id="urls"
            rows={4}
            placeholder={
              'https://youtube.com/watch?v=...\nhttps://tiktok.com/@user/video/...\nhttps://pinterest.com/pin/...\nhttps://instagram.com/reel/...'
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
          {isAdmin && adult && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2">
              <p className="mono text-[10px] uppercase tracking-widest text-red-400">
                Modo +18 ativo — sites suportados (Full HD, otimizado)
              </p>
              <div className="mono mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-red-300/80">
                {ADULT_SITES.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>
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
          <span className="text-white">TikTok</span>{' '}
          <span className="text-lime">sem marca d&apos;água em HD</span>{' '}
          (esquema savett) ·{' '}
          <span className="text-white">Pinterest</span> mídia direta
          (esquema klickpin) ·{' '}
          <span className="text-white">YouTube/Instagram</span> yt-dlp.
          Downloads paralelos (3x) e acelerados (multi-conexão). Links
          privados exigem login. Use apenas para conteúdo que você tem
          direito de baixar.
        </p>
      </div>
    </ToolShell>
  );
}
