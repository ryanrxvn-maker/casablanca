'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { detectAudioLanguage } from '@/lib/heygen-extension-bridge';

/**
 * Trigger compacto pra clone de voz:
 *  - Botao "Clonar voz nova" abre dropdown ancorado
 *  - Dropdown deixa o user escolher modelo (V3/V2/Multilingual) +
 *    lingua + trim time + flags de denoise/remove music
 *  - Quando user seleciona file (audio ou video), dispara onSubmit
 *    com as opcoes escolhidas
 *
 * Persiste as escolhas em localStorage (proximas vezes ja vem pre-fill).
 */

export type CloneOptionsPicked = {
  file: File;
  model: 'V3' | 'V2' | 'multilingual';
  language: 'pt' | 'en' | 'es' | 'auto';
  trimToSeconds: number;
  removeBackgroundNoise: boolean;
  removeBackgroundMusic: boolean;
};

const PREFS_KEY = 'darkolab:voice-clone:prefs';

function loadPrefs(): Omit<CloneOptionsPicked, 'file'> {
  if (typeof window === 'undefined') {
    return { model: 'V3', language: 'pt', trimToSeconds: 90, removeBackgroundNoise: true, removeBackgroundMusic: true };
  }
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) throw 0;
    const j = JSON.parse(raw);
    return {
      model: j.model || 'V3',
      language: j.language || 'pt',
      trimToSeconds: typeof j.trimToSeconds === 'number' ? j.trimToSeconds : 90,
      removeBackgroundNoise: j.removeBackgroundNoise !== false,
      removeBackgroundMusic: j.removeBackgroundMusic !== false,
    };
  } catch {
    return { model: 'V3', language: 'pt', trimToSeconds: 90, removeBackgroundNoise: true, removeBackgroundMusic: true };
  }
}

function savePrefs(p: Omit<CloneOptionsPicked, 'file'>) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

