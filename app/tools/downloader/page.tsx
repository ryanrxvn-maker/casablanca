'use client';

import { useEffect, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { createClient } from '@/lib/supabase/client';
import { ToolStep, ToolChoice, ToolAction } from '@/components/tool-kit';
import { IconDownloader } from '@/components/ToolIcons';

type Mode = 'video' | 'audio-mp3' | 'audio-wav';
type Quality = '1080' | '720' | '480' | 'best';
type JobState = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';

type Job = {
  id: string;
  url: string;
  state: JobState;
  filename: string | null;
  error: string | null;
  /** Bytes recebidos / total (null = ainda não chegou content-length) */
  progress: { received: number; total: number | null } | null;
};

const HUE = 'rgba(96,165,250,0.4)';

const MODES: { value: Mode; label: string; sub: string }[] = [
  { value: 'video', label: 'Vídeo', sub: 'MP4' },
  { value: 'audio-mp3', label: 'Áudio', sub: 'MP3' },
  { value: 'audio-wav', label: 'Áudio', sub: 'WAV' },
];

const QUALITIES: { value: Quality; label: string; sub: string }[] = [
  { value: '1080', label: '1080p', sub: 'Full HD' },
  { value: '720', label: '720p', sub: 'HD' },
  { value: '480', label: '480p', sub: 'Padrão' },
  { value: 'best', label: 'Máxima', sub: 'Original' },
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

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export default function DownloaderPage() {
  const [raw, setRaw] = useToolState<string>('downloader:urls', '');
  const [mode, setMode] = useToolState<Mode>('downloader:mode', 'video');
  const [quality, setQuality] = useToolState<Quality>(
    'downloader:quality',
    '1080',
  );
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
    // Fase 1: 'resolving' — esperando o servidor descobrir/baixar a fonte
    setJobs((prev) =>
      prev.map((j, i) =>
        i === idx ? { ...j, state: 'resolving', progress: null } : j,
      ),
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
      const total = Number(res.headers.get('content-length')) || null;

      // Fase 2: 'downloading' — bytes começando a chegar
      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx
            ? {
                ...j,
                state: 'downloading',
                progress: { received: 0, total },
              }
            : j,
        ),
      );

      // Lê a stream em chunks pra mostrar % na UI ANTES do
      // download nativo do navegador aparecer.
      if (!res.body) {
        // Fallback (browsers muito antigos): cai pra blob direto
        const blob = await res.blob();
        triggerDownload(blob, filename);
      } else {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        // throttle dos setJobs pra não floodar o React
        let lastUpdate = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          received += value.length;
          const now = Date.now();
          if (now - lastUpdate > 100) {
            lastUpdate = now;
            const snap = received;
            setJobs((prev) =>
              prev.map((j, i) =>
                i === idx && j.progress
                  ? {
                      ...j,
                      progress: { received: snap, total: j.progress.total },
                    }
                  : j,
              ),
            );
          }
        }
        const ct = res.headers.get('content-type') || 'application/octet-stream';
        const blob = new Blob(chunks as BlobPart[], { type: ct });
        triggerDownload(blob, filename);
      }

      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx
            ? { ...j, state: 'done', filename, progress: null }
            : j,
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
                progress: null,
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
      progress: null,
    }));
    setJobs(initial);
    setRunning(true);
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
      eyebrow="WEB · MULTI-SITE"
      description="Baixa vídeos, áudios e imagens do YouTube, Instagram, TikTok e Pinterest. Cola um link ou vários, um por linha."
      hue={HUE}
      icon={<IconDownloader size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} title="Extensão + Motor" hint="Instala uma vez, baixa em qualquer site" hue={HUE}>
          {ext.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                </span>
                <span className="text-lime">
                  Auto Edit · Downloader v{ext.version}
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
            <div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <a
                  href="/api/downloader-engine/download"
                  className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-[14px] border border-blue-400/40 bg-blue-400/[0.06] px-4 py-3.5 transition-all hover:-translate-y-[1px] hover:border-blue-400/65"
                  download
                  style={{ boxShadow: '0 0 20px -8px rgba(96,165,250,0.4)' }}
                >
                  <div>
                    <div
                      className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-blue-300"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Passo 01
                    </div>
                    <div
                      className="text-[14px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Instalar o Motor
                    </div>
                    <div className="mono text-[10.5px] text-text-muted">
                      .exe — 1 clique, instala sozinho
                    </div>
                  </div>
                  <span className="text-2xl text-blue-300 transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </a>
                <a
                  href="/api/downloader-extension/download"
                  className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-[14px] border border-line-strong bg-bg-soft/60 px-4 py-3.5 transition-all hover:-translate-y-[1px] hover:border-blue-400/45"
                  download
                >
                  <div>
                    <div
                      className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Passo 02
                    </div>
                    <div
                      className="text-[14px] font-bold tracking-tight text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Baixar Extensão
                    </div>
                    <div className="mono text-[10.5px] text-text-muted">
                      Chrome / chrome://extensions
                    </div>
                  </div>
                  <span className="text-2xl text-text-muted transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </a>
              </div>
              <details className="mt-3 group">
                <summary
                  className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300/80 hover:text-blue-300"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Instruções detalhadas
                </summary>
                <ol className="mono mt-3 list-decimal space-y-2 pl-5 text-[11px] leading-relaxed text-text-muted">
                  <li>
                    Duplo-clique no <code className="mono text-white">AutoEditDownloaderSetup.exe</code>. A janela do prompt abre VISÍVEL mostrando o progresso (1-3 min na 1ª vez).
                  </li>
                  <li>
                    Se o SmartScreen avisar: <i>&quot;Mais informações&quot;</i> → <i>&quot;Executar assim mesmo&quot;</i>.
                  </li>
                  <li>
                    Quando aparecer <b className="text-white">[ OK ] Instalado e vinculado com sucesso</b>, pode fechar.
                  </li>
                  <li>
                    Extrai o ZIP da extensão, abre <code className="mono text-white">chrome://extensions</code>, ativa <i>Modo desenvolvedor</i>, clica <i>Carregar sem compactação</i>.
                  </li>
                  <li>
                    Abre um vídeo em qualquer site e clica no botão <b className="text-white">⬇ Baixar</b> que aparece na página.
                  </li>
                </ol>
                <p className="mono mt-3 text-[10px] leading-relaxed text-text-muted">
                  <span className="text-lime">Anti-antivírus:</span> EXE <b className="text-white">assinado digitalmente</b> (Publisher: Auto Edit, timestamp DigiCert), metadata completa (versão 3.0, descrição, copyright), manifest XML <code>asInvoker</code> (sem UAC), PowerShell visível, sem VBS, sem mods em Startup. Auto-start usa Task Scheduler nativo.
                </p>

                {/* Fallback: ZIP sem .exe — pra casos extremos onde mesmo o
                    .exe assinado é bloqueado por AV corporativo paranóico. */}
                <div className="mt-3 rounded-[10px] border border-yellow-500/30 bg-yellow-500/5 px-3 py-2.5">
                  <div
                    className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.18em] text-yellow-300"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Antivírus ainda bloqueia?
                  </div>
                  <p className="mono text-[10.5px] leading-relaxed text-yellow-200/90">
                    Baixa a versão <b>sem .exe</b> (só scripts <code>.cmd</code> + <code>.ps1</code> abertos — você consegue abrir no Notepad). Avast/Defender quase nunca bloqueiam:
                  </p>
                  <a
                    href="/api/downloader-engine/download?format=zip"
                    download
                    className="mono mt-2 inline-flex items-center gap-2 rounded-full border border-yellow-500/60 bg-yellow-500/15 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-yellow-100 transition hover:bg-yellow-500/25"
                  >
                    ↓ Baixar versão ZIP (alternativa)
                  </a>
                </div>

                <p className="mono mt-2 text-[10px] leading-relaxed text-text-muted">
                  Falhou? Log em <code className="mono text-white">%LOCALAPPDATA%\AutoEditDownloader\install.log</code>. Manda no WhatsApp.
                </p>
              </details>
            </div>
          )}
        </ToolStep>

        <ToolStep n={2} title="Links" hint="Cola um por linha — vários downloads em paralelo" hue={HUE}>
          <div className="relative">
            <textarea
              id="urls"
              rows={5}
              placeholder={
                'https://youtube.com/watch?v=...\nhttps://tiktok.com/@user/video/...\nhttps://pinterest.com/pin/...\nhttps://instagram.com/reel/...'
              }
              className="input-field font-mono text-xs"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              disabled={running}
            />
            {isAdmin ? (
              <button
                type="button"
                aria-label="Modo +18"
                title={adult ? 'Modo +18 ativado' : 'Ativar modo +18'}
                onClick={() => setAdult((v) => !v)}
                className={`absolute right-2 top-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[8px] font-black leading-none tracking-tight transition-all duration-200 active:scale-90 ${
                  adult
                    ? 'border-rose-500 bg-rose-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                    : 'border-rose-900/60 bg-transparent text-rose-700/70 hover:border-rose-500 hover:text-rose-400'
                }`}
              >
                +18
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Detectados
            </span>
            <span
              className={
                'mono text-[12.5px] ' +
                (urls.length > 0 ? 'text-violet' : 'text-text-muted')
              }
            >
              {urls.length} link{urls.length === 1 ? '' : 's'}
            </span>
          </div>
          {adult && (
            <div className="mt-3 rounded-[10px] border border-rose-900/50 bg-rose-950/20 px-3 py-2">
              <p className="mono text-[10px] uppercase tracking-widest text-rose-400">
                Modo +18 ativo
              </p>
              <div className="mono mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-rose-300/80">
                {ADULT_SITES.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </ToolStep>

        <ToolStep n={3} title="Formato" hue={HUE}>
          <div className="flex flex-col gap-4">
            <ToolChoice
              value={mode}
              onChange={(v) => !running && setMode(v as Mode)}
              options={MODES}
              disabled={running}
              hue={HUE}
            />
            {mode === 'video' ? (
              <div>
                <div
                  className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  Qualidade
                </div>
                <ToolChoice
                  value={quality}
                  onChange={(v) => !running && setQuality(v as Quality)}
                  options={QUALITIES}
                  disabled={running}
                  hue={HUE}
                />
              </div>
            ) : null}
          </div>
        </ToolStep>

        <ToolStep n={4} title={running ? 'Baixando…' : 'Baixar'} hue={HUE}>
          <ToolAction
            onClick={handleStart}
            loading={running}
            disabled={urls.length === 0 || running}
          >
            {urls.length > 1
              ? `Baixar ${urls.length} arquivos`
              : 'Baixar'}
          </ToolAction>

          {jobs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {jobs.map((j) => {
                const pct =
                  j.progress && j.progress.total
                    ? Math.min(100, Math.round((j.progress.received / j.progress.total) * 100))
                    : null;
                const isActive = j.state === 'resolving' || j.state === 'downloading';
                return (
                  <div
                    key={j.id}
                    className="card-3d card-pad flex flex-col gap-2 !py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mono truncate text-xs text-white">
                          {j.filename || j.url}
                        </div>
                        <div className="mono mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">
                          {detectSource(j.url)}
                          {j.progress && j.state === 'downloading' ? (
                            <>
                              {' · '}
                              <span className="text-violet">
                                {formatBytes(j.progress.received)}
                                {j.progress.total
                                  ? ` / ${formatBytes(j.progress.total)}`
                                  : ''}
                              </span>
                            </>
                          ) : null}
                          {j.error ? ` · ${j.error}` : ''}
                        </div>
                      </div>
                      <span
                        className={`mono shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-widest ${
                          j.state === 'done'
                            ? 'border-lime text-lime'
                            : j.state === 'error'
                              ? 'border-red-500/60 text-red-300'
                              : j.state === 'downloading'
                                ? 'border-violet/60 text-violet'
                                : j.state === 'resolving'
                                  ? 'border-blue-400/60 text-blue-300'
                                  : 'border-line-strong text-text-muted'
                        }`}
                      >
                        {j.state === 'queued' && 'fila'}
                        {j.state === 'resolving' && 'localizando'}
                        {j.state === 'downloading' &&
                          (pct !== null ? `${pct}%` : 'baixando…')}
                        {j.state === 'done' && 'ok'}
                        {j.state === 'error' && 'erro'}
                      </span>
                    </div>
                    {/* Barra de progresso: visível durante resolving e downloading */}
                    {isActive ? (
                      <div className="relative h-1 w-full overflow-hidden rounded-full bg-line/40">
                        {pct !== null ? (
                          <div
                            className="absolute left-0 top-0 h-full bg-gradient-to-r from-violet to-blue-400 transition-all duration-150"
                            style={{ width: `${pct}%` }}
                          />
                        ) : (
                          // Indeterminado — animação de "scan" enquanto resolve
                          <div className="cp-indeterminate absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-transparent via-violet to-transparent" />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <style jsx>{`
                @keyframes cp-indeterminate {
                  0%   { transform: translateX(-100%); }
                  100% { transform: translateX(400%); }
                }
                .cp-indeterminate {
                  animation: cp-indeterminate 1.2s ease-in-out infinite;
                }
              `}</style>
            </div>
          )}
        </ToolStep>

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
