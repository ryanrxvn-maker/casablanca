'use client';

/**
 * TEMPLATES de legenda (hook × body) POR CONTA — os irmãos dos ⭐ Favoritos.
 *
 * Mesma receita do useTypoFavs: a verdade mora no banco
 * (`user_tool_prefs.tipografia_templates`, RLS) e o localStorage é cache
 * instantâneo + salva-vidas enquanto a migração 034 não roda / sem internet.
 *
 * Os de FÁBRICA (Template 1 e 2) vêm sempre na frente e não podem ser
 * apagados nem renomeados — o user salva os dele por cima.
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BUILTIN_TEMPLATES, type CaptionTemplate } from '@/lib/typography/caption-script';

export const TYPO_TPLS_KEY = 'tipografia:captiontpls';

function sane(x: unknown): CaptionTemplate | null {
  if (!x || typeof x !== 'object') return null;
  const t = x as Partial<CaptionTemplate>;
  if (typeof t.id !== 'string' || typeof t.name !== 'string') return null;
  if (!Array.isArray(t.segments) || t.segments.length === 0) return null;
  const segments = t.segments
    .filter((s) => s && (s.kind === 'hook' || s.kind === 'body'))
    .map((s) => ({
      kind: s.kind,
      label: typeof s.label === 'string' ? s.label : s.kind === 'hook' ? 'Hook' : 'Body',
      style: s.style && typeof s.style === 'object' ? s.style : {},
    }));
  if (segments.length === 0) return null;
  return { id: t.id, name: t.name, hint: typeof t.hint === 'string' ? t.hint : undefined, segments };
}

function parseList(raw: unknown): CaptionTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptionTemplate[] = [];
  for (const item of raw) {
    const t = sane(item);
    // id de builtin não pode ser sequestrado por um salvo
    if (t && !BUILTIN_TEMPLATES.some((b) => b.id === t.id)) out.push(t);
  }
  return out;
}

export function useCaptionTemplates(): {
  /** de fábrica + os do user, nesta ordem */
  templates: CaptionTemplate[];
  saved: CaptionTemplate[];
  saveTemplate: (t: CaptionTemplate) => void;
  removeTemplate: (id: string) => void;
} {
  const [saved, setSaved] = useState<CaptionTemplate[]>([]);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem(TYPO_TPLS_KEY);
      if (raw) setSaved(parseList(JSON.parse(raw)));
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
          .select('tipografia_templates')
          .eq('user_id', uid)
          .maybeSingle();
        if (error || cancelled || !data) return; // 034 ainda não rodou → local segura
        const server = parseList(data.tipografia_templates);
        setSaved(server);
        try {
          localStorage.setItem(TYPO_TPLS_KEY, JSON.stringify(server));
        } catch {
          /* cache é best-effort */
        }
      } catch {
        /* offline — o cache local vale */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: CaptionTemplate[]) => {
    try {
      localStorage.setItem(TYPO_TPLS_KEY, JSON.stringify(next));
    } catch {
      /* storage cheio — segue em memória */
    }
    void (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        await supabase.from('user_tool_prefs').upsert({
          user_id: uid,
          tipografia_templates: next,
          updated_at: new Date().toISOString(),
        });
      } catch {
        /* servidor indisponível — o localStorage segurou */
      }
    })();
  }, []);

  const saveTemplate = useCallback(
    (t: CaptionTemplate) => {
      setSaved((prev) => {
        const clean = sane(t);
        if (!clean || BUILTIN_TEMPLATES.some((b) => b.id === clean.id)) return prev;
        const i = prev.findIndex((x) => x.id === clean.id);
        const next = i >= 0 ? prev.map((x, j) => (j === i ? clean : x)) : [...prev, clean];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeTemplate = useCallback(
    (id: string) => {
      setSaved((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (next.length === prev.length) return prev;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { templates: [...BUILTIN_TEMPLATES, ...saved], saved, saveTemplate, removeTemplate };
}
