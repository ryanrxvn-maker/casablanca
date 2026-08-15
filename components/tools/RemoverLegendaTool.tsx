'use client';

import { useEffect, useRef, useState } from 'react';
import { ToolHeroVideo } from '@/components/ToolHeroVideo';
import { createClient } from '@/lib/supabase/client';
import { splitVideoByTime, joinCleanedWithOriginalAudio } from '@/lib/ffmpeg-worker';
import { withFFLock } from '@/lib/lipsync-pipeline';

/**
 * RemoverLegendaTool — remoção de legenda/marca d'água queimada.
 *
 * O motor de remoção só aceita trechos curtos, então por baixo dos panos a
 * ferramenta pica vídeos longos, limpa cada pedaço e costura tudo de volta —
 * TUDO INVISÍVEL pro cliente: pra ele é UM vídeo entrando e UM MP4 limpo
 * saindo. Ele nunca vê os trechos, o motor, nem sabe que houve pré/pós.
 *
 * Pipeline de UM disparo (runJob), todo assíncrono e resistente a rede:
 *   1. Pré-produção (client, ffmpeg.wasm): pica o vídeo em trechos ≤~28s por
 *      keyframe (sem re-encode = rápido; WORKERFS aguenta arquivos grandes).
 *   2. Cada trecho: sobe pro Supabase (signed URL) → START no servidor →
 *      POLL leve até o trecho limpo ficar pronto → baixa. Vários trechos em
 *      paralelo (concorrência limitada).
 *   3. Pós-produção (client): junta os trechos limpos + re-muxa o ÁUDIO
 *      ORIGINAL (contínuo, sem clique de emenda) → MP4 final pra baixar.
 */

// 800MB / 20min — a pré-produção pica pra caber no motor (≤30s/≤100MB por trecho).
const MAX_VIDEO_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 20 * 60 + 5; // 20min (folga de 5s)
const SEGMENT_TARGET_SEC = 24; // alvo por trecho (folga sob o teto de 30s do motor)
const SEGMENT_HARD_LIMIT_SEC = 29; // nenhum trecho pode passar disso
const SEGMENT_CONCURRENCY = 3; // trechos processados em paralelo

const UPLOAD_BUCKET = 'subtitle-uploads';

// ─── tipos ───────────────────────────────────────────────────────────────────

type JobStage = 'queued' | 'preparing' | 'processing' | 'finalizing' | 'done' | 'error';