export function VoiceCloneTrigger({
  onSubmit,
  disabled,
}: {
  onSubmit: (opts: CloneOptionsPicked) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<CloneOptionsPicked['model']>('V3');
  const [language, setLanguage] = useState<CloneOptionsPicked['language']>('pt');
  const [trimToSeconds, setTrimToSeconds] = useState<number>(90);
  const [removeBackgroundNoise, setRemoveBgNoise] = useState(true);
  const [removeBackgroundMusic, setRemoveBgMusic] = useState(true);
  const [langWarning, setLangWarning] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = loadPrefs();
    setModel(p.model);
    setLanguage(p.language);
    setTrimToSeconds(p.trimToSeconds);
    setRemoveBgNoise(p.removeBackgroundNoise);
    setRemoveBgMusic(p.removeBackgroundMusic);
  }, []);

  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const W = Math.min(380, vw - 24);
    const H_EST = 460;
    const SPACING = 8;
    const spaceBelow = vh - r.bottom - SPACING;
    const spaceAbove = r.top - SPACING;
    let top: number;
    if (spaceBelow >= 320 || spaceBelow >= spaceAbove) {
      top = r.bottom + SPACING;
    } else {
      const h = Math.min(H_EST, spaceAbove);
      top = r.top - h - SPACING;
    }
    if (top < 12) top = 12;
    let left = r.left + r.width / 2 - W / 2;
    if (left + W > vw - 12) left = vw - W - 12;
    if (left < 12) left = 12;
    setPos({ top, left, width: W });
  };

  useLayoutEffect(() => { if (open) computePos(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => computePos();
    const onResize = () => computePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDoc); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function pickFile() {
    fileRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setLangWarning(null);
    // Heuristic detection — so warning, nao bloqueia
    try {
      const detected = await detectAudioLanguage(f);
      if (detected.lang === 'en' && language === 'pt') {
        setLangWarning(`⚠ filename sugere ingles — voce escolheu PT. Confira.`);
      }
    } catch {}
    const prefs = { model, language, trimToSeconds, removeBackgroundNoise, removeBackgroundMusic };
    savePrefs(prefs);
    onSubmit({ file: f, ...prefs });
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={
          'label-tech inline-flex items-center gap-1 self-start rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50 ' +
          (open ? 'border-fuchsia-300 bg-fuchsia-500/20' : '')
        }
        title="Clona uma voz nova no HeyGen a partir de audio/video"
      >
        🎤 Clonar voz nova
      </button>

      {open && pos ? (
        <div
          ref={popRef}
          className="fixed z-[60] overflow-hidden rounded-[14px] border border-fuchsia-500/40 bg-bg shadow-[0_12px_40px_-6px_rgba(0,0,0,0.6),0_0_28px_-12px_rgba(217,70,239,0.4)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="flex items-center justify-between border-b border-line/40 bg-bg-soft/40 px-3 py-2">
            <h3 className="label-tech text-[10px] uppercase tracking-widest text-fuchsia-200">Opcoes do clone</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted hover:border-fuchsia-400/60 hover:text-fuchsia-300"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3 p-3">
            {/* Modelo */}
            <div>
              <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Modelo</div>
              <div className="grid grid-cols-3 gap-1">
                {(['V3', 'V2', 'multilingual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={
                      'mono rounded border px-2 py-1 text-[10px] uppercase tracking-widest transition ' +
                      (model === m
                        ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100'
                        : 'border-line-strong bg-bg-soft/30 text-text-muted hover:border-fuchsia-500/60')
                    }
                  >
                    {m === 'multilingual' ? 'Multi' : m}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-text-muted">
                {model === 'V3' && 'V3 — melhor qualidade PT/EN (default)'}
                {model === 'V2' && 'V2 — legacy, menor custo'}
                {model === 'multilingual' && 'Multilingual — 50+ idiomas'}
              </div>
            </div>

            {/* Lingua */}
            <div>
              <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Lingua do audio</div>
              <div className="grid grid-cols-4 gap-1">
                {(['pt', 'en', 'es', 'auto'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLanguage(l)}
                    className={
                      'mono rounded border px-2 py-1 text-[10px] uppercase tracking-widest transition ' +
                      (language === l
                        ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100'
                        : 'border-line-strong bg-bg-soft/30 text-text-muted hover:border-fuchsia-500/60')
                    }
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Trim */}
            <div>
              <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                Cortar audio em {trimToSeconds}s (mais rapido)
              </div>
              <input
                type="range"
                min={30}
                max={180}
                step={15}
                value={trimToSeconds}
                onChange={(e) => setTrimToSeconds(Number(e.target.value))}
                className="w-full accent-fuchsia-400"
              />
              <div className="flex justify-between text-[9px] text-text-muted mono">
                <span>30s</span><span>90s</span><span>180s</span>
              </div>
            </div>

            {/* Flags */}
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-[11px] text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeBackgroundMusic}
                  onChange={(e) => setRemoveBgMusic(e.target.checked)}
                  className="accent-fuchsia-400"
                />
                Remover trilha sonora (musica de fundo)
              </label>
              <label className="flex items-center gap-2 text-[11px] text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeBackgroundNoise}
                  onChange={(e) => setRemoveBgNoise(e.target.checked)}
                  className="accent-fuchsia-400"
                />
                Reduzir ruido de fundo
              </label>
            </div>

            {langWarning ? (
              <div className="rounded border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-[10px] text-yellow-200">
                {langWarning}
              </div>
            ) : null}

            {/* Submit */}
            <button
              type="button"
              onClick={pickFile}
              className="w-full mono rounded border border-fuchsia-500/60 bg-fuchsia-500/20 px-3 py-2 text-[11px] uppercase tracking-widest text-fuchsia-100 hover:bg-fuchsia-500/30"
            >
              Selecionar audio / video →
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.mp4,.mov,.webm"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
