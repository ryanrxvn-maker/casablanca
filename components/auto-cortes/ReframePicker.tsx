'use client';

/**
 * AUTO CORTES — modo de REENQUADRO.
 *
 * Só entra em jogo quando a proporção de saída é diferente da proporção da
 * fonte (um podcast 16:9 virando 9:16, o caso normal). Se a saída tiver a
 * mesma forma do original, o painel diz isso em vez de fingir escolha.
 */

import { ToolChoice } from '@/components/tool-kit';
import type { ReframeMode } from '@/lib/auto-cortes/types';
import { AC_HUE } from './ui';

export const REFRAME_OPTIONS: Array<{ value: ReframeMode; label: string; sub: string }> = [
  { value: 'auto', label: 'Automático', sub: 'a IA escolhe' },
  { value: 'seguir', label: 'Seguir rosto', sub: 'câmera acompanha' },
  { value: 'dividir', label: 'Dividir', sub: '2 pessoas' },
  { value: 'centro', label: 'Centro', sub: 'corte fixo' },
  { value: 'ajustar', label: 'Ajustar', sub: 'fundo desfocado' },
];

export function ReframePicker({
  value,
  onChange,
  disabled,
  /** true quando a proporção de saída é a mesma da fonte */
  sameAspect,
}: {
  value: ReframeMode;
  onChange: (v: ReframeMode) => void;
  disabled?: boolean;
  sameAspect?: boolean;
}) {
  return (
    <div>
      <ToolChoice<ReframeMode>
        value={value}
        onChange={onChange}
        options={REFRAME_OPTIONS}
        disabled={disabled || sameAspect}
        hue={AC_HUE}
      />
      <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
        {sameAspect
          ? 'A saída tem a mesma forma do vídeo original — não há o que reenquadrar.'
          : 'No “Automático” o corte segue quem está falando; com duas pessoas estáveis na cena ele divide a tela.'}
      </p>
    </div>
  );
}
