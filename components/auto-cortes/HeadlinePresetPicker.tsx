'use client';

/**
 * AUTO CORTES — galeria de HEADLINE (o "Texto" do Opus Clip).
 *
 * Mesma galeria, filtrada pela lista curada de `headlinePresets()` e com o
 * texto de demonstração da headline — os cards mostram exatamente o que vai
 * ser queimado no alto do corte, não "SUA LEGENDA AQUI".
 */

import { useMemo } from 'react';
import { PresetGallery } from '@/components/typography/PresetGallery';
import { useTypoFavs } from '@/components/typography/useTypoFavs';
import { HEADLINE_DEMO_TEXT, headlinePresets } from '@/lib/auto-cortes/headline';

export function HeadlinePresetPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  /** id do modelo, ou null = sem headline */
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { favs, toggleFav } = useTypoFavs();
  const presets = useMemo(() => headlinePresets(), []);
  return (
    <PresetGallery
      presetId={value ?? ''}
      onPick={(id) => onChange(id)}
      favs={favs}
      onToggleFav={toggleFav}
      disabled={disabled}
      compact={compact}
      presets={presets}
      demoText={HEADLINE_DEMO_TEXT}
      allowNone={{
        label: 'Sem headline',
        selected: value == null,
        onPick: () => onChange(null),
      }}
    />
  );
}

/** Nome do modelo pra mostrar fora da galeria (resumo do passo). */
export function headlinePresetLabel(id: string | null): string {
  if (!id) return 'Sem headline';
  return headlinePresets().find((p) => p.id === id)?.name ?? id;
}
