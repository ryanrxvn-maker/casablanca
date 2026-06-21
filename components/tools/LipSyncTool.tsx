'use client';

import { useEffect, useRef, useState } from 'react';
import { LipSyncHero3D } from '@/app/tools/lipsync/LipSyncHero3D';
import { createClient } from '@/lib/supabase/client';
import { LipsyncPreviewCard, type LipsyncTake } from '@/components/LipsyncPreviewCard';

const UPLOAD_BUCKET = 'lipsync-uploads';

/** Limite rígido de upload do vídeo: 300MB (exatos 300MB passam). */
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/** Ícone de import profissional (sem cor chamativa — herda currentColor cinza). */
function ImportIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </svg>
  );
}

/** Mede a duração (s) de um arquivo de mídia via elemento HTML. */
async function measureMediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
      el.preload = 'metadata';
      el.src = url;
      el.onloadedmetadata = () => {
        const d = el.duration || 0;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : 0);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    } catch {
      resolve(0);
    }
  });
}

/** Extrai mensagem legível de QUALQUER erro — nunca devolve "[object Object]". */
function errMsg(e: unknown): string {
  if (e == null) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || e.name || 'Erro';
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    const inner = o.error as Record<string, unknown> | undefined;
    if (inner && typeof inner === 'object' && typeof inner.message === 'string') return inner.message;
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}' && s !== 'null') return s.slice(0, 300);
    } catch {
      /* ignore */
    }
  }
  return String(e);
}

/**
 * LipSyncTool — UI de geração de lipsync.
 *
 * Fluxo NÃO-BLOQUEANTE (estilo "fila de criações"):
 *   - O usuário escolhe um vídeo (rosto) + sobe um áudio e clica GERAR.
 *   - Na hora abre um CARD embaixo ("Meus LipSyncs") já carregando, e o
 *     formulário fica LIVRE pra disparar outro — sem trocar de tela.
 *   - O preview central continua mostrando a FONTE (o vídeo enviado), nunca
 *     o resultado. Os resultados aparecem só nos cards de baixo.
 *   - Cada CARD = 1 disparo do usuário. Se internamente o áudio for longo e
 *     a gente dividir em trechos, isso é INVISÍVEL pro cliente (pra ele é
 *     uma geração só, costurada no final).
 *
 * Layout (3 colunas): biblioteca de vídeos · preview da fonte · painel de
 * configuração. Abaixo: grade "Meus LipSyncs".
 */

/** Etapas internas de UM disparo. */
type JobStatus =
  | 'queued'
  | 'pre'
  | 'uploading'
  | 'generating'
  | 'concat'
  | 'done'
  | 'error';

type Job = {
  id: string;
  num: number; // nº sequencial do disparo (rótulo)
  label: string; // "LipSync 01"
  status: JobStatus;
  percent: number; // 0-100 (barra visível, monotônica)
  floor: number; // piso real (marcos de etapa) — a barra nunca fica abaixo
  estMs: number; // estimativa de tempo total → barra previsível
  videoUrl: string | null; // object URL do MP4 final
  error: string | null;
  createdAt: number;
};

type VideoItem = {
  id: string;
  file: File;
  url: string; // local blob URL pra preview
  meta?: { w: number; h: number; dur: number };
};

function isActive(s: JobStatus): boolean {
  return s !== 'done' && s !== 'error';
}

/** Corre uma promise contra um timeout (ms). Usado pra etapas de ffmpeg
 *  não pendurarem o disparo — se estourar, o chamador faz fallback. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Estimativa grosseira do tempo total de um disparo (ms) — calibra a barra
 *  de progresso pra ela preencher de acordo com o processo inteiro. */
function estimateJobMs(audioSec: number, faceNeedsCompress: boolean, clean: boolean): number {
  const compress = faceNeedsCompress ? 60_000 : 0; // compressão (veryfast 1080p)
  const cleanMs = clean ? 5_000 + audioSec * 180 : 0; // limpar áudio (se ligado)
  const upload = 8_000; // subir o rosto
  const gen = Math.max(26_000, audioSec * 1_800); // render no motor (trechos em série)
  const concat = audioSec > 108 ? 6_000 : 0; // costura (só áudio longo)
  return compress + cleanMs + upload + gen + concat;
}

/** Mapeia a etapa interna pro estado visual do card. */
function jobTakeStatus(s: JobStatus): LipsyncTake['status'] {
  if (s === 'done') return 'completed';
  if (s === 'error') return 'failed';
  if (s === 'queued') return 'pending';
  return 'processing';
}

