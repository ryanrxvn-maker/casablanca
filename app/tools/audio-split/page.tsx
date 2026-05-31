'use client';

import { useRef } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { CancelButton } from '@/components/CancelButton';
import { useToolState } from '@/components/ToolsStateProvider';
import { ToolStep, ToolAction, ToolResultCard } from '@/components/tool-kit';
import { IconAudioSplit, IconStepMic, IconStepScissors } from '@/components/ToolIcons';

const HUE = 'rgba(34,211,238,0.4)';
import {
  decodeAudioRobust,
  downloadBlob,
  encodeWAV,
  splitByParagraphs,
} from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import { formatTime } from '@/lib/utils';

type OutputPart = {
  index: number;
  blob: Blob;
  url: string;
  duration: number;
};

function baseName(name?: string | null) {
  if (!name) return 'audio';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.replace(/\s+/g, '_');
}

function partFileName(_base: string, index: number) {
  // Nome simples "parteN.wav" — dentro do ZIP fica parte1.wav, parte2.wav, etc.
  // O nome do ZIP (parametro externo) pode continuar usando o basename.
  return 'parte' + index + '.wav';
}

export default function AudioSplitPage() {
  // State persistente via provider — sobrevive navegacao entre ferramentas
  const [file, setFile] = useToolState<File | null>('audio-split:file', null);
  const [processing, setProcessing] = useToolState<boolean>(
    'audio-split:processing',
    false,
  );
  const [status, setStatus] = useToolState<string | null>(
    'audio-split:status',
    null,
  );
  const [parts, setParts] = useToolState<OutputPart[]>('audio-split:parts', []);
  const [error, setError] = useToolState<string | null>(
    'audio-split:error',
    null,
  );

  function reset() {
    parts.forEach((p) => URL.revokeObjectURL(p.url));
    setParts([]);
    setStatus(null);
    setError(null);
  }

  async function process() {
    if (!file) return;
    reset();
    setProcessing(true);
    try {
      setStatus('Carregando...');
      const decoded = await decodeAudioRobust(file, () => setStatus('Carregando...'));

      setStatus('Dividindo...');
      const buffers = splitByParagraphs(decoded);

      setStatus('Gerando arquivos...');
      const out: OutputPart[] = buffers.map((buf, i) => {
        const blob = encodeWAV(buf);
        return {
          index: i + 1,
          blob,
          url: URL.createObjectURL(blob),
          duration: buf.duration,
        };
      });
      setParts(out);
      setStatus(null);
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? 'Falha ao processar o arquivo.');
      setStatus(null);
    } finally {
      setProcessing(false);
    }
  }

  async function downloadPart(part: OutputPart) {
    const base = baseName(file?.name);
    await downloadBlob(part.blob, partFileName(base, part.index));
  }

  async function downloadZip() {
    if (parts.length === 0) return;
    setStatus('Montando ZIP...');
    const base = baseName(file?.name);
    const zip = await buildZip(
      parts.map((p) => ({
        name: partFileName(base, p.index),
        data: p.blob,
      })),
    );
    setStatus(null);
    await downloadBlob(zip, base + '_split.zip');
  }

  return (
    <ToolShell
      title="Dividir áudios"
      eyebrow="ÁUDIO"
      description="Quebra o áudio em pedaços pelas pausas. Sem cortar falas."
      hue={HUE}
      icon={<IconAudioSplit size={56} />}
    >
      <div className="flex flex-col gap-5">
        <ToolStep n={1} icon={<IconStepMic size={18} />} title="Áudio ou vídeo" hint="MP3, WAV, MP4, WEBM ou OGG" hue={HUE}>
          <FileUpload
            accept="audio/*,video/mp4,video/webm,video/ogg"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4, WEBM ou OGG"
          />
        </ToolStep>

        <ToolStep n={2} icon={<IconStepScissors size={18} />} title="Como divide" hint="Heurística inteligente de pausas" hue={HUE}>
          <div className="rounded-[12px] border border-line bg-bg/40 px-4 py-3 text-xs text-text-muted leading-relaxed">
            Procura as pausas mais longas e quebra em partes equilibradas
            (~4 partes por minuto de fala). Pra remover silêncios use a{' '}
            <span className="text-violet">Decupagem</span>.
          </div>
        </ToolStep>

        <ToolStep n={3} title={processing ? 'Processando…' : 'Processar'} hue={HUE}>
          <div className="flex flex-wrap gap-3">
            <ToolAction onClick={process} loading={processing} disabled={!file || processing}>
              Processar
            </ToolAction>
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
        </ToolStep>

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
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,232,124,0.9)]" />
                </span>
              ) : null}
              <span className="mono uppercase tracking-widest">{status}</span>
            </div>
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

        {parts.length > 0 ? (
          <div className="fade-in-up">
            <ToolResultCard
              title={`${parts.length} parte${parts.length > 1 ? 's' : ''}`}
              meta={parts.length > 1 ? 'Pausas detectadas' : undefined}
              hue={HUE}
            >
              {parts.length > 1 ? (
                <div className="mb-4">
                  <ToolAction onClick={downloadZip}>Baixar ZIP</ToolAction>
                </div>
              ) : null}
              <ul className="flex flex-col gap-3">
                {parts.map((p, idx) => (
                  <li
                    key={p.index}
                    className="fade-in-up flex flex-col gap-2"
                    style={{ animationDelay: `${Math.min(idx, 8) * 50}ms` }}
                  >
                    <div className="flex items-center justify-between text-xs text-text-muted">
                      <span>
                        Parte {p.index}
                        <span className="mono text-text-dim"> · {formatTime(p.duration)}</span>
                      </span>
                      <button
                        onClick={() => downloadPart(p)}
                        className="btn-ghost !py-1 !px-2 text-xs"
                      >
                        Baixar
                      </button>
                    </div>
                    <AudioPlayer src={p.url} />
                  </li>
                ))}
              </ul>
            </ToolResultCard>
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