type Job = {
  id: string;
  num: number;
  label: string;
  sourceUrl: string; // object URL do original (antes)
  stage: JobStage;
  pct: number; // 0-100 (barra visível)
  resultUrl: string | null; // object URL do MP4 final (depois)
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
    case 'preparing': return 'Preparando…';
    case 'processing': return `Removendo legenda ${j.pct.toFixed(0)}%`;
    case 'finalizing': return 'Finalizando…';
    case 'done': return 'Pronto ✓';
    case 'error': return 'Erro';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-tenta uma operação com backoff + jitter. Cada tentativa recomeça do zero
 * (ex.: pega uma signed URL nova), seguro pra uploads. Blip de rede some na 2ª/3ª.
 */
async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { tries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 4;
  const base = opts.baseDelayMs ?? 700;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= tries) break;
      const delay = Math.min(8000, base * 2 ** (attempt - 1)) + Math.random() * 400;
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── componente principal ────────────────────────────────────────────────────

export default function RemoverLegendaTool() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [formError, setFormError] = useState<string>('');
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const jobSeqRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [compareJob, setCompareJob] = useState<Job | null>(null);
  const cancelledRef = useRef<Set<string>>(new Set());

  const selected = videos.find((v) => v.id === selectedId) ?? null;

  async function addVideo(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      setFormError(`Vídeo de ${(file.size / 1024 / 1024).toFixed(0)}MB — o limite é 800MB. Comprime o vídeo e tenta de novo.`);
      return;
    }
    const id = `v-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const url = URL.createObjectURL(file);
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
      setTimeout(() => done(undefined), 5000);
    });
    if (meta && Number.isFinite(meta.dur) && meta.dur > MAX_DURATION_SEC) {
      URL.revokeObjectURL(url);
      setFormError(`Vídeo de ${Math.round(meta.dur / 60)}min — o limite é 20 minutos. Corta o vídeo e tenta de novo.`);
      return;
    }
    setVideos((prev) => [...prev, { id, file, url, meta }]);
    setSelectedId(id);
    setFormError('');
  }

  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    const okType = f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi|mpe?g)$/i.test(f.name);
    if (!okType) { setFormError('Solta um arquivo de vídeo (MP4, MOV, WEBM…).'); return; }
    void addVideo(f);
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

  // ── sobe UM trecho pro Supabase e devolve a URL pública ───────────────────────
  async function uploadSegment(file: Blob, isFirst: boolean): Promise<string> {
    return withRetry(async () => {
      const r = await fetch('/api/tools/remove-subtitle/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext: 'mp4', cleanup: isFirst }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.path || !d?.token) throw new Error(d?.error || `Falha ao iniciar upload (HTTP ${r.status})`);
      const supabase = createClient();
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).uploadToSignedUrl(d.path, d.token, file);
      if (error) throw error;
      if (!d.publicUrl || typeof d.publicUrl !== 'string') throw new Error('Upload não retornou URL.');
      return d.publicUrl as string;
    }, { tries: 4 });
  }

  // ── processa UM trecho: upload → START → POLL → download → Blob limpo ─────────
  async function processSegment(
    jobId: string,
    seg: Blob,
    isFirst: boolean,
    meta?: { w: number; h: number },
  ): Promise<Blob> {
    const publicUrl = await uploadSegment(seg, isFirst);

    // START — submete e volta com um token; 503 = fila cheia no instante (espera e re-POSTa).
    type StartData = { job?: string; status?: string; error?: unknown } | null;
    let job = '';
    for (let busy = 0; busy < 6; busy++) {
      if (cancelledRef.current.has(jobId)) throw new Error('cancelado');
      const r = await withRetry(async () => {
        const res = await fetch('/api/tools/remove-subtitle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_url: publicUrl, width: meta?.w || 0, height: meta?.h || 0 }),
        });
        const json = (await res.json().catch(() => null)) as StartData;
        return { status: res.status, ok: res.ok, data: json };
      }, { tries: 3, baseDelayMs: 1200 });
      if (r.status === 503) { await sleep(Math.min(8000, 2000 * 2 ** busy) + Math.random() * 400); continue; }
      if (!r.ok || !r.data?.job) {
        throw new Error(
          (r.data && (typeof r.data.error === 'string' ? r.data.error : r.data.error ? errMsg(r.data.error) : null)) ||
            `O servidor respondeu erro ${r.status}.`,
        );
      }
      job = r.data.job;
      break;
    }
    if (!job) throw new Error('O serviço está ocupado agora. Tenta de novo em instantes.');

    // POLL — acompanha o processamento (blip de rede não derruba o job).
    type StatusData = { status?: string; output_video_url?: string; error?: unknown } | null;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 20 * 60 * 1000;
    let outUrl = '';
    for (;;) {
      if (cancelledRef.current.has(jobId)) throw new Error('cancelado');
      if (Date.now() - startedAt > MAX_WAIT_MS) throw new Error('O processamento está demorando demais. Tenta de novo.');
      await sleep(3500 + Math.random() * 900);
      let st: StatusData = null;
      try {
        st = await withRetry(async () => {
          const res = await fetch(`/api/tools/remove-subtitle/status?job=${encodeURIComponent(job)}`);
          const json = (await res.json().catch(() => null)) as StatusData;
          if (!res.ok && res.status >= 500) throw new Error(`status HTTP ${res.status}`);
          if (!res.ok) return json ?? { status: 'error', error: `erro ${res.status}` };
          return json;
        }, { tries: 4, baseDelayMs: 1000 });
      } catch {
        continue; // blip de rede no poll → tenta no próximo ciclo
      }
      if (!st) continue;
      if (st.status === 'done' && st.output_video_url) { outUrl = st.output_video_url; break; }
      if (st.status === 'failed' || st.status === 'error') {
        throw new Error((typeof st.error === 'string' && st.error) || 'Falha ao processar um trecho.');
      }
    }

    // Download do trecho limpo (idempotente).
    return withRetry(async () => {
      const r = await fetch(outUrl);
      if (!r.ok) throw new Error(`Falha ao baixar um trecho (HTTP ${r.status}).`);
      return r.blob();
    }, { tries: 4 });
  }

  // ── pipeline de UM disparo ────────────────────────────────────────────────────
  async function runJob(jobId: string, file: File, meta?: { w: number; h: number; dur: number }) {
    try {
      // 1. Pré-produção: pica o vídeo em trechos (serializa o ffmpeg entre jobs).
      patchJob(jobId, { stage: 'preparing', pct: 3 });
      const segments = await withFFLock(() =>
        splitVideoByTime(file, SEGMENT_TARGET_SEC, SEGMENT_HARD_LIMIT_SEC, {
          onStage: () => patchJob(jobId, { stage: 'preparing' }),
        }),
      );
      if (cancelledRef.current.has(jobId)) return;
      patchJob(jobId, { stage: 'processing', pct: 12 });

      // 2. Processa os trechos (paralelismo limitado). Progresso 12→85%.
      const cleaned: Blob[] = new Array(segments.length);
      let doneCount = 0;
      let nextIdx = 0;
      const total = segments.length;
      const worker = async () => {
        for (;;) {
          const i = nextIdx++;
          if (i >= total) return;
          if (cancelledRef.current.has(jobId)) throw new Error('cancelado');
          cleaned[i] = await processSegment(jobId, segments[i], i === 0, meta);
          doneCount++;
          patchJob(jobId, { pct: 12 + (doneCount / total) * 73 });
        }
      };
      await Promise.all(Array.from({ length: Math.min(SEGMENT_CONCURRENCY, total) }, () => worker()));
      if (cancelledRef.current.has(jobId)) return;

      // 3. Pós-produção: junta os trechos limpos + re-muxa o áudio original.
      patchJob(jobId, { stage: 'finalizing', pct: 88 });
      const finalBlob = await withFFLock(() =>
        joinCleanedWithOriginalAudio(cleaned, file, {
          onStage: () => patchJob(jobId, { stage: 'finalizing' }),
        }),
      );
      if (cancelledRef.current.has(jobId)) return;

      const resultUrl = URL.createObjectURL(finalBlob);
      patchJob(jobId, { stage: 'done', pct: 100, resultUrl });
    } catch (e) {
      if (cancelledRef.current.has(jobId)) return;
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
    const meta = selected.meta;
    const num = (jobSeqRef.current += 1);
    const id = `job-${Date.now()}-${num}`;
    const sourceUrl = URL.createObjectURL(file);

    setJobs((prev) => [
      {
        id, num,
        label: `Vídeo ${String(num).padStart(2, '0')}`,
        sourceUrl,
        stage: 'queued',
        pct: 0,
        resultUrl: null, error: null,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    void runJob(id, file, meta);
  }

  function clearDoneJobs() {
    setJobs((prev) => {
      prev.forEach((j) => {
        if (!isActive(j.stage)) {
          URL.revokeObjectURL(j.sourceUrl);
          if (j.resultUrl) URL.revokeObjectURL(j.resultUrl);
        }
      });
      return prev.filter((j) => isActive(j.stage));
    });
  }

  useEffect(() => {
    const cancelled = cancelledRef.current;
    return () => {
      // Marca tudo como cancelado e libera os object URLs.
      setJobs((prev) => { prev.forEach((j) => cancelled.add(j.id)); return prev; });
      videos.forEach((v) => URL.revokeObjectURL(v.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // arrastar-e-soltar: aceita um vídeo solto em QUALQUER lugar da página
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setDragOver(false), 140);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (hideTimer) clearTimeout(hideTimer);
      setDragOver(false);
      acceptFile(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      if (hideTimer) clearTimeout(hideTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalNum = jobs.length ? Math.max(...jobs.map((j) => j.num)) : 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8 space-y-7">
      <ToolHeroVideo
        src="/cards/removedor-legenda.mp4"
        poster="/cards/removedor-legenda.jpg"
        eyebrow="Smart Remover"
        title="Removedor de Legenda"
        subtitle="Legenda queimada. IA remove. MP4 limpo."
        glow="rgba(244,114,182,0.5)"
      />

      <div className="grid gap-4 lg:grid-cols-[210px_1fr_300px]">
        {/* BIBLIOTECA */}
        <div className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-3 space-y-2 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted">VÍDEOS</span>
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
              <div className="mono text-[9px] text-text-dim mt-0.5">até 20min · 800MB</div>
            </div>
            <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }} />
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
                <p className="mt-2 text-[12px] text-text-muted max-w-[300px]">O vídeo com legenda/marca queimada. Qualquer duração, até 20 minutos.</p>
              </div>
            </div>
          )}
        </div>

        {/* PAINEL */}
        <aside className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-4 md:p-5 space-y-5">
          <div>
            <div className="label-tech text-[10px] font-bold tracking-[0.22em] text-fuchsia-300">MODO AUTOMÁTICO</div>
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
            <div className="mono text-[10px] text-text-muted">Vídeos longos entram inteiros — a IA cuida do resto</div>
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
              className="label-tech w-full text-[10px] tracking-[0.18em] text-text-muted hover:text-red-300 transition"
            >↺ Limpar</button>
          )}
        </aside>
      </div>

      {jobs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="label-tech text-[11px] font-bold tracking-[0.2em] text-white">VÍDEOS LIMPOS</span>
              <span className="mono text-[10px] text-text-dim">{jobs.length}</span>
            </div>
            {jobs.some((j) => !isActive(j.stage)) && (
              <button type="button" onClick={clearDoneJobs} className="label-tech text-[10px] tracking-[0.16em] text-text-muted hover:text-red-300 transition">Limpar prontos</button>
            )}
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => <JobCard key={job.id} job={job} total={totalNum} onCompare={() => setCompareJob(job)} />)}
          </div>
        </section>
      )}

      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3">
        <div className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted">Pra sair perfeito</div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Legenda/marca em posição fixa limpa melhor.</li>
          <li>· 720p ou mais pra reconstrução nítida.</li>
          <li>· Pode disparar vários — aparecem prontos conforme terminam.</li>
          <li>· Resultado em MP4, sem marca, pronto pra usar.</li>
          <li>· Não fecha a aba enquanto processa.</li>
          <li>· Qualquer duração, até 20 minutos por vídeo.</li>
        </ul>
      </div>

      {/* drag-and-drop: overlay enquanto arrasta um arquivo */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center bg-fuchsia-500/10 backdrop-blur-[2px]">
          <div className="rounded-[20px] border-2 border-dashed border-fuchsia-400/70 bg-black/65 px-10 py-7 text-center">
            <div className="text-[44px] leading-none">⬇</div>
            <div className="label-tech mt-2 text-[13px] font-bold tracking-[0.2em] text-white">Solta o vídeo pra subir</div>
            <div className="mono mt-1 text-[10px] text-white/60">MP4, MOV, WEBM… até 800MB</div>
          </div>
        </div>
      )}

      {/* comparação antes/depois em tela grande (slider) */}
      {compareJob && compareJob.resultUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setCompareJob(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-2.5">
            <div className="flex items-center justify-between gap-4" style={{ width: 'min(92vw, 41vh)' }}>
              <span className="label-tech text-[12px] font-bold tracking-[0.18em] text-white">
                {compareJob.label} · antes / depois
              </span>
              <button type="button" onClick={() => setCompareJob(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white transition hover:bg-white/10">✕</button>
            </div>
            <BeforeAfter beforeUrl={compareJob.sourceUrl} afterUrl={compareJob.resultUrl} />
            <a
              href={compareJob.resultUrl}
              download="video_limpo.mp4"
              className="label-tech rounded-[12px] border border-lime/50 bg-lime/15 px-4 py-3 text-center text-[12px] font-bold tracking-widest text-lime transition hover:bg-lime/25"
              style={{ width: 'min(92vw, 41vh)' }}
            >↓ Baixar MP4 limpo</a>
            <p className="mono text-center text-[10px] text-white/55">Arraste o divisor ⇆ pra comparar</p>
          </div>
        </div>
      )}
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

function JobCard({ job, total, onCompare }: { job: Job; total: number; onCompare: () => void }) {
  const isDone = job.stage === 'done';
  const isErr = job.stage === 'error';
  const proc = isActive(job.stage);

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
          <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 transition-all duration-500" style={{ width: Math.max(2, job.pct) + '%' }} />
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

      {isDone && job.resultUrl && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onCompare}
            className="group relative block w-full overflow-hidden rounded-[10px] border border-lime/40 bg-black shadow-[0_0_22px_-8px_rgba(200,232,124,0.55)]"
            title="Ver comparação antes/depois em tela grande"
          >
            <video src={job.resultUrl} muted loop playsInline preload="metadata" className="aspect-[3/4] w-full object-contain" />
            <span className="label-tech absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[8px] tracking-widest text-lime">Limpo ✓</span>
            <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100">
              <span className="mono inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-bold text-black">⤢ Comparar antes/depois</span>
            </span>
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onCompare}
              className="label-tech rounded-[10px] border border-white/15 bg-white/5 px-3 py-2 text-center text-[11px] font-bold tracking-widest text-white/85 transition hover:bg-white/10"
            >⤢ Comparar</button>
            <a
              href={job.resultUrl}
              download="video_limpo.mp4"
              className="label-tech rounded-[10px] border border-lime/40 bg-lime/10 px-3 py-2 text-center text-[11px] font-bold tracking-widest text-lime transition hover:bg-lime/20"
            >↓ Baixar</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BeforeAfter — slider antes/depois ─────────────────────────────────────────

function BeforeAfter({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [pos, setPos] = useState(50);
  const [ar, setAr] = useState('9 / 16');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const dragging = useRef(false);

  // Ambos os vídeos são locais (blob) → sincronizam suave; o ANTES é o mestre.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = aRef.current, b = bRef.current;
      if (a && b) {
        if (a.paused) a.play().catch(() => {});
        if (b.readyState >= 2 && b.paused) b.play().catch(() => {});
        if (b.readyState >= 2 && !b.seeking) {
          const d = b.currentTime - a.currentTime;
          if (Math.abs(d) > 0.25) { try { b.currentTime = a.currentTime; } catch { /* */ } }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function setFromClientX(clientX: number) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }

  return (
    <div
      ref={wrapRef}
      className="relative touch-none cursor-ew-resize select-none overflow-hidden rounded-[14px] border border-white/15 bg-black"
      style={{ height: '72vh', aspectRatio: ar, maxWidth: '92vw' }}
      onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setFromClientX(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) setFromClientX(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      {/* DEPOIS (camada de baixo, inteira) */}
      <video ref={bRef} src={afterUrl} muted loop autoPlay playsInline preload="auto" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      {/* ANTES (camada de cima, recortada até pos%) */}
      <video
        ref={aRef}
        src={beforeUrl}
        muted loop autoPlay playsInline
        onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setAr(`${v.videoWidth} / ${v.videoHeight}`); }}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <span className="label-tech pointer-events-none absolute left-2 top-2 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-bold tracking-widest text-white/85 backdrop-blur-md">Antes</span>
      <span className="label-tech pointer-events-none absolute right-2 top-2 rounded-full border border-lime/30 bg-black/55 px-2.5 py-1 text-[10px] font-bold tracking-widest text-lime backdrop-blur-md">Depois ✓</span>
      {/* divisor */}
      <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_10px_rgba(0,0,0,0.6)]" />
        <div className="absolute left-0 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-[14px] font-bold text-black shadow-lg">⇆</div>
      </div>
    </div>
  );
}
