'use client';

import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useToolState } from '@/components/ToolsStateProvider';
import { downloadBlob } from '@/lib/audio-engine';
import {
  normalizeVolume,
  type NormalizeIntensity,
  type NormalizeOutFormat,
  type FFProgress,
} from '@/lib/ffmpeg-worker';

/**
 * Normalizador de Volume — equilibra o volume de um video/audio.
 *
 * Cenario tipico: VSL onde uma voz esta mais alta que outra, ou trechos
 * de musica/efeito muito acima do narrador. Usa o filtro `dynaudnorm` do
 * FFmpeg pra ajustar gain dinamicamente: trechos baixos sobem, altos baixam,
 * tudo se equilibra.
 *
 * Saida pode ser MP4 (mantem video, troca trilha de audio), MP3 ou WAV.
 * Quando o input e audio puro, MP4 fica desabilitado.
 */

function isVideoFile(f: File | null): boolean {
  if (!f) return false;
  return f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi)$/i.test(f.name);
}

function baseName(name?: string | null) {
  if (!name) return 'arquivo';
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

const INTENSITY_OPTIONS: Array<{
  id: NormalizeIntensity;
  label: string;
  description: string;
}> = [
  {
    id: 'suave',
    label: 'Suave',
    description: 'Pequenos ajustes — preserva mais a dinamica original.',
  },
  {
    id: 'padrao',
    label: 'Padrão',
    description: 'Equilibrio recomendado para VSLs e narracoes.',
  },
  {
    id: 'forte',
    label: 'Forte',
    description: 'Achata variacoes agressivamente. Voz uniforme do inicio ao fim.',
  },
];

export default function NormalizadorPage() {
  const [file, setFile] = useToolState<File | null>('normalizador:file', null);
  const [intensity, setIntensity] = useToolState<NormalizeIntensity>(
    'normalizador:intensity',
    'padrao',
  );
  const [output, setOutput] = useToolState<NormalizeOutFormat>(
    'normalizador:output',
    'mp4',
  );
  const [processing, setProcessing] = useToolState<boolean>(
    'normalizador:processing',
    false,
  );
  const [status, setStatus] = useToolState<string | null>(
    'normalizador:status',
    null,
  );
  const [progress, setProgress] = useToolState<number | null>(
    'normalizador:progress',
    null,
  );
  const [error, setError] = useToolState<string | null>(
    'normalizador:error',
    null,
  );
  const [resultUrl, setResultUrl] = useToolState<string | null>(
    'normalizador:resultUrl',
    null,
  );
  const [resultBlob, setResultBlob] = useToolState<Blob | null>(
    'normalizador:resultBlob',
    null,
  );
  const [resultKind, setResultKind] = useToolState<NormalizeOutFormat | null>(
    'normalizador:resultKind',
    null,
  );

  const fileIsVideo = isVideoFile(file);
  // Se input nao tiver video, o output mp4 nao faz sentido — forca audio.
  const effectiveOutput: NormalizeOutFormat = fileIsVideo ? output : output === 'mp4' ? 'mp3' : output;

  function reset() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultBlob(null);
    setResultKind(null);
    setStatus(null);
    setError(null);
    setProgress(null);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      setStatus('Carregando FFmpeg...');
      const out = await normalizeVolume(
        file,
        { intensity, output: effectiveOutput },
        {
          onStage: (s) => setStatus(s),
          onProgress: (p: FFProgress) => setProgress(p.ratio),
        },
      );

      const url = URL.createObjectURL(out);
      setResultBlob(out);
      setResultUrl(url);
      setResultKind(effectiveOutput);
      setStatus(null);
      setProgress(null);
    } catch (e) {
      console.error(e);
      setError(
        (e as Error)?.message ?? 'Falha ao normalizar. Tente outro arquivo.',
      );
      setStatus(null);
      setProgress(null);
    } finally {
      setProcessing(false);
    }
  }

  async function download() {
    if (!resultBlob || !resultKind || !file) return;
    const ext = resultKind;
    await downloadBlob(resultBlob, baseName(file.name) + '_normalizado.' + ext);
  }

  return (
    <ToolShell
      title="Normalizador de Volume"
      description="Equilibra o volume de video ou audio: trechos baixos sobem, trechos altos baixam, voz fica uniforme. Saida em MP4 (mantem video), MP3 ou WAV."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivo (audio ou video)</label>
          <FileUpload
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4, WEBM ou MOV"
          />
        </div>

        <div>
          <label className="label-field">Intensidade da normalizacao</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {INTENSITY_OPTIONS.map((opt) => {
              const active = intensity === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setIntensity(opt.id)}
                  disabled={processing}
                  className={
                    'flex flex-col items-start gap-1 rounded-[12px] border px-4 py-3 text-left transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ' +
                    (active
                      ? 'border-lime bg-lime/10 text-lime shadow-[0_0_18px_-4px_rgba(200,255,0,0.5)]'
                      : 'border-line bg-bg text-text-muted hover:border-lime/50 hover:text-white')
                  }
                >
                  <span className="text-sm font-semibold uppercase tracking-widest">
                    {opt.label}
                  </span>
                  <span className="text-[11px] leading-snug text-text-muted">
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label-field">Formato de saida</label>
          <div className="flex flex-wrap gap-2">
            {(['mp4', 'mp3', 'wav'] as const).map((f) => {
              const disabled = f === 'mp4' && !fileIsVideo;
              const active = effectiveOutput === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => !disabled && setOutput(f)}
                  disabled={processing || disabled}
                  className={
                    'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 ' +
                    (active
                      ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                  title={
                    disabled
                      ? 'MP4 disponivel apenas quando o input e video.'
                      : undefined
                  }
                >
                  {f === 'mp4' ? 'MP4 (video)' : f.toUpperCase()}
                </button>
              );
            })}
          </div>
          {effectiveOutput === 'mp4' ? (
            <p className="mt-2 text-xs text-text-muted">
              O video original e mantido; apenas a trilha de audio e normalizada.
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-muted">
              {fileIsVideo
                ? 'A imagem do video sera descartada — saida e somente audio normalizado.'
                : 'Saida de audio normalizado.'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={process}
            className="btn-primary"
            disabled={!file || processing}
          >
            {processing ? 'Processando...' : 'Normalizar'}
          </button>
          <button
            onClick={() => {
              reset();
              setFile(null);
            }}
            className="btn-secondary"
            disabled={processing}
          >
            Limpar
          </button>
        </div>

        {status ? (
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
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                </span>
              ) : null}
              <span className="mono uppercase tracking-widest">{status}</span>
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

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        ) : null}

        {resultUrl && resultKind ? (
          <div className="fade-in-up mt-2 border-t border-line pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
                </span>
                Resultado normalizado
              </h3>
              <button onClick={download} className="btn-primary !py-2 text-xs">
                Baixar {resultKind.toUpperCase()}
              </button>
            </div>
            {resultKind === 'mp4' ? (
              <video
                src={resultUrl}
                controls
                className="w-full rounded-[12px] border border-lime/30 bg-bg shadow-[0_0_28px_-12px_rgba(200,255,0,0.4)]"
              />
            ) : (
              <AudioPlayer src={resultUrl} label="Preview" />
            )}
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
