'use client';

import { AudioPlayer } from '@/components/AudioPlayer';
import {
  ToolHero,
  ToolStep,
  ToolDropzone,
  ToolChoice,
  ToolSlider,
  ToolAction,
  ToolResultCard,
  ToolMetric,
} from '@/components/tool-kit';
import {
  IconDecupagem,
  IconStepUpload,
  IconStepFormat,
  IconStepSliders,
} from '@/components/ToolIcons';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  decodeAudioRobust,
  downloadBlob,
  encodeWAV,
  trimSilences,
  detectSilences,
} from '@/lib/audio-engine';
import {
  cancelFFmpeg,
  cutVideoSegments,
  extractAudioAs,
  isCancellationError,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';
import { formatTime } from '@/lib/utils';
import { useTier } from '@/lib/use-tier';

type OutputKind = 'video' | 'audio';
type AudioFmt = 'wav' | 'mp3';

type Result =
  | {
      kind: 'video';
      blob: Blob;
      url: string;
      originalDur: number;
      newDur: number;
    }
  | {
      kind: 'audio';
      blob: Blob;
      url: string;
      format: AudioFmt;
      originalDur: number;
      newDur: number;
    };

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(file.name);
}

function baseName(name?: string | null) {
  if (!name) return 'arquivo';
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

/**
 * A partir das regioes silenciosas, calcula as regioes com fala (complemento),
 * mantendo `keepSilence` segundos nas bordas pra manter o corte natural.
 */
function computeSpeechSegments(
  silences: Array<{ start: number; end: number }>,
  totalDur: number,
  keepSilence: number,
): Array<{ start: number; end: number }> {
  const segs: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of silences) {
    const silStart = Math.max(0, s.start + keepSilence);
    const silEnd = Math.min(totalDur, s.end - keepSilence);
    if (silEnd > silStart) {
      if (silStart > cursor) segs.push({ start: cursor, end: silStart });
      cursor = silEnd;
    }
  }
  if (cursor < totalDur) segs.push({ start: cursor, end: totalDur });
  return segs.filter((s) => s.end - s.start > 0.05);
}

