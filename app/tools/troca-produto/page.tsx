'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { CostHint } from '@/components/CostHint';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { estimateTrocaProduto } from '@/lib/cost-estimator';
import { useToolState } from '@/components/ToolsStateProvider';
import { getFFmpeg } from '@/lib/ffmpeg-worker';
import { fetchFile } from '@ffmpeg/util';

/**
 * Troca de Produto — substitui mencoes de um produto antigo pelo novo
 * no audio de uma VSL, mantendo a voz do narrador original.
 *
 * Pipeline:
 *  1. Usuario envia audio + nome do produto antigo + nome do produto novo
 *  2. POST /api/troca-produto/assemblyai -> transcript + matches (start/end ms)
 *  3. Usuario confirma quais matches substituir (checkboxes)
 *  4. POST /api/troca-produto/elevenlabs-clone -> voice_id (Instant Voice Clone)
 *  5. Pra cada match: POST /api/troca-produto/elevenlabs-tts -> MP3 do produto novo
 *  6. Local (FFmpeg WASM):
 *     - recorta o audio original em segmentos [0, match1.start] + [TTS1] + [match1.end, match2.start] + [TTS2] + ...
 *     - aplica atempo no TTS pra caber na duracao original do slot (fluencia)
 *     - concatena todos os segmentos em um MP3 final
 *  7. POST /api/troca-produto/elevenlabs-delete (cleanup)
 *  8. Usuario baixa o audio final
 */

type Word = {
  text: string;
  start: number;
  end: number;
  confidence: number;
};

type Match = {
  startMs: number;
  endMs: number;
  wordIndices: number[];
};

type Transcript = {
  transcriptId: string;
  text: string;
  words: Word[];
  matches: Match[];
};

type Stage =
  | 'idle'
  | 'transcribing'
  | 'cloning'
  | 'tts'
  | 'splicing'
  | 'done'
  | 'error';

// Vercel limita o body de uma route handler a 4.5MB no plano Hobby/Pro.
// Damos uma margem de seguranca pra header overhead do multipart.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Le a Response como JSON quando possivel; quando o platform devolve
 * texto puro (ex: "Request Entity Too Large"), embrulhamos numa estrutura
 * { error: string } pra o caller nao explodir com JSON.parse.
 */
async function readResponseJson(res: Response): Promise<{
  error?: string;
  detail?: string;
  [key: string]: unknown;
}> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const sniff = text.trim().slice(0, 120);
    if (/Request Entity Too Large/i.test(sniff)) {
      return {
        error:
          'Arquivo grande demais para o servidor (limite ~4MB). Comprima o audio primeiro com a ferramenta Compressor.',
      };
    }
    return {
      error: `Resposta nao-JSON do servidor (HTTP ${res.status}).`,
      detail: sniff,
    };
  }
}

