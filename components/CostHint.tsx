import type { CostEstimate } from '@/lib/cost-estimator';

/**
 * Estimativa de custo DESATIVADA.
 *
 * Regra do produto: NENHUMA ferramenta deve exibir custo pro cliente.
 * Mantido como no-op (retorna null) pra não quebrar os imports/usos
 * existentes nas tool pages. Pra reativar algum dia, basta restaurar o
 * componente do histórico do git.
 */
export function CostHint(_props: { estimate: CostEstimate }) {
  return null;
}