export default function DecupagemPage() {
  const tier = useTier();
  const isFree = tier === 'free';
  const [file, setFile] = useToolState<File | null>('decupagem:file', null);
  const [keepSilence, setKeepSilence] = useToolState<number>(
    'decupagem:keepSilence',
    0.05,
  );
  const [outputKind, setOutputKind] = useToolState<OutputKind>(
    'decupagem:outputKind',
    'video',
  );
  const [audioFormat, setAudioFormat] = useToolState<AudioFmt>(
    'decupagem:audioFormat',
    'mp3',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'decupagem:processing',
    false,
  );
  const [status, setStatus] = useToolState<string | null>(
    'decupagem:status',
    null,
  );
  const [progress, setProgress] = useToolState<number | null>(
    'decupagem:progress',
    null,
  );
  const [error, setError] = useToolState<string | null>(
    'decupagem:error',
    null,
  );
  const [result, setResult] = useToolState<Result | null>(
    'decupagem:result',
    null,
  );

  const fileIsVideo = file ? isVideoFile(file) : false;
  // Free é forçado a 'audio' — segurança UI (server também bloqueia).
  const effectiveKind: OutputKind = isFree
    ? 'audio'
    : fileIsVideo
      ? outputKind
      : 'audio';

  function reset() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStatus(null);
    setError(null);
    setProgress(null);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      if (effectiveKind === 'audio') {
        await processAudio();
      } else {
        await processVideo();
      }
    } catch (e) {
      console.error(e);
      if (isCancellationError(e)) {
        setStatus('Cancelado.');
        setError(null);
      } else {
        setError((e as Error).message ?? 'Não foi possível processar.');
        setStatus(null);
      }
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  }

  async function processAudio() {
    if (!file) return;
    setStatus('Carregando...');
    const decoded = await decodeAudioRobust(file, () => setStatus('Carregando...'));
    setStatus('Cortando silêncios...');
    const trimmed = trimSilences(decoded, keepSilence);

    let blob: Blob;
    if (audioFormat === 'wav') {
      setStatus('Gerando arquivo...');
      blob = encodeWAV(trimmed);
    } else {
      setStatus('Gerando arquivo...');
      const wav = encodeWAV(trimmed);
      blob = await extractAudioAs(wav, 'mp3', {
        onStage: () => setStatus('Gerando arquivo...'),
        onProgress: ({ ratio }) => setProgress(ratio),
      });
    }

    setResult({
      kind: 'audio',
      blob,
      url: URL.createObjectURL(blob),
      format: audioFormat,
      originalDur: decoded.duration,
      newDur: trimmed.duration,
    });
    setStatus(null);
  }

  async function processVideo() {
    if (!file) return;
    setStatus('Analisando...');
    const decoded = await decodeAudioRobust(file, () => setStatus('Analisando...'));
    const silences = detectSilences(decoded);
    const segments = computeSpeechSegments(
      silences,
      decoded.duration,
      keepSilence,
    );

    if (segments.length === 0) {
      throw new Error(
        'Não consegui detectar a fala. Tente diminuir a tolerância de silêncio.',
      );
    }

    const newDur = segments.reduce((a, s) => a + (s.end - s.start), 0);

    setStatus(
      `Cortando ${segments.length} trechos de fala (FFmpeg)...`,
    );
    const blob = await cutVideoSegments(file, segments, {
      onStage: (s) => setStatus(s),
      onProgress: ({ ratio }) => setProgress(ratio),
    });

    setResult({
      kind: 'video',
      blob,
      url: URL.createObjectURL(blob),
      originalDur: decoded.duration,
      newDur,
    });
    setStatus(null);
  }

  async function download() {
    if (!result || !file) return;
    const base = baseName(file.name);
    if (result.kind === 'video') {
      await downloadBlob(result.blob, base + '_decupado.mp4');
    } else {
      await downloadBlob(result.blob, base + '_decupado.' + result.format);
    }
  }

  const reducedPct =
    result && result.originalDur > 0
      ? Math.max(0, Math.round((1 - result.newDur / result.originalDur) * 100))
      : 0;

  const audioOptions = [
    { value: 'mp3' as const, label: 'MP3', sub: 'menor' },
    { value: 'wav' as const, label: 'WAV', sub: 'qualidade máx' },
  ];

  return (
    <div className="mx-auto w-full max-w-[920px] px-5 md:px-8">
      <ToolHero
        title="Decupagem"
        eyebrow="VÍDEO / ÁUDIO"
        subtitle="Corta os silêncios. Envia áudio, recebe áudio. Envia vídeo, recebe vídeo."
        hue="rgba(163,230,53,0.4)"
        icon={<IconDecupagem size={56} />}
      />

      <div className="mt-6 grid gap-5">
        {/* PASSO 1 — UPLOAD */}
        <ToolStep
          n={1}
          icon={<IconStepUpload size={18} />}
          title="Solta o arquivo"
          hint="MP3, WAV, MP4, WEBM ou MOV"
          hue="rgba(163,230,53,0.4)"
        >
          <ToolDropzone
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            file={file}
            onFile={(f) => {
              reset();
              setFile(f);
            }}
            hint="Até 2 GB. Arraste pra cá ou clique pra escolher."
            hue="rgba(163,230,53,0.5)"
            disabled={processing}
          />
        </ToolStep>

        {/* PASSO 2 — SAÍDA (só pra vídeo) */}
        {fileIsVideo ? (
          <ToolStep
            n={2}
            icon={<IconStepFormat size={18} />}
            title="Como você quer receber?"
            hint={isFree ? 'A conta grátis exporta só áudio' : 'Escolhe o formato de saída'}
            hue="rgba(167,139,250,0.4)"
          >
            <ToolChoice
              value={effectiveKind}
              onChange={(v) => {
                if (v === 'video' && isFree) return;
                setOutputKind(v);
              }}
              options={[
                { value: 'video' as const, label: 'Vídeo', sub: 'mp4' },
                { value: 'audio' as const, label: 'Áudio', sub: 'só som' },
              ]}
              disabled={processing}
            />
            {isFree ? (
              <p className="mt-2 text-[11.5px] text-violet">
                🔒 Vídeo bloqueado no plano grátis.
              </p>
            ) : null}
          </ToolStep>
        ) : null}

        {/* PASSO 3 — FORMATO DE ÁUDIO (se for saída áudio) */}
        {effectiveKind === 'audio' ? (
          <ToolStep
            n={fileIsVideo ? 3 : 2}
            icon={<IconStepFormat size={18} />}
            title="Formato do áudio"
            hue="rgba(34,211,238,0.4)"
          >
            <ToolChoice
              value={audioFormat}
              onChange={setAudioFormat}
              options={audioOptions}
              disabled={processing}
            />
          </ToolStep>
        ) : null}

        {/* PASSO 4 — TOLERÂNCIA */}
        <ToolStep
          n={effectiveKind === 'audio' ? (fileIsVideo ? 4 : 3) : 3}
          icon={<IconStepSliders size={18} />}
          title="Quanto de silêncio manter?"
          hint="Pouco = corte agressivo. Muito = fala respira"
          hue="rgba(244,114,182,0.4)"
        >
          <ToolSlider
            label="Tolerância de silêncio"
            min={0.01}
            max={0.5}
            step={0.01}
            value={keepSilence}
            onChange={setKeepSilence}
            display={(v) => `${v.toFixed(2)}s`}
            disabled={processing}
          />
        </ToolStep>

        {/* AÇÃO */}
        <div className="flex flex-wrap items-center gap-3">
          {processing ? (
            <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar" />
          ) : (
            <ToolAction onClick={process} disabled={!file} variant="lime">
              Decupar agora
            </ToolAction>
          )}
          <button
            onClick={() => {
              reset();
              setFile(null);
            }}
            className="btn-ghost"
            disabled={processing}
          >
            Limpar
          </button>
        </div>

        {/* STATUS */}
        {status ? (
          <div
            className={
              'rounded-[14px] border px-4 py-3 text-xs ' +
              (processing
                ? 'scan-line border-lime/40 bg-lime/5 text-lime'
                : 'border-line bg-bg-soft/40 text-text-muted')
            }
          >
            <div className="flex items-center gap-2">
              {processing ? (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                </span>
              ) : null}
              <span
                className="mono uppercase tracking-widest"
                style={{ fontFamily: 'var(--font-tech)' }}
              >
                {status}
              </span>
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

        {/* ERRO */}
        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[14px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300"
          >
            {error}
          </div>
        ) : null}

        {/* RESULTADO */}
        {result ? (
          <ToolResultCard
            title="Decupagem concluída"
            meta={`${reducedPct}% menor`}
          >
            <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
              <ToolMetric
                value={formatTime(result.originalDur)}
                label="Original"
              />
              <ToolMetric
                value={formatTime(result.newDur)}
                label="Após decupagem"
                accent="lime"
              />
              <ToolMetric value={`–${reducedPct}%`} label="Redução" accent="lime" />
            </div>
            {result.kind === 'video' ? (
              <video
                src={result.url}
                controls
                className="w-full rounded-[14px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,255,0,0.4)]"
              />
            ) : (
              <AudioPlayer src={result.url} label="Preview" />
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={download} className="btn-lime !py-2.5 text-xs">
                Baixar{' '}
                {result.kind === 'video'
                  ? 'MP4'
                  : result.format.toUpperCase()}
              </button>
            </div>
          </ToolResultCard>
        ) : null}
      </div>
    </div>
  );
}
