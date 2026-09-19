'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { useToolState } from '@/components/ToolsStateProvider';
import { logHistory, syncDownloaderHistoryJobs, type DownloaderHistoryJob } from '@/lib/history';
import { toFriendlyMessage, FriendlyError } from '@/lib/friendly-error';
import { createClient } from '@/lib/supabase/client';
import { useUserEmail } from '@/lib/use-tier';
import { macMotorLiberado } from '@/lib/mac-motor-beta';
import { DOWNLOADER_EXTENSION_VERSION, DOWNLOADER_ENGINE_VERSION, INITIAL_DOWNLOADER_CONNECTION, connectionFromPong, expireDownloaderConnection, getDownloaderStatus, versionAtLeast, type DownloaderConnection } from '@/lib/downloader-connection';
import { ToolStep, ToolChoice } from '@/components/tool-kit';
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
  phase?: string;
  percent?: number | null;
};

const HUE = 'rgba(96,165,250,0.4)';

const MODES: { value: Mode; label: string }[] = [
  { value: 'video', label: 'Vídeo' },
  { value: 'audio-mp3', label: 'Áudio MP3' },
  { value: 'audio-wav', label: 'Áudio WAV' },
];

const QUALITIES: { value: Quality; label: string }[] = [
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: 'best', label: 'Máxima' },
];

