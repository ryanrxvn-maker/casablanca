'use client';

/**
 * AUTO CORTES — galeria de LEGENDA.
 *
 * É a mesma galeria das Legendas Automáticas (os 491 modelos, mesmos
 * favoritos por conta) com um card "Sem legenda" na frente. `null` = corte
 * sem legenda nenhuma.
 */

import { PresetGallery } from '@/components/typography/PresetGallery';
import { useTypoFavs } from '@/components/typography/useTypoFavs';
import { TYPO_PRESETS } from '@/lib/typography/presets';

export function CaptionPresetPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  /** id do modelo, ou null = sem legenda */
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { favs, toggleFav } = useTypoFavs();
  return (
    <PresetGallery
      presetId={value ?? ''}
      onPick={(id) => onChange(id)}
      favs={favs}
      onToggleFav={toggleFav}
      disabled={disabled}
      compact={compact}
      allowNone={{
        label: 'Sem legenda',
        selected: value == null,
        onPick: () => onChange(null),
      }}
    />
  );
}

/** Nome do modelo pra mostrar fora da galeria (resumo do passo). */
export function captionPresetLabel(id: string | null): string {
  if (!id) return 'Sem legenda';
  return TYPO_PRESETS.find((p) => p.id === id)?.name ?? id;
}
