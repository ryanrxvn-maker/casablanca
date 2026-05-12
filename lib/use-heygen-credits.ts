'use client';

import { useEffect, useState, useCallback } from 'react';
import { getHeyGenCredits, type HeyGenCredits } from './heygen-extension-bridge';

/**
 * Hook React pra puxar saldo HeyGen com cache 30s.
 * Auto-fetch no mount + refresh manual.
 */
export function useHeyGenCredits(autoFetch = true) {
  const [credits, setCredits] = useState<HeyGenCredits | null>(null);
  const [loading, setLoading] = useState(autoFetch);

  const refresh = useCallback(async (force = true) => {
    setLoading(true);
    try {
      const c = await getHeyGenCredits({ force });
      setCredits(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoFetch) refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return { credits, loading, refresh };
}
