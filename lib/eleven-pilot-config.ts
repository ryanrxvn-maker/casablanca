/**
 * Modo ELEVEN do ClickUp Pilot — o que fica salvo no disco.
 *
 * O modo e POR WORKSPACE, pela mesma razao que os status extras sao
 * ([[clickup-pilot-config]]): o Pilot atende duas empresas com o mesmo token,
 * e o que vale numa nao pode vazar pra outra. Hoje so o DR MILLION usa voz do
 * ElevenLabs — no B2C o toggle nem aparece, e o fluxo de la continua byte a
 * byte o mesmo de antes.
 *
 * O preset de voz (modelo + ajustes) e GLOBAL de proposito: e a "assinatura
 * sonora" que o user calibra uma vez e quer repetida em todo disparo. O que
 * varia por task (qual voz, quais hooks) vive na analise, nao aqui.
 */

import type { ElevenVoiceSettings } from './elevenlabs-api-direct';
import { DEFAULT_MODEL_ID, DEFAULT_VOICE_SETTINGS } from './elevenlabs-api-direct';

const KEY_MODE = 'darkolab:pilot:eleven-mode:'; // + teamId
const KEY_PRESET = 'darkolab:pilot:eleven-preset';
const KEY_LAST_VOICE = 'darkolab:pilot:eleven-last-voice';

/* ══════════════ Empresa habilitada ══════════════ */

/** O modo Eleven so existe pro DR MILLION. Casa pelo NOME do workspace (não
 *  pelo id) — trocar de conta ou recriar o workspace continua funcionando,
 *  mesmo criterio de [[defaultExtraStatusesForTeamName]]. */
export function teamSupportsEleven(teamName: string | undefined | null): boolean {
  return /mil+i?on/i.test((teamName || '').trim());
}

/* ══════════════ Liga/desliga por workspace ══════════════ */

export function isElevenModeOn(teamId: string | null): boolean {
  if (typeof window === 'undefined' || !teamId) return false;
  return localStorage.getItem(KEY_MODE + teamId) === '1';
}

export function setElevenMode(teamId: string | null, on: boolean): void {
  if (typeof window === 'undefined' || !teamId) return;
  if (on) localStorage.setItem(KEY_MODE + teamId, '1');
  else localStorage.removeItem(KEY_MODE + teamId);
}

/**
 * Modo EFETIVO: so liga se o workspace suporta E o user ligou.
 *
 * A dupla checagem existe porque o id fica salvo: se o user liga no DR
 * MILLION e depois o Pilot abre no B2C com um id herdado, o valor salvo
 * sozinho ligaria o modo na empresa errada.
 */
export function elevenModeActive(
  teamId: string | null,
  teamName: string | undefined | null,
): boolean {
  return teamSupportsEleven(teamName) && isElevenModeOn(teamId);
}

/* ══════════════ Preset de voz ══════════════ */

export type ElevenPreset = {
  modelId: string;
  settings: ElevenVoiceSettings;
  /** ISO da lingua (ex 'pl'). null = o modelo detecta sozinho. */
  languageCode: string | null;
};

export const DEFAULT_PRESET: ElevenPreset = {
  modelId: DEFAULT_MODEL_ID,
  settings: { ...DEFAULT_VOICE_SETTINGS },
  languageCode: null,
};

/** Clampa tudo pros limites que o ElevenLabs aceita. Preset salvo por uma
 *  versao antiga (ou editado na mao no storage) nunca derruba um disparo. */
export function sanitizePreset(raw: unknown): ElevenPreset {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ElevenPreset>;
  const s = (p.settings && typeof p.settings === 'object' ? p.settings : {}) as Partial<ElevenVoiceSettings>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  return {
    modelId: typeof p.modelId === 'string' && p.modelId ? p.modelId : DEFAULT_MODEL_ID,
    settings: {
      stability: num(s.stability, DEFAULT_VOICE_SETTINGS.stability, 0, 1),
      similarity_boost: num(s.similarity_boost, DEFAULT_VOICE_SETTINGS.similarity_boost, 0, 1),
      style: num(s.style, DEFAULT_VOICE_SETTINGS.style, 0, 1),
      use_speaker_boost:
        typeof s.use_speaker_boost === 'boolean'
          ? s.use_speaker_boost
          : DEFAULT_VOICE_SETTINGS.use_speaker_boost,
      speed: num(s.speed, DEFAULT_VOICE_SETTINGS.speed, 0.7, 1.2),
    },
    languageCode:
      typeof p.languageCode === 'string' && p.languageCode.trim() ? p.languageCode.trim() : null,
  };
}

export function getElevenPreset(): ElevenPreset {
  if (typeof window === 'undefined') return { ...DEFAULT_PRESET };
  try {
    const raw = localStorage.getItem(KEY_PRESET);
    if (!raw) return { ...DEFAULT_PRESET };
    return sanitizePreset(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PRESET };
  }
}

export function setElevenPreset(p: ElevenPreset): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_PRESET, JSON.stringify(sanitizePreset(p)));
  } catch {
    /* storage cheio — segue com o preset em memoria */
  }
}

/* ══════════════ Ultima voz usada ══════════════ */

/** Lembrar a ultima voz poupa o user de procurar a mesma voz em toda task —
 *  no DR MILLION e quase sempre a mesma. */
export function getLastElevenVoice(): { id: string; name: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY_LAST_VOICE);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v?.id ? { id: String(v.id), name: String(v.name || v.id) } : null;
  } catch {
    return null;
  }
}

export function setLastElevenVoice(v: { id: string; name: string } | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!v) localStorage.removeItem(KEY_LAST_VOICE);
    else localStorage.setItem(KEY_LAST_VOICE, JSON.stringify({ id: v.id, name: v.name }));
  } catch {
    /* ignora */
  }
}

/* ══════════════ Nome dos arquivos entregues ══════════════ */

/**
 * Nome do MP3 final de um hook: `AD07G1GL.mp3`.
 *
 * O nome sai do CODIGO DA TASK do hook (AD07G1GL), nao de um "hook 1"
 * generico — e assim que o material e identificado no ClickUp e no Drive, e
 * e o que o editor espera achar na pasta.
 */
export function elevenDeliverableName(hookAdId: string): string {
  const limpo = (hookAdId || 'AUDIO').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${limpo || 'AUDIO'}.mp3`;
}

/** Nome do ZIP do disparo: `AD07-VOZ.zip` (grupo, não hook). */
export function elevenZipName(groupId: string): string {
  const limpo = (groupId || 'AD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${limpo || 'AD'}-VOZ.zip`;
}
