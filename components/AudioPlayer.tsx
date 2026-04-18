'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/utils';

/**
 * Player de áudio minimalista com play/pause, seek e timestamps.
 * Aceita um blob URL ou data URL em `src`.
 */
export function AudioPlayer({
  src,
  label,
}: {
  src: string;
  label?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrent(audio.currentTime || 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const v = parseFloat(e.target.value);
    audio.currentTime = v;
    setCurrent(v);
  }

  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-bg px-3 py-2">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime text-black transition hover:brightness-95"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {label && (
          <div className="mb-1 truncate text-xs text-text-muted">{label}</div>
        )}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={current}
          onChange={seek}
        />
      </div>

      <div className="mono shrink-0 text-xs text-text-muted">
        {formatTime(current)} / {formatTime(duration)}
      </div>
    </div>
  );
}
