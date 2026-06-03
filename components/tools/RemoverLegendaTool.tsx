'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * RemoverLegendaTool — remoção de legenda/marca d'água queimada via vmake
 * Smart (server-side, conta do admin). SEM instalador, SEM motor local.
 *
 * Fluxo NÃO-BLOQUEANTE (igual à fila do lipsync):
 *   - O usuário sobe um ou mais vídeos e clica REMOVER.
 *   - Na hora abre um CARD embaixo ("Vídeos limpos") já carregando, e o
 *     formulário fica LIVRE pra disparar outro.
 *   - Cada CARD = 1 disparo. O servidor sobe pro vmake, roda o Smart e
 *     devolve o MP4 limpo (re-hospedado, sem marca do motor).
 *   - O preview mostra ANTES (fonte) → DEPOIS (limpo) lado a lado.
 *
 * SEMPRE modo SMART (auto: detecta legenda + marca e reconstrói o fundo).
 */

const UPLOAD_BUCKET = 'remover-uploads';
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB

function errMsg(e: unknown): string {
  if (e == null) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || e.name || 'Erro';
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}') return s.slice(0, 300);
    } catch { /* ignore */ }
  }
  return String(e);
}

type JobStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error';

type Job = {
  id: string;
  num: number;
  label: string;
  status: JobStatus;
  percent: number;
  floor: number;
  estMs: number;
  sourceUrl: string; // blob URL da fonte (preview antes)
  resultUrl: string | null; // MP4 limpo
  error: string | null;
  createdAt: number;
};

type VideoItem = {
  id: string;
  file: File;
  url: string;
  meta?: { w: number; h: number; dur: number };
};

function isActive(s: JobStatus): boolean {
  return s !== 'done' && s !== 'error';
}

/** Estimativa do tempo total (ms) — calibra a barra de progresso. O vmake
 *  leva ~o tempo do vídeo pra processar (Smart frame-a-frame). */
function estimateJobMs(durSec: number, sizeMB: number): number {
  const upload = 6_000 + sizeMB * 250; // subir pro Supabase + pro vmake
  const gen = Math.max(30_000, durSec * 1_500); // render no motor
  return upload + gen;
}

