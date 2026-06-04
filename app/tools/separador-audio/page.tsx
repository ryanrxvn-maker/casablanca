'use client';

/**
 * Separador de Áudio — separa voz, trilha sonora e SFX de qualquer áudio/vídeo.
 *
 * Pipeline (sem o HTTP 413 antigo — o arquivo NUNCA passa pela Vercel):
 *  1. Usuário sobe arquivo (áudio ou vídeo) e ESCOLHE o que quer extrair.
 *  2. Client decodifica a faixa de áudio (Web Audio, lida até com MP4) e a
 *     re-codifica em WAV.
 *  3. Sobe o WAV DIRETO pro Supabase via signed URL (browser → Supabase).
 *  4. POST /api/separador-audio { audioUrl } → Demucs (Replicate) separa em
 *     4 trilhas brutas (vocals/drums/bass/other), re-hospedadas no Supabase.
 *  5. Client monta os ALVOS escolhidos a partir das 4 trilhas (uma trilha =
 *     download direto; combinação como "trilha sonora" = mix via Web Audio).
 *
 * Escolher mais ou menos alvos NÃO custa GPU extra — a separação é uma só.
 */

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { ToolStep, ToolDropzone, ToolAction } from '@/components/tool-kit';
import {
  IconAudioSplit,
  IconStepMic,
  IconStepPlay,
} from '@/components/ToolIcons';
import { AudioPlayer } from '@/components/AudioPlayer';
import { CancelButton } from '@/components/CancelButton';
import { createClient } from '@/lib/supabase/client';
import { decodeAudio, decodeAudioRobust, encodeWAV, downloadBlob } from '@/lib/audio-engine';
import { formatBytes } from '@/lib/utils';
import {
  MAX_AUDIO_MB,
  MAX_AUDIO_MINUTES,
  OUTPUT_META,
  type OutputTarget,
  type RawStem,
} from '@/lib/audio-separator';

const HUE = 'rgba(167,139,250,0.45)';
const UPLOAD_BUCKET = 'separador-uploads';

/**
 * A ferramenta SEMPRE separa as 3 faixas. O usuário escolhe no resultado o
 * que tocar e o que baixar — um player + um botão de download por faixa.
 */
const OUTPUTS: OutputTarget[] = ['vocals', 'instrumental', 'sfx'];

type Stage =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'processing'
  | 'building'
  | 'done'
  | 'error';

type TargetResult = {
  url: string;
  blob: Blob;
  size: number;
  ext: 'mp3' | 'wav';
};

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

function errMsg(e: unknown): string {
  if (e == null) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || e.name || 'Erro';
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error) return o.error;
    if (typeof o.message === 'string' && o.message) return o.message;
    try {
      const s = JSON.stringify(e);
      if (s && s !== '{}') return s.slice(0, 300);
    } catch {
      /* ignore */
    }
  }
  return String(e);
}

/** Soma N AudioBuffers (mesmo sample rate) num só, com clamp pra não clipar. */
function mixBuffers(buffers: AudioBuffer[]): AudioBuffer {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  const length = Math.max(...buffers.map((b) => b.length));
  const channels = Math.min(
    2,
    Math.max(...buffers.map((b) => b.numberOfChannels)),
  );
  const sr = buffers[0].sampleRate;
  const out = ctx.createBuffer(channels, length, sr);
  for (let c = 0; c < channels; c++) {
    const od = out.getChannelData(c);
    for (const b of buffers) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
      for (let i = 0; i < src.length; i++) od[i] += src[i];
    }
    for (let i = 0; i < od.length; i++) {
      if (od[i] > 1) od[i] = 1;
      else if (od[i] < -1) od[i] = -1;
    }
  }
  ctx.close();
  return out;
}

