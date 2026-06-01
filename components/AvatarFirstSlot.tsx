'use client';

import { useEffect, useState } from 'react';
import { runAvatarFirst, type AvatarFirstProgress, type AvatarFirstResult } from '@/lib/avatar-first';

/**
 * AvatarFirstSlot — UI pra fluxo Avatar First:
 *   - Toggle on/off
 *   - Quando on: input pra Imagem + Audio + Nome do avatar
 *   - Botao 'Criar avatar + clonar voz'
 *   - Quando completa: chama onComplete com { avatarId, voiceId, voiceName }
 *
 * Usar quando o avatar referenciado no briefing NAO existe na biblioteca
 * HeyGen. Cria avatar persistente (consome 1 slot dos 5 disponiveis).
 */
export function AvatarFirstSlot({
  slotKey,
  briefingUsername,
  enabled,
  setEnabled,
  onComplete,
  disabled,
}: {
  slotKey: string;
  briefingUsername: string;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  onComplete: (result: { avatarId: string; voiceId: string; voiceName: string; avatarName: string }) => void;
  disabled?: boolean;
}) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [avatarName, setAvatarName] = useState(briefingUsername.replace(/[._-]/g, ' ').trim());
  const [progress, setProgress] = useState<AvatarFirstProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedAvatar, setCompletedAvatar] = useState<{ avatarId: string; voiceId: string; voiceName: string } | null>(null);

  // Reset state quando toggle desativa
  useEffect(() => {
    if (!enabled) {
      setImageFile(null);
      setAudioFile(null);
      setProgress(null);
      setError(null);
      setCompletedAvatar(null);
    }
  }, [enabled]);

  // Estima duracao do audio
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  useEffect(() => {
    if (!audioFile) { setAudioDuration(null); return; }
    const url = URL.createObjectURL(audioFile);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      setAudioDuration(audio.duration);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => { setAudioDuration(null); URL.revokeObjectURL(url); };
  }, [audioFile]);

  async function startFlow() {
    if (!imageFile || !audioFile) {
      setError('Faltam image OU audio.');
      return;
    }
    setRunning(true);
    setError(null);
    setProgress({ stage: 'clone-voice', percent: 0, message: 'Iniciando...' });
    try {
      const result: AvatarFirstResult = await runAvatarFirst({
        image: imageFile,
        voiceAudio: audioFile,
        avatarName: avatarName.trim() || briefingUsername,
        voiceOptions: {
          model: 'V3',
          language: 'pt',
          trimToSeconds: 90,
          removeBackgroundNoise: true,
          removeBackgroundMusic: true,
        },
        onProgress: setProgress,
      });
      if (!result.ok) {
        setError(`Erro em ${result.stage}: ${result.error}`);
        setRunning(false);
        return;
      }
      setCompletedAvatar({ avatarId: result.avatarId, voiceId: result.voiceId, voiceName: result.voiceName });
      onComplete({
        avatarId: result.avatarId,
        voiceId: result.voiceId,
        voiceName: result.voiceName,
        avatarName: avatarName.trim() || briefingUsername,
      });
      setRunning(false);
    } catch (e: any) {
      setError(e?.message || String(e));
      setRunning(false);
    }
  }

  const canStart = !!imageFile && !!audioFile && !!avatarName.trim() && !running;

  return (
    <div className={`rounded-[12px] border p-3 transition ${enabled ? 'border-purple-500/40 bg-purple-500/5' : 'border-line-strong bg-bg/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => !disabled && setEnabled(e.target.checked)}
            disabled={disabled}
            className="accent-purple-400"
          />
          <span className="mono text-[10px] uppercase tracking-widest text-purple-300">
            🆕 Avatar First — avatar nao existe? upa imagem + audio
          </span>
        </label>
        {completedAvatar ? (
          <span className="mono rounded border border-lime/60 bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
            ✓ avatar criado
          </span>
        ) : null}
      </div>

      {enabled ? (
        <div className="mt-3 space-y-2">
          {/* Nome do avatar */}
          <div>
            <div className="mono mb-1 text-[9px] uppercase tracking-widest text-text-muted">Nome do avatar (sera salvo no HeyGen)</div>
            <input
              type="text"
              value={avatarName}
              onChange={(e) => setAvatarName(e.target.value)}
              placeholder={briefingUsername}
              className="input-field font-mono text-xs"
              disabled={running || !!completedAvatar}
            />
          </div>

          {/* Upload imagem */}
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex cursor-pointer flex-col rounded border border-dashed px-2 py-2 text-[10px] hover:border-purple-400 ${imageFile ? 'border-purple-500/60 bg-purple-500/5 text-purple-200' : 'border-line-strong text-text-muted'}`}>
              <span className="mono uppercase tracking-widest">📷 Imagem avatar</span>
              <span className="mt-0.5 truncate text-[9px]">
                {imageFile ? imageFile.name : 'click pra escolher (PNG/JPG)'}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                className="hidden"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                disabled={running || !!completedAvatar}
              />
            </label>

            <label className={`flex cursor-pointer flex-col rounded border border-dashed px-2 py-2 text-[10px] hover:border-purple-400 ${audioFile ? 'border-purple-500/60 bg-purple-500/5 text-purple-200' : 'border-line-strong text-text-muted'}`}>
              <span className="mono uppercase tracking-widest">🎤 Audio voz</span>
              <span className="mt-0.5 truncate text-[9px]">
                {audioFile ? `${audioFile.name}${audioDuration ? ' (' + audioDuration.toFixed(1) + 's)' : ''}` : 'click (MP3/WAV/M4A)'}
              </span>
              <input
                type="file"
                accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.mp4,.mov"
                className="hidden"
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                disabled={running || !!completedAvatar}
              />
            </label>
          </div>

          {/* Status / progress */}
          {progress ? (
            <div className="rounded border border-purple-500/40 bg-purple-500/10 px-2 py-1.5">
              <div className="mono text-[9px] uppercase tracking-widest text-purple-200">
                {progress.stage} · {Math.round(progress.percent)}%
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">{progress.message}</div>
              <div className="mt-1 h-1 rounded bg-bg/60 overflow-hidden">
                <div className="h-full bg-purple-400 transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
              ✗ {error}
            </div>
          ) : null}

          {completedAvatar ? (
            <div className="rounded border border-lime/40 bg-lime/10 px-2 py-1.5 text-[11px]">
              <div className="mono text-[9px] uppercase tracking-widest text-lime mb-1">✓ Avatar pronto pra usar</div>
              <div className="text-text-muted">avatar_id: <span className="mono text-white">{completedAvatar.avatarId.slice(0, 20)}...</span></div>
              <div className="text-text-muted">voice: <span className="mono text-white">{completedAvatar.voiceName}</span></div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startFlow}
              disabled={!canStart}
              className="mono w-full rounded border border-purple-500/60 bg-purple-500/20 px-3 py-2 text-[11px] uppercase tracking-widest text-purple-100 hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? '⟳ Processando...' : '▶ Criar avatar + clonar voz'}
            </button>
          )}

          <div className="mono text-[9px] uppercase tracking-widest text-text-muted">
            ⚠ BETA — consome 1 slot Photo Avatar (5 total).
          </div>
        </div>
      ) : null}
    </div>
  );
}
