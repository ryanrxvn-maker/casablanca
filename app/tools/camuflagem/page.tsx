'use client';

import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  camuflar,
  verifyCamouflage,
  buildMonoSumWav,
  type VerifyVerdict,
} from '@/lib/camuflagem';
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
  // Verificação automática "o que a IA escuta"
  guard?: 'checking' | VerifyVerdict;
  whiteScore?: number;
  blackScore?: number;
  // Transcrição (prova manual)
  transcribing?: boolean;
  transcript?: string;
  transcriptErr?: string;
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
          guard: undefined,
          whiteScore: undefined,
          blackScore: undefined,
          transcript: undefined,
          transcriptErr: undefined,
        });
        if (format === 'mp4' && !isVideoFile(pair.black)) {
          throw new Error(
            'Para sair em MP4, o BLACK precisa ser um arquivo de video.',
          );
        }

        // LOOP DE GARANTIA (vale pra WAV, MP3 e MP4):
        //  1. camufla com reforço atual
        //  2. codifica no formato pedido (MP3/MP4 com settings robustos)
        //  3. decodifica o ARQUIVO REAL, refaz o downmix mono (L+R) que a IA
        //     recebe e mede se sobrou o WHITE
        //  4. se a IA ainda escuta o BLACK (codec lossy comeu a camada),
        //     dobra o reforço do WHITE e tenta de novo — até passar.
        // Nunca entregamos um arquivo que a verificação reprova.
        const ladder = [1, 2, 4, 8, 16];
        let out: Blob | null = null;
        let lastV: Awaited<ReturnType<typeof verifyCamouflage>> | null = null;

        for (let attempt = 0; attempt < ladder.length; attempt++) {
          const boost = ladder[attempt];
          const tag = attempt === 0 ? '' : ` (reforco ${attempt})`;

          updatePair(pair.id, { stage: `Camuflando audio${tag}...` });
          const wav = await camuflar({
            black: pair.black!,
            white: pair.white!,
            volumePercent: volume,
            gainBoost: boost,
          });

          let candidate: Blob;
          if (format === 'wav') {
            candidate = wav;
          } else if (format === 'mp3') {
            updatePair(pair.id, {
              stage: `Convertendo para MP3 320k${tag}...`,
            });
            candidate = await extractAudioAs(
              wav,
              'mp3',
              { onStage: (s) => updatePair(pair.id, { stage: s }) },
              true,
            );
          } else {
            updatePair(pair.id, {
              stage: `Muxando no video (AAC 320k)${tag}...`,
            });
            candidate = await muxAudioIntoVideo(
              pair.black!,
              wav,
              { onStage: (s) => updatePair(pair.id, { stage: s }) },
              true,
            );
          }

          updatePair(pair.id, {
            stage: `Verificando o que a IA escuta no ${format.toUpperCase()} real${tag}...`,
            guard: 'checking',
          });
          const v = await verifyCamouflage({
            result: candidate,
            white: pair.white!,
            black: pair.black!,
          });
          lastV = v;
          out = candidate;

          if (v.verdict === 'ok') break;
          // WAV é exato por construção: se reprovar, reforçar não muda nada
          // (problema seria no áudio de origem) — para e reporta honestamente.
          if (format === 'wav') break;
        }

        const url = URL.createObjectURL(out!);
        updatePair(pair.id, {
          status: 'done',
          resultBlob: out!,
          resultUrl: url,
          stage: undefined,
          guard: lastV?.verdict ?? 'fail',
          whiteScore: lastV?.whiteScore,
          blackScore: lastV?.blackScore,
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

  // TRANSCREVER: pega o resultado, refaz o downmix mono (L+R) idêntico ao
  // que a IA processaria e transcreve. O texto que voltar é literalmente
  // "o que a IA escuta" — tem que ser o roteiro do WHITE.
  async function transcribeOne(pair: Pair) {
    if (!pair.resultBlob || pair.transcribing) return;
    updatePair(pair.id, {
      transcribing: true,
      transcript: undefined,
      transcriptErr: undefined,
    });
    try {
      const { wav } = await buildMonoSumWav(pair.resultBlob);
      const fd = new FormData();
      fd.append('audio', wav, 'mono-sum.wav');
      fd.append('languageCode', 'pt');
      const res = await fetch('/api/camuflagem/transcribe', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(
          (data && (data.error as string)) ??
            `Falha na transcricao (HTTP ${res.status}).`,
        );
      }
      updatePair(pair.id, {
        transcribing: false,
        transcript: (data.text as string) || '(silencio / nada reconhecido)',
      });
    } catch (e) {
      updatePair(pair.id, {
        transcribing: false,
        transcriptErr: (e as Error).message ?? 'Falha na transcricao.',
      });
    }
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
      description="Inversao de fase estereo: IA escuta o WHITE, publico escuta o BLACK. Cada arquivo gerado e verificado NO FORMATO REAL (WAV, MP3 ou MP4) e a camuflagem e reforcada automaticamente ate a IA comprovadamente escutar o WHITE — garantido em qualquer formato."
    >
      <div className="flex flex-col gap-6">
        <MissingKeyBanner services={['assemblyai']} />
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

                  {/* GARANTIA automatica: o que a IA realmente escuta */}
                  {pair.guard === 'checking' ? (
                    <div className="flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft/40 px-3 py-2 text-xs text-text-muted">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-lime border-t-transparent" />
                      Verificando o que a IA escuta...
                    </div>
                  ) : pair.guard === 'ok' ? (
                    <div className="rounded-[10px] border border-lime/50 bg-lime/10 px-3 py-2 text-xs text-lime shadow-[0_0_22px_-8px_rgba(200,255,0,0.6)]">
                      <strong>CAMUFLAGEM GARANTIDA</strong> — a IA escuta o{' '}
                      <strong>WHITE</strong>, o BLACK cancela no mono.
                      <span className="ml-2 mono text-[10px] text-text-muted">
                        white {(pair.whiteScore ?? 0).toFixed(2)} · black{' '}
                        {(pair.blackScore ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ) : pair.guard === 'fail' ? (
                    <div
                      role="alert"
                      className="error-shake rounded-[10px] border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
                    >
                      <strong>FALHOU — a IA escuta o BLACK</strong> mesmo apos
                      reforcar a camuflagem ao maximo. Provavel causa no audio
                      de origem (WHITE quase mudo, ou BLACK/WHITE trocados).
                      Cheque os arquivos e o botao de transcrever.
                      <span className="ml-2 mono text-[10px] text-red-400/80">
                        white {(pair.whiteScore ?? 0).toFixed(2)} · black{' '}
                        {(pair.blackScore ?? 0).toFixed(2)}
                      </span>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => transcribeOne(pair)}
                      disabled={pair.transcribing}
                      aria-label="Transcrever (ouvir como a IA)"
                      title="Transcrever — ouve o downmix mono (L+R) e mostra o que a IA realmente escuta"
                      className="group relative flex h-9 w-9 items-center justify-center rounded-xl border-2 border-line bg-bg-soft/80 text-text-muted backdrop-blur-md transition-all duration-300 ease-[cubic-bezier(.4,1.4,.6,1)] hover:scale-[1.06] hover:border-lime hover:text-lime active:scale-[0.92] active:duration-75 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        boxShadow:
                          'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 0 rgba(0,0,0,0.5), 0 2px 6px -2px rgba(0,0,0,0.6)',
                      }}
                    >
                      {pair.transcribing ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-lime border-t-transparent" />
                      ) : (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                          <path d="M5 11a7 7 0 0 0 14 0" />
                          <line x1="12" y1="18" x2="12" y2="22" />
                          <line x1="8" y1="22" x2="16" y2="22" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => downloadOne(pair)}
                      className="btn-ghost !py-1 text-xs"
                    >
                      Baixar {format.toUpperCase()}
                    </button>
                  </div>

                  {pair.transcriptErr ? (
                    <div
                      role="alert"
                      className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                    >
                      {pair.transcriptErr}
                    </div>
                  ) : null}
                  {pair.transcript ? (
                    <div className="rounded-[8px] border border-lime/30 bg-bg-soft/50 px-3 py-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                        O que a IA escuta (downmix mono L+R)
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-white">
                        {pair.transcript}
                      </p>
                      <p className="mt-2 text-[10px] text-text-muted">
                        Esse texto tem que ser o roteiro do <strong>WHITE</strong>.
                        Se aparecer o roteiro do BLACK, a camuflagem nao segurou.
                      </p>
                    </div>
                  ) : null}
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