export default function SeparadorAudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [stageMsg, setStageMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<
    Partial<Record<OutputTarget, TargetResult>>
  >({});
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);

  function reset() {
    setResults((prev) => {
      Object.values(prev).forEach((r) => r && URL.revokeObjectURL(r.url));
      return {};
    });
    setStage('idle');
    setStageMsg('');
    setErrorMsg(null);
  }

  function handleFile(f: File | null) {
    if (stage !== 'idle' && stage !== 'done' && stage !== 'error') return;
    reset();
    setFile(f);
  }

  async function handleCancel() {
    if (abortCtl) abortCtl.abort();
    setStage('error');
    setErrorMsg('Cancelado.');
  }

  /** Sobe um blob DIRETO pro Supabase via signed URL e devolve a URL pública. */
  async function uploadPublic(blob: Blob, ext: string): Promise<string> {
    const r = await fetch('/api/separador-audio/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ext }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Falha ao preparar upload (HTTP ${r.status})`);
    if (!d.path || !d.token) throw new Error('Upload não retornou credenciais.');

    const supabase = createClient();
    const { error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .uploadToSignedUrl(d.path, d.token, blob);
    if (error) throw new Error('Falha no upload pro storage: ' + errMsg(error));
    if (!d.publicUrl) throw new Error('Upload não retornou URL pública.');
    return d.publicUrl as string;
  }

  async function handleSeparate() {
    if (!file) return;

    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setErrorMsg(`Arquivo grande demais. Máximo ${MAX_AUDIO_MB}MB.`);
      setStage('error');
      return;
    }

    reset();
    const ctl = new AbortController();
    setAbortCtl(ctl);

    try {
      // 1) Extrai a faixa de áudio (mesmo de vídeo MP4) e re-codifica em WAV.
      setStage('preparing');
      setStageMsg('Preparando o áudio…');
      const srcBuffer = await decodeAudioRobust(file, (s) => setStageMsg(s));
      const wav = encodeWAV(srcBuffer);

      // 2) Sobe direto pro Supabase (sem tocar na Vercel → sem HTTP 413).
      setStage('uploading');
      setStageMsg('Enviando o áudio…');
      const audioUrl = await uploadPublic(wav, 'wav');

      // 3) Separa via Demucs (Replicate).
      setStage('processing');
      setStageMsg('IA separando as trilhas (pode levar 1-3 min)…');
      const res = await fetch('/api/separador-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl, filename: file.name }),
        signal: ctl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const rawStems = json.stems as Partial<
        Record<RawStem, { url: string; size: number }>
      >;

      // 4) Baixa as trilhas brutas necessárias pras 3 faixas.
      setStage('building');
      setStageMsg('Montando voz, trilha sonora e SFX…');

      const needed = new Set<RawStem>();
      for (const t of OUTPUTS) OUTPUT_META[t].recipe.forEach((s) => needed.add(s));

      const rawBlob: Partial<Record<RawStem, Blob>> = {};
      const rawBuf: Partial<Record<RawStem, AudioBuffer>> = {};
      await Promise.all(
        Array.from(needed).map(async (stem) => {
          const entry = rawStems?.[stem];
          if (!entry?.url) return;
          const r = await fetch(entry.url, { signal: ctl.signal });
          if (!r.ok) throw new Error(`Falha ao baixar trilha ${stem} (HTTP ${r.status})`);
          rawBlob[stem] = await r.blob();
        }),
      );

      // 5) Monta cada alvo escolhido.
      const built: Partial<Record<OutputTarget, TargetResult>> = {};
      for (const t of OUTPUTS) {
        const recipe = OUTPUT_META[t].recipe.filter((s) => rawBlob[s]);
        if (recipe.length === 0) continue;

        if (recipe.length === 1) {
          // Trilha única → usa o MP3 do Demucs direto (menor, sem re-encode).
          const blob = rawBlob[recipe[0]]!;
          built[t] = {
            blob,
            url: URL.createObjectURL(blob),
            size: blob.size,
            ext: 'mp3',
          };
        } else {
          // Combinação (ex: trilha sonora = drums+bass+other) → mix no browser.
          const bufs: AudioBuffer[] = [];
          for (const s of recipe) {
            if (!rawBuf[s]) rawBuf[s] = await decodeAudio(rawBlob[s]!);
            bufs.push(rawBuf[s]!);
          }
          const mixed = mixBuffers(bufs);
          const blob = encodeWAV(mixed);
          built[t] = {
            blob,
            url: URL.createObjectURL(blob),
            size: blob.size,
            ext: 'wav',
          };
        }
      }

      if (Object.keys(built).length === 0) {
        throw new Error('Nenhuma faixa pôde ser montada.');
      }

      setResults(built);
      setStage('done');
      setStageMsg('Pronto.');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      setErrorMsg(errMsg(e));
      setStage('error');
    } finally {
      setAbortCtl(null);
    }
  }

  async function downloadTarget(t: OutputTarget) {
    const r = results[t];
    if (!r || !file) return;
    await downloadBlob(r.blob, `${baseName(file.name)}_${t}.${r.ext}`);
  }

  async function downloadAll() {
    if (!file) return;
    for (const t of OUTPUTS) {
      const r = results[t];
      if (!r) continue;
      await downloadBlob(r.blob, `${baseName(file.name)}_${t}.${r.ext}`);
    }
  }

  const isWorking =
    stage === 'preparing' ||
    stage === 'uploading' ||
    stage === 'processing' ||
    stage === 'building';

  const doneCount = Object.keys(results).length;

  return (
    <ToolShell
      title="Separador de Áudio"
      eyebrow="ÁUDIO · IA"
      description={`Separa voz, trilha sonora e SFX em 3 faixas independentes. Ouça o preview e baixe cada uma. Qualidade Demucs v4. Até ${MAX_AUDIO_MB}MB ou ${MAX_AUDIO_MINUTES} min.`}
      hue={HUE}
      icon={<IconAudioSplit size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep
          n={1}
          icon={<IconStepMic size={18} />}
          title="Áudio ou vídeo"
          hint={`MP3, WAV, M4A, OGG, MP4 — até ${MAX_AUDIO_MB}MB`}
          hue={HUE}
        >
          <ToolDropzone
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            file={file}
            onFile={handleFile}
            disabled={isWorking}
            hue={HUE}
            hint={`Arraste o arquivo ou clique pra escolher (máx ${MAX_AUDIO_MB}MB).`}
          />
          {file ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-text-muted">
              <div className="rounded-[10px] border border-line/60 bg-bg-soft/40 px-3 py-2">
                <div className="mono text-[10px] uppercase tracking-widest text-text-dim">
                  Arquivo
                </div>
                <div className="mt-0.5 truncate text-white">{file.name}</div>
              </div>
              <div className="rounded-[10px] border border-line/60 bg-bg-soft/40 px-3 py-2">
                <div className="mono text-[10px] uppercase tracking-widest text-text-dim">
                  Tamanho
                </div>
                <div className="mt-0.5 mono text-white">{formatBytes(file.size)}</div>
              </div>
            </div>
          ) : null}
        </ToolStep>

        <ToolStep
          n={2}
          icon={<IconStepPlay size={18} />}
          title={isWorking ? 'Separando…' : 'Separar'}
          hint="Separa as 3 faixas de uma vez. No resultado você ouve e baixa cada uma."
          hue={HUE}
        >
          <div className="flex flex-wrap gap-3">
            {isWorking ? (
              <CancelButton onClick={handleCancel} label="Cancelar" />
            ) : (
              <ToolAction onClick={handleSeparate} disabled={!file}>
                Separar voz, trilha sonora e SFX
              </ToolAction>
            )}
            {stage === 'done' && doneCount > 1 ? (
              <button onClick={downloadAll} className="btn-secondary" type="button">
                Baixar todas
              </button>
            ) : null}
          </div>
        </ToolStep>

        {/* Status banner */}
        {isWorking ? (
          <div className="scan-line flex items-center gap-3 rounded-[12px] border border-violet/40 bg-violet/[0.06] px-4 py-3 text-sm text-violet">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-violet shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
            </span>
            <span className="mono uppercase tracking-widest text-[11.5px]">
              {stageMsg}
            </span>
          </div>
        ) : null}

        {/* Erro */}
        {stage === 'error' && errorMsg ? (
          <div className="rounded-[12px] border border-rose-500/40 bg-rose-500/[0.06] px-4 py-3 text-sm">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.22em] text-rose-300"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              Falha
            </div>
            <p className="mt-1 text-[13px] text-white/90">{errorMsg}</p>
            <button
              onClick={reset}
              type="button"
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-rose-500/50 bg-rose-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-rose-100 hover:bg-rose-500/25"
              style={{ fontFamily: 'var(--font-tech)' }}
            >
              ↻ Tentar de novo
            </button>
          </div>
        ) : null}

        {/* Resultados */}
        {stage === 'done' && doneCount > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {OUTPUTS.map((t) => {
              const r = results[t];
              if (!r) return null;
              const meta = OUTPUT_META[t];
              return (
                <StemCard
                  key={t}
                  tag={t}
                  label={meta.label}
                  description={meta.description}
                  hue={meta.hue}
                  url={r.url}
                  size={r.size}
                  onDownload={() => downloadTarget(t)}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}

/* ───────────────── StemCard ───────────────── */

function StemCard({
  tag,
  label,
  description,
  hue,
  url,
  size,
  onDownload,
}: {
  tag: string;
  label: string;
  description: string;
  hue: string;
  url: string;
  size: number;
  onDownload: () => void;
}) {
  return (
    <div
      className="stem-card group relative overflow-hidden rounded-[16px] border border-line/70 p-4 transition-all duration-300 hover:-translate-y-[2px]"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.18)), linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
        boxShadow: `0 0 28px -14px ${hue}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-60 blur-3xl"
        style={{ background: hue }}
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-[16px] font-bold tracking-tight text-white"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            {label}
          </h3>
          <span
            className="mono shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.16em]"
            style={{
              fontFamily: 'var(--font-tech)',
              color: hue.replace('0.5', '1'),
              borderColor: hue,
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            {tag.toUpperCase()}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-text-muted">
          {description}
        </p>
        <div className="mt-3">
          <AudioPlayer src={url} label={label} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="mono text-[11px] text-text-muted">
            {formatBytes(size)}
          </span>
          <button
            onClick={onDownload}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white transition hover:bg-black/60"
            style={{ fontFamily: 'var(--font-tech)' }}
          >
            ↓ Baixar
          </button>
        </div>
      </div>
    </div>
  );
}
