'use client';

/**
 * Separador de Áudio — separa voz, instrumental e SFX de qualquer áudio.
 *
 * Pipeline:
 *  1. Usuário sobe arquivo (até 200MB / 25min)
 *  2. POST /api/separador-audio (multipart)
 *  3. API roda Demucs/MDX-Net via HuggingFace Space
 *  4. Recebe 3 URLs (vocals/instrumental/sfx)
 *  5. Baixa cada stem como blob local — usuário toca + baixa
 *
 * UI: 3 cards de stem com player + size + botão baixar. Estados claros:
 * upload → processando (com mensagens de stage) → pronto.
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
import { downloadBlob } from '@/lib/audio-engine';
import { formatBytes } from '@/lib/utils';
import {
  MAX_AUDIO_MB,
  MAX_AUDIO_MINUTES,
  STEM_META,
  STEM_ORDER,
  type SeparatorStem,
} from '@/lib/audio-separator';

const HUE = 'rgba(167,139,250,0.45)';

type Stage = 'idle' | 'uploading' | 'processing' | 'downloading' | 'done' | 'error';

type StemResult = {
  url: string;
  blob: Blob;
  size: number;
};

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

export default function SeparadorAudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [stageMsg, setStageMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stems, setStems] = useState<Partial<Record<SeparatorStem, StemResult>>>({});
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);

  function reset() {
    Object.values(stems).forEach((s) => s && URL.revokeObjectURL(s.url));
    setStems({});
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

  async function handleSeparate() {
    if (!file) return;

    // Validação de tamanho
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setErrorMsg(`Arquivo grande demais. Máximo ${MAX_AUDIO_MB}MB.`);
      setStage('error');
      return;
    }

    reset();
    setStage('uploading');
    setStageMsg('Enviando áudio para o servidor…');

    const ctl = new AbortController();
    setAbortCtl(ctl);

    try {
      const form = new FormData();
      form.append('audio', file);

      const res = await fetch('/api/separador-audio', {
        method: 'POST',
        body: form,
        signal: ctl.signal,
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {
          /* sem JSON */
        }
        throw new Error(msg);
      }

      setStage('processing');
      setStageMsg('IA separando os stems (pode levar 1-3 min)…');

      const json = (await res.json()) as {
        stems: Record<SeparatorStem, { url: string }>;
      };

      setStage('downloading');
      setStageMsg('Baixando os 3 stems…');

      const downloadedStems: Partial<Record<SeparatorStem, StemResult>> = {};
      await Promise.all(
        STEM_ORDER.map(async (stem) => {
          const entry = json.stems[stem];
          if (!entry?.url) return;
          const r = await fetch(entry.url, { signal: ctl.signal });
          if (!r.ok) {
            throw new Error(`Falha ao baixar ${stem}: HTTP ${r.status}`);
          }
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          downloadedStems[stem] = { url, blob, size: blob.size };
        }),
      );

      setStems(downloadedStems);
      setStage('done');
      setStageMsg('Pronto.');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // já tratado em handleCancel
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage('error');
    } finally {
      setAbortCtl(null);
    }
  }

  async function downloadStem(stem: SeparatorStem) {
    const r = stems[stem];
    if (!r || !file) return;
    const ext = r.blob.type.includes('wav') ? 'wav' : 'mp3';
    await downloadBlob(r.blob, `${baseName(file.name)}_${stem}.${ext}`);
  }

  async function downloadAll() {
    if (!file) return;
    // Cada um separado — não tem ffmpeg disponível aqui pra zipar.
    // Buildzip já existe, mas dependência mais leve: baixar 1 por 1.
    for (const stem of STEM_ORDER) {
      const r = stems[stem];
      if (!r) continue;
      const ext = r.blob.type.includes('wav') ? 'wav' : 'mp3';
      await downloadBlob(r.blob, `${baseName(file.name)}_${stem}.${ext}`);
    }
  }

  const isWorking =
    stage === 'uploading' || stage === 'processing' || stage === 'downloading';

  return (
    <ToolShell
      title="Separador de Áudio"
      eyebrow="ÁUDIO · IA"
      description={`Separa voz, instrumental e SFX em 3 trilhas independentes. Qualidade absurda. Até ${MAX_AUDIO_MB}MB ou ${MAX_AUDIO_MINUTES} min.`}
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
          hue={HUE}
        >
          <div className="flex flex-wrap gap-3">
            {isWorking ? (
              <CancelButton onClick={handleCancel} label="Cancelar" />
            ) : (
              <ToolAction onClick={handleSeparate} disabled={!file}>
                Separar voz, instrumental e SFX
              </ToolAction>
            )}
            {stage === 'done' && Object.keys(stems).length > 1 ? (
              <button
                onClick={downloadAll}
                className="btn-secondary"
                type="button"
              >
                Baixar todos
              </button>
            ) : null}
          </div>
        </ToolStep>

        {/* Status banner */}
        {stage !== 'idle' && stage !== 'done' && stage !== 'error' ? (
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

        {/* Resultados — 3 cards de stem */}
        {stage === 'done' && Object.keys(stems).length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {STEM_ORDER.map((stem) => {
              const r = stems[stem];
              if (!r) return null;
              const meta = STEM_META[stem];
              return (
                <StemCard
                  key={stem}
                  stem={stem}
                  label={meta.label}
                  description={meta.description}
                  hue={meta.hue}
                  url={r.url}
                  size={r.size}
                  onDownload={() => downloadStem(stem)}
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
  stem,
  label,
  description,
  hue,
  url,
  size,
  onDownload,
}: {
  stem: SeparatorStem;
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
            {stem.toUpperCase()}
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
