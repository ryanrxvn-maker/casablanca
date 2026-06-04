/**
 * Separador de Áudio — separa voz / trilha / SFX usando Demucs v4 (Meta)
 * hospedado no Replicate (mesma infra do /api/voice-isolate-pro).
 *
 * Arquivo compartilhado client/server: só constantes e tipos puros.
 *
 * MODELO DE STEMS
 * ───────────────
 * O Demucs sempre devolve 4 trilhas brutas: vocals, drums, bass, other.
 * O usuário, porém, raciocina em termos de "voz / trilha sonora / SFX". A
 * gente expõe ALVOS DE SAÍDA (OutputTarget) que são receitas em cima das 4
 * trilhas brutas — montadas no CLIENT (Web Audio), então escolher mais ou
 * menos alvos NÃO gasta GPU extra: a separação é sempre uma só.
 *
 *   voz          → vocals
 *   instrumental → drums + bass + other   (a trilha sonora, sem a voz)
 *   sfx          → other                  (efeitos / ambiência / foley)
 *   bateria      → drums
 *   baixo        → bass
 */

/** As 4 trilhas que o Demucs devolve cru. */
export type RawStem = 'vocals' | 'drums' | 'bass' | 'other';
export const RAW_STEMS: RawStem[] = ['vocals', 'drums', 'bass', 'other'];

/** O que o usuário pode pedir pra ouvir/baixar. */
export type OutputTarget =
  | 'vocals'
  | 'instrumental'
  | 'sfx'
  | 'drums'
  | 'bass';

export const OUTPUT_META: Record<
  OutputTarget,
  {
    label: string;
    hue: string;
    description: string;
    /** Quais trilhas brutas somar pra montar este alvo. */
    recipe: RawStem[];
  }
> = {
  vocals: {
    label: 'Voz',
    hue: 'rgba(167,139,250,0.5)',
    description: 'Só a voz isolada — sem música, sem efeitos.',
    recipe: ['vocals'],
  },
  instrumental: {
    label: 'Trilha sonora',
    hue: 'rgba(94,234,212,0.5)',
    description: 'Música completa sem a voz — beat, instrumentos e ambiência.',
    recipe: ['drums', 'bass', 'other'],
  },
  sfx: {
    label: 'SFX / Ambiência',
    hue: 'rgba(244,114,182,0.5)',
    description: 'Efeitos, foley e instrumentos diversos (trilha "other").',
    recipe: ['other'],
  },
  drums: {
    label: 'Bateria',
    hue: 'rgba(251,191,36,0.5)',
    description: 'Só a percussão — bateria e batidas.',
    recipe: ['drums'],
  },
  bass: {
    label: 'Baixo',
    hue: 'rgba(96,165,250,0.5)',
    description: 'Só o grave — linha de baixo.',
    recipe: ['bass'],
  },
};

/** Ordem de exibição dos alvos na UI. */
export const OUTPUT_ORDER: OutputTarget[] = [
  'vocals',
  'instrumental',
  'sfx',
  'drums',
  'bass',
];

/** Seleção padrão: o caso de uso mais comum (karaokê / VA). */
export const DEFAULT_OUTPUTS: OutputTarget[] = ['vocals', 'instrumental'];

/** Limite de tamanho de UPLOAD. Sobe direto pro Supabase (sem limite Vercel). */
export const MAX_AUDIO_MB = 200;

/** Limite prático de duração — acima disso o Demucs fica lento/caro. */
export const MAX_AUDIO_MINUTES = 25;