function isInstagramUrl(u: string): boolean {
  try {
    return /(^|\.)instagram\.com$/.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

// Erros do caminho extensão→Motor chegam como códigos do Chrome
// ("SERVER_FAILED") ou frases curtas do service worker. Traduz pro cliente
// SEMPRE em linguagem normal, com o que fazer em seguida.
function friendlyEngineFail(raw: string): string {
  const m = raw.toLowerCase();
  if (!m.trim()) return 'O download falhou agora. Tenta de novo em instantes.';
  if (/(user_canceled|cancelado pelo usu)/.test(m))
    return 'Download cancelado no navegador. Clique em Baixar para tentar novamente.';
  if (/(unauthorized|forbidden|token)/.test(m))
    return 'O Motor está reiniciando. Espera uns segundos e tenta de novo.';
  if (/(nao esta rodando|não está rodando|abra o)/.test(m))
    return 'O Motor não está aberto no seu computador. Abre o Auto Edit Downloader no menu Iniciar (ou reinstala no passo 1 acima) e tenta de novo.';
  if (/(server_|network_|file_|user_canceled|crash|failed|interrupted|tempo esgotado)/.test(m))
    return 'O download falhou no meio do caminho. Confere se o vídeo está público e se o Motor está aberto (bolinha verde no passo 1), e tenta de novo.';
  return raw; // já veio como frase amigável do Motor
}

// Baixa QUALQUER link suportado pelo MOTOR local, via extensão (o service
// worker fala com o Motor pareado em 127.0.0.1). É o caminho que sempre
// funciona pra YouTube/Pinterest/TikTok: o servidor não baixa esses sites —
// quem baixa é o Motor no computador do usuário. O arquivo cai direto na
// barra de downloads do navegador.
function downloadViaEngine(
  url: string,
  mode: Mode,
  quality: Quality,
  onProgress: (phase: string, percent: number | null) => void,
  instagram = false,
): Promise<DownloaderHistoryJob> {
  return new Promise((resolve, reject) => {
    const reqId = `eng-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;
    let idleTimer: ReturnType<typeof setTimeout>;
    const stopWaiting = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      clearTimeout(idleTimer);
      clearTimeout(overallTimer);
      reject(new FriendlyError('A página perdeu o acompanhamento deste pedido. Abra a extensão Auto Edit Downloader para conferir a fila antes de tentar novamente; o download pode continuar por lá.'));
    };
    const keepWaiting = () => { clearTimeout(idleTimer); idleTimer = setTimeout(stopWaiting, 120000); };
    const overallTimer = setTimeout(stopWaiting, 60 * 60 * 1000);
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (
        e.source !== window || e.origin !== window.location.origin ||
        !d ||
        d.source !== 'darko-dl-ext' ||
        d.reqId !== reqId
      )
        return;
      if (done) return;
      if (d.type === 'DL_ENGINE_PROGRESS') {
        const pct = typeof d.pct === 'number' && Number.isFinite(d.pct) && d.pct >= 0 ? Math.min(100, d.pct) : null;
        keepWaiting();
        onProgress(typeof d.phase === 'string' ? d.phase : 'downloading', pct);
        return;
      }
      if (d.type !== (instagram ? 'DL_IG_RESULT' : 'DL_ENGINE_RESULT')) return;
      done = true;
      window.removeEventListener('message', onMsg);
      clearTimeout(idleTimer);
      clearTimeout(overallTimer);
      if (d.ok && d.job) resolve(d.job as DownloaderHistoryJob);
      else if (d.ok) reject(new FriendlyError('O navegador concluiu o download sem informar o nome do arquivo. Atualize a extensão e tente novamente.'));
      else reject(new FriendlyError(friendlyEngineFail(String(d.error || ''))));
    };
    window.addEventListener('message', onMsg);
    keepWaiting();
    window.postMessage({ source: 'darko-dl', type: instagram ? 'DL_IG_DOWNLOAD' : 'DL_ENGINE_DOWNLOAD', url, mode, quality, reqId }, window.location.origin);
  });
}

function detectSource(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('tiktok')) return 'TikTok';
  if (u.includes('pinterest') || u.includes('pin.it')) return 'Pinterest';
  if (u.includes('instagr')) return 'Instagram';
  if (u.includes('youtu')) return 'YouTube';
  return '—';
}

async function triggerDownload(blob: Blob, filename: string) {
  // downloadBlob = revoke de 60s (10s cortava vídeo grande de YouTube no meio)
  // + captura pro cofre do Histórico geral (recuperável por 7 dias).
  await import('@/lib/audio-engine').then(({ downloadBlob }) =>
    downloadBlob(blob, filename, { tool: 'downloader', capture: false }),
  );
}

async function previewFor(url: string): Promise<{ thumbnailUrl?: string; title?: string }> {
  try {
    const response = await fetch(`/api/downloader-preview?url=${encodeURIComponent(url)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return {};
    const value = await response.json();
    return {
      thumbnailUrl: typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl : undefined,
      title: typeof value.title === 'string' ? value.title : undefined,
    };
  } catch { return {}; }
}

/** Quebra de linha da caixa de URLs (constantes: evitam escapes no meio
 *  do arquivo, que ja quebraram o parse uma vez). */
const NL = String.fromCharCode(10);
const QUEBRA_DE_LINHA = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/**
 * O cliente está num Mac?
 *
 * O Motor tem instalador PRÓPRIO por sistema — `.exe` no Windows, comando de
 * Terminal no Mac. Até aqui a página mandava todo mundo pro `.exe`, o que pro
 * cliente de Mac é beco sem saída: ele baixa um arquivo que o Mac não executa.
 *
 * Começa em `null` (desconhecido) de propósito: o servidor e o 1º render do
 * cliente batem, e o ajuste vem no efeito — sem erro de hidratação.
 */
function useIsMac(): boolean | null {
  const [isMac, setIsMac] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const uaData = (
      navigator as unknown as { userAgentData?: { platform?: string } }
    ).userAgentData;
    const plat = uaData?.platform || navigator.platform || '';
    const ua = navigator.userAgent || '';
    // iPad em "modo desktop" se declara MacIntel e some com "iPad" do UA — mas
    // reporta touch, e Mac nenhum reporta. Sem isso, iPad veria um comando de
    // Terminal que não existe lá.
    const isIpadPretendingMac =
      /mac/i.test(plat) && (navigator.maxTouchPoints || 0) > 1;
    setIsMac(
      /mac/i.test(plat + ' ' + ua) &&
        !/iphone|ipad|ipod/i.test(ua) &&
        !isIpadPretendingMac,
    );
  }, []);
  return isMac;
}

/** Comando único de instalação do Motor no Mac, com botão de copiar. */
function MacInstallCommand() {
  const [copied, setCopied] = useState(false);
  const [cmd, setCmd] = useState(
    'curl -fsSL https://www.darkoautoedit.com/api/downloader-engine/mac | bash',
  );
  useEffect(() => {
    // Origem real da página: serve igual em produção, preview e localhost.
    if (typeof window !== 'undefined') {
      setCmd(
        `curl -fsSL ${window.location.origin}/api/downloader-engine/mac | bash`,
      );
    }
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard bloqueado — dá pra selecionar na mão */
    }
  };
  return (
    <div className="mt-2.5 flex items-stretch gap-2">
      <code className="mono flex-1 overflow-x-auto whitespace-nowrap rounded-[10px] border border-line-strong bg-black/45 px-3 py-2.5 text-[11px] leading-relaxed text-lime">
        {cmd}
      </code>
      <button
        type="button"
        onClick={copy}
        className="mono shrink-0 rounded-[10px] border border-blue-400/55 bg-blue-400/15 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-blue-100 transition hover:bg-blue-400/25"
      >
        {copied ? '✓ copiado' : 'copiar'}
      </button>
    </div>
  );
}

export default function DownloaderPage() {
  const isMac = useIsMac();
  const userEmail = useUserEmail();
  const [raw, setRaw] = useToolState<string>('downloader:urls', '');
  // LINK VINDO DE FORA (?url=...): o botão BAIXAR das indicações do copy no
  // ClickUp Pilot abre esta página já com a URL colada (YouTube, TikTok,
  // Instagram — que precisam do motor). Só ADICIONA a URL se ela ainda não
  // estiver na caixa; nunca apaga o que o user já tinha digitado.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let doQuery: string | null = null;
    try { doQuery = new URLSearchParams(window.location.search).get('url'); } catch { /* sem query */ }
    if (!doQuery) return;
    const url = doQuery.trim();
    if (!/^https?:/i.test(url)) return;
    setRaw((atual) => {
      const linhas = (atual || '').split(QUEBRA_DE_LINHA).map((l) => l.trim());
      if (linhas.includes(url)) return atual;
      const base = (atual || '').trim();
      return base ? base + NL + url : url;
    });
    try {
      const limpa = new URL(window.location.href);
      limpa.searchParams.delete('url');
      window.history.replaceState({}, '', limpa.pathname + limpa.search + limpa.hash);
    } catch { /* historico bloqueado: so ficaria o param na barra */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mode, setMode] = useToolState<Mode>('downloader:mode', 'video');
  const [quality, setQuality] = useToolState<Quality>(
    'downloader:quality',
    '1080',
  );
  const [ext, setExt] = useState<DownloaderConnection>(INITIAL_DOWNLOADER_CONNECTION);
  const [latestVersion, setLatestVersion] = useState(DOWNLOADER_EXTENSION_VERSION);
  const [reChecking, setReChecking] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongAt = useRef(0);
  const connectionStatus = getDownloaderStatus(ext, latestVersion);
  const extensionCurrent = ext.connected && versionAtLeast(ext.version, latestVersion);
  const extensionDownloadUrl = `/api/downloader-extension/download?v=${latestVersion}`;

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const ping = () => window.postMessage({ source: 'darko-dl', type: 'DL_PING' }, window.location.origin);
    const later = (fn: () => void, delay: number) => timers.push(setTimeout(() => alive && fn(), delay));
    function onMsg(event: MessageEvent) {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin || !data || data.source !== 'darko-dl-ext' || data.type !== 'DL_PONG') return;
      lastPongAt.current = Date.now();
      setExt((previous) => connectionFromPong(data, Date.now(), previous));
      if (data.checking !== true) setReChecking(false);
    }
    async function refreshRelease() {
      try {
        const response = await fetch('/api/downloader-extension/version', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const release = await response.json();
        if (alive && typeof release.version === 'string' && versionAtLeast(release.version, DOWNLOADER_EXTENSION_VERSION)) setLatestVersion(release.version);
      } catch { /* The bundled release remains the minimum when offline. */ }
    }
    window.addEventListener('message', onMsg);
    [0, 250, 1000, 2500, 5000].forEach((delay) => later(ping, delay));
    later(() => setExt((previous) => previous.connected ? previous : { ...previous, checked: true }), 7000);
    void refreshRelease();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      ping();
      setExt((previous) => expireDownloaderConnection(previous, Date.now()));
    }, 5000);
    const releaseInterval = setInterval(refreshRelease, 5 * 60 * 1000);
    function resume() {
      if (document.visibilityState !== 'visible') return;
      ping();
      later(ping, 500);
      void refreshRelease();
    }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      alive = false;
      window.removeEventListener('message', onMsg);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      timers.forEach(clearTimeout);
      clearInterval(interval);
      clearInterval(releaseInterval);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  function handleRecheck() {
    const startedAt = Date.now();
    setReChecking(true);
    window.postMessage({ source: 'darko-dl', type: 'DL_PING', force: true }, window.location.origin);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      // Instalar/atualizar a extensão invalida o content script que já estava
      // nesta aba. Sem PONG novo, o único jeito correto de injetar a ponte nova
      // é o mesmo que F5 — o botão faz isso sozinho e o useToolState preserva
      // os links e as opções preenchidas.
      if (lastPongAt.current < startedAt) {
        window.location.reload();
        return;
      }
      setReChecking(false);
      setExt((previous) => expireDownloaderConnection(previous, Date.now()));
    }, 1800);
  }

  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adult, setAdult] = useState(false);
  /* Motor no Mac em TESTE FECHADO: o comando de instalação só aparece pros
     testadores. Os outros clientes de Mac não veem o .exe do Windows (que
     eles não conseguem rodar) — veem o que funciona pra eles hoje. */
  const macMotorOk = macMotorLiberado(userEmail, isAdmin);
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

    // INSTAGRAM (vídeo, extensão conectada): baixa pela sessão logada do
    // usuário via extensão — o servidor não consegue (IG exige login). O
    // arquivo cai na barra de downloads do navegador; aqui só marcamos o
    // andamento. Sem extensão, segue pro /api/downloader (que orienta o
    // usuário a instalar a extensão).
    if (mode === 'video' && !(isAdmin && adult) && isInstagramUrl(url)) {
      const canIgPaste = extensionCurrent;
      if (!canIgPaste) {
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? {
                  ...j,
                  state: 'error',
                  error: ext.connected
                    ? 'Atualize a extensão (passo 1 acima) pra baixar do Instagram por link. O download usa o seu próprio Instagram logado.'
                    : 'Pra baixar do Instagram, instale e conecte a extensão (passo 1 acima). O download usa o seu próprio Instagram logado.',
                  progress: null,
                }
              : j,
          ),
        );
        return;
      }
      try {
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? { ...j, state: 'downloading', progress: null }
              : j,
          ),
        );
        const completed = await downloadViaEngine(url, mode, quality, (phase, pct) => {
          setJobs((previous) => previous.map((job, i) => i === idx ? {
            ...job, state: phase === 'queued' ? 'queued' : phase === 'resolving' ? 'resolving' : 'downloading', phase, percent: pct,
          } : job));
        }, true);
        const filename = completed.filename || 'instagram.mp4';
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx ? { ...j, state: 'done', filename, progress: null } : j,
          ),
        );
        await syncDownloaderHistoryJobs([completed]);
        return;
      } catch (e) {
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? {
                  ...j,
                  state: 'error',
                  error: toFriendlyMessage(e, 'O download do Instagram falhou. Tenta de novo.'),
                  progress: null,
                }
              : j,
          ),
        );
        return;
      }
    }

    const source = detectSource(url);
    const knownSource = source !== '—';
    const engineOk = connectionStatus === 'ready';

    // MOTOR CONECTADO: baixa pelo Motor no computador do usuário (via
    // extensão). É o caminho que sempre funciona pra YouTube, TikTok e
    // Pinterest — o servidor não baixa esses sites; o Motor baixa.
    if (engineOk && knownSource && !(isAdmin && adult)) {
      try {
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx ? { ...j, state: 'downloading', progress: null } : j,
          ),
        );
        const completed = await downloadViaEngine(url, mode, quality, (phase, pct) => {
          setJobs((previous) => previous.map((job, i) => i === idx ? {
            ...job,
            state: phase === 'queued' ? 'queued' : phase === 'resolving' ? 'resolving' : 'downloading',
            phase,
            percent: pct,
          } : job));
        });
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? {
                  ...j,
                  state: 'done',
                  filename: completed.filename || 'Pronto — na barra de downloads do navegador',
                  progress: null,
                }
              : j,
          ),
        );
        await syncDownloaderHistoryJobs([completed]);
      } catch (e) {
        console.error('[downloader] motor', e);
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? {
                  ...j,
                  state: 'error',
                  error: toFriendlyMessage(
                    e,
                    'O download falhou agora. Tenta de novo em instantes.',
                  ),
                  progress: null,
                }
              : j,
          ),
        );
      }
      return;
    }

    // SEM MOTOR: o servidor só resolve TikTok em vídeo. Pro resto, o que
    // resolve é instalar o Motor — orienta na hora, sem deixar o cliente
    // esperando uma falha.
    if (!engineOk && knownSource && !(isAdmin && adult)) {
      const serverCan = source === 'TikTok' && mode === 'video';
      if (!serverCan) {
        setJobs((prev) =>
          prev.map((j, i) =>
            i === idx
              ? {
                  ...j,
                  state: 'error',
                  error: connectionStatus === 'outdated' ? 'Atualize a extensão no passo 1 para continuar.' : connectionStatus === 'engine-outdated' ? 'Atualize o Motor no passo 1 para continuar.' : connectionStatus === 'engine-offline' ? 'Abra o Auto Edit Downloader no seu computador e clique em Verificar conexão no passo 1.' : 'Instale e conecte a extensão e o Motor no passo 1 para baixar este link.',
                  progress: null,
                }
              : j,
          ),
        );
        return;
      }
    }

    try {
      const res = await fetch('/api/downloader', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, mode, quality, adult: isAdmin && adult }),
        signal: AbortSignal.timeout(180000),
      });

      if (!res.ok) {
        let msg = 'O download falhou agora. Tenta de novo em instantes.';
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {
          /* binário/sem json */
        }
        throw new FriendlyError(msg);
      }

      const cd = res.headers.get('content-disposition') || '';
      if (/application\/json|text\/html/i.test(res.headers.get('content-type') || '')) {
        throw new FriendlyError('O serviço retornou uma resposta inválida em vez do arquivo. Tente novamente.');
      }
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
        await triggerDownload(blob, filename);
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
        await triggerDownload(blob, filename);
      }

      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx
            ? { ...j, state: 'done', filename, progress: null }
            : j,
        ),
      );
      const preview = await previewFor(url);
      logHistory({
        externalId: `downloader:server:${crypto.randomUUID()}`,
        tool: 'downloader',
        kind: 'download',
        title: filename,
        source: {
          kind: 'downloader', url, filename, mode, quality,
          thumbnailUrl: preview.thumbnailUrl, sourceTitle: preview.title,
          platform: detectSource(url) === '—' ? 'Web' : detectSource(url),
        },
      });
    } catch (e) {
      console.error('[downloader]', e);
      setJobs((prev) =>
        prev.map((j, i) =>
          i === idx
            ? {
                ...j,
                state: 'error',
                error: toFriendlyMessage(e, 'O download falhou agora. Tenta de novo em instantes.'),
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
    const CONCURRENCY = 3;
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const i = next++;
        // eslint-disable-next-line no-await-in-loop
        await processOne(urls[i], i);
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
    } finally {
      setRunning(false);
    }
  }

  return (
    <ToolShell
      title="Downloader"
      eyebrow="WEB · MULTI-SITE"
      description="Baixe vídeos, áudios e imagens do YouTube, Instagram, TikTok e Pinterest. Adicione um link por linha para organizar os downloads."
      hue={HUE}
      icon={<IconDownloader size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} icon={<IconStepPlug size={18} />} title="Sua conexão" hint="Extensão no navegador. Motor no computador. Tudo no mesmo lugar." hue={HUE}>
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151419]" data-downloader-status={connectionStatus}>
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
              <div className="flex min-w-0 items-center gap-3.5" role="status" aria-live="polite">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${connectionStatus === 'ready' ? 'border-lime/25 bg-lime/[0.08] text-lime' : connectionStatus === 'outdated' || connectionStatus === 'engine-outdated' ? 'border-amber-300/25 bg-amber-300/[0.06] text-amber-200' : 'border-white/10 bg-white/[0.035] text-violet'}`}>
                  <IconStepPlug size={22} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold tracking-tight text-white">
                    {connectionStatus === 'checking' ? 'Verificando seu navegador…' : connectionStatus === 'missing' ? 'Conecte sua extensão' : connectionStatus === 'outdated' ? 'Uma atualização está disponível' : connectionStatus === 'engine-outdated' ? 'Atualize o Motor para continuar' : connectionStatus === 'engine-offline' ? 'Extensão conectada. Abra o Motor.' : connectionStatus === 'engine-checking' ? 'Localizando o Motor…' : 'Tudo pronto para baixar'}
                  </h3>
                  <p className="mt-1 max-w-[58ch] text-xs leading-relaxed text-text-muted">
                    {connectionStatus === 'checking' ? 'Aguardando a resposta da extensão instalada.' : connectionStatus === 'missing' ? 'Instale ou reative a extensão e clique em Verificar conexão. A página se atualiza sozinha se necessário.' : connectionStatus === 'outdated' ? `Sua extensão ${ext.version ? `v${ext.version}` : 'é de uma versão antiga'}. A versão v${latestVersion} está disponível.` : connectionStatus === 'engine-outdated' ? `Motor ${ext.engineVersion ? `v${ext.engineVersion}` : 'antigo'} detectado. Instale a versão v${DOWNLOADER_ENGINE_VERSION} para receber as correções.` : connectionStatus === 'engine-offline' ? 'A extensão respondeu, mas o Motor local está indisponível. Verifique a conexão depois de abri-lo.' : connectionStatus === 'engine-checking' ? 'A extensão respondeu. Estamos verificando o Motor local.' : 'Conexão confirmada agora com o seu computador.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {(connectionStatus === 'missing' || connectionStatus === 'outdated') && (
                  <a href={extensionDownloadUrl} download onClick={() => setShowSetup(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#b39af3] px-4 text-sm font-semibold text-[#20172e] transition duration-200 hover:bg-[#c5b0fb] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet">
                    <IconStepDownload size={17} /> {connectionStatus === 'outdated' ? 'Atualizar extensão' : 'Baixar extensão'}
                  </a>
                )}
                {(connectionStatus === 'engine-outdated' || connectionStatus === 'engine-offline') && !isMac && (
                  <a href={`/api/downloader-engine/download?v=${DOWNLOADER_ENGINE_VERSION}`} download className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#b39af3] px-4 text-sm font-semibold text-[#20172e] transition duration-200 hover:bg-[#c5b0fb] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet">
                    <IconStepDownload size={17} /> {connectionStatus === 'engine-outdated' ? 'Atualizar Motor' : 'Instalar Motor'}
                  </a>
                )}
                <button type="button" disabled={reChecking} onClick={handleRecheck} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3.5 text-xs font-medium text-text-muted transition duration-200 hover:border-white/20 hover:text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet">
                  <svg className={reChecking ? 'animate-spin' : ''} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg>
                  {reChecking ? 'Verificando…' : 'Verificar conexão'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.06] bg-white/[0.015] px-5 py-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${extensionCurrent ? 'bg-lime' : 'bg-white/25'}`} />Extensão {ext.connected ? ext.version ? `v${ext.version}` : 'antiga' : 'não detectada'}</span>
              <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${connectionStatus === 'ready' ? 'bg-lime' : 'bg-white/25'}`} />Motor {ext.engine ? ext.engineVersion ? `v${ext.engineVersion}` : 'detectado' : 'aguardando conexão'}</span>
              <span className="ml-auto tabular-nums">Versão disponível · {latestVersion}</span>
            </div>
          </section>
          <details className="group mt-4" open={showSetup || connectionStatus === 'missing' || connectionStatus === 'outdated'} onToggle={(event) => setShowSetup(event.currentTarget.open)}>
            <summary className="cursor-pointer text-xs font-medium text-text-muted transition hover:text-white">{connectionStatus === 'outdated' ? 'Como atualizar sua extensão' : 'Instalação e ajuda'}</summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-violet">No navegador</p>
                <h4 className="mt-1 text-sm font-semibold text-white">{connectionStatus === 'outdated' ? 'Atualize sem perder sua configuração' : 'Instale a extensão'}</h4>
                <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-text-muted">
                  <li>Baixe e extraia o ZIP da extensão v{latestVersion}.</li>
                  {connectionStatus === 'outdated' ? <><li>Substitua os arquivos na pasta em que você instalou a extensão.</li><li>Abra <code className="text-white">chrome://extensions</code> (Chrome) ou <code className="text-white">edge://extensions</code> (Edge) e clique no botão de recarregar do Auto Edit Downloader.</li></> : <li>Abra <code className="text-white">chrome://extensions</code> (Chrome) ou <code className="text-white">edge://extensions</code> (Edge). Ative o modo desenvolvedor, clique em <b className="font-medium text-white">Carregar sem compactação</b> e selecione a pasta extraída.</li>}
                  <li>Recarregue esta página e as abas dos vídeos para ativar a nova extensão.</li>
                </ol>
                <a href={extensionDownloadUrl} download className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-violet underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"><IconStepDownload size={15} /> Baixar ZIP · v{latestVersion}</a>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-violet">No computador</p>
                <h4 className="mt-1 text-sm font-semibold text-white">{isMac ? 'Motor para Mac' : 'Motor para Windows'}</h4>
                {isMac && macMotorOk ? <><p className="mt-3 text-xs leading-relaxed text-text-muted">Abra o Terminal, cole o comando e aguarde a confirmação. Ele também atualiza uma instalação existente.</p><MacInstallCommand /></> : isMac ? <p className="mt-3 text-xs leading-relaxed text-text-muted">O Motor para Mac está em teste fechado. Instagram pela extensão e TikTok em vídeo podem usar os caminhos disponíveis sem o Motor. YouTube e Pinterest precisam dele.</p> : <><p className="mt-3 text-xs leading-relaxed text-text-muted">Execute o instalador e aguarde a confirmação. Para atualizar, instale por cima da versão existente. Se já estiver instalado, abra <b className="font-medium text-white">Auto Edit Downloader</b> no menu Iniciar.</p><a href={`/api/downloader-engine/download?v=${DOWNLOADER_ENGINE_VERSION}`} download className="mt-4 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-violet underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"><IconStepDownload size={15} /> Baixar Motor · v{DOWNLOADER_ENGINE_VERSION}</a><p className="mt-2 text-[11px] leading-relaxed text-text-muted">Se o instalador não abrir, use a <a href="/api/downloader-engine/download?format=zip" download className="text-violet underline underline-offset-2">versão ZIP</a>.</p></>}
              </div>
            </div>
          </details>
          {isMac && macMotorOk && (connectionStatus === 'engine-outdated' || connectionStatus === 'engine-offline') && !showSetup && <MacInstallCommand />}
        </ToolStep>

        <ToolStep n={2} icon={<IconStepLink size={18} />} title="Links" hint="Adicione um link por linha. Os downloads entram na mesma fila." hue={HUE}>
          <div className="relative">
            <textarea
              id="urls"
              aria-label="Links para baixar, um por linha"
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
              <p className="label-tech text-[10px] uppercase tracking-widest text-rose-400">
                Modo +18 ativo
              </p>
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
          <button
            type="button"
            onClick={handleStart}
            aria-busy={running}
            disabled={urls.length === 0 || running}
            className="group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-[#b39af3] px-6 text-[15px] font-semibold tracking-tight text-[#20172e] shadow-[0_8px_24px_-12px_rgba(179,154,243,0.4)] transition duration-200 hover:bg-[#c5b0fb] active:translate-y-px disabled:cursor-not-allowed disabled:border-white/[0.07] disabled:bg-white/[0.07] disabled:text-text-muted disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet"
          >
            <span className={running ? 'animate-pulse' : 'transition-transform duration-200 group-hover:translate-y-0.5'}><IconStepDownload size={20} /></span>
            {(() => {
              // Estado padrão: botão de start
              if (!running) {
                return urls.length > 1
                  ? `Baixar ${urls.length} arquivos`
                  : 'Baixar arquivo';
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

              if (active.some((job) => job.state === 'downloading')) {
                const progress = active.find((job) => job.percent != null)?.percent;
                return progress != null ? `Baixando · ${Math.round(progress)}% · ${doneCount}/${total}` : `Baixando · ${doneCount}/${total}`;
              }

              // Sem bytes ainda — mostra "Localizando…" com cronômetro
              if (active.length > 0 && startedAt) {
                const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
                return `Localizando…  ${sec}s`;
              }
              return `Iniciando…  ${doneCount}/${total}`;
            })()}
          </button>

          {jobs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {jobs.map((j) => {
                const pct =
                  j.progress && j.progress.total
                    ? Math.min(100, Math.round((j.progress.received / j.progress.total) * 100))
                    : j.percent ?? null;
                const isActive = j.state === 'resolving' || j.state === 'downloading';
                return (
                  <div
                    key={j.id}
                    className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mono truncate text-xs text-white">
                          {j.filename || j.url}
                        </div>
                        <div className="mt-1 text-[11px] text-text-muted">
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
                        </div>
                        {j.error && <p role="alert" className="mt-2 whitespace-normal break-words text-xs leading-relaxed text-red-300">{j.error}</p>}
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
                          (j.phase === 'saving' ? 'salvando…' : pct !== null ? `${Math.round(pct)}%` : 'baixando…')}
                        {j.state === 'done' && 'salvo'}
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
          Downloads em fila, com até 3 pedidos simultâneos. Links
          privados exigem login. Use apenas para conteúdo que você tem
          direito de baixar.
        </p>
      </div>
    </ToolShell>
  );
}
