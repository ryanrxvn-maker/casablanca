'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import {
  decodeAudioRobust,
  downloadBlob,
  encodeWAV,
  splitByParagraphs,
  trimSilences,
} from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';
import { formatTime } from '@/lib/utils';

type Mode = 'split-trim' | 'split-only' | 'trim-only';

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

function partFileName(base: string, index: number) {
  const n = String(index).padStart(2, '0');
  return base + '_parte-' + n + '.wav';
}

export default function AudioSplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('split-trim');
  const [keepSilence, setKeepSilence] = useState(0.05);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [parts, setParts] = useState<OutputPart[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      let toSplit = decoded;
      if (mode !== 'split-only') {
        setStatus('Removendo silencios...');
        toSplit = trimSilences(decoded, keepSilence);
      }

      let buffers: AudioBuffer[];
      if (mode === 'trim-only') {
        buffers = [toSplit];
      } else {
        setStatus('Detectando pausas e dividindo...');
        buffers = splitByParagraphs(toSplit);
      }

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
      description="Divide seu audio em partes por paragrafos e remove silencios automaticamente."
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

        <div>
          <label className="label-field">Modo</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="input-field"
          >
            <option value="split-trim">Remover silencios + Dividir</option>
            <option value="split-only">Apenas Dividir</option>
            <option value="trim-only">Apenas Remover Silencios</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label-field !mb-0">Tolerancia de silencio</label>
            <span className="mono text-xs text-lime">
              {keepSilence.toFixed(2)}s
            </span>
          </div>
          <input
            type="range"
            min={0.01}
            max={0.5}
            step={0.01}
            value={keepSilence}
            onChange={(e) => setKeepSilence(parseFloat(e.target.value))}
            className="mt-3"
          />
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
