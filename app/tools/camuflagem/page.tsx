'use client';

import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  camuflar,
  verifyCamouflage,
  buildPlatformMonoWav,
  type VerifyVerdict,
  type DownmixResult,
} from '@/lib/camuflagem';
import { downloadBlob } from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import {
  cancelFFmpeg,
  extractAudioAs,
  extractStereoAudioForTranscription,
  isCancellationError,
  muxAudioIntoVideo,
} from '@/lib/ffmpeg-worker';
import { CancelButton } from '@/components/CancelButton';

type OutFormat = 'mp4' | 'mp3' | 'wav';

// Alvo da camuflagem. Define QUAL downmix decide o veredito:
//  - platforms: TikTok/Kwai/YouTube reduzem pra mono SOMANDO/mediando os
//    canais (YouTube Content ID faz a média — comprovado). A inversão de
//    fase engana esses. Julga por soma L+R + média.
//  - single: ASR de canal único (AssemblyAI, Whisper padrão). Pega 1 canal,
//    onde o BLACK está cheio. A técnica NÃO camufla. Julga pelos canais.
//  - universal: pior caso — só passa se TODO downmix escutar o WHITE.
type Target = 'platforms' | 'single' | 'universal';

const TARGET_KINDS: Record<Target, Array<'sum' | 'avg' | 'left' | 'right'>> = {
  platforms: ['sum', 'avg'],
  single: ['left', 'right'],
  universal: ['sum', 'avg', 'left', 'right'],
};

