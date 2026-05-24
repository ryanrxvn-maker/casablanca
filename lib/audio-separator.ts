/**
 * Separador de Áudio — separa voz / instrumental / SFX usando modelo de
 * separação de fontes (Demucs ou MDX-Net) hospedado em Hugging Face Space.
 *
 * Arquivo compartilhado client/server: só constantes e tipos puros.
 *
 * A Space é configurável via env `AUDIO_SEPARATOR_SPACE` no servidor —
 * default é uma Space pública conhecida do Demucs. Se a Space cair, basta
 * apontar pra outra alternativa (mesmo formato de input/output).
 */

export type SeparatorStem = 'vocals' | 'instrumental' | 'sfx';

export type SeparatorJob = {
  /** ID único do job (timestamp + random) */
  id: string;
  /** Arquivo de origem */
  file: File;
  state: 'queued' | 'uploading' | 'processing' | 'downloading' | 'done' | 'error';
  /** Progresso 0-100 */
  progress: number;
  /** Mensagem de estágio humano */
  stage: string | null;
  /** Stems separados — URLs blob locais pros players */
  stems: Partial<Record<SeparatorStem, { url: string; blob: Blob; size: number }>>;
  error: string | null;
};

export const STEM_META: Record<SeparatorStem, { label: string; hue: string; description: string; icon: string }> = {
  vocals: {
    label: 'Voz',
    hue: 'rgba(167,139,250,0.5)',
    description: 'Só a voz isolada — sem música, sem efeitos.',
    icon: 'mic',
  },
  instrumental: {
    label: 'Instrumental',
    hue: 'rgba(94,234,212,0.5)',
    description: 'Tudo menos a voz — música, beat, instrumentos.',
    icon: 'music',
  },
  sfx: {
    label: 'SFX',
    hue: 'rgba(244,114,182,0.5)',
    description: 'Efeitos sonoros isolados — risadas, ambientação, foley.',
    icon: 'sparkle',
  },
};

export const STEM_ORDER: SeparatorStem[] = ['vocals', 'instrumental', 'sfx'];

/** Faz um ID curto pra job */
export function makeJobId(file: File): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${file.name.length}`;
}

/** Limite de tamanho — arquivos maiores que 200MB ficam pesados pro HF */
export const MAX_AUDIO_MB = 200;

/** Limite de duração — 25 min é o teto do Demucs sem partição manual */
export const MAX_AUDIO_MINUTES = 25;
