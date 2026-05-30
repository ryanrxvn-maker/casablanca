'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { createClient } from '@/lib/supabase/client';
import { ToolStep, ToolChoice, ToolAction } from '@/components/tool-kit';
import { IconDownloader, IconStepPlug, IconStepLink, IconStepFormat, IconStepDownload } from '@/components/ToolIcons';

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
  // Cache localStorage: se foi conectado nos últimos 10min, começa
  // otimisticamente como connected — evita "desconectado" flash no reload.
  // User pediu: "conectou uma vez, fica conectado a menos que exclua a extensão".
  const EXT_CACHE_KEY = 'darkolab:downloader:ext-cache';
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10min
  function loadCachedExt(): { connected: boolean; version?: string; engine?: boolean } {
    try {
      const raw = localStorage.getItem(EXT_CACHE_KEY);
      if (!raw) return { connected: false };
      const c = JSON.parse(raw) as { connected: boolean; version?: string; engine?: boolean; ts: number };
      if (Date.now() - c.ts > CACHE_TTL_MS) return { connected: false };
      return { connected: c.connected, version: c.version, engine: c.engine };
    } catch { return { connected: false }; }
  }
  function saveCachedExt(v: { connected: boolean; version?: string; engine?: boolean }) {
    try {
      localStorage.setItem(EXT_CACHE_KEY, JSON.stringify({ ...v, ts: Date.now() }));
    } catch {}
  }

  // Versão MÍNIMA recomendada da extensão+motor. Abaixo disso, a versão
  // antiga sofre de: (a) service worker MV3 hibernando (desconecta sozinho)
  // e (b) janela preta de console no startup. A v1.4.0 corrige os dois.
  const MIN_EXT_VERSION = [1, 4, 0];
  function isOutdatedVersion(v?: string): boolean {
    if (!v) return false; // sem info de versão → não alarma
    const parts = v.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < MIN_EXT_VERSION.length; i++) {
      const cur = parts[i] || 0;
      if (cur < MIN_EXT_VERSION[i]) return true;
      if (cur > MIN_EXT_VERSION[i]) return false;
    }
    return false; // igual = atualizado
  }

  const [ext, setExt] = useState<{
    connected: boolean;
    version?: string;
    engine?: boolean;
  }>(() => loadCachedExt()); // 🔥 começa otimisticamente do cache

  const [reChecking, setReChecking] = useState(false);
  const doPing = () =>
    window.postMessage({ source: 'darko-dl', type: 'DL_PING' }, '*');

  useEffect(() => {
    let alive = true;
    // Contador de pings SEM RESPOSTA consecutivos.
    // Só marcamos desconectado após N fails SEGUIDOS — anti-flicker.
    // (User: "uma vez conectado, fica conectado.")
    let missedPings = 0;
    const MAX_MISSED = 5; // 5 pings × 2s = 10s sem resposta → desconectado
    let lastPongAt = 0;
    let pendingPing = false;

    function onMsg(e: MessageEvent) {
      const d = e.data;
      if (!d || d.source !== 'darko-dl-ext' || d.type !== 'DL_PONG') return;
      if (!alive) return;
      lastPongAt = Date.now();
      missedPings = 0;
      pendingPing = false;
      const next = { connected: true, version: d.version, engine: d.engine === true };
      setExt(next);
      saveCachedExt(next);
      setReChecking(false);
    }
    window.addEventListener('message', onMsg);

    // Burst inicial — pings agressivos pra pegar a extension em qualquer
    // estado de inicialização (cobre race condition de quem chegou primeiro).
    const initialPings = [0, 50, 200, 500, 1000, 2000, 4000];
    const timers: ReturnType<typeof setTimeout>[] = initialPings.map((delay) =>
      setTimeout(() => alive && doPing(), delay),
    );

    // Polling 2s — mais responsivo que 5s antigo
    const interval = setInterval(() => {
      if (!alive) return;
      if (document.visibilityState !== 'visible') return;
      pendingPing = true;
      doPing();
      // Após 1.5s sem pong, conta como missed
      setTimeout(() => {
        if (!alive || !pendingPing) return;
        pendingPing = false;
        missedPings++;
        if (missedPings >= MAX_MISSED) {
          // Só zera connected se passou MAX_MISSED inteiros sem pong.
          // Anti-flicker: extensão pode dar pequenos glitches sem desconectar.
          setExt((prev) => {
            if (!prev.connected) return prev;
            const next = { ...prev, connected: false };
            saveCachedExt(next);
            return next;
          });
        }
      }, 1500);
    }, 2000);

    // Re-ping AGRESSIVO ao voltar pra tab (visibility change)
    function onVis() {
      if (document.visibilityState === 'visible') {
        doPing();
        setTimeout(doPing, 200);
        setTimeout(doPing, 600);
      }
    }
    document.addEventListener('visibilitychange', onVis);

    // Re-ping ao reconectar à rede
    function onOnline() {
      missedPings = 0;
      doPing();
      setTimeout(doPing, 500);
    }
    window.addEventListener('online', onOnline);

    return () => {
      alive = false;
      window.removeEventListener('message', onMsg);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, []);

  // Re-check manual — burst agressivo
  function handleRecheck() {
    setReChecking(true);
    [0, 200, 500, 1000, 2000].forEach((d) => setTimeout(doPing, d));
    setTimeout(() => setReChecking(false), 3000);
  }

  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adult, setAdult] = useState(false);
  // Timestamp em que a sessão de download começou — usado pra cronometrar
  // o tempo de resolução (sensação de "rápido pra iniciar")
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Tick a cada 1s pra forçar re-render do contador de segundos
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

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
    setStartedAt(Date.now());
    // Concorrência maior = inicia mais downloads em paralelo,
    // reduz percepção de "esperar a vez"
    const CONCURRENCY = 6;
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
        <ToolStep n={1} icon={<IconStepPlug size={18} />} title="Extensão + Motor" hint="Instala uma vez, baixa em qualquer site" hue={HUE}>
          {/* AVISO DE ATUALIZAÇÃO (contas não-admin) — versão antiga sofre
              de desconexão automática + janela preta. v1.4.0 corrige.
              Admin (você) já aplicou o fix manualmente, então não vê isso. */}
          {!isAdmin && ext.connected && isOutdatedVersion(ext.version) && (
            <div
              className="mb-3 rounded-[14px] border border-amber-400/50 bg-amber-400/[0.08] p-4"
              style={{ boxShadow: '0 0 20px -8px rgba(251,191,36,0.5)' }}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/15 text-lg">
                  ⚠
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-amber-300"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Atualização importante disponível
                  </div>
                  <div
                    className="mt-0.5 text-[14px] font-bold tracking-tight text-white"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Reinstale a nova versão pra funcionar 100%
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">
                    Sua versão atual (<b className="text-white">v{ext.version}</b>) pode
                    <b className="text-white"> desconectar sozinha</b> e mostrar uma
                    <b className="text-white"> janela preta</b> ao ligar o PC. A nova
                    versão corrige os dois — fica conectada pra sempre e roda invisível.
                  </p>
                  <ol className="mono mt-2.5 list-decimal space-y-1 pl-5 text-[11.5px] leading-relaxed text-text-muted">
                    <li>Baixe e rode o novo instalador no botão abaixo.</li>
                    <li>Em <code className="text-white">chrome://extensions</code>, remova a extensão antiga e carregue a nova pasta.</li>
                    <li>Pronto — não desconecta mais nem aparece janela preta.</li>
                  </ol>
                  <div className="mt-3">
                    <a
                      href="/api/downloader-engine/download"
                      download
                      className="inline-flex items-center gap-2 rounded-full border border-amber-400/55 bg-amber-400/15 px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-400/25"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      ↓ Baixar nova versão (corrigida)
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
          {ext.connected && ext.engine ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                </span>
                <span className="text-lime">
                  Auto Edit · Downloader v{ext.version}
                </span>
                <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                  ✓ motor online
                </span>
              </div>
            </div>
          ) : ext.connected && !ext.engine ? (
            // EXTENSÃO OK, MOTOR OFFLINE — caso típico de "Motor desconectado".
            // Mostra painel orientativo, botão pra rechecar e link
            // pra reinstalar o .exe caso esteja faltando.
            <div className="rounded-[14px] border border-red-500/40 bg-red-500/[0.06] p-4">
              <div className="flex items-start gap-3">
                <span
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/50 bg-red-500/15"
                  style={{ boxShadow: '0 0 18px -6px rgba(244,63,94,0.6)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-red-300"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Motor desconectado
                  </div>
                  <div
                    className="mt-0.5 text-[14px] font-bold tracking-tight text-white"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    Extensão instalada · motor local offline
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">
                    A extensão do navegador encontrou a página, mas o motor
                    no seu computador não está rodando. Abre o atalho{' '}
                    <b className="text-white">Auto Edit Downloader</b> no
                    menu Iniciar (ou rebaixa o instalador) e depois clica
                    em <b className="text-white">Verificar de novo</b>.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleRecheck}
                      disabled={reChecking}
                      className="inline-flex items-center gap-2 rounded-full border border-lime/55 bg-lime/10 px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-lime transition hover:bg-lime/20 disabled:opacity-60"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      {reChecking ? (
                        <>
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-lime/40 border-t-lime" />
                          Verificando…
                        </>
                      ) : (
                        <>↻ Verificar de novo</>
                      )}
                    </button>
                    <a
                      href="/api/downloader-engine/download"
                      download
                      className="inline-flex items-center gap-2 rounded-full border border-blue-400/45 bg-blue-400/[0.08] px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-blue-300 transition hover:bg-blue-400/20"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      ↓ Rebaixar Motor (.exe)
                    </a>
                    <span
                      className="mono ml-1 text-[10px] text-text-muted"
                      title="Verifica a cada 5 segundos enquanto a aba estiver aberta"
                    >
                      Auto-check: 5s
                    </span>
                  </div>
                  <details className="mt-3 group">
                    <summary
                      className="cursor-pointer text-[10.5px] font-bold uppercase tracking-[0.18em] text-text-muted hover:text-text"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      O motor não abre?
                    </summary>
                    <ol className="mono mt-2 list-decimal space-y-1.5 pl-5 text-[11px] leading-relaxed text-text-muted">
                      <li>
                        Vai em <code className="text-white">Iniciar → Auto Edit Downloader</code> e abre.
                      </li>
                      <li>
                        Se não tiver o atalho, rebaixa o <code className="text-white">.exe</code> acima e roda como administrador.
                      </li>
                      <li>
                        Antivírus pode ter colocado em quarentena —
                        cheque <code className="text-white">%LOCALAPPDATA%\AutoEditDownloader\install.log</code>.
                      </li>
                      <li>
                        Sem solução? Manda print do log no WhatsApp.
                      </li>
                    </ol>
                  </details>
                </div>
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
                    Duplo-clique no <code className="mono text-white">AutoEditDownloaderSetup.exe</code>. Abre a janela Auto Edit (preta com accent lime, igual ao site) mostrando o progresso. <span className="text-lime">Sem CMD piscando.</span>
                  </li>
                  <li>
                    Se o SmartScreen avisar: <i>&quot;Mais informações&quot;</i> → <i>&quot;Executar assim mesmo&quot;</i>.
                  </li>
                  <li>
                    Quando o título virar <b className="text-lime">&quot;Instalado e vinculado&quot;</b>, clica <i>Fechar</i>.
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

        <ToolStep n={2} icon={<IconStepLink size={18} />} title="Links" hint="Cola um por linha — vários downloads em paralelo" hue={HUE}>
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

        <ToolStep n={3} icon={<IconStepFormat size={18} />} title="Formato" hue={HUE}>
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

        <ToolStep
          n={4}
          icon={<IconStepDownload size={18} />}
          title={(() => {
            if (!running) return 'Baixar';
            const doneCount = jobs.filter((j) => j.state === 'done').length;
            const total = jobs.length;
            if (doneCount === total) return `Concluído · ${total}/${total}`;
            return `Baixando · ${doneCount}/${total}`;
          })()}
          hue={HUE}
        >
          <ToolAction
            onClick={handleStart}
            loading={false}
            disabled={urls.length === 0 || running}
          >
            {(() => {
              // Estado padrão: botão de start
              if (!running) {
                return urls.length > 1
                  ? `Baixar ${urls.length} arquivos`
                  : 'Baixar';
              }
              // Em execução: calcula agregado de bytes ou estado
              const active = jobs.filter(
                (j) => j.state === 'resolving' || j.state === 'downloading',
              );
              const doneCount = jobs.filter((j) => j.state === 'done').length;
              const total = jobs.length;
              if (doneCount === total) return '✓ Concluído';

              // Soma de bytes recebidos / total de TODOS os jobs com size conhecido
              let receivedSum = 0;
              let totalSum = 0;
              let knownCount = 0;
              for (const j of jobs) {
                if (j.state === 'done' && j.progress) {
                  // contabiliza o total final do job concluído
                  if (j.progress.total) {
                    totalSum += j.progress.total;
                    receivedSum += j.progress.total;
                    knownCount++;
                  }
                } else if (j.progress && j.progress.total) {
                  totalSum += j.progress.total;
                  receivedSum += j.progress.received;
                  knownCount++;
                }
              }

              // Se temos bytes conhecidos pra calcular %
              if (knownCount > 0 && totalSum > 0) {
                const pct = Math.min(
                  100,
                  Math.round((receivedSum / totalSum) * 100),
                );
                return `${pct}% baixado  ·  ${doneCount}/${total}`;
              }

              // Sem bytes ainda — mostra "Localizando…" com cronômetro
              if (active.length > 0 && startedAt) {
                const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
                return `Localizando…  ${sec}s`;
              }
              return `Iniciando…  ${doneCount}/${total}`;
            })()}
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
          <span className="text-lime">sem marca d&apos;água em HD</span> ·{' '}
          <span className="text-white">Pinterest</span> mídia direta ·{' '}
          <span className="text-white">YouTube/Instagram</span>.
          Downloads paralelos (3x) e acelerados (multi-conexão). Links
          privados exigem login. Use apenas para conteúdo que você tem
          direito de baixar.
        </p>
      </div>
    </ToolShell>
  );
}
