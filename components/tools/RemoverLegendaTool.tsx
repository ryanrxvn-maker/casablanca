'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * RemoverLegendaTool — remoção de legenda/marca d'água via vmake Smart.
 *
 * Arquitetura para arquivos GRANDES (qualquer tamanho), sem CORS e sem o
 * limite do Supabase/Vercel:
 *   1. /upload/init → abre um multipart no OSS do vmake (sessão cifrada).
 *   2. O arquivo é fatiado em chunks de 4MB; cada chunk vai pro nosso
 *      servidor (≤ limite da Vercel) que repassa pro OSS (server-side, sem
 *      CORS). Chunks sobem em paralelo, com retry e progresso real.
 *   3. /remove-subtitle fecha o multipart + submete a remoção → record_id.
 *   4. Poll em /status até concluir. Exibe antes/depois + download.
 *
 * Nenhum timeout: o processamento corre no vmake, o cliente só faz poll.
 */

const CHUNK_SIZE = 4 * 1024 * 1024;     // 4MB por parte (abaixo do limite da Vercel)
const UPLOAD_CONCURRENCY = 4;           // chunks simultâneos (upload mais rápido)
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300MB — limite do motor de remoção (rejeita acima disso)

// ─── tipos ───────────────────────────────────────────────────────────────────

type JobStage = 'queued' | 'uploading' | 'submitting' | 'processing' | 'done' | 'error';

type Job = {
  id: string;
  num: number;
  label: string;
  sourceUrl: string;   // blob URL local (preview da fonte)
  stage: JobStage;
  uploadPct: number;
  vmakePct: number;
  recordId: string | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: number;
};

type VideoItem = {
  id: string;
  file: File;
  url: string;
  meta?: { w: number; h: number; dur: number };
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || 'Erro';
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.error === 'string') return o.error;
    try { return JSON.stringify(e).slice(0, 300); } catch { /* */ }
  }
  return String(e);
}

function isActive(s: JobStage): boolean {
  return s !== 'done' && s !== 'error';
}

function stageLabel(j: Job): string {
  switch (j.stage) {
    case 'queued': return 'Na fila…';
    case 'uploading': return `Enviando ${j.uploadPct.toFixed(0)}%`;
    case 'submitting': return 'Iniciando…';
    case 'processing': return `IA removendo ${j.vmakePct.toFixed(0)}%`;
    case 'done': return 'Pronto ✓';
    case 'error': return 'Erro';
  }
}

// ─── componente principal ────────────────────────────────────────────────────

