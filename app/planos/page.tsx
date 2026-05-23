import { Suspense } from 'react';
import { Plans } from '@/components/Plans';

/**
 * /planos — vitrine pública de planos (Free / Basic / Pro).
 * Acessível sem login, com link no header da landing e no hub.
 */
export default function PlanosPage() {
  return (
    <Suspense fallback={null}>
      <Plans />
    </Suspense>
  );
}
