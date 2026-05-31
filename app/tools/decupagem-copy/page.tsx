'use client';

import { useEffect, useMemo } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { ToolHero3D } from '@/components/ToolHero3D';
import { FileUpload } from '@/components/FileUpload';
import { CostHint } from '@/components/CostHint';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { estimateDecupagemCopy } from '@/lib/cost-estimator';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  cutVideoSegments,
  extractAudioForTranscription,
  isCancellationError,
  probeVideoMetadata,
  removeAvatarSilences,
  type FFProgress,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { useRef } from 'react';
import { formatBytes, formatTime } from '@/lib/utils';
import { ToolStep, ToolAction, ToolMetric } from '@/components/tool-kit';
import { IconDecupageCopy, IconStepUpload, IconStepText, IconStepScissors } from '@/components/ToolIcons';
import { TierGate } from '@/components/TierGate';

const HUE = 'rgba(232,121,249,0.45)';

/**
 * Decupagem com Copy — re-edita um video bruto pra seguir a ordem de uma
 * copy/script, escolhendo automaticamente a melhor take de cada frase.
 *
 * Pipeline (1 video por vez, ate 800MB/40min):
 *   1. Browser extrai audio low-bitrate (OPUS 12kbps mono)
 *   2. POST /api/decupagem-copy/match (audio + copy)
 *   3. Server transcreve via AssemblyAI (word-level timestamps em pt)
 *   4. Server roda matcher: pra cada frase da copy, acha o melhor span
 *      no transcript (completude + fluencia + sem fillers + boundaries
 *      limpos). Retorna cuts em ORDEM da copy.
 *   5. Browser corta + concat com FFmpeg WASM (cutVideoSegments)
 *   6. Download do MP4 final
 *
 * Custo: ~$0.27 por video de 40min (AssemblyAI).
 */

const MAX_FILE_BYTES = 800 * 1024 * 1024;
const MAX_DURATION_SEC = 40 * 60;
// Corte de silencio FIXO em 0.10s — pausas >= 100ms entre falas somem.
// Valor calibrado: corta tempo morto/respiracao sem comer palavra.
const SILENCE_TOLERANCE = 0.1;

type Cut = {
  startMs: number;
  endMs: number;
  copyPhrase: string;
  transcriptText: string;
  score: number;
};

export default function DecupagemCopyPage() {
  return (
    <TierGate require="pro" toolName="Decupagem Inteligente">
      <DecupagemCopyInner />
    </TierGate>
  );
}