export default function RemoverLegendaTool() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [formError, setFormError] = useState<string>('');

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const jobSeqRef = useRef<number>(0);

  const selected = videos.find((v) => v.id === selectedId) ?? null;

  async function addVideo(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      setFormError(`Vídeo de ${(file.size / 1024 / 1024).toFixed(0)}MB — o limite é 500MB.`);
      return;
    }
    const id = `v-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const url = URL.createObjectURL(file);
    let meta: VideoItem['meta'] | undefined;
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject();
      });
      meta = { w: v.videoWidth, h: v.videoHeight, dur: v.duration };
    } catch { /* ignore */ }
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

  /** Sobe o arquivo DIRETO pro Supabase via signed URL (browser → Supabase). */
  async function uploadPublic(file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const r = await fetch('/api/tools/remove-subtitle/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ext }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error || `Falha ao iniciar upload (HTTP ${r.status})`);
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .uploadToSignedUrl(d.path, d.token, file);
    if (error) throw new Error('Falha no upload pro storage: ' + errMsg(error));
    if (!d.publicUrl) throw new Error('Upload não retornou URL.');
    return d.publicUrl as string;
  }

  function patchJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
  function bumpFloor(id: string, floor: number) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, floor: Math.max(j.floor, floor) } : j)));
  }

  /** Pipeline de UM disparo (background, não bloqueia a UI). */
  async function runJob(id: string, file: File) {
    try {
      patchJob(id, { status: 'uploading' });
      const videoUrl = await uploadPublic(file);
      bumpFloor(id, 22);

      patchJob(id, { status: 'processing' });
      const res = await fetch('/api/tools/remove-subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: videoUrl, mode: 'smart' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.output_video_url) {
        throw new Error(
          (data && (typeof data.error === 'string' ? data.error : errMsg(data.error))) ||
            `O servidor respondeu erro ${res.status}.`,
        );
      }
      bumpFloor(id, 96);
      patchJob(id, { status: 'done', percent: 100, resultUrl: data.output_video_url });
    } catch (err) {
      patchJob(id, { status: 'error', error: errMsg(err) || 'Algo deu errado.' });
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
    const durSec = selected.meta?.dur || 30;
    const estMs = estimateJobMs(durSec, file.size / 1024 / 1024);

    setJobs((prev) => [
      {
        id,
        num,
        label: `Vídeo ${String(num).padStart(2, '0')}`,
        status: 'queued',
        percent: 4,
        floor: 4,
        estMs,
        sourceUrl: selected.url,
        resultUrl: null,
        error: null,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    void runJob(id, file);
  }

  function clearJobs() {
    setJobs((prev) => {
      prev.forEach((j) => {
        if (!isActive(j.status) && j.resultUrl) {
          /* resultUrl é URL pública do Supabase, não precisa revoke */
        }
      });
      return prev.filter((j) => isActive(j.status));
    });
  }

  /* Ticker da barra (tempo decorrido vs. estimativa, assintótico a 96%). */
  const hasActiveJob = jobs.some((j) => isActive(j.status));
  useEffect(() => {
    if (!hasActiveJob) return;
    const t = setInterval(() => {
      const now = Date.now();
      setJobs((prev) => {
        let changed = false;
        const next = prev.map((j) => {
          if (!isActive(j.status)) return j;
          const elapsed = now - j.createdAt;
          const timeBased = 96 * (1 - Math.exp((-1.7 * elapsed) / Math.max(8000, j.estMs)));
          const target = Math.min(96, Math.max(j.floor, timeBased));
          if (target <= j.percent + 0.05) return j;
          changed = true;
          const step = Math.max(0.25, (target - j.percent) * 0.3);
          return { ...j, percent: Math.min(target, j.percent + step) };
        });
        return changed ? next : prev;
      });
    }, 350);
    return () => clearInterval(t);
  }, [hasActiveJob]);

  useEffect(() => {
    return () => {
      videos.forEach((v) => URL.revokeObjectURL(v.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalNum = jobs.length ? Math.max(...jobs.map((j) => j.num)) : 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8 space-y-7">
      {/* HERO */}
      <header className="pt-2">
        <div
          className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          VÍDEO LIMPO · IA SMART · ZERO INSTALADOR
        </div>
        <h1
          className="mt-1 text-[28px] md:text-[34px] font-extrabold tracking-tight text-white"
          style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
        >
          Removedor de Legenda / Marca d&apos;Água
        </h1>
        <p className="mt-1 text-[13px] text-text-muted max-w-[620px]">
          Limpa legenda queimada e marca d&apos;água com IA. A IA reconstrói o fundo —
          sai um MP4 pronto, sem blur. <span className="text-white font-semibold">Tudo na nuvem.</span>
        </p>
      </header>

      {/* WORKSPACE — 3 colunas */}
      <div className="grid gap-4 lg:grid-cols-[210px_1fr_320px]">
        {/* COLUNA 1: biblioteca */}
        <div className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-3 space-y-2 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1 px-1">
            <span
              className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              VÍDEOS
            </span>
            {videos.length > 0 && <span className="mono text-[10px] text-text-dim">{videos.length}</span>}
          </div>

          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="group relative w-full overflow-hidden rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 aspect-[3/4] flex flex-col items-center justify-center gap-2 hover:border-fuchsia-400/55 hover:bg-fuchsia-400/[0.04] transition"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-text-muted text-[22px]">
              ⬆
            </span>
            <div className="text-center px-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                Subir vídeo
              </div>
              <div className="mono text-[9px] text-text-muted mt-0.5">arraste ou clique</div>
              <div className="mono text-[9px] text-text-dim mt-0.5">até 500MB</div>
            </div>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addVideo(f);
                e.target.value = '';
              }}
            />
          </button>

          {videos.map((v) => (
            <VideoThumb
              key={v.id}
              item={v}
              selected={v.id === selectedId}
              onSelect={() => setSelectedId(v.id)}
              onRemove={() => removeVideo(v.id)}
            />
          ))}
        </div>

        {/* COLUNA 2: preview da fonte */}
        <div className="relative overflow-hidden rounded-[18px] border border-line/60 bg-bg-soft/30">
          {selected ? (
            <div className="relative aspect-[3/4] md:aspect-[4/5] bg-black overflow-hidden">
              <video src={selected.url} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-contain" />
              <div className="absolute top-3 right-3 z-20">
                <span
                  className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md"
                  style={{ fontFamily: 'var(--font-tech)' }}
                >
                  ◇ FONTE {selected.meta ? `· ${selected.meta.w}×${selected.meta.h}` : ''}
                </span>
              </div>
            </div>
          ) : (
            <div className="aspect-[3/4] md:aspect-[4/5] flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/8 bg-black/40 text-text-muted text-[40px]">
                🎬
              </div>
              <div>
                <h3 className="text-[22px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                  Sobe um vídeo na esquerda
                </h3>
                <p className="mt-2 text-[13px] text-text-muted max-w-[360px]">
                  O vídeo com legenda/marca queimada. A IA limpa e reconstrói o fundo.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* COLUNA 3: painel */}
        <aside className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-4 md:p-5 space-y-5">
          <div>
            <div className="mono text-[10px] font-bold uppercase tracking-[0.22em] text-fuchsia-300" style={{ fontFamily: 'var(--font-tech)' }}>
              MODO INTELIGENTE
            </div>
            <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}>
              Smart Remover
            </h2>
            <p className="mt-2 text-[11.5px] leading-snug text-text-muted">
              A IA detecta onde a legenda/marca fica fixa e reconstrói o fundo automaticamente,
              frame a frame, sem blur. Sai um MP4 limpo.
            </p>
          </div>

          <div className="rounded-[12px] border border-lime/30 bg-lime/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
              </span>
              <span className="text-[12px] text-lime font-semibold">Motor na nuvem · sem instalar nada</span>
            </div>
          </div>

          {formError && (
            <div className="rounded-[10px] border border-red-500/55 bg-red-500/10 px-3 py-2 text-[11px] leading-snug text-red-200">
              {formError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selected}
            className="group relative w-full overflow-hidden rounded-[16px] border border-fuchsia-400/55 px-5 py-4 transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                'linear-gradient(135deg, rgba(232,121,249,0.25) 0%, rgba(167,139,250,0.25) 50%, rgba(103,232,249,0.20) 100%)',
              boxShadow: '0 0 30px -4px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            <span className="relative flex items-center justify-center gap-3">
              <span className="text-[18px]">✦</span>
              <span className="text-[14px] font-bold uppercase tracking-[0.22em] text-white leading-none" style={{ fontFamily: 'var(--font-tech)' }}>
                Remover legenda
              </span>
              <span className="text-[16px] transition-transform group-hover:translate-x-1.5 ml-auto">→</span>
            </span>
          </button>

          {videos.length > 0 && (
            <button
              type="button"
              onClick={() => {
                videos.forEach((v) => URL.revokeObjectURL(v.url));
                setVideos([]);
                setSelectedId('');
                setFormError('');
              }}
              className="mono w-full text-[10px] uppercase tracking-[0.18em] text-text-muted hover:text-red-300 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ↺ Limpar formulário
            </button>
          )}
        </aside>
      </div>

      {/* CARDS dos disparos */}
      {jobs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                VÍDEOS LIMPOS
              </span>
              <span className="mono text-[10px] text-text-dim">{jobs.length}</span>
            </div>
            {jobs.some((j) => !isActive(j.status)) && (
              <button
                type="button"
                onClick={clearJobs}
                className="mono text-[10px] uppercase tracking-[0.16em] text-text-muted hover:text-red-300 transition"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Limpar prontos
              </button>
            )}
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} total={totalNum} />
            ))}
          </div>
        </section>
      )}

      {/* TIPS */}
      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3">
        <div className="mono text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted" style={{ fontFamily: 'var(--font-tech)' }}>
          Pra sair perfeito
        </div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Legenda/marca em posição fixa limpa melhor.</li>
          <li>· 720p ou mais pra reconstrução nítida.</li>
          <li>· Pode disparar vários — vão aparecendo prontos embaixo.</li>
          <li>· O resultado sai em MP4, pronto pra usar.</li>
        </ul>
      </div>
    </div>
  );
}

/* ═══════════ VideoThumb ═══════════ */
function VideoThumb({ item, selected, onSelect, onRemove }: { item: VideoItem; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <div
      onClick={onSelect}
      className={
        'group relative overflow-hidden rounded-[12px] border-2 aspect-[3/4] cursor-pointer transition ' +
        (selected ? 'border-fuchsia-400/70 shadow-[0_0_22px_-6px_rgba(232,121,249,0.7)]' : 'border-line-strong hover:border-fuchsia-400/45')
      }
    >
      <video src={item.url} muted loop autoPlay={selected} playsInline className="h-full w-full object-cover" />
      {!selected && <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition" />}
      {selected && (
        <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-400 text-[10px] font-bold text-bg">✓</span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition"
      >
        ✕
      </button>
      {item.meta && (
        <span className="absolute bottom-1.5 left-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">{item.meta.dur.toFixed(1)}s</span>
      )}
    </div>
  );
}

/* ═══════════ JobCard ═══════════ */
function JobCard({ job, total }: { job: Job; total: number }) {
  const pct = Math.round(job.percent);
  return (
    <div className="fade-in-up rounded-[14px] border border-line bg-bg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="mono font-bold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
          {job.label} <span className="text-text-dim">/ {total}</span>
        </span>
        <span
          className={
            'mono shrink-0 ' +
            (job.status === 'done' ? 'text-lime' : job.status === 'error' ? 'text-red-400' : 'text-text-muted')
          }
        >
          {job.status === 'done' ? 'OK' : job.status === 'error' ? 'erro' : job.status === 'uploading' ? 'enviando' : job.status === 'processing' ? pct + '%' : 'na fila'}
        </span>
      </div>

      {isActive(job.status) && (
        <>
          <div className="aspect-video overflow-hidden rounded-[10px] bg-black">
            <video src={job.sourceUrl} muted loop autoPlay playsInline className="h-full w-full object-contain opacity-60" />
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 transition-all" style={{ width: pct + '%' }} />
          </div>
          <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
            {job.status === 'uploading' ? 'Enviando pro motor…' : 'IA reconstruindo o fundo…'}
          </div>
        </>
      )}

      {job.status === 'error' && job.error && (
        <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{job.error}</div>
      )}

      {job.status === 'done' && job.resultUrl && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-0.5">
              <div className="mono text-[8px] uppercase tracking-widest text-text-muted">Antes</div>
              <video src={job.sourceUrl} muted loop className="aspect-video w-full rounded-[8px] border border-line object-cover" />
            </div>
            <div className="space-y-0.5">
              <div className="mono text-[8px] uppercase tracking-widest text-lime">Limpo</div>
              <video src={job.resultUrl} controls className="aspect-video w-full rounded-[8px] border border-lime/30 object-cover" />
            </div>
          </div>
          <a
            href={job.resultUrl}
            download={`${job.label.replace(/\s+/g, '_')}_limpo.mp4`}
            className="mono block w-full rounded-[10px] border border-lime/40 bg-lime/10 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-lime hover:bg-lime/20 transition"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ↓ Baixar MP4 limpo
          </a>
        </div>
      )}
    </div>
  );
}
