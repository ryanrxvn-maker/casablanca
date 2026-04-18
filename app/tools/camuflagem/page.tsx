'use client';

import { useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { AudioPlayer } from '@/components/AudioPlayer';
import { camuflar } from '@/lib/camuflagem';
import { downloadBlob } from '@/lib/audio-engine';
import { buildZip } from '@/lib/zip-builder';

type Pair = {
  id: string;
  black: File | null;
  white: File | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  errorMsg?: string;
  resultBlob?: Blob;
  resultUrl?: string;
};

function newPair(): Pair {
  return { id: crypto.randomUUID(), black: null, white: null, status: 'idle' };
}

export default function CamuflagemPage() {
  const [pairs, setPairs] = useState<Pair[]>([newPair()]);
  const [volume, setVolume] = useState(30);
  const [processingAll, setProcessingAll] = useState(false);

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
        updatePair(pair.id, { status: 'processing', errorMsg: undefined });
        const blob = await camuflar({
          black: pair.black!,
          white: pair.white!,
          volumePercent: volume,
        });
        const url = URL.createObjectURL(blob);
        updatePair(pair.id, { status: 'done', resultBlob: blob, resultUrl: url });
      } catch (e) {
        console.error(e);
        updatePair(pair.id, {
          status: 'error',
          errorMsg: (e as Error).message ?? 'Falha',
        });
      }
    }
    setProcessingAll(false);
  }

  async function downloadOne(pair: Pair) {
    if (!pair.resultBlob) return;
    const base = (pair.black?.name ?? 'pair').replace(/\.[^.]+$/, '');
    await downloadBlob(pair.resultBlob, base + '_camuflado.wav');
  }

  async function downloadAllZip() {
    const done = pairs.filter((p) => p.resultBlob);
    if (done.length === 0) return;
    const zip = await buildZip(
      done.map((p, i) => ({
        name:
          (p.black?.name ?? 'par-' + (i + 1)).replace(/\.[^.]+$/, '') +
          '_camuflado.wav',
        data: p.resultBlob!,
      })),
    );
    await downloadBlob(zip, 'camuflagem.zip');
  }

  const doneCount = pairs.filter((p) => p.status === 'done').length;

  return (
    <ToolShell
      title="Camuflagem"
      description="Tecnica estereo de inversao de fase: a IA escuta o audio WHITE, o publico escuta o BLACK."
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
          />
          <p className="mt-2 text-xs text-text-muted">
            Ganho aplicado: {((volume / 100) * 0.05).toFixed(4)}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {pairs.map((pair, i) => (
            <div key={pair.id} className="rounded-[12px] border border-line bg-bg p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                  Par {i + 1}
                  {pair.status === 'processing' ? (
                    <span className="ml-2 text-lime">processando...</span>
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
                  >
                    Remover
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label-field">BLACK (publico)</label>
                  <FileUpload
                    accept="audio/*,video/mp4"
                    value={pair.black}
                    onChange={(f) => updatePair(pair.id, { black: f, status: 'idle' })}
                  />
                </div>
                <div>
                  <label className="label-field">WHITE (IA)</label>
                  <FileUpload
                    accept="audio/*,video/mp4"
                    value={pair.white}
                    onChange={(f) => updatePair(pair.id, { white: f, status: 'idle' })}
                  />
                </div>
              </div>

              {pair.errorMsg ? (
                <div className="mt-3 rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {pair.errorMsg}
                </div>
              ) : null}

              {pair.status === 'done' && pair.resultUrl ? (
                <div className="mt-3 flex flex-col gap-2">
                  <AudioPlayer src={pair.resultUrl} label="Resultado camuflado" />
                  <div className="flex justify-end">
                    <button
                      onClick={() => downloadOne(pair)}
                      className="btn-ghost !py-1 text-xs"
                    >
                      Baixar WAV
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
          <button
            onClick={processAll}
            className="btn-primary"
            disabled={processingAll || !pairs.some((p) => p.black && p.white)}
          >
            {processingAll ? 'Processando...' : 'Processar tudo'}
          </button>
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
