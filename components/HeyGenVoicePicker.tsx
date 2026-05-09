'use client';

import { useEffect, useState } from 'react';

/**
 * HeyGenVoicePicker — busca + clone de voz HeyGen.
 *
 * Compartilhado entre HeyGen Auto Avatar e Mind Ads Suite. Inclui:
 *   - Toggle "substituir voz padrao do avatar"
 *   - Busca por nome (lang=pt)
 *   - Upload de audio pra clonar nova voz (one-shot via /api/heygen/clone-voice)
 *   - Lista de vozes ja clonadas (persistida pelo caller via setClonedVoices)
 */

export type VoiceOption = {
  id: string;
  name: string;
  gender: string | null;
  language: string | null;
  previewAudio: string | null;
};

export type ClonedVoice = { id: string; name: string };

export function HeyGenVoicePicker({
  override,
  setOverride,
  query,
  setQuery,
  selected,
  setSelected,
  clonedVoices,
  setClonedVoices,
  disabled,
}: {
  override: boolean;
  setOverride: (v: boolean) => void;
  query: string;
  setQuery: (s: string) => void;
  selected: VoiceOption | null;
  setSelected: (v: VoiceOption | null) => void;
  clonedVoices: ClonedVoice[];
  setClonedVoices: (vs: ClonedVoice[]) => void;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<VoiceOption[]>([]);
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  useEffect(() => {
    if (!override) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/heygen/voices?q=${encodeURIComponent(query.trim())}&lang=pt`,
        );
        const json = await res.json();
        if (res.ok && Array.isArray(json.voices)) {
          setResults(json.voices);
        }
      } catch {
        /* ignora */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, override]);

  async function clone() {
    if (!cloneAudioFile || !cloneName.trim()) return;
    setCloning(true);
    setCloneError(null);
    try {
      const fd = new FormData();
      fd.append('audio', cloneAudioFile);
      fd.append('name', cloneName.trim());
      const res = await fetch('/api/heygen/clone-voice', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha ao clonar voz.');
      const newVoice: ClonedVoice = { id: json.voiceId, name: json.name };
      setClonedVoices([newVoice, ...clonedVoices]);
      setSelected({
        id: newVoice.id,
        name: newVoice.name,
        gender: null,
        language: 'pt',
        previewAudio: null,
      });
      setCloneAudioFile(null);
      setCloneName('');
    } catch (e) {
      setCloneError((e as Error).message);
    } finally {
      setCloning(false);
    }
  }

  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-lime"
        />
        <div>
          <div className="text-sm font-semibold text-white">
            Substituir voz padrao do avatar
          </div>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Por padrao usa a voz vinculada ao avatar. Marca aqui pra escolher
            outra ou clonar nova.
          </p>
        </div>
      </label>

      {override ? (
        <div className="mt-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar voz HeyGen (pt-BR)..."
            className="input-field"
            disabled={disabled}
          />
          {results.length > 0 ? (
            <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
              {results.map((v) => {
                const active = selected?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelected(v)}
                    disabled={disabled}
                    className={
                      'flex items-center justify-between rounded-md border px-3 py-1.5 text-left text-xs transition-all ' +
                      (active
                        ? 'border-lime bg-lime/10 text-white'
                        : 'border-line bg-bg-soft/30 text-text-muted hover:border-lime')
                    }
                  >
                    <span>
                      {v.name}
                      {v.gender ? ' · ' + v.gender : ''}
                    </span>
                    <span className="mono text-[10px] uppercase">
                      {active ? 'OK' : v.language ?? 'pt'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {selected ? (
            <div className="mt-2 text-[11px] text-lime">
              ✓ Voz {selected.name}
            </div>
          ) : null}

          {/* Voice clone */}
          <div className="mt-4 rounded-[12px] border border-line bg-bg/60 p-3">
            <div className="mb-2 text-xs font-semibold text-white">
              OU clone uma voz nova (a partir de audio)
            </div>
            <p className="mb-3 text-[11px] text-text-muted">
              Upload de 5-30s de audio com a voz desejada. HeyGen cria um
              voice_id, salvo aqui pra reuso. One-shot — geracoes futuras
              com essa voz nao consomem API.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="Nome (ex: Maria pt-BR)"
                className="input-field !py-1.5 text-xs"
                disabled={cloning || disabled}
              />
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setCloneAudioFile(e.target.files?.[0] ?? null)}
                className="input-field !py-1.5 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-lime file:px-2 file:py-1 file:text-[10px] file:font-semibold file:text-black"
                disabled={cloning || disabled}
              />
            </div>
            <button
              type="button"
              onClick={clone}
              disabled={
                !cloneAudioFile || !cloneName.trim() || cloning || disabled
              }
              className="mt-3 w-full rounded-md border border-line-strong bg-bg-soft px-3 py-1.5 text-xs text-white transition hover:border-lime hover:text-lime disabled:opacity-50"
            >
              {cloning ? 'Clonando voz no HeyGen...' : 'Clonar voz'}
            </button>
            {cloneError ? (
              <div className="mt-2 text-[11px] text-red-300">
                {cloneError}
              </div>
            ) : null}
            {clonedVoices.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-text-muted">
                  <span>Vozes clonadas</span>
                  <button
                    type="button"
                    onClick={() => setClonedVoices([])}
                    className="text-text-muted hover:text-red-300"
                  >
                    limpar lista
                  </button>
                </div>
                <div className="grid gap-1">
                  {clonedVoices.map((v) => {
                    const active = selected?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setSelected({
                            id: v.id,
                            name: v.name,
                            gender: null,
                            language: 'pt',
                            previewAudio: null,
                          })
                        }
                        className={
                          'flex items-center justify-between rounded-md border px-2 py-1 text-left text-[11px] ' +
                          (active
                            ? 'border-lime bg-lime/10 text-white'
                            : 'border-line bg-bg text-text-muted hover:border-lime')
                        }
                      >
                        <span>🎙 {v.name}</span>
                        <span className="mono text-[9px]">
                          {active ? 'OK' : 'usar'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
