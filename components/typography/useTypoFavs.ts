'use client';

/**
 * ⭐ Favoritos de modelos de lettering, POR CONTA.
 *
 * A verdade mora no banco (`user_tool_prefs.tipografia_favs`, RLS);
 * o localStorage é cache instantâneo + fallback enquanto a migração 031 não
 * roda / sem internet. Extraído de app/tools/tipografia/page.tsx (22.08.2026)
 * pra que a Tipografia e o Auto Cortes compartilhem A MESMA lista — favoritar
 * numa ferramenta aparece na outra.
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export const TYPO_FAVS_KEY = 'tipografia:favs';

export function useTypoFavs(): { favs: string[]; toggleFav: (id: string) => void } {
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem(TYPO_FAVS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setFavs(arr.filter((x) => typeof x === 'string'));
      }
    } catch {
      /* sem cache local */
    }
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid || cancelled) return;
        const { data, error } = await supabase
          .from('user_tool_prefs')
          .select('tipografia_favs')
          .eq('user_id', uid)
          .maybeSingle();
        if (error || cancelled) return; // tabela ainda não migrada → local segura
        if (data && Array.isArray(data.tipografia_favs)) {
          const server = (data.tipografia_favs as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          );
          setFavs(server);
          try {
            localStorage.setItem(TYPO_FAVS_KEY, JSON.stringify(server));
          } catch {
            /* cache local é best-effort */
          }
        }
      } catch {
        /* offline — o cache local vale */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(TYPO_FAVS_KEY, JSON.stringify(next));
      } catch {
        /* storage cheio — segue só em memória */
      }
      void (async () => {
        try {
          const supabase = createClient();
          const { data: u } = await supabase.auth.getUser();
          const uid = u.user?.id;
          if (!uid) return;
          await supabase.from('user_tool_prefs').upsert({
            user_id: uid,
            tipografia_favs: next,
            updated_at: new Date().toISOString(),
          });
        } catch {
          /* servidor indisponível — localStorage segurou */
        }
      })();
      return next;
    });
  }, []);

  return { favs, toggleFav };
}