export default function TrocaProdutoPage() {
  const [file, setFile] = useToolState<File | null>('trocaProduto:file', null);
  const [oldProduct, setOldProduct] = useToolState<string>(
    'trocaProduto:oldProduct',
    '',
  );
  const [newProduct, setNewProduct] = useToolState<string>(
    'trocaProduto:newProduct',
    '',
  );
  const [transcript, setTranscript] = useToolState<Transcript | null>(
    'trocaProduto:transcript',
    null,
  );
  const [selectedMatches, setSelectedMatches] = useToolState<number[]>(
    'trocaProduto:selected',
    [],
  );
  const [stage, setStage] = useToolState<Stage>('trocaProduto:stage', 'idle');
  const [stageMsg, setStageMsg] = useState<string>('');
  const [error, setError] = useToolState<string | null>(
    'trocaProduto:error',
    null,
  );
  const [resultUrl, setResultUrl] = useToolState<string | null>(
    'trocaProduto:resultUrl',
    null,
  );

  function reset() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setTranscript(null);
    setSelectedMatches([]);
    setResultUrl(null);
    setError(null);
    setStage('idle');
    setStageMsg('');
  }

  async function runTranscribe() {
    if (!file) {
      setError('Envie o arquivo de áudio primeiro.');
      return;
    }
    if (!oldProduct.trim()) {
      setError('Informe o nome do produto antigo.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `Arquivo de ${(file.size / 1024 / 1024).toFixed(1)}MB excede o limite de upload (${MAX_UPLOAD_BYTES / 1024 / 1024}MB). Comprima o audio primeiro com a ferramenta Compressor.`,
      );
      return;
    }
    setError(null);
    setTranscript(null);
    setStage('transcribing');
    setStageMsg('Transcrevendo com AssemblyAI (pode levar 1-3 min)...');
    try {
      const fd = new FormData();
      fd.append('audio', file);
      fd.append('oldProduct', oldProduct);
      fd.append('languageCode', 'pt');
      const res = await fetch('/api/troca-produto/assemblyai', {
        method: 'POST',
        body: fd,
      });
      const json = (await readResponseJson(res)) as Partial<Transcript> & {
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || 'Falha na transcrição.');
      if (!json.matches || !json.words) {
        throw new Error('Resposta incompleta do servidor.');
      }
      setTranscript({
        transcriptId: json.transcriptId ?? '',
        text: json.text ?? '',
        words: json.words,
        matches: json.matches,
      });
      setSelectedMatches(json.matches.map((_, i) => i));
      setStage('idle');
      setStageMsg('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao transcrever.');
      setStage('error');
    }
  }

  async function runReplace() {
    if (!file || !transcript) {
      setError('Transcreva o áudio antes de substituir.');
      return;
    }
    if (!newProduct.trim()) {
      setError('Informe o nome do produto novo.');
      return;
    }
    if (selectedMatches.length === 0) {
      setError('Selecione ao menos uma ocorrência para substituir.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `Arquivo de ${(file.size / 1024 / 1024).toFixed(1)}MB excede o limite de upload (${MAX_UPLOAD_BYTES / 1024 / 1024}MB). Comprima o audio primeiro com a ferramenta Compressor.`,
      );
      return;
    }

    setError(null);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);

    let voiceId: string | null = null;
    try {
      // 1. Clonar voz
      setStage('cloning');
      setStageMsg('Clonando voz do narrador (ElevenLabs)...');
      const cloneFd = new FormData();
      cloneFd.append('audio', file);
      cloneFd.append('name', `darko-clone-${Date.now()}`);
      const cloneRes = await fetch('/api/troca-produto/elevenlabs-clone', {
        method: 'POST',
        body: cloneFd,
      });
      const cloneJson = (await readResponseJson(cloneRes)) as {
        voiceId?: string;
        error?: string;
      };
      if (!cloneRes.ok || !cloneJson.voiceId) {
        throw new Error(cloneJson.error || 'Falha ao clonar voz.');
      }
      voiceId = cloneJson.voiceId;

      // 2. Gerar TTS pra cada match selecionado
      setStage('tts');
      const ttsBlobs: Record<number, Blob> = {};
      const picked = selectedMatches
        .map((i) => ({ idx: i, match: transcript.matches[i] }))
        .filter((x) => x.match)
        .sort((a, b) => a.match.startMs - b.match.startMs);

      for (let k = 0; k < picked.length; k++) {
        const { idx, match } = picked[k];
        setStageMsg(`Gerando TTS do produto novo (${k + 1}/${picked.length})...`);
        const context = buildContext(transcript, match);
        const ttsRes = await fetch('/api/troca-produto/elevenlabs-tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            voiceId,
            text: newProduct,
            previousText: context.previous,
            nextText: context.next,
          }),
        });
        if (!ttsRes.ok) {
          const errJson = (await readResponseJson(ttsRes)) as {
            error?: string;
          };
          throw new Error(errJson.error || `Falha no TTS #${k + 1}.`);
        }
        ttsBlobs[idx] = await ttsRes.blob();
      }

      // 3. Splicing via FFmpeg WASM
      setStage('splicing');
      setStageMsg('Remontando o áudio final (FFmpeg WASM)...');
      const finalBlob = await spliceAudio(file, picked, ttsBlobs);

      const url = URL.createObjectURL(finalBlob);
      setResultUrl(url);
      setStage('done');
      setStageMsg('Pronto.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no pipeline.');
      setStage('error');
    } finally {
      // 4. Cleanup — sempre tenta deletar a voice
      if (voiceId) {
        fetch('/api/troca-produto/elevenlabs-delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voiceId }),
        }).catch(() => {});
      }
    }
  }

  function downloadResult() {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'troca-produto.mp3';
    a.click();
  }

  function toggleMatch(i: number) {
    setSelectedMatches((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort(),
    );
  }

  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'error';

  return (
    <ToolShell
      title="Troca de Produto"
      description="Substitui o nome de um produto em um áudio mantendo a voz original (ElevenLabs + AssemblyAI + FFmpeg)."
    >
      <div className="grid gap-5">
        <MissingKeyBanner services={['assemblyai', 'elevenlabs']} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label-field">
              Produto antigo (como aparece na fala)
            </span>
            <input
              type="text"
              value={oldProduct}
              onChange={(e) => setOldProduct(e.target.value)}
              placeholder="Ex: Glicodin"
              className="input-field"
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="label-field">
              Produto novo
            </span>
            <input
              type="text"
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              placeholder="Ex: Glicopril"
              className="input-field"
              disabled={busy}
            />
          </label>
        </div>

        <label className="block">
          <span className="label-field">
            Áudio da VSL
          </span>
          <input
            type="file"
            accept="audio/*,video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              reset();
            }}
            className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
            disabled={busy}
          />
          {file && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span>
                {file.name} —{' '}
                <span
                  className={
                    'mono ' +
                    (file.size > MAX_UPLOAD_BYTES ? 'text-red-300' : 'text-lime')
                  }
                >
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </span>
              {file.size > MAX_UPLOAD_BYTES ? (
                <span className="text-red-300">
                  · acima do limite ({MAX_UPLOAD_BYTES / 1024 / 1024}MB).
                  Comprima primeiro com a Compressor.
                </span>
              ) : null}
            </div>
          )}
          <p className="mt-2 text-[11px] text-text-muted">
            Limite de upload: {MAX_UPLOAD_BYTES / 1024 / 1024}MB. Para arquivos
            maiores, use a ferramenta{' '}
            <span className="text-lime">Compressor</span> antes de enviar.
          </p>
        </label>

        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        )}

        {busy && (
          <div className="scan-line tech-frame rounded-xl border border-lime/40 bg-bg-soft/40 p-5">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-lime shadow-[0_0_12px_rgba(200,255,0,0.9)]" />
              </span>
              <span className="text-sm font-medium uppercase tracking-widest text-lime">
                {stage === 'transcribing'
                  ? 'AssemblyAI · transcrevendo'
                  : stage === 'cloning'
                    ? 'ElevenLabs · clonando voz'
                    : stage === 'tts'
                      ? 'ElevenLabs · gerando TTS'
                      : stage === 'splicing'
                        ? 'FFmpeg · remontando audio'
                        : 'processando'}
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              <div className="shimmer h-3 w-3/4 rounded-full bg-bg" />
              <div className="shimmer h-3 w-11/12 rounded-full bg-bg" />
              <div className="shimmer h-3 w-2/3 rounded-full bg-bg" />
            </div>
            {stageMsg && (
              <p className="mono mt-4 text-[11px] uppercase tracking-widest text-text-muted">
                {stageMsg}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runTranscribe}
            disabled={busy || !file || !oldProduct.trim()}
            className="btn-secondary"
          >
            1. Transcrever + localizar
          </button>
          <button
            type="button"
            onClick={runReplace}
            disabled={
              busy ||
              !transcript ||
              selectedMatches.length === 0 ||
              !newProduct.trim()
            }
            className="btn-primary"
          >
            2. Clonar voz e substituir
          </button>
          {resultUrl && (
            <button
              type="button"
              onClick={downloadResult}
              className="btn-secondary"
            >
              Baixar áudio final
            </button>
          )}
        </div>

        {transcript && transcript.matches.length > 0 ? (
          <CostHint
            estimate={estimateTrocaProduto({
              durationSec:
                (transcript.matches[transcript.matches.length - 1]?.endMs ??
                  60_000) / 1000,
              numReplacements: selectedMatches.length,
              productNameLength: newProduct.length || 10,
            })}
          />
        ) : null}

        {transcript && (
          <section className="fade-in-up rounded-xl border border-line bg-bg-soft/40 p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                Ocorrências encontradas ({transcript.matches.length})
              </h2>
              {transcript.matches.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedMatches(transcript.matches.map((_, i) => i))
                    }
                    className="btn-ghost text-xs"
                  >
                    Selecionar todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMatches([])}
                    className="btn-ghost text-xs"
                  >
                    Limpar
                  </button>
                </div>
              )}
            </header>
            {transcript.matches.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nenhuma ocorrência de &quot;{oldProduct}&quot; foi encontrada.
                Verifique a grafia e tente de novo.
              </p>
            ) : (
              <ul className="grid gap-2">
                {transcript.matches.map((m, i) => {
                  const context = contextSnippet(transcript.words, m);
                  return (
                    <li
                      key={i}
                      className="fade-in-up flex items-start gap-3 rounded-lg border border-line bg-black/30 p-3"
                      style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedMatches.includes(i)}
                        onChange={() => toggleMatch(i)}
                        className="mt-1 h-4 w-4 accent-lime"
                        disabled={busy}
                      />
                      <div className="flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                          <span>{formatMs(m.startMs)} → {formatMs(m.endMs)}</span>
                          <span className="opacity-60">
                            ({(m.endMs - m.startMs) / 1000}s)
                          </span>
                        </div>
                        <p className="text-sm text-white">{context}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {resultUrl && (
          <section className="fade-in-up rounded-xl border border-lime/40 bg-bg-soft/40 p-4 shadow-[0_0_28px_-12px_rgba(200,255,0,0.5)]">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-lime">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
              </span>
              Resultado pronto
            </h2>
            <audio src={resultUrl} controls className="w-full" />
          </section>
        )}
      </div>
    </ToolShell>
  );
}

/* ---------------------------------- helpers ---------------------------------- */

function formatMs(ms: number): string {
  const totalS = ms / 1000;
  const m = Math.floor(totalS / 60);
  const s = Math.floor(totalS % 60);
  const cs = Math.floor((totalS * 100) % 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function contextSnippet(words: Word[], match: Match): string {
  const start = Math.max(0, match.wordIndices[0] - 6);
  const end = Math.min(
    words.length,
    match.wordIndices[match.wordIndices.length - 1] + 7,
  );
  const before = words
    .slice(start, match.wordIndices[0])
    .map((w) => w.text)
    .join(' ');
  const hit = words
    .slice(
      match.wordIndices[0],
      match.wordIndices[match.wordIndices.length - 1] + 1,
    )
    .map((w) => w.text)
    .join(' ');
  const after = words
    .slice(match.wordIndices[match.wordIndices.length - 1] + 1, end)
    .map((w) => w.text)
    .join(' ');
  return `...${before} [${hit}] ${after}...`;
}

function buildContext(t: Transcript, match: Match) {
  const prev = t.words
    .slice(Math.max(0, match.wordIndices[0] - 12), match.wordIndices[0])
    .map((w) => w.text)
    .join(' ');
  const next = t.words
    .slice(
      match.wordIndices[match.wordIndices.length - 1] + 1,
      Math.min(
        t.words.length,
        match.wordIndices[match.wordIndices.length - 1] + 13,
      ),
    )
    .map((w) => w.text)
    .join(' ');
  return { previous: prev || undefined, next: next || undefined };
}

/**
 * Usa FFmpeg WASM pra:
 *  - escrever o audio original + cada TTS gerado
 *  - cortar segmentos do original (entre/fora dos matches)
 *  - time-stretch cada TTS com atempo pra caber na duracao original do slot
 *  - concatenar todos em um MP3 final
 *
 * Estrategia de time-stretch:
 *   ratio = ttsDuration / slotDuration   (atempo acelera >1, desacelera <1)
 *   atempo suporta 0.5 - 100.0; pra ratios fora, encadeamos varios atempos.
 */
async function spliceAudio(
  original: File,
  picked: Array<{ idx: number; match: Match }>,
  ttsBlobs: Record<number, Blob>,
): Promise<Blob> {
  const ff = await getFFmpeg();

  // ordena e dedup
  const matches = [...picked].sort((a, b) => a.match.startMs - b.match.startMs);

  // escreve arquivos no FS do ffmpeg
  await ff.writeFile('in.src', await fetchFile(original));
  for (const p of matches) {
    const blob = ttsBlobs[p.idx];
    if (!blob) throw new Error(`TTS ausente pro match #${p.idx}`);
    const data = new Uint8Array(await blob.arrayBuffer());
    await ff.writeFile(`tts_${p.idx}.mp3`, data);
  }

  // Sondagem da duracao total do original (via ffprobe-like: rodamos um 'null'
  // e parseamos o log). Simplificamos: pegamos do match final pra nao parsear.
  // Mas precisamos do tamanho total pra pegar o ultimo "tail" do audio ->
  // vamos simplesmente cortar com -ss X sem -to, que vai ate o fim.
  //
  // Para cada segmento do original, cortamos usando -ss + -t em segundos.

  // Gera TTS ajustados (time-stretched) — um arquivo por match.
  // Pra isso precisamos saber a duracao do TTS. Rodamos o ffmpeg com "-af volume=0.5"
  // e lemos o log pra extrair a duracao. Mais simples: decodificamos o mp3 pra wav
  // e medimos pelo tamanho do buffer wav.
  async function measureDurationMs(ffFile: string): Promise<number> {
    const out = `probe_${ffFile}.wav`;
    await ff.exec([
      '-y',
      '-i',
      ffFile,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-f',
      'wav',
      out,
    ]);
    const raw = (await ff.readFile(out)) as Uint8Array;
    await ff.deleteFile(out);
    const bytes = raw.byteLength - 44;
    const samples = bytes / 2;
    return (samples / 44100) * 1000;
  }

  const stretchedTtsFiles: Record<number, string> = {};
  for (const p of matches) {
    const ttsFile = `tts_${p.idx}.mp3`;
    const ttsDurMs = await measureDurationMs(ttsFile);
    const slotMs = p.match.endMs - p.match.startMs;
    const ratio = Math.max(0.5, Math.min(2.0, ttsDurMs / slotMs));
    const outFile = `stretched_${p.idx}.wav`;
    const filter = ratioToAtempoChain(ratio);
    await ff.exec([
      '-y',
      '-i',
      ttsFile,
      '-af',
      filter,
      '-ac',
      '1',
      '-ar',
      '44100',
      '-f',
      'wav',
      outFile,
    ]);
    stretchedTtsFiles[p.idx] = outFile;
  }

  // Agora corta o original em segmentos: antes do match 0, entre matches, apos ultimo match.
  // Cada segmento cortado vira wav mono 44.1kHz pra bater com os TTS.
  const pieces: string[] = [];
  let cursorMs = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i].match;
    if (m.startMs > cursorMs) {
      const segFile = `orig_${i}.wav`;
      const startS = cursorMs / 1000;
      const durS = (m.startMs - cursorMs) / 1000;
      await ff.exec([
        '-y',
        '-ss',
        startS.toFixed(3),
        '-t',
        durS.toFixed(3),
        '-i',
        'in.src',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-f',
        'wav',
        segFile,
      ]);
      pieces.push(segFile);
    }
    pieces.push(stretchedTtsFiles[matches[i].idx]);
    cursorMs = m.endMs;
  }
  // tail — do ultimo match ate o fim do audio
  const tailFile = 'orig_tail.wav';
  await ff.exec([
    '-y',
    '-ss',
    (cursorMs / 1000).toFixed(3),
    '-i',
    'in.src',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-f',
    'wav',
    tailFile,
  ]);
  pieces.push(tailFile);

  // concat via concat demuxer
  const listTxt = pieces.map((p) => `file '${p}'`).join('\n');
  await ff.writeFile('list.txt', new TextEncoder().encode(listTxt));
  await ff.exec([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'list.txt',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    'final.mp3',
  ]);
  const out = (await ff.readFile('final.mp3')) as Uint8Array;
  const buf = new Uint8Array(out.byteLength);
  buf.set(out);
  return new Blob([buf.buffer], { type: 'audio/mpeg' });
}

/**
 * atempo so suporta 0.5–2.0. Pra ratios fora disso encadeamos multiplos.
 * Aqui ja clampamos entre 0.5 e 2.0 no caller, entao um atempo basta.
 */
function ratioToAtempoChain(ratio: number): string {
  if (ratio >= 0.5 && ratio <= 2.0) return `atempo=${ratio.toFixed(4)}`;
  // Fallback defensivo
  const parts: string[] = [];
  let r = ratio;
  while (r > 2.0) {
    parts.push('atempo=2.0');
    r /= 2.0;
  }
  while (r < 0.5) {
    parts.push('atempo=0.5');
    r /= 0.5;
  }
  parts.push(`atempo=${r.toFixed(4)}`);
  return parts.join(',');
}