export default function RemoverLegendaTool() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [formError, setFormError] = useState<string>('');
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const jobSeqRef = useRef(0);
  const pollingRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const selected = videos.find((v) => v.id === selectedId) ?? null;

  async function addVideo(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      setFormError(`Vídeo de ${(file.size / 1024 / 1024).toFixed(0)}MB — o limite é 300MB. Comprime ou corta o vídeo e tenta de novo.`);
      return;
    }
    const id = `v-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const url = URL.createObjectURL(file);
    // Lê metadata com TIMEOUT — nunca trava (vídeo que o browser demora pra
    // decodificar ainda é adicionado; o processamento é server-side mesmo).
    const meta = await new Promise<VideoItem['meta'] | undefined>((resolve) => {
      let settled = false;
      const done = (m: VideoItem['meta'] | undefined) => { if (!settled) { settled = true; resolve(m); } };
      try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
        v.onerror = () => done(undefined);
        v.src = url;
      } catch { done(undefined); }
      setTimeout(() => done(undefined), 4000);
    });
    setVideos((prev) => [...prev, { id, file, url, meta }]);
    setSelectedId(id);
    setFormError('');
  }

  function removeVideo(id: string) {
    setVideos((prev) => {
      const t = prev.find((v) => v.id === id);
      if (t) URL.revokeObjectURL(t.url);
      const next = prev.filter((v) => v.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? '');
      return next;
    });
  }

  function patchJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  // ── polling do processamento ────────────────────────────────────────────────
  function startPolling(jobId: string, recordId: string) {
    const tick = async () => {
      try {
        const r = await fetch(`/api/tools/remove-subtitle/status?record_id=${recordId}&mode=smart`);
        const d = await r.json();
        if (!r.ok) {
          patchJob(jobId, { stage: 'error', error: d?.error || `Erro ${r.status}` });
          return;
        }
        const { status, process, downloadUrl } = d;
        if (status === 2 && downloadUrl) {
          // NÃO guarda a downloadUrl (CDN assinada, expira ~1-2min).
          // O preview/download usam o proxy /download por record_id (sempre fresco).
          patchJob(jobId, { stage: 'done', vmakePct: 100 });
          return;
        }
        if (typeof status === 'number' && status < 0) {
          patchJob(jobId, { stage: 'error', error: 'O motor falhou ao processar o vídeo.' });
          return;
        }
        patchJob(jobId, { stage: 'processing', vmakePct: Math.round((process ?? 0) * 100) });
        pollingRef.current[jobId] = setTimeout(tick, 4000);
      } catch (e) {
        // erro de rede transitório — tenta de novo (não mata o job)
        pollingRef.current[jobId] = setTimeout(tick, 5000);
        void e;
      }
    };
    pollingRef.current[jobId] = setTimeout(tick, 3000);
  }

  // ── upload de UM chunk com retry ──────────────────────────────────────────────
  async function uploadChunk(
    session: string,
    partNumber: number,
    blob: Blob,
  ): Promise<{ partNumber: number; etag: string }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch('/api/tools/remove-subtitle/upload/part', {
          method: 'POST',
          headers: {
            'x-vmk-session': session,
            'x-vmk-part': String(partNumber),
            'content-type': 'application/octet-stream',
          },
          body: blob,
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.etag) throw new Error(d?.error || `parte ${partNumber} (HTTP ${r.status})`);
        return { partNumber, etag: d.etag };
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  // ── pipeline de UM disparo ────────────────────────────────────────────────────
  async function runJob(jobId: string, file: File) {
    try {
      // 1. init multipart
      patchJob(jobId, { stage: 'uploading', uploadPct: 0 });
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
      const initRes = await fetch('/api/tools/remove-subtitle/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext }),
      });
      const initData = await initRes.json();
      if (!initRes.ok || !initData?.session) {
        throw new Error(initData?.error || `Falha ao iniciar upload (${initRes.status})`);
      }
      const session: string = initData.session;

      // 2. fatia e sobe os chunks em paralelo (com retry + progresso real)
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);
      const parts: Array<{ partNumber: number; etag: string }> = new Array(totalParts);
      let uploadedBytes = 0;
      let nextIdx = 0;

      const worker = async () => {
        while (true) {
          const idx = nextIdx++;
          if (idx >= totalParts) return;
          const partNumber = idx + 1;
          const start = idx * CHUNK_SIZE;
          const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
          const res = await uploadChunk(session, partNumber, blob);
          parts[idx] = res;
          uploadedBytes += blob.size;
          patchJob(jobId, { uploadPct: (uploadedBytes / file.size) * 100 });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, totalParts) }, () => worker()),
      );

      // 3. fecha o multipart + submete a remoção
      patchJob(jobId, { stage: 'submitting' });
      const finRes = await fetch('/api/tools/remove-subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, parts: parts.filter(Boolean), mode: 'smart', title: file.name }),
      });
      const finData = await finRes.json();
      if (!finRes.ok || !finData?.record_id) {
        throw new Error(finData?.error || `Falha ao iniciar processamento (${finRes.status})`);
      }

      // 4. poll
      patchJob(jobId, { stage: 'processing', vmakePct: 0, recordId: finData.record_id });
      startPolling(jobId, finData.record_id);
    } catch (e) {
      patchJob(jobId, { stage: 'error', error: errMsg(e) || 'Algo deu errado.' });
    }
  }

  function handleGenerate() {
    setFormError('');
    if (!selected) {
      setFormError('Sobe um vídeo na esquerda.');
      return;
    }
    const file = selected.file;
    const num = (jobSeqRef.current += 1);
    const id = `job-${Date.now()}-${num}`;
    const sourceUrl = URL.createObjectURL(file);

    setJobs((prev) => [
      {
        id, num,
        label: `Vídeo ${String(num).padStart(2, '0')}`,
        sourceUrl,
        stage: 'queued',
        uploadPct: 0, vmakePct: 0,
        recordId: null, resultUrl: null, error: null,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    void runJob(id, file);
  }

  function clearDoneJobs() {
    setJobs((prev) => {
      prev.forEach((j) => { if (!isActive(j.stage)) URL.revokeObjectURL(j.sourceUrl); });
      return prev.filter((j) => isActive(j.stage));
    });
  }

  useEffect(() => {
    return () => {
      Object.values(pollingRef.current).forEach(clearTimeout);
      videos.forEach((v) => URL.revokeObjectURL(v.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalNum = jobs.length ? Math.max(...jobs.map((j) => j.num)) : 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8 space-y-7">
      <header className="pt-2">
        <div className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300" style={{ fontFamily: 'var(--font-tech)' }}>
          VÍDEO LIMPO · IA SMART · NUVEM · QUALQUER TAMANHO
        </div>
        <h1 className="mt-1 text-[28px] md:text-[34px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}>
          Removedor de Legenda / Marca d&apos;Água
        </h1>
        <p className="mt-1 text-[13px] text-text-muted max-w-[620px]">
          IA detecta a legenda/marca queimada e reconstrói o fundo, frame a frame.{' '}
          <span className="text-white font-semibold">Sobe o vídeo, aguarda e baixa o MP4 limpo.</span>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[210px_1fr_300px]">
        {/* BIBLIOTECA */}
        <div className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-3 space-y-2 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>VÍDEOS</span>
            {videos.length > 0 && <span className="mono text-[10px] text-text-dim">{videos.length}</span>}
          </div>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="group relative w-full overflow-hidden rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 aspect-[3/4] flex flex-col items-center justify-center gap-2 hover:border-fuchsia-400/55 hover:bg-fuchsia-400/[0.04] transition"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-text-muted text-[22px] transition-transform group-hover:scale-110">⬆</span>
            <div className="text-center px-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>Subir vídeo</div>
              <div className="mono text-[9px] text-text-muted mt-0.5">arraste ou clique</div>
              <div className="mono text-[9px] text-text-dim mt-0.5">qualquer tamanho</div>
            </div>
            <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) addVideo(f); e.target.value = ''; }} />
          </button>
          {videos.map((v) => (
            <VideoThumb key={v.id} item={v} selected={v.id === selectedId} onSelect={() => setSelectedId(v.id)} onRemove={() => removeVideo(v.id)} />
          ))}
        </div>

        {/* PREVIEW */}
        <div className="relative overflow-hidden rounded-[18px] border border-line/60 bg-bg-soft/30">
          {selected ? (
            <div className="relative aspect-[3/4] md:aspect-[4/5] bg-black overflow-hidden">
              <video src={selected.url} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-contain" />
              <div className="absolute top-3 right-3 z-20">
                <span className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md" style={{ fontFamily: 'var(--font-tech)' }}>
                  ◇ FONTE{selected.meta ? ` · ${selected.meta.w}×${selected.meta.h} · ${selected.meta.dur.toFixed(0)}s` : ''}
                </span>
              </div>
              <div className="absolute bottom-3 right-3 z-20">
                <span className="mono inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[9px] text-white/70 backdrop-blur-md">
                  {(selected.file.size / 1024 / 1024).toFixed(0)} MB
                </span>
              </div>
            </div>
          ) : (
            <div className="aspect-[3/4] md:aspect-[4/5] flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="text-[48px] opacity-30">🎬</div>
              <div>
                <h3 className="text-[22px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)' }}>Sobe um vídeo</h3>
                <p className="mt-2 text-[12px] text-text-muted max-w-[300px]">O vídeo com legenda/marca queimada. Qualquer tamanho.</p>
              </div>
            </div>
          )}
        </div>

        {/* PAINEL */}
        <aside className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-4 md:p-5 space-y-5">
          <div>
            <div className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300" style={{ fontFamily: 'var(--font-tech)' }}>MODO AUTOMÁTICO</div>
            <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}>Smart Remover</h2>
            <p className="mt-2 text-[11.5px] leading-snug text-text-muted">Detecta a legenda/marca automaticamente e reconstrói o fundo. Sai um MP4 limpo pra usar.</p>
          </div>
          <div className="rounded-[12px] border border-lime/30 bg-lime/5 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
              </span>
              <span className="text-[12px] text-lime font-semibold">Motor na nuvem · sem instalar nada</span>
            </div>
            <div className="mono text-[10px] text-text-muted">Upload em chunks · sem limite de tamanho</div>
          </div>
          {formError && <div className="rounded-[10px] border border-red-500/55 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{formError}</div>}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selected}
            className="group relative w-full overflow-hidden rounded-[16px] border border-fuchsia-400/55 px-5 py-4 transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, rgba(232,121,249,0.25) 0%, rgba(167,139,250,0.25) 50%, rgba(103,232,249,0.20) 100%)', boxShadow: '0 0 30px -4px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.12)' }}
          >
            <span className="relative flex items-center justify-center gap-3">
              <span className="text-[18px]">✦</span>
              <span className="text-[14px] font-bold uppercase tracking-[0.22em] text-white leading-none" style={{ fontFamily: 'var(--font-tech)' }}>Remover legenda</span>
              <span className="text-[16px] transition-transform group-hover:translate-x-1.5 ml-auto">→</span>
            </span>
          </button>
          {videos.length > 0 && (
            <button
              type="button"
              onClick={() => { videos.forEach((v) => URL.revokeObjectURL(v.url)); setVideos([]); setSelectedId(''); setFormError(''); }}
              className="mono w-full text-[10px] uppercase tracking-[0.18em] text-text-muted hover:text-red-300 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >↺ Limpar</button>
          )}
        </aside>
      </div>

      {jobs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>VÍDEOS LIMPOS</span>
              <span className="mono text-[10px] text-text-dim">{jobs.length}</span>
            </div>
            {jobs.some((j) => !isActive(j.stage)) && (
              <button type="button" onClick={clearDoneJobs} className="mono text-[10px] uppercase tracking-[0.16em] text-text-muted hover:text-red-300 transition" style={{ fontFamily: 'var(--font-tech)' }}>Limpar prontos</button>
            )}
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => <JobCard key={job.id} job={job} total={totalNum} />)}
          </div>
        </section>
      )}

      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3">
        <div className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>Pra sair perfeito</div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Legenda/marca em posição fixa limpa melhor.</li>
          <li>· 720p ou mais pra reconstrução nítida.</li>
          <li>· Pode disparar vários — aparecem prontos conforme terminam.</li>
          <li>· Resultado em MP4, sem marca, pronto pra usar.</li>
          <li>· Não fecha a aba enquanto processa — o poll continua.</li>
          <li>· Arquivos grandes sobem em pedaços, sem limite.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── VideoThumb ───────────────────────────────────────────────────────────────

function VideoThumb({ item, selected, onSelect, onRemove }: { item: VideoItem; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <div onClick={onSelect} className={'group relative overflow-hidden rounded-[12px] border-2 aspect-[3/4] cursor-pointer transition ' + (selected ? 'border-fuchsia-400/70 shadow-[0_0_22px_-6px_rgba(232,121,249,0.7)]' : 'border-line-strong hover:border-fuchsia-400/45')}>
      <video src={item.url} muted loop autoPlay={selected} playsInline className="h-full w-full object-cover" />
      {!selected && <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition" />}
      {selected && <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-400 text-[10px] font-bold text-bg">✓</span>}
      <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition">✕</button>
      {item.meta && <span className="absolute bottom-1.5 left-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">{item.meta.dur.toFixed(0)}s</span>}
    </div>
  );
}

// ─── JobCard ──────────────────────────────────────────────────────────────────

function JobCard({ job, total }: { job: Job; total: number }) {
  const isDone = job.stage === 'done';
  const isErr = job.stage === 'error';
  const proc = isActive(job.stage);

  // Preview + download via proxy do servidor: resolve uma URL FRESCA a cada
  // request (a do CDN é assinada e expira ~1-2min), faz streaming (arquivos
  // grandes, sem estourar memória) e força o download (Content-Disposition).
  const base = job.recordId
    ? `/api/tools/remove-subtitle/download?record_id=${encodeURIComponent(job.recordId)}&mode=smart`
    : '';
  const previewUrl = base;
  const dlUrl = base ? base + '&dl=1' : '';

  let barPct = 0;
  if (job.stage === 'uploading') barPct = 2 + (job.uploadPct / 100) * 40;
  else if (job.stage === 'submitting') barPct = 44;
  else if (job.stage === 'processing') barPct = 44 + (job.vmakePct / 100) * 54;
  else if (isDone) barPct = 100;

  return (
    <div className="fade-in-up rounded-[14px] border border-line bg-bg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="mono font-bold text-white truncate" style={{ fontFamily: 'var(--font-tech)' }}>
          {job.label} <span className="text-text-dim font-normal">/ {total}</span>
        </span>
        <span className={'mono shrink-0 text-[10px] ' + (isDone ? 'text-lime' : isErr ? 'text-red-400' : 'text-text-muted')}>
          {stageLabel(job)}
        </span>
      </div>

      {proc && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 transition-all duration-500" style={{ width: barPct + '%' }} />
        </div>
      )}

      {proc && (
        <div className="aspect-video overflow-hidden rounded-[10px] bg-black">
          <video src={job.sourceUrl} muted loop autoPlay playsInline className="h-full w-full object-contain opacity-50" />
        </div>
      )}

      {isErr && job.error && (
        <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{job.error}</div>
      )}

      {isDone && job.recordId && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <div className="mono text-[8px] uppercase tracking-widest text-text-muted">Antes</div>
              <video src={job.sourceUrl} muted loop className="aspect-video w-full rounded-[8px] border border-line object-cover" />
            </div>
            <div className="space-y-0.5">
              <div className="mono text-[8px] uppercase tracking-widest text-lime">Limpo ✓</div>
              <video src={previewUrl} controls preload="metadata" className="aspect-video w-full rounded-[8px] border border-lime/40 object-cover shadow-[0_0_20px_-8px_rgba(200,232,124,0.5)]" />
            </div>
          </div>
          <a href={dlUrl} download="video_limpo.mp4" className="mono block w-full rounded-[10px] border border-lime/40 bg-lime/10 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-lime hover:bg-lime/20 transition" style={{ fontFamily: 'var(--font-tech)' }}>
            ↓ Baixar MP4 limpo
          </a>
        </div>
      )}
    </div>
  );
}
