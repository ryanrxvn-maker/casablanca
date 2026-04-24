'use client';

import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useToolState } from '@/components/ToolsStateProvider';
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
      setStatus('Decodificando audio...');
      const decoded = await decodeAudioRobust(file, (s) => setStatus(s));

      setStatus('Detectando pausas e dividindo...');
      const buffers = splitByParagraphs(decoded);

      setStatus('Gerando ' + buffers.length + ' arquivo(s)...');
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
      title="Audio Split"
      description="Divide seu audio em partes por paragrafos detectando pausas naturais."
    >
      <div className="flex flex-col gap-6">
        <div>
          <label className="label-field">Arquivo de audio / video</label>
          <FileUpload
            accept="audio/*,video/mp4,video/webm,video/ogg"
            value={file}
            onChange={(f) => {
              reset();
              setFile(f);
            }}
            hint="MP3, WAV, MP4, WEBM ou OGG"
          />
        </div>

        <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-xs text-text-muted">
          A divisao procura as pausas mais longas do audio e quebra em partes
          equilibradas (em media 4 partes por minuto de fala). Para remover
          silencios use a ferramenta <span className="text-lime">Decupagem</span>.
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={process}
            className="btn-primary"
            disabled={!file || processing}
          >
            {processing ? 'Processando...' : 'Processar'}
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
          <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-xs text-text-muted">
            {status}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {parts.length > 0 ? (
          <div className="mt-2 border-t border-line pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
                Resultado ({parts.length} parte{parts.length > 1 ? 's' : ''})
              </h3>
              {parts.length > 1 ? (
                <button onClick={downloadZip} className="btn-primary !py-2 text-xs">
                  Baixar ZIP
                </button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-3">
              {parts.map((p) => (
                <li key={p.index} className="flex flex-col gap-2">
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
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
