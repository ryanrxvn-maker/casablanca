import { Suspense } from 'react';
import { ToolsHub } from '@/components/ToolsHub';
import { BillingReturnReconcile } from '@/components/BillingReturnReconcile';

/**
 * Landing das ferramentas — Hub central com cards organizados por suite.
 * Substitui o antigo redirect. Mostra a coleçao toda com cards animados,
 * pilas de identidade visual e copy minima.
 */
export default function ToolsIndex() {
  return (
    <Suspense fallback={null}>
      <BillingReturnReconcile />
      <ToolsHub />
    </Suspense>
  );
}
