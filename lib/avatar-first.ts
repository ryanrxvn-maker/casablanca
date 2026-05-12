/**
 * Avatar First — orquestracao do fluxo quando user upa imagem + audio
 * pra avatar que nao existe na biblioteca HeyGen.
 *
 * Fluxo (especificado pelo user 12/05/2026):
 *   1. Clona voz do audio enviado (HeyGen voice clone — existing flow)
 *   2. Cria Photo Avatar persistente no HeyGen via imagem (NEW endpoint)
 *   3. Retorna { avatarId, voiceId } prontos pra usar nos dispatches
 *      dos takes restantes (Script-to-Video normal).
 *
 * Custos:
 *   - Clone voice: 0 creditos
 *   - Photo Avatar create: consome 1 slot (user tem 5)
 *   - Cada video subsequente: motor III=0, IV=1, V=3
 *
 * IMPORTANTE: Photo Avatar create endpoint ainda nao 100% verificado live.
 * Tentamos 4 endpoints em cascata. Se falhar, mostra erro detalhado.
 */

import { cloneVoiceViaExtension, createPhotoAvatarViaExtension } from './heygen-extension-bridge';

export type AvatarFirstInput = {
  image: File;
  voiceAudio: File;
  avatarName: string;
  voiceOptions?: {
    model?: 'V3' | 'V2' | 'multilingual';
    language?: 'pt' | 'en' | 'es' | null;
    trimToSeconds?: number;
    removeBackgroundNoise?: boolean;
    removeBackgroundMusic?: boolean;
  };
  onProgress?: (msg: AvatarFirstProgress) => void;
};

export type AvatarFirstProgress = {
  stage: 'clone-voice' | 'create-avatar' | 'done' | 'error';
  percent: number;
  message: string;
};

export type AvatarFirstResult =
  | { ok: true; avatarId: string; voiceId: string; voiceName: string; groupId?: string; lookId?: string }
  | { ok: false; stage: string; error: string };

export async function runAvatarFirst(input: AvatarFirstInput): Promise<AvatarFirstResult> {
  const progress = input.onProgress ?? (() => {});

  // ============= 1. CLONE VOICE =============
  progress({ stage: 'clone-voice', percent: 5, message: 'Clonando voz do audio enviado...' });
  const voiceRes = await cloneVoiceViaExtension(input.voiceAudio, {
    displayName: input.avatarName + ' (voice)',
    model: input.voiceOptions?.model || 'V3',
    language: input.voiceOptions?.language ?? null,
    trimToSeconds: input.voiceOptions?.trimToSeconds ?? 90,
    removeBackgroundNoise: input.voiceOptions?.removeBackgroundNoise ?? true,
    removeBackgroundMusic: input.voiceOptions?.removeBackgroundMusic ?? true,
    onProgress: (stage, percent, message) => {
      progress({
        stage: 'clone-voice',
        percent: 5 + Math.min(40, (percent || 0) * 0.4),
        message: 'Clone voice: ' + (message || stage),
      });
    },
  });
  if (!voiceRes.ok) {
    return { ok: false, stage: 'clone-voice', error: voiceRes.error };
  }
  progress({ stage: 'clone-voice', percent: 45, message: `Voice clonada: ${voiceRes.voiceName}` });

  // ============= 2. CREATE PHOTO AVATAR =============
  progress({ stage: 'create-avatar', percent: 50, message: 'Criando Photo Avatar (pode demorar 1-3 min)...' });
  const avRes = await createPhotoAvatarViaExtension({
    image: input.image,
    avatarName: input.avatarName,
    onProgress: (stage, percent, message) => {
      progress({
        stage: 'create-avatar',
        percent: 50 + Math.min(45, (percent || 0) * 0.45),
        message: 'Avatar: ' + (message || stage),
      });
    },
  });
  if (!avRes.ok) {
    return { ok: false, stage: 'create-avatar', error: avRes.error };
  }

  progress({ stage: 'done', percent: 100, message: `Pronto: avatar ${avRes.avatarId} + voice ${voiceRes.voiceId}` });
  return {
    ok: true,
    avatarId: avRes.avatarId,
    groupId: avRes.groupId,
    lookId: avRes.lookId,
    voiceId: voiceRes.voiceId,
    voiceName: voiceRes.voiceName,
  };
}