function effectiveVerdict(
  downmixes: DownmixResult[] | undefined,
  target: Target,
): 'ok' | 'fail' | null {
  if (!downmixes || downmixes.length === 0) return null;
  const kinds = TARGET_KINDS[target];
  const relevant = downmixes.filter((d) => kinds.includes(d.kind));
  if (relevant.length === 0) return null;
  return relevant.every((d) => d.hears === 'white') ? 'ok' : 'fail';
}

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
  downmixes?: DownmixResult[];
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
  const [target, setTarget] = useToolState<Target>(
    'camuflagem:target',
    'platforms',
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

        // Camufla -> codifica no formato pedido (MP3/MP4 com settings
        // robustos pra inversão de fase sobreviver ao codec lossy).
        updatePair(pair.id, { stage: 'Camuflando audio...' });
        const wav = await camuflar({
          black: pair.black!,
          white: pair.white!,
          volumePercent: volume,
        });

        let out: Blob;
        if (format === 'wav') {
          out = wav;
        } else if (format === 'mp3') {
          updatePair(pair.id, { stage: 'Convertendo para MP3 320k...' });
          out = await extractAudioAs(
            wav,
            'mp3',
            { onStage: (s) => updatePair(pair.id, { stage: s }) },
            true,
          );
        } else {
          updatePair(pair.id, { stage: 'Muxando no video (AAC 320k)...' });
          out = await muxAudioIntoVideo(
            pair.black!,
            wav,
            { onStage: (s) => updatePair(pair.id, { stage: s }) },
            true,
          );
        }

        // GARANTIA HONESTA: decodifica o ARQUIVO REAL e mede o que CADA
        // tipo de IA escuta — soma L+R, média E canal isolado (que é como
        // AssemblyAI/Whisper padrão fazem). Só fica verde se o PIOR caso
        // ainda escutar o WHITE. Nunca mais "camuflado" mentiroso.
        updatePair(pair.id, {
          stage: `Verificando o que cada IA escuta no ${format.toUpperCase()} real...`,
          guard: 'checking',
        });
        const v = await verifyCamouflage({
          result: out,
          white: pair.white!,
          black: pair.black!,
        });

        const url = URL.createObjectURL(out);
        updatePair(pair.id, {
          status: 'done',
          resultBlob: out,
          resultUrl: url,
          stage: undefined,
          guard: v.verdict,
          whiteScore: v.whiteScore,
          blackScore: v.blackScore,
          downmixes: v.downmixes,
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

  // TRANSCREVER: reproduz o pipeline da IA-alvo escolhida sobre o ARQUIVO
  // REAL já codificado e transcreve via AssemblyAI:
  //  - platforms: mono-média (L+R)/2 — exatamente o que TikTok/Kwai/YouTube
  //    alimentam no ASR deles (YouTube Content ID faz a média, comprovado).
  //  - single/universal: estéreo cru — o ASR pega 1 canal (pior caso).
  async function transcribeOne(pair: Pair) {
    if (!pair.resultBlob || pair.transcribing) return;
    updatePair(pair.id, {
      transcribing: true,
      transcript: undefined,
      transcriptErr: undefined,
    });
    try {
      let audio: Blob;
      let fname: string;
      if (target === 'platforms') {
        const { wav } = await buildPlatformMonoWav(pair.resultBlob);
        audio = wav;
        fname = 'platform-mono.wav';
      } else {
        audio = await extractStereoAudioForTranscription(pair.resultBlob);
        fname = 'real-stereo.ogg';
      }
      const fd = new FormData();
      fd.append('audio', audio, fname);
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
      eyebrow="ÁUDIO"
      description="Escolha pra quem você quer enganar. O selo só fica verde se realmente camuflar."
    >
      <div className="flex flex-col gap-6">
        <MissingKeyBanner services={['assemblyai']} />
        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Intensidade da camuflagem</label>
            <span className="mono text-xs text-violet">{volume}%</span>
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
            Quanto maior, mais difícil de detectar.
          </p>
        </div>

        <div>
          <label className="label-field">Formato de saída</label>
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

        <div>
          <label className="label-field">Quem você quer enganar</label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['platforms', 'TikTok / Kwai / YouTube'],
                ['single', 'IAs de transcrição'],
                ['universal', 'Todos (mais difícil)'],
              ] as const
            ).map(([t, lbl]) => {
              const active = target === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  disabled={processingAll}
                  className={
                    'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] disabled:opacity-40 ' +
                    (active
                      ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                      : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                  }
                >
                  {lbl}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {target === 'platforms' ? (
              <>
                TikTok/Kwai/YouTube reduzem o audio pra mono SOMANDO os canais
                (o Content ID do YouTube faz a media — comprovado). A inversao
                de fase engana esses: eles escutam o WHITE.
              </>
            ) : target === 'single' ? (
              <>
                Engines que pegam UM canal isolado escutam o BLACK em volume
                cheio. A inversao de fase NAO camufla contra elas — e nao tem
                como, sem o publico tambem ouvir o WHITE.
              </>
            ) : (
              <>
                So fica verde se TODO tipo de IA (somadora E de canal unico)
                escutar o WHITE. A inversao de fase nunca passa aqui.
              </>
            )}
          </p>
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

                  {/* GARANTIA HONESTA: o que CADA tipo de IA escuta */}
                  {pair.guard === 'checking' ? (
                    <div className="flex items-center gap-2 rounded-[10px] border border-line bg-bg-soft/40 px-3 py-2 text-xs text-text-muted">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-lime border-t-transparent" />
                      Verificando o que cada IA escuta no arquivo real...
                    </div>
                  ) : pair.guard === 'ok' || pair.guard === 'fail' ? (
                    (() => {
                      const ev = effectiveVerdict(pair.downmixes, target);
                      const ok = ev === 'ok';
                      const relevant = TARGET_KINDS[target];
                      const targetLabel =
                        target === 'platforms'
                          ? 'TikTok / Kwai / YouTube'
                          : target === 'single'
                            ? 'ASR de canal unico'
                            : 'qualquer IA';
                      return (
                        <div
                          role={ok ? undefined : 'alert'}
                          className={
                            'rounded-[10px] border px-3 py-2 text-xs ' +
                            (ok
                              ? 'border-lime/50 bg-lime/10 text-lime shadow-[0_0_22px_-8px_rgba(200,255,0,0.6)]'
                              : 'error-shake border-red-500/50 bg-red-500/10 text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]')
                          }
                        >
                          <div className="mb-1.5 font-semibold">
                            {ok ? (
                              <>
                                CAMUFLADO PRA {targetLabel.toUpperCase()} — essa
                                IA escuta o WHITE
                              </>
                            ) : (
                              <>
                                NAO CAMUFLADO PRA {targetLabel.toUpperCase()} —
                                essa IA escuta o BLACK
                              </>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            {(pair.downmixes ?? []).map((d) => {
                              const used = relevant.includes(d.kind);
                              return (
                                <div
                                  key={d.kind}
                                  className={
                                    'flex items-center justify-between gap-2 ' +
                                    (used ? '' : 'opacity-40')
                                  }
                                >
                                  <span className="text-text-muted">
                                    {used ? '▸ ' : ''}
                                    {d.label}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    <span className="mono text-[10px] text-text-muted">
                                      w {d.whiteScore.toFixed(2)} · b{' '}
                                      {d.blackScore.toFixed(2)}
                                    </span>
                                    <span
                                      className={
                                        'rounded px-1.5 py-0.5 text-[10px] font-semibold ' +
                                        (d.hears === 'white'
                                          ? 'bg-lime/20 text-lime'
                                          : d.hears === 'black'
                                            ? 'bg-red-500/25 text-red-300'
                                            : 'bg-yellow-500/20 text-yellow-300')
                                      }
                                    >
                                      {d.hears === 'white'
                                        ? 'WHITE'
                                        : d.hears === 'black'
                                          ? 'BLACK'
                                          : '???'}
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {ok && target === 'platforms' ? (
                            <div className="mt-2 border-t border-lime/30 pt-2 text-[11px] text-lime/80">
                              YouTube Content ID faz a media dos canais
                              (comprovado); TikTok/Kwai sao da mesma familia. A
                              prova final e empirica: suba 1 video teste e veja
                              a legenda automatica / se a moderacao pega o WHITE.
                            </div>
                          ) : !ok ? (
                            <div className="mt-2 border-t border-red-500/30 pt-2 text-[11px] text-red-300/90">
                              A inversao de fase so engana quem SOMA/media L+R.
                              Engine de canal unico escuta o BLACK cheio — sem
                              correcao possivel sem o publico ouvir o WHITE.
                              Confirme no botao TRANSCREVER.
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => transcribeOne(pair)}
                      disabled={pair.transcribing}
                      aria-label="Transcrever (ouvir como a IA)"
                      title="Transcrever — escuta o que a IA ouve"
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
                        {target === 'platforms'
                          ? 'O que TikTok/Kwai/YouTube escutariam (mono-media L+R do arquivo real)'
                          : 'O que um ASR de canal unico escuta (estereo cru do arquivo real)'}
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-white">
                        {pair.transcript}
                      </p>
                      <p className="mt-2 text-[10px] text-text-muted">
                        Esse texto tem que ser o roteiro do <strong>WHITE</strong>.
                        {target === 'platforms' ? (
                          <>
                            {' '}
                            Reproducao fiel do pipeline mono dessas plataformas
                            — mas a certeza ABSOLUTA so vem da legenda
                            automatica da propria plataforma no video publicado.
                          </>
                        ) : (
                          <>
                            {' '}
                            Se aparecer o roteiro do BLACK, a camuflagem nao
                            segurou pra esse tipo de IA.
                          </>
                        )}
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
