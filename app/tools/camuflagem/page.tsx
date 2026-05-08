'use client';

import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useToolState } from '@/components/ToolsStateProvider';
import { camuflar } from '@/lib/camuflagem';
import { downloadBlob } from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import {
  cancelFFmpeg,
  extractAudioAs,
  isCancellationError,
  muxAudioIntoVideo,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';

type OutFormat = 'mp4' | 'mp3' | 'wav';

type Pair = {
  id: string;
  black: File | null;
  white: File | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  errorMsg?: string;
  resultBlob?: Blob;
  resultUrl?: string;
  stage?: string;
};

function newPair(): Pair {
  return { id: crypto.randomUUID(), black: null, white: null, status: 'idle' };
}

function isVideoFile(f: File | null) {
  if (!f) return false;
  return f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(f.name);
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
}

export default function CamuflagemPage() {
  const [pairs, setPairs] = useToolState<Pair[]>('camuflagem:pairs', [
    newPair(),
  ]);
  const [volume, setVolume] = useToolState<number>('camuflagem:volume', 30);
  const [format, setFormat] = useToolState<OutFormat>(
    'camuflagem:format',
    'wav',
  );
  const [processingAll, setProcessingAll] = useToolState<boolean>(
    'camuflagem:processingAll',
    false,
  );

  function updatePair(id: string, patch: Partial<Pair>) {
    setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function addPair() {
    if (pairs.length >= 10) return;
    setPairs((prev) => [...prev, newPair()]);
  }

  function removePair(id: string) {
    if (pairs.length <= 1) return;
    setPairs((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function processAll() {
    const ready = pairs.filter((p) => p.black && p.white);
    if (ready.length === 0) return;
    setProcessingAll(true);

    for (const pair of ready) {
      try {
        updatePair(pair.id, {
          status: 'processing',
          errorMsg: undefined,
          stage: 'Camuflando audio...',
        });
        // 1) Gera WAV camuflado (stereo, com inversao de fase)
        const wav = await camuflar({
          black: pair.black!,
          white: pair.white!,
          volumePercent: volume,
        });

        let out: Blob;
        if (format === 'wav') {
          out = wav;
        } else if (format === 'mp3') {
          updatePair(pair.id, { stage: 'Convertendo para MP3...' });
          out = await extractAudioAs(wav, 'mp3', {
            onStage: (s) => updatePair(pair.id, { stage: s }),
          });
        } else {
          // mp4: exige BLACK de video — mantem o video, troca a trilha de audio
          if (!isVideoFile(pair.black)) {
            throw new Error(
              'Para sair em MP4, o BLACK precisa ser um arquivo de video.',
            );
          }
          updatePair(pair.id, { stage: 'Muxando audio camuflado no video...' });
          out = await muxAudioIntoVideo(pair.black!, wav, {
            onStage: (s) => updatePair(pair.id, { stage: s }),
          });
        }

        const url = URL.createObjectURL(out);
        updatePair(pair.id, {
          status: 'done',
          resultBlob: out,
          resultUrl: url,
          stage: undefined,
        });
      } catch (e) {
        console.error(e);
        if (isCancellationError(e)) {
          updatePair(pair.id, {
            status: 'error',
            errorMsg: 'Cancelado pelo usuario.',
            stage: undefined,
          });
          break;
        }
        updatePair(pair.id, {
          status: 'error',
          errorMsg: (e as Error).message ?? 'Falha',
          stage: undefined,
        });
      }
    }
    setProcessingAll(false);
  }

  async function downloadOne(pair: Pair) {
    if (!pair.resultBlob) return;
    const base = baseName(pair.black?.name ?? 'par');
    await downloadBlob(pair.resultBlob, base + '_camuflado.' + format);
  }

  async function downloadAllZip() {
    const done = pairs.filter((p) => p.resultBlob);
    if (done.length === 0) return;
    const zip = await buildZip(
      done.map((p, i) => ({
        name:
          baseName(p.black?.name ?? 'par-' + (i + 1)) +
          '_camuflado.' +
          format,
        data: p.resultBlob!,
      })),
    );
    await downloadBlob(zip, 'camuflagem.zip');
  }

  const doneCount = pairs.filter((p) => p.status === 'done').length;
  const anyBlackNotVideo = pairs.some((p) => p.black && !isVideoFile(p.black));
  const mp4Disabled = anyBlackNotVideo;

  return (
    <ToolShell
      title="Camuflagem"
      description="Inversao de fase estereo: IA escuta o WHITE, publico escuta o BLACK. O output tem SEMPRE a duracao do BLACK — o WHITE e so uma camada de camuflagem. Exporte em MP4 (video), MP3 ou WAV."
    >
      <div className="flex flex-col gap-6">
        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Volume do WHITE</label>
            <span className="mono text-xs text-lime">{volume}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={volume}
            onChange={(e) => setVolume(parseInt(e.target.value))}
            className="mt-3"
            disabled={processingAll}
          />
          <p className="mt-2 text-xs text-text-muted">
            Ganho aplicado:{' '}
            <span className="mono text-lime">
              {((volume / 100) * 0.05).toFixed(4)}
            </span>
          </p>
        </div>

        <div>
          <label className="label-field">Formato de saida</label>
          <div className="flex flex-wrap gap-2">
            {(['mp4', 'mp3', 'wav'] as const).map((f) => {
              const disabled = f === 'mp4' && mp4Disabled;
              const active = format === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => !disabled && setFormat(f)}
                  disabled={processingAll || disabled}
                  className={
                    'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 ' +
                    (active
                      ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                  title={
                    disabled
                      ? 'MP4 exige que todos os BLACK sejam arquivos de video.'
                      : undefined
                  }
                >
                  {f === 'mp4' ? 'MP4 (video + audio)' : f.toUpperCase()}
                </button>
              );
            })}
          </div>
          {format === 'mp4' ? (
            <p className="mt-2 text-xs text-text-muted">
              O BLACK mantem o video; apenas a trilha de audio e substituida pela
              versao camuflada.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {pairs.map((pair, i) => (
            <div
              key={pair.id}
              className={
                'rounded-[12px] border bg-bg p-4 transition-colors ' +
                (pair.status === 'processing'
                  ? 'scan-line border-lime/40'
                  : pair.status === 'done'
                    ? 'border-lime/30'
                    : pair.status === 'error'
                      ? 'border-red-500/40'
                      : 'border-line')
              }
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                  Par {i + 1}
                  {pair.status === 'processing' ? (
                    <span className="ml-2 text-lime">
                      {pair.stage ?? 'processando...'}
                    </span>
                  ) : null}
                  {pair.status === 'done' ? (
                    <span className="ml-2 text-lime">OK</span>
                  ) : null}
                  {pair.status === 'error' ? (
                    <span className="ml-2 text-red-400">erro</span>
                  ) : null}
                </span>
                {pairs.length > 1 ? (
                  <button
                    onClick={() => removePair(pair.id)}
                    className="btn-ghost !py-1 text-xs"
                    disabled={processingAll}
                  >
                    Remover
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label-field">BLACK (publico)</label>
                  <FileUpload
                    accept="audio/*,video/mp4,video/webm,video/quicktime"
                    value={pair.black}
                    onChange={(f) =>
                      updatePair(pair.id, { black: f, status: 'idle' })
                    }
                  />
                </div>
                <div>
                  <label className="label-field">WHITE (IA)</label>
                  <FileUpload
                    accept="audio/*,video/mp4,video/webm,video/quicktime"
                    value={pair.white}
                    onChange={(f) =>
                      updatePair(pair.id, { white: f, status: 'idle' })
                    }
                  />
                  <p className="mt-1 text-[11px] text-text-muted">
                    Pode ser mais curto que o BLACK — o output fica com a
                    duracao do BLACK, e a IA segue sem identificar a trilha.
                  </p>
                </div>
              </div>

              {pair.errorMsg ? (
                <div
                  key={pair.errorMsg}
                  role="alert"
                  className="error-shake mt-3 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
                >
                  {pair.errorMsg}
                </div>
              ) : null}

              {pair.status === 'done' && pair.resultUrl ? (
                <div className="mt-3 flex flex-col gap-2">
                  {format === 'mp4' ? (
                    <video
                      src={pair.resultUrl}
                      controls
                      className="w-full rounded-[12px] border border-lime/30 bg-black shadow-[0_0_28px_-12px_rgba(200,255,0,0.4)]"
                    />
                  ) : (
                    <AudioPlayer src={pair.resultUrl} label="Resultado camuflado" />
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={() => downloadOne(pair)}
                      className="btn-ghost !py-1 text-xs"
                    >
                      Baixar {format.toUpperCase()}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={addPair}
            className="btn-secondary"
            disabled={pairs.length >= 10 || processingAll}
          >
            + Adicionar par ({pairs.length}/10)
          </button>
          {processingAll ? (
            <CancelButton onClick={() => cancelFFmpeg()} label="Cancelar processamento" />
          ) : (
            <button
              onClick={processAll}
              className="btn-primary"
              disabled={!pairs.some((p) => p.black && p.white)}
            >
              Processar tudo
            </button>
          )}
          {doneCount > 1 ? (
            <button onClick={downloadAllZip} className="btn-secondary">
              Baixar ZIP ({doneCount})
            </button>
          ) : null}
        </div>
      </div>
    </ToolShell>
  );
}