function DecupagemCopyInner() {
  const [file, setFile] = useToolState<File | null>('decupcopy:file', null);
  const [copyText, setCopyText] = useToolState<string>('decupcopy:copy', '');
  const [processing, setProcessing] = useToolState<boolean>(
    'decupcopy:processing',
    false,
  );
  const [stage, setStage] = useToolState<string | null>(
    'decupcopy:stage',
    null,
  );
  const [progress, setProgress] = useToolState<number | null>(
    'decupcopy:progress',
    null,
  );
  const [cuts, setCuts] = useToolState<Cut[]>('decupcopy:cuts', []);
  const [resultUrl, setResultUrl] = useToolState<string | null>(
    'decupcopy:resultUrl',
    null,
  );
  const [duration, setDuration] = useToolState<number | null>(
    'decupcopy:duration',
    null,
  );
  const [error, setError] = useToolState<string | null>(
    'decupcopy:error',
    null,
  );
  const [removeSilence, setRemoveSilence] = useToolState<boolean>(
    'decupcopy:removeSilence',
    true,
  );
  const abortRef = useRef<AbortController | null>(null);

  function handleCancel() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

  // Probe duration ao adicionar arquivo
  useEffect(() => {
    if (!file) {
      setDuration(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const meta = await probeVideoMetadata(file);
      if (!cancelled && meta) setDuration(meta.durationSec);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const validation = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) {
      return `Arquivo de ${formatBytes(file.size)} excede o limite de 800MB. Comprima primeiro com a ferramenta Compressor.`;
    }
    if (duration !== null && duration > MAX_DURATION_SEC) {
      return `Video de ${Math.round(duration / 60)}min excede o limite de 40min.`;
    }
    return null;
  }, [file, duration]);

  function reset() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setCuts([]);
    setStage(null);
    setProgress(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    if (validation) {
      setError(validation);
      return;
    }
    if (!copyText.trim()) {
      setError('Cole a copy/script no campo de texto.');
      return;
    }
    if (copyText.length < 30) {
      setError('Copy muito curta — cole pelo menos algumas frases pra alinhar.');
      return;
    }

    reset();
    setProcessing(true);

    try {
      // Step 1: Extract audio
      setStage('Extraindo audio do video...');
      setProgress(0);
      const audio = await extractAudioForTranscription(file, {
        onStage: (s) => setStage(s),
        onProgress: (p: FFProgress) => setProgress(p.ratio * 0.25),
      });

      if (audio.size > 4_400_000) {
        throw new Error(
          `Audio extraido tem ${formatBytes(audio.size)} — excede o limite (~4.4MB) do servidor. Use video mais curto.`,
        );
      }

      // Step 2: Send to server for transcription + matching
      setStage('Transcrevendo o áudio...');
      setProgress(0.3);

      const fd = new FormData();
      fd.append('audio', audio, 'audio.opus');
      fd.append('copy', copyText);
      fd.append('provider', 'groq');

      abortRef.current = new AbortController();
      const res = await fetch('/api/decupagem-copy/match', {
        method: 'POST',
        body: fd,
        signal: abortRef.current.signal,
      });

      const text = await res.text();
      let json: { cuts?: Cut[]; provider?: string; error?: string };
      try {
        json = JSON.parse(text);
      } catch {
        if (/Request Entity Too Large/i.test(text)) {
          throw new Error(
            'Audio acima do limite do servidor. Comprima o video primeiro.',
          );
        }
        throw new Error(
          `Resposta nao-JSON do servidor (HTTP ${res.status}): ${text.slice(0, 100)}`,
        );
      }

      if (!res.ok || !json.cuts) {
        throw new Error(json.error || 'Falha na transcricao/matching.');
      }

      setCuts(json.cuts);
      setStage(
        `${json.cuts.length} frase(s) alinhada(s) (${json.provider ?? '?'}). Cortando + concatenando...`,
      );
      setProgress(0.5);

      // Step 3: Cut + concat with FFmpeg WASM
      // NAO fazemos mais silence-split por cut — causava duplicacao quando
      // o cut continha 2 takes consecutivas. Usamos cuts limpos do matcher.
      const segments = json.cuts.map((c) => ({
        start: c.startMs / 1000,
        end: c.endMs / 1000,
      }));

      setStage(
        `Cortando ${segments.length} segmento(s) e concatenando...`,
      );
      let out = await cutVideoSegments(file, segments, {
        onStage: (s) => setStage(s),
        onProgress: (p: FFProgress) =>
          setProgress(0.5 + p.ratio * 0.4),
      });

      // Step 4: Silence removal GLOBAL no MP4 final (depois do concat).
      // Remove pausas naturais entre frases sem dividir cuts.
      // Limiar FIXO em SILENCE_TOLERANCE (0.10s).
      if (removeSilence) {
        setStage('Removendo silencios globais do video final...');
        setProgress(0.9);
        try {
          out = await removeAvatarSilences(out, SILENCE_TOLERANCE, {
            onStage: (s) => setStage(s),
            onProgress: (p: FFProgress) =>
              setProgress(0.9 + p.ratio * 0.1),
          });
        } catch (silErr) {
          console.warn('[silence-remove-global]', silErr);
          // Falha — segue com video sem silence removal
        }
      }

      const url = URL.createObjectURL(out);
      setResultUrl(url);
      setStage(null);
      setProgress(null);
    } catch (e) {
      console.error(e);
      if (isCancellationError(e) || (e as Error)?.name === 'AbortError') {
        setStage('Cancelado pelo usuario.');
        setError(null);
      } else {
        setError(
          (e as Error)?.message ?? 'Falha ao decupar pela copy.',
        );
        setStage(null);
      }
      setProgress(null);
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  }

  async function download() {
    if (!resultUrl || !file) return;
    const baseName = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/\s+/g, '_');
    const res = await fetch(resultUrl);
    const blob = await res.blob();
    await downloadBlob(blob, baseName + '_decupado_pela_copy.mp4');
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 pt-6 md:px-8 md:pt-8">
      <ToolHero3D
        eyebrow="WHISPER · DECUPAGEM INTELIGENTE"
        eyebrow2="A IA MONTA POR VOCÊ"
        title="Decupagem Inteligente"
        subtitle={
          <>
            Manda o vídeo bruto + a copy final.{' '}
            <span className="font-semibold text-white">A IA escolhe a melhor take de cada frase</span> e monta tudo na ordem certa — você só revisa e exporta.
          </>
        }
        tint="fuchsia"
        pipeline={[
          { icon: '🎞', label: 'Vídeo bruto', sub: 'Todas as takes', tone: 'text-text-muted' },
          { icon: '📝', label: 'Copy final', sub: 'O texto certo', tone: 'text-fuchsia-300' },
          { icon: '🧠', label: 'Transcrição + IA', sub: 'Match por frase', tone: 'text-violet' },
          { icon: '✂', label: 'Timeline', sub: 'Cortes prontos', tone: 'text-lime' },
        ]}
        stats={[
          { value: '~2min', label: 'pra processar' },
          { value: 'XML', label: 'pro Premiere' },
          { value: 'MP4', label: 'pré-cortado' },
        ]}
      />
      <div className="mt-6 rounded-[20px] border border-line/60 bg-bg-soft/40 p-5 backdrop-blur-sm md:p-7">
      <div className="flex flex-col gap-5">
        <MissingKeyBanner services={['groq']} />

        <ToolStep n={1} icon={<IconStepUpload size={18} />} title="Vídeo bruto" hint="MP4, MOV, WEBM, MKV — até 800MB e 40min" hue={HUE}>
          <FileUpload
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP4, MOV, WEBM, MKV — ate 800MB e 40min"
          />
          {file ? (
            <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <ToolMetric value={formatBytes(file.size)} label="Tamanho" />
              {duration !== null ? (
                <ToolMetric value={formatTime(duration)} label="Duração" accent="lime" />
              ) : null}
              {file && duration !== null && duration > 0 ? (
                <div className="hidden md:block">
                  <CostHint estimate={estimateDecupagemCopy(duration)} />
                </div>
              ) : null}
            </div>
          ) : null}
          {validation ? (
            <div className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {validation}
            </div>
          ) : null}
        </ToolStep>

        <ToolStep n={2} icon={<IconStepText size={18} />} title="Copy / Script" hint="Cole na ordem desejada — frase por frase" hue={HUE}>
          <textarea
            id="copy"
            value={copyText}
            onChange={(e) => setCopyText(e.target.value)}
            placeholder="Cole aqui a copy completa, frase por frase. Quebre por linha ou pontuacao (.!?). A IA vai pegar cada frase e procurar a melhor take dela no video bruto."
            rows={9}
            className="input-field resize-y font-mono text-sm"
            disabled={processing}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
            <span>
              <span className="mono text-violet">
                {copyText.trim().length}
              </span>{' '}
              caracteres ·{' '}
              <span className="mono text-violet">
                {copyText.split(/[.!?\n]+/).filter((p) => p.trim().length > 2)
                  .length}
              </span>{' '}
              frase(s)
            </span>
            <button
              type="button"
              onClick={() => setCopyText('')}
              className="btn-ghost !py-0.5 !px-2 text-[11px]"
              disabled={processing || !copyText}
            >
              Limpar copy
            </button>
          </div>
        </ToolStep>

        <ToolStep n={3} icon={<IconStepScissors size={18} />} title="Silêncios" hint="Decide se corta as pausas entre as falas" hue={HUE}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={removeSilence}
              onChange={(e) => setRemoveSilence(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-violet"
              disabled={processing}
            />
            <div className="flex-1">
              <div className="text-white font-semibold">
                Remover silêncios entre as falas
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                Depois de alinhar a copy, corta toda pausa{' '}
                <span className="mono text-violet">≥ 0.10s</span> — calibrado pra tirar tempo morto sem comer palavra.
              </div>
            </div>
          </label>
        </ToolStep>

        <ToolStep n={4} title={processing ? 'Decupando…' : 'Decupar pela copy'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            {processing ? (
              <CancelButton onClick={handleCancel} label="Cancelar processamento" />
            ) : (
              <ToolAction
                onClick={process}
                disabled={!file || !!validation || !copyText.trim()}
              >
                Decupar pela Copy
              </ToolAction>
            )}
            <button
              onClick={() => {
                reset();
                setFile(null);
                setDuration(null);
                setCopyText('');
              }}
              className="btn-secondary"
              disabled={processing}
            >
              Limpar tudo
            </button>
          </div>
        </ToolStep>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {stage ? (
          <div
            className={
              'rounded-[12px] border px-4 py-3 text-xs ' +
              (processing
                ? 'scan-line border-lime/40 bg-bg-soft/40 text-lime'
                : 'border-line bg-bg text-text-muted')
            }
          >
            <div className="flex items-center gap-2">
              {processing ? (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
                </span>
              ) : null}
              <span className="mono uppercase tracking-widest">{stage}</span>
            </div>
            {progress !== null ? (
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-lime transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {cuts.length > 0 && resultUrl ? (
          <div className="fade-in-up mt-2 border-t border-line pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,232,124,0.9)]" />
                </span>
                Decupagem pronta · {cuts.length} cortes na ordem da copy
              </h3>
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar MP4
              </button>
            </div>

            <video
              src={resultUrl}
              controls
              className="w-full rounded-[12px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,232,124,0.4)]"
            />

            <div className="mt-4">
              <h4 className="mb-2 text-[11px] uppercase tracking-widest text-text-muted">
                Cortes detectados (debug)
              </h4>
              <ul className="grid gap-1.5">
                {cuts.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-[8px] border border-line bg-bg p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-lime">
                        #{i + 1}
                      </span>
                      <span className="mono text-text-muted">
                        {formatTime(c.startMs / 1000)} →{' '}
                        {formatTime(c.endMs / 1000)} · score{' '}
                        <span className="text-lime">
                          {Math.round(c.score * 100)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 grid gap-0.5 text-[11px]">
                      <div className="text-text-muted">
                        copy: <span className="text-white">{c.copyPhrase}</span>
                      </div>
                      <div className="text-text-muted">
                        match:{' '}
                        <span className="italic text-text-muted">
                          {c.transcriptText}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