export default function LipSyncTool() {
  // Library de videos uploadados
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  // Audio
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string>('');
  const [audioDur, setAudioDur] = useState<number>(0);

  // Fila de disparos (cada um vira um card embaixo)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [formError, setFormError] = useState<string>('');
  const [flash, setFlash] = useState<boolean>(false); // toast "enviado ↓"

  // Limpar áudio (pré-produção do áudio: highpass + normalização de volume).
  // Ligado por padrão, mas OPCIONAL: às vezes o ruído faz parte do natural
  // do áudio e o usuário quer mandar o áudio ORIGINAL, sem mexer.
  const [cleanAudioOn, setCleanAudioOn] = useState<boolean>(true);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const jobSeqRef = useRef<number>(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = videos.find((v) => v.id === selectedId) ?? null;

  /* ─── Validacao do video ─────────────────────────────────────
     Detecta problemas conhecidos que causam glitches no lipsync. */
  const videoIssues: Array<{ severity: 'block' | 'warn' | 'info'; text: string }> = (() => {
    if (!selected || !selected.meta) return [];
    const issues: Array<{ severity: 'block' | 'warn' | 'info'; text: string }> = [];
    const { w, h, dur } = selected.meta;
    const minDim = Math.min(w, h);

    if (minDim < 480) issues.push({ severity: 'warn', text: `Resolução ${w}×${h} baixa — os dentes podem sair menos nítidos.` });
    if (dur < 2) issues.push({ severity: 'block', text: `Vídeo de ${dur.toFixed(1)}s é muito curto — use pelo menos 2s de rosto.` });
    if (selected.file.size > 200 * 1024 * 1024) issues.push({ severity: 'warn', text: `Arquivo ${(selected.file.size / 1024 / 1024).toFixed(0)}MB grande — upload pode demorar.` });

    return issues;
  })();
  const hasBlockingIssue = videoIssues.some((i) => i.severity === 'block');

  /* ─── Video library ─────────────────────────────────────────── */

  async function addVideo(file: File) {
    // Limite RÍGIDO de 300MB no upload (não deixa nem adicionar acima disso).
    if (file.size > MAX_VIDEO_BYTES) {
      setFormError(
        `Vídeo de ${(file.size / 1024 / 1024).toFixed(0)}MB — o limite é 300MB. Usa um arquivo até 300MB.`,
      );
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
    } catch {
      // ignore
    }
    const item: VideoItem = { id, file, url, meta };
    setVideos((prev) => [...prev, item]);
    setSelectedId(id);
    setFormError('');
  }

  function removeVideo(id: string) {
    setVideos((prev) => {
      const target = prev.find((v) => v.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((v) => v.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? '');
      return next;
    });
  }

  /* ─── Audio ─────────────────────────────────────────────────── */

  async function setAudio(file: File | null) {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    if (!file) {
      setAudioFile(null);
      setAudioPreview('');
      setAudioDur(0);
      return;
    }
    setAudioFile(file);
    setFormError('');
    const url = URL.createObjectURL(file);
    setAudioPreview(url);
    try {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = url;
      await new Promise<void>((resolve, reject) => {
        a.onloadedmetadata = () => resolve();
        a.onerror = () => reject();
      });
      setAudioDur(a.duration);
    } catch {
      setAudioDur(0);
    }
  }

  /* ─── Upload helper ─────────────────────────────────────────────
     Sobe o arquivo DIRETO pro Supabase Storage via signed URL
     (browser → Supabase, SEM passar pela Vercel) e retorna a URL
     pública que o servidor baixa pra gerar. A Vercel corta corpos
     > ~4,5MB; subindo direto o arquivo nunca toca a Vercel. */
  async function uploadPublic(file: File, kind: 'video' | 'audio'): Promise<string> {
    const ext = (file.name.split('.').pop() || (kind === 'audio' ? 'mp3' : 'mp4')).toLowerCase();
    const r = await fetch('/api/tools/lipsync/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ext }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error || `Falha ao iniciar upload (HTTP ${r.status})`);
    const supabase = createClient();
    let upErr: unknown = null;
    try {
      const { error } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .uploadToSignedUrl(d.path, d.token, file);
      upErr = error;
    } catch (e) {
      upErr = e;
    }
    if (upErr) throw new Error('Falha no upload pro storage: ' + errMsg(upErr));
    if (!d.publicUrl || typeof d.publicUrl !== 'string') throw new Error('Upload não retornou URL.');
    return d.publicUrl as string;
  }

  /** Uma geração (rosto + 1 trecho de áudio): sobe → gera → baixa. SEM
   *  pós-produção: o que sai do motor já é o resultado final. */
  async function generateOne(
    faceUrl: string, audioChunk: File, chunkMs: number, label?: string,
  ): Promise<Blob> {
    const aUrl = await uploadPublic(audioChunk, 'audio');
    const res = await fetch('/api/tools/lipsync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: faceUrl, audio_url: aUrl, audio_ms: chunkMs }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.output_video_url) {
      throw new Error(
        (data && (typeof data.error === 'string' ? data.error : data.error ? errMsg(data.error) : null)) ||
          (label ? `Falha ao gerar ${label}.` : `O servidor respondeu erro ${res.status}.`),
      );
    }
    const r = await fetch(data.output_video_url);
    if (!r.ok) throw new Error(`Falha ao baixar o resultado${label ? ` (${label})` : ''}.`);
    return r.blob();
  }

  /* ─── Jobs ───────────────────────────────────────────────────── */

  function patchJob(id: string, patch: Partial<Job>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  /** Sobe o "piso" real da barra (marco de etapa concluída). Só mexe no
   *  FLOOR — o ticker faz a barra subir SUAVE até ele (sem salto). */
  function bumpFloor(id: string, floor: number) {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, floor: Math.max(j.floor, floor) } : j)),
    );
  }

  /**
   * Pipeline de UM disparo. Roda em background (não bloqueia a UI). Toda
   * etapa de ffmpeg passa pela fila interna (withFFLock). SEM pós-produção:
   * o que sai do motor já é o resultado final (mais rápido + nada pra travar).
   */
  async function runJob(id: string, faceFile: File, audioSrc: File, audioMs: number, cleanOn: boolean) {
    try {
      const {
        prepareFaceVideo, cleanAudioMp3, splitAudioChunks, concatLipVideos,
        CHUNK_THRESHOLD_SEC, MAX_CHUNK_SEC,
      } = await import('@/lib/lipsync-pipeline');

      // 1. PRÉ-PRODUÇÃO: rosto (native se ≤44MB; senão comprime preservando
      //    qualidade) + áudio. O "limpar áudio" é OPCIONAL (toggle): se
      //    ligado, normaliza (com timeout→fallback pro cru, nunca prende);
      //    se desligado, manda o áudio ORIGINAL intacto.
      patchJob(id, { status: 'pre' });
      const audioPrep: Promise<File> = cleanOn
        ? (async (): Promise<File> => {
            try {
              return await withTimeout(cleanAudioMp3(audioSrc), 90_000);
            } catch {
              return audioSrc; // fallback: áudio cru (garante o disparo)
            }
          })()
        : Promise.resolve(audioSrc); // toggle off → áudio original, sem mexer
      const [face, cleanAudio] = await Promise.all([prepareFaceVideo(faceFile), audioPrep]);
      bumpFloor(id, 14);

      // 2. CHUNKING (invisível pro cliente): áudio longo vira trechos ≤100s.
      const needChunk = audioMs / 1000 > CHUNK_THRESHOLD_SEC;
      const audioChunks = needChunk ? await splitAudioChunks(cleanAudio, MAX_CHUNK_SEC) : [cleanAudio];
      const n = audioChunks.length;

      // 3. Sobe o ROSTO uma vez só (reusado em todos os trechos).
      patchJob(id, { status: 'uploading' });
      const faceUrl = await uploadPublic(face, 'video');
      bumpFloor(id, 24);

      // 4. Gera trecho a trecho, em SÉRIE (anti-throttle + 1 render por vez).
      patchJob(id, { status: 'generating' });
      const outBlobs: Blob[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const chunkMs = n > 1
          ? Math.round((await measureMediaDuration(audioChunks[i])) * 1000) || Math.min(MAX_CHUNK_SEC * 1000, audioMs)
          : audioMs;
        outBlobs[i] = await generateOne(faceUrl, audioChunks[i], chunkMs, n > 1 ? `trecho ${i + 1}/${n}` : undefined);
        bumpFloor(id, 26 + Math.round(((i + 1) / n) * 62)); // marco REAL por trecho → até ~88
      }

      // 5. COSTURA os trechos num só (1 trecho = direto, sem custo).
      let finalBlob: Blob;
      if (n > 1) {
        patchJob(id, { status: 'concat' });
        bumpFloor(id, 92);
        finalBlob = await concatLipVideos(outBlobs);
      } else {
        finalBlob = outBlobs[0];
      }

      patchJob(id, { status: 'done', percent: 100, videoUrl: URL.createObjectURL(finalBlob) });
    } catch (err) {
      patchJob(id, { status: 'error', error: errMsg(err) || 'Algo deu errado.' });
    }
  }

  /** Dispara — NÃO bloqueia: cria o card, libera o form, roda em background. */
  async function handleGenerate() {
    setFormError('');
    if (!selected) {
      setFormError('Seleciona um vídeo na esquerda.');
      return;
    }
    if (!audioFile) {
      setFormError('Sobe o áudio que a boca vai falar.');
      return;
    }
    let audioMs = Math.round((audioDur || 0) * 1000);
    if (!audioMs) audioMs = Math.round((await measureMediaDuration(audioFile)) * 1000);
    if (!audioMs || audioMs <= 0) {
      setFormError('Não consegui ler a duração do áudio. Tenta outro arquivo (mp3/wav/mp4).');
      return;
    }
    if (selected.file.size > MAX_VIDEO_BYTES) {
      setFormError('Vídeo acima de 300MB. Usa um arquivo até 300MB.');
      return;
    }
    if (audioMs > 600_000) {
      setFormError('Áudio acima de 10 minutos. Usa um áudio até 10min.');
      return;
    }

    // Snapshot dos inputs — o form fica LIVRE e o usuário pode trocar tudo
    // sem afetar este disparo (o pipeline usa as cópias capturadas aqui).
    const faceFile = selected.file;
    const audioSrc = audioFile;
    const ms = audioMs;
    const doClean = cleanAudioOn; // snapshot — toggle pode mudar depois
    const num = (jobSeqRef.current += 1);
    const id = `job-${Date.now()}-${num}`;
    const label = `LipSync ${String(num).padStart(2, '0')}`;
    // Estimativa de tempo total → barra de progresso previsível (preenche
    // de acordo com o processo inteiro, sem saltos nem congelamento).
    const faceCompress = faceFile.size > 44 * 1024 * 1024;
    const estMs = estimateJobMs(ms / 1000, faceCompress, doClean);

    // Card aparece embaixo JÁ carregando; o form continua livre na mesma tela.
    setJobs((prev) => [
      { id, num, label, status: 'queued', percent: 4, floor: 4, estMs, videoUrl: null, error: null, createdAt: Date.now() },
      ...prev,
    ]);

    // Toast "enviado ↓" no preview pra guiar o olho pra fila de baixo.
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2600);

    // Roda em background — sem await: a UI segue livre.
    void runJob(id, faceFile, audioSrc, ms, doClean);
  }

  /** Limpa os disparos PRONTOS/falhos (mantém os que ainda estão rodando). */
  function clearJobs() {
    setJobs((prev) => {
      prev.forEach((j) => {
        if (!isActive(j.status) && j.videoUrl) URL.revokeObjectURL(j.videoUrl);
      });
      return prev.filter((j) => isActive(j.status));
    });
  }

  /** Limpa só o FORMULÁRIO (biblioteca + áudio). Os cards de baixo ficam. */
  function handleReset() {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    videos.forEach((v) => URL.revokeObjectURL(v.url));
    setVideos([]);
    setSelectedId('');
    setAudioFile(null);
    setAudioPreview('');
    setAudioDur(0);
    setFormError('');
  }

  /* ─── Ticker da barra: progresso por TEMPO do processo inteiro ─────────
     Previsível e suave: a barra avança conforme o tempo decorrido vs. a
     estimativa total (curva que desacelera mas NUNCA para — assintótica a
     96%). Os marcos REAIS (bumpFloor) puxam a barra pra cima quando uma
     etapa termina antes do previsto. Monotônica = nunca volta atrás. */
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
          // 0 → 96 assintótico; ~80% no tempo estimado, segue subindo devagar.
          const timeBased = 96 * (1 - Math.exp(-1.7 * elapsed / Math.max(8000, j.estMs)));
          const target = Math.min(96, Math.max(j.floor, timeBased));
          if (target <= j.percent + 0.05) return j;
          changed = true;
          // ease até o alvo, com passo mínimo → sempre se move (não “trava”).
          const step = Math.max(0.25, (target - j.percent) * 0.3);
          return { ...j, percent: Math.min(target, j.percent + step) };
        });
        return changed ? next : prev;
      });
    }, 350);
    return () => clearInterval(t);
  }, [hasActiveJob]);

  /* ─── Cleanup ─── */
  useEffect(() => {
    return () => {
      videos.forEach((v) => URL.revokeObjectURL(v.url));
      if (audioPreview) URL.revokeObjectURL(audioPreview);
      jobs.forEach((j) => j.videoUrl && URL.revokeObjectURL(j.videoUrl));
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalNum = jobs.length ? Math.max(...jobs.map((j) => j.num)) : 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8 space-y-7">
      <LipSyncHero3D />

      {/* WORKSPACE — 3 colunas */}
      <div className="grid gap-4 lg:grid-cols-[210px_1fr_360px]">
        {/* ─── COLUNA 1: VIDEO LIBRARY ─── */}
        <div className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-3 space-y-2 max-h-[640px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1 px-1">
            <span
              className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              VÍDEOS
            </span>
            {videos.length > 0 && (
              <span className="mono text-[10px] text-text-dim">{videos.length}</span>
            )}
          </div>

          {/* Upload tile (sempre primeiro) */}
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="group relative w-full overflow-hidden rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 aspect-[3/4] flex flex-col items-center justify-center gap-2 hover:border-fuchsia-400/55 hover:bg-fuchsia-400/[0.04] transition"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-text-muted transition-transform duration-500 group-hover:scale-110">
              <ImportIcon />
            </span>
            <div className="text-center px-2">
              <div
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Subir vídeo
              </div>
              <div className="mono text-[9px] text-text-muted mt-0.5">arraste ou clique</div>
              <div className="mono text-[9px] text-text-dim mt-0.5">até 300MB</div>
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

          {/* Thumbnails */}
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

        {/* ─── COLUNA 2: PREVIEW CENTRAL (sempre a FONTE) ─── */}
        <PreviewStage selected={selected} flash={flash} />

        {/* ─── COLUNA 3: SIDE PANEL ─── */}
        <aside className="rounded-[18px] border border-line/60 bg-bg-soft/30 p-4 md:p-5 space-y-5">
          {/* Header */}
          <div>
            <div
              className="label-tech text-[10px] font-bold tracking-[0.22em] text-fuchsia-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              SUA BOCA VAI FALAR
            </div>
            <h2
              className="mt-1 text-[20px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Configure e gera
            </h2>
          </div>

          {/* Audio upload */}
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <label
                className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Áudio
              </label>
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setAudio(f);
                e.target.value = '';
              }}
            />
            {!audioFile ? (
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="w-full rounded-[14px] border-2 border-dashed border-line-strong bg-bg/40 px-4 py-5 hover:border-violet/55 hover:bg-violet/[0.04] transition group"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-[20px] transition-transform group-hover:-rotate-6 group-hover:scale-110"
                    style={{ boxShadow: '0 0 20px -4px rgba(167,139,250,0.45)' }}
                  >
                    🎙
                  </span>
                  <div className="text-left">
                    <div
                      className="text-[12px] font-bold uppercase tracking-[0.16em] text-white"
                      style={{ fontFamily: 'var(--font-tech)' }}
                    >
                      Subir áudio ou vídeo
                    </div>
                    <div className="mono text-[10px] text-text-muted">mp3, wav, m4a ou mp4 (extrai áudio)</div>
                  </div>
                </div>
              </button>
            ) : (
              <AudioMiniPlayer
                file={audioFile}
                src={audioPreview}
                durationSec={audioDur}
                onChange={() => audioInputRef.current?.click()}
                onClear={() => setAudio(null)}
              />
            )}
          </div>

          {/* Limpar áudio — toggle 3D animado (sem texto NO botão) */}
          <Toggle3D
            on={cleanAudioOn}
            onToggle={() => setCleanAudioOn((v) => !v)}
            label="Limpar áudio"
          />

          {/* WARNINGS - só block/warn (info é ruído, removido) */}
          {selected && videoIssues.some((iss) => iss.severity !== 'info') && (
            <div className="space-y-1.5">
              {videoIssues.filter((iss) => iss.severity !== 'info').map((issue, i) => {
                const styles =
                  issue.severity === 'block'
                    ? 'border-red-500/55 bg-red-500/10 text-red-200'
                    : 'border-amber-400/45 bg-amber-400/10 text-amber-200';
                const prefix = issue.severity === 'block' ? '✕ Bloqueado: ' : '⚠ ';
                return (
                  <div
                    key={i}
                    className={`rounded-[10px] border px-3 py-2 text-[11px] leading-snug ${styles}`}
                  >
                    <span className="font-bold">{prefix}</span>
                    {issue.text}
                  </div>
                );
              })}
            </div>
          )}

          {/* Erro de formulário (validação) */}
          {formError && (
            <div className="rounded-[10px] border border-red-500/55 bg-red-500/10 px-3 py-2 text-[11px] leading-snug text-red-200">
              {formError}
            </div>
          )}

          {/* GENERATE button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selected || !audioFile || hasBlockingIssue}
            className="ultra-btn group relative w-full overflow-hidden rounded-[16px] border border-fuchsia-400/55 px-5 py-4 transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                'linear-gradient(135deg, rgba(232,121,249,0.25) 0%, rgba(167,139,250,0.25) 50%, rgba(103,232,249,0.20) 100%)',
              boxShadow:
                '0 0 30px -4px rgba(232,121,249,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            <span
              aria-hidden
              className="ultra-btn-sheen pointer-events-none absolute inset-y-0 left-[-30%] w-[40%] opacity-0 group-hover:opacity-100"
              style={{
                background:
                  'linear-gradient(120deg, transparent, rgba(255,255,255,0.32), transparent)',
              }}
            />
            <span className="relative flex items-center justify-center gap-3">
              <span className="text-[18px]">▶</span>
              <span
                className="text-[14px] font-bold uppercase tracking-[0.22em] text-white leading-none"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Gerar
              </span>
              <span className="text-[16px] transition-transform group-hover:translate-x-1.5 ml-auto">→</span>
            </span>
            <style jsx>{`
              .ultra-btn-sheen {
                animation: btnSheen 2.4s ease-in-out infinite;
              }
              @keyframes btnSheen {
                0% { left: -40%; opacity: 0; }
                30% { opacity: 1; }
                100% { left: 130%; opacity: 0; }
              }
            `}</style>
          </button>

          {/* Reset form */}
          {(videos.length > 0 || audioFile) && (
            <button
              type="button"
              onClick={handleReset}
              className="label-tech w-full text-[10px] tracking-[0.18em] text-text-muted hover:text-red-300 transition"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ↺ Limpar formulário
            </button>
          )}
        </aside>
      </div>

      {/* ─── MEUS LIPSYNCS (cards dos disparos) ─── */}
      {jobs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span
                className="label-tech text-[11px] font-bold tracking-[0.2em] text-white"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                MEUS LIPSYNCS
              </span>
              <span className="mono text-[10px] text-text-dim">{jobs.length}</span>
            </div>
            {jobs.some((j) => !isActive(j.status)) && (
              <button
                type="button"
                onClick={clearJobs}
                className="label-tech text-[10px] tracking-[0.16em] text-text-muted hover:text-red-300 transition"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                Limpar prontos
              </button>
            )}
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {jobs.map((job) => (
              <LipsyncPreviewCard
                key={job.id}
                take={{
                  label: job.label,
                  status: jobTakeStatus(job.status),
                  videoUrl: job.videoUrl,
                  error: job.error,
                }}
                position={job.num}
                total={totalNum}
                percent={job.percent}
                fileBase="lipsync"
              />
            ))}
          </div>
        </section>
      )}

      {/* TIPS rodape */}
      <div className="rounded-[12px] border border-dashed border-line-strong bg-bg-soft/15 px-4 py-3">
        <div
          className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          Pra sair perfeito
        </div>
        <ul className="mt-2 grid gap-1 text-[11.5px] text-text-muted md:grid-cols-2">
          <li>· Rosto frontal, centralizado, sem mão na boca.</li>
          <li>· Iluminação uniforme — luz lateral cria sombra.</li>
          <li>· Áudio limpo, sem música por trás.</li>
          <li>· 720p ou mais pra boca ficar nítida.</li>
          <li>· Mesma pessoa, mesma língua do áudio.</li>
          <li>· Pode disparar vários — vão aparecendo prontos embaixo.</li>
        </ul>
      </div>
    </div>
  );
}

