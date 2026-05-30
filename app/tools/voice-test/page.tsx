'use client';

/**
 * Voice Isolator Test — pagina de teste pro pre-processamento do VA pipeline.
 *
 * Upload audio com voz+musica → roda isolateVoice() (mesma logica usada no VA
 * pipeline) → mostra antes/depois com player + metricas. Permite ajustar mode
 * (auto/center/bandpass/aggressive).
 */

import { useState, useRef } from 'react';
import { ToolShell } from '@/components/ToolShell';
import {
  isolateVoice,
  analyzeAudioForVoiceIsolation,
  type VoiceIsolatorMode,
} from '@/lib/voice-isolator';
import { downloadBlob } from '@/lib/audio-engine';
import { ToolStep, ToolAction, ToolResultCard } from '@/components/tool-kit';
import { IconStepMic, IconStepSliders } from '@/components/ToolIcons';

const HUE = 'rgba(94,234,212,0.42)';

type Result = {
  original: { blob: Blob; url: string; size: number; duration: number; channels: number };
  isolated: { blob: Blob; url: string; size: number };
  mode: VoiceIsolatorMode;
  hint: string;
  elapsedMs: number;
};

export default function VoiceTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<VoiceIsolatorMode>('auto');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  async function handleProcess() {
    if (!file) return;
    setError(null);
    setResult(null);
    setProcessing(true);
    setProgress('Iniciando...');
    const start = Date.now();
    abortRef.current = false;
    try {
      // Analise pre
      setProgress('Analisando audio...');
      const analysis = await analyzeAudioForVoiceIsolation(file);
      const originalUrl = URL.createObjectURL(file);

      setProgress(`Stereo: ${analysis.channels >= 2 ? 'sim' : 'mono'} · ${analysis.duration.toFixed(1)}s · iniciando isolate...`);

      const isolated = await isolateVoice(file, {
        mode,
        format: 'wav',
        onStage: (stage) => {
          if (abortRef.current) return;
          setProgress(stage);
        },
        onProgress: (p) => {
          if (abortRef.current) return;
          setProgress(`Processando ${Math.round(p.ratio * 100)}%`);
        },
      });

      const isolatedUrl = URL.createObjectURL(isolated);
      const elapsedMs = Date.now() - start;

      setResult({
        original: {
          blob: file,
          url: originalUrl,
          size: file.size,
          duration: analysis.duration,
          channels: analysis.channels,
        },
        isolated: {
          blob: isolated,
          url: isolatedUrl,
          size: isolated.size,
        },
        mode: mode === 'auto' ? analysis.recommendedMode : mode,
        hint: analysis.hint,
        elapsedMs,
      });
      setProgress(`Concluido em ${(elapsedMs / 1000).toFixed(1)}s`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const base = (file?.name || 'audio').replace(/\.[^.]+$/, '');
    downloadBlob(result.isolated.blob, `${base}_vocals.wav`);
  }

  return (
    <ToolShell
      title="Isolar voz"
      eyebrow="ÁUDIO"
      description="Tira a música, deixa só a voz. Ideal pra usar com avatar e lipsync."
      hue={HUE}
    >
      <div className="grid gap-5">
        <ToolStep n={1} icon={<IconStepMic size={18} />} title="Áudio" hint="MP3, WAV, M4A, OGG ou MP4" hue={HUE}>
          <input
            type="file"
            accept="audio/*,video/mp4"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
              setError(null);
            }}
            className="input-field"
            disabled={processing}
          />
          {file && (
            <p className="mono mt-2 text-xs text-text-muted">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
        </ToolStep>

        <ToolStep n={2} icon={<IconStepSliders size={18} />} title="Modo de isolação" hint="Auto detecta stereo/mono" hue={HUE}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as VoiceIsolatorMode)}
            className="input-field"
            disabled={processing}
          >
            <option value="auto">Auto (detecta stereo/mono)</option>
            <option value="center">Center Channel Extraction (stereo wide)</option>
            <option value="bandpass">Bandpass + Compand (mono ou stereo fake)</option>
            <option value="aggressive">Aggressive (audio sujo com denoise pesado)</option>
          </select>
        </ToolStep>

        <ToolStep n={3} title={processing ? 'Isolando…' : 'Isolar voz'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            <ToolAction onClick={handleProcess} loading={processing} disabled={!file || processing}>
              Isolar voz
            </ToolAction>
            {result && (
              <button
                type="button"
                onClick={handleDownload}
                className="btn-secondary"
              >
                ⬇ Baixar vocals.wav
              </button>
            )}
          </div>
        </ToolStep>

        {progress && processing && (
          <div className="rounded-md border border-line bg-bg-soft/40 px-3 py-2 text-xs">
            <span className="mono text-lime">{progress}</span>
          </div>
        )}

        {error && (
          <div className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-lime/30 bg-lime/5 p-4">
            <div className="grid gap-1 text-xs mb-3">
              <div className="flex justify-between">
                <span className="text-text-muted">Modo aplicado:</span>
                <span className="mono text-lime">{result.mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Original:</span>
                <span className="mono">
                  {(result.original.size / 1024).toFixed(1)} KB ·{' '}
                  {result.original.channels === 1 ? 'mono' : 'stereo'} ·{' '}
                  {result.original.duration.toFixed(1)}s
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Isolated:</span>
                <span className="mono">
                  {(result.isolated.size / 1024).toFixed(1)} KB · mono (WAV PCM)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Tempo de processamento:</span>
                <span className="mono text-lime">
                  {(result.elapsedMs / 1000).toFixed(1)}s
                </span>
              </div>
              <p className="text-text-muted italic mt-2">{result.hint}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mono text-[10px] uppercase tracking-widest text-text-muted mb-1">
                  Antes (original)
                </h3>
                <audio controls src={result.original.url} className="w-full" />
              </div>
              <div>
                <h3 className="mono text-[10px] uppercase tracking-widest text-lime mb-1">
                  Depois (vocals isolated)
                </h3>
                <audio controls src={result.isolated.url} className="w-full" />
              </div>
            </div>

            <p className="mt-3 text-xs text-text-muted">
              <strong className="text-lime">Como avaliar:</strong> a voz deve estar
              audivel e clara no &quot;Depois&quot;. Musica/bass devem estar muito mais
              baixos ou inaudiveis. Se ainda ouve musica forte, troca pra mode{' '}
              <span className="mono text-lime">aggressive</span> e tenta de novo.
            </p>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
