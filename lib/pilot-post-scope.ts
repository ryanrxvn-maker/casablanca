import type { Insert } from './pilot-inserts';

export type ParteDaPosProducao = { label: string; text: string };

/** A versão mantém sua própria copy; só herda da mãe se não tiver nenhuma. */
export function copyDaPosProducao(fontes: Array<ReadonlyArray<ParteDaPosProducao> | null | undefined>): ParteDaPosProducao[] {
  return (fontes.find((partes) => partes?.length) || []).map((parte) => ({
    label: String(parte.label || ''),
    text: String(parte.text || ''),
  }));
}

/** Cada montado contém um hook + body, nunca todos os hooks da task.
 * Só hooks alternativos CONHECIDOS podem sair do plano: uma âncora desconhecida
 * ou um body ausente continua presente para que os gates denunciem a falha. */
export function escopoDaPosProducao(
  copy: ParteDaPosProducao[],
  inserts: Insert[],
  partLabels?: readonly string[],
): { partes: ParteDaPosProducao[]; inserts: Insert[]; labelsDesconhecidas: string[] } {
  if (!partLabels) return { partes: copy, inserts, labelsDesconhecidas: [] };
  const selecionadas = new Set(partLabels);
  const hooksAlternativos = new Set(copy
    .filter((parte) => /^(HOOK|GANCHO)/.test(parte.label.toUpperCase()) && !selecionadas.has(parte.label))
    .map((parte) => parte.label));
  const partes = partLabels.flatMap((label) => copy.filter((parte) => parte.label === label));
  return {
    partes,
    inserts: inserts.filter((insert) => !hooksAlternativos.has(insert.ancora)),
    labelsDesconhecidas: partLabels.filter((label) => !copy.some((parte) => parte.label === label)),
  };
}