/* ═══════════════════════ VideoThumb ═══════════════════════ */

function VideoThumb({
  item,
  selected,
  onSelect,
  onRemove,
}: {
  item: VideoItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={
        'group relative overflow-hidden rounded-[12px] border-2 aspect-[3/4] cursor-pointer transition ' +
        (selected
          ? 'border-fuchsia-400/70 shadow-[0_0_22px_-6px_rgba(232,121,249,0.7)]'
          : 'border-line-strong hover:border-fuchsia-400/45')
      }
    >
      <video
        src={item.url}
        muted
        loop
        autoPlay={selected}
        playsInline
        className="h-full w-full object-cover"
      />
      {!selected && (
        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition" />
      )}
      {selected && (
        <span className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-400 text-[10px] font-bold text-bg shadow-[0_0_10px_rgba(232,121,249,0.9)]">
          ✓
        </span>
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
        <span className="absolute bottom-1.5 left-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
          {item.meta.dur.toFixed(1)}s
        </span>
      )}
      {item.meta && (
        <span className="absolute bottom-1.5 right-1.5 mono rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
          {item.meta.w}×{item.meta.h}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════ PreviewStage ═══════════════════════ */
/** Mostra SEMPRE a fonte (o vídeo enviado). Os resultados vão pros cards. */
function PreviewStage({ selected, flash }: { selected: VideoItem | null; flash: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[18px] border border-line/60 bg-bg-soft/30">
      {/* Badge FONTE */}
      {selected && (
        <div className="absolute top-3 right-3 z-20">
          <span
            className="mono inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85 backdrop-blur-md"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ◇ FONTE · {selected.meta ? `${selected.meta.w}×${selected.meta.h}` : 'vídeo'}
          </span>
        </div>
      )}

      {/* Empty state */}
      {!selected ? (
        <div className="aspect-[3/4] md:aspect-[4/5] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/8 bg-black/40 text-text-muted"
            style={{
              boxShadow: '0 0 36px -6px rgba(232,121,249,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
              animation: 'emptyPulse 3.5s ease-in-out infinite',
            }}
          >
            <ImportIcon size={40} />
          </div>
          <div>
            <h3
              className="text-[22px] font-extrabold tracking-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.02em' }}
            >
              Sobe um vídeo na esquerda
            </h3>
            <p className="mt-2 text-[13px] text-text-muted max-w-[360px]">
              O rosto que vai ganhar a fala. Pode subir vários e escolher qual usar.
            </p>
          </div>
          <style jsx>{`
            @keyframes emptyPulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.06); }
            }
          `}</style>
        </div>
      ) : (
        <div className="relative aspect-[3/4] md:aspect-[4/5] bg-black overflow-hidden">
          <video
            src={selected.url}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />

          {/* Toast "enviado ↓" — guia o olho pra fila de baixo */}
          {flash && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
              <span
                className="label-tech inline-flex items-center gap-2 rounded-full border border-lime/55 bg-black/70 px-4 py-2 text-[11px] font-bold tracking-[0.16em] text-lime backdrop-blur-md"
                style={{ fontFamily: 'var(--font-tech)', animation: 'flashUp 2.6s ease-out forwards' }}
              >
                <span className="h-2 w-2 rounded-full bg-lime animate-pulse" />
                Enviado · aparece em Meus LipSyncs ↓
              </span>
            </div>
          )}
          <style jsx>{`
            @keyframes flashUp {
              0% { opacity: 0; transform: translateY(10px); }
              12% { opacity: 1; transform: translateY(0); }
              80% { opacity: 1; }
              100% { opacity: 0; transform: translateY(-6px); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ Toggle3D ═══════════════════════ */
/**
 * Switch 3D animado, SEM texto no botão (só o trilho recuado + knob elevado
 * com brilho/spin quando ligado). O rótulo + dica ficam FORA do botão.
 * Reutilizável (recebe label/hints).
 */
function Toggle3D({
  on,
  onToggle,
  label,
  hintOn,
  hintOff,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hintOn?: string;
  hintOff?: string;
}) {
  const hint = on ? hintOn : hintOff;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-line/60 bg-bg/30 px-3.5 py-2.5">
      <div className="min-w-0">
        <div
          className="label-tech text-[10px] font-bold tracking-[0.18em] text-text-muted"
          style={{ fontFamily: 'var(--font-tech)' }}
        >
          {label}
        </div>
        {hint ? <div className="mono text-[9px] text-text-dim mt-0.5">{hint}</div> : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={'tg3d ' + (on ? 'is-on' : 'is-off')}
      >
        <span className="tg3d-track" aria-hidden>
          <span className="tg3d-glow" />
          <span className="tg3d-knob">
            <span className="tg3d-spark">✦</span>
          </span>
        </span>
        <style jsx>{`
          .tg3d {
            --w: 60px; --h: 30px; --pad: 3px; --knob: 24px;
            position: relative; width: var(--w); height: var(--h);
            border-radius: 999px; border: none; padding: 0; cursor: pointer;
            background: transparent; flex: none;
            transform: perspective(220px) rotateX(9deg);
            transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
          }
          .tg3d:hover { transform: perspective(220px) rotateX(9deg) translateY(-1px); }
          .tg3d:active { transform: perspective(220px) rotateX(9deg) translateY(1px) scale(0.96); }
          .tg3d-track {
            position: absolute; inset: 0; border-radius: 999px;
            transition: background 0.35s ease, box-shadow 0.35s ease;
            box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6), inset 0 -1px 0 rgba(255, 255, 255, 0.06);
          }
          .is-off .tg3d-track { background: linear-gradient(180deg, #1a1a22, #0d0d13); }
          .is-on .tg3d-track {
            background: linear-gradient(110deg, rgba(232, 121, 249, 0.95), rgba(167, 139, 250, 0.95) 50%, rgba(103, 232, 249, 0.9));
            box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.35), 0 0 18px -2px rgba(232, 121, 249, 0.7), 0 0 30px -6px rgba(103, 232, 249, 0.5);
          }
          .tg3d-glow {
            position: absolute; inset: -2px; border-radius: 999px; opacity: 0;
            transition: opacity 0.35s ease; pointer-events: none;
          }
          .is-on .tg3d-glow {
            opacity: 1;
            background: radial-gradient(circle at 72% 50%, rgba(255, 255, 255, 0.28), transparent 60%);
            animation: tg3dPulse 2.4s ease-in-out infinite;
          }
          .tg3d-knob {
            position: absolute; top: var(--pad); left: var(--pad);
            width: var(--knob); height: var(--knob); border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: radial-gradient(circle at 35% 28%, #ffffff, #d8d8e2 45%, #9aa0b5 100%);
            box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.9), inset 0 -2px 3px rgba(0, 0, 0, 0.25);
            transition: transform 0.32s cubic-bezier(0.4, 1.5, 0.5, 1), background 0.32s ease;
          }
          .is-on .tg3d-knob {
            transform: translateX(calc(var(--w) - var(--knob) - var(--pad) * 2));
            background: radial-gradient(circle at 35% 28%, #ffffff, #ffe9ff 45%, #f0abfc 100%);
          }
          .tg3d-spark {
            font-size: 12px; line-height: 1; color: #a21caf; opacity: 0; transform: rotate(0deg);
            transition: opacity 0.3s ease;
          }
          .is-on .tg3d-spark { opacity: 1; animation: tg3dSpin 3s linear infinite; }
          @keyframes tg3dPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
          @keyframes tg3dSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </button>
    </div>
  );
}

/* ═══════════════════════ AudioMiniPlayer ═══════════════════════ */

function AudioMiniPlayer({
  file,
  src,
  durationSec,
  onChange,
  onClear,
}: {
  file: File;
  src: string;
  durationSec: number;
  onChange: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-violet/35 bg-violet/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-violet/40 bg-violet/10 text-[14px]">
          🎙
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] font-semibold text-white">{file.name}</div>
          <div className="mono text-[9.5px] text-text-muted">
            {durationSec > 0 ? `${durationSec.toFixed(1)}s · ` : ''}
            {(file.size / 1024 / 1024).toFixed(1)}MB
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onChange}
            className="label-tech rounded-md border border-line-strong px-2 py-1 text-[9px] tracking-widest text-text-muted hover:text-fuchsia-300 hover:border-fuchsia-400/40"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            Trocar
          </button>
          <button
            type="button"
            onClick={onClear}
            className="mono rounded-md border border-line-strong px-2 py-1 text-[9px] uppercase tracking-widest text-text-muted hover:text-red-300 hover:border-red-500/40"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ✕
          </button>
        </div>
      </div>
      {/* Mini waveform visual */}
      <div className="relative h-10 overflow-hidden rounded-[10px] bg-bg/40">
        <div className="absolute inset-0 flex items-center justify-center gap-[2px] px-2">
          {Array.from({ length: 36 }).map((_, i) => {
            const h = 8 + Math.abs(Math.sin(i * 0.5)) * 28;
            return (
              <span
                key={i}
                className="block w-[3px] rounded-full bg-gradient-to-t from-violet to-fuchsia-300"
                style={{
                  height: `${h}px`,
                  opacity: 0.4 + (i % 3) * 0.2,
                  animation: `miniBar ${0.7 + (i % 4) * 0.1}s ease-in-out ${i * 0.04}s infinite alternate`,
                }}
              />
            );
          })}
        </div>
        <audio src={src} controls className="relative z-10 h-10 w-full opacity-90" />
      </div>
      <style jsx>{`
        @keyframes miniBar {
          from { transform: scaleY(0.3); }
          to { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  );
}
