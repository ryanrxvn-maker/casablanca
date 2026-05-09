'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Service =
  | 'anthropic'
  | 'assemblyai'
  | 'elevenlabs'
  | 'heygen'
  | 'replicate'
  | 'groq';

const LABEL: Record<Service, string> = {
  anthropic: 'Anthropic (Claude)',
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  replicate: 'Replicate',
  groq: 'Groq (Whisper)',
};

/**
 * Banner amarelo no topo das tool pages: detecta quais chaves o user
 * NAO configurou e linka pra /configuracoes/api. Evita que o usuario
 * use a ferramenta e leve um 400 no meio do processamento.
 */
export function MissingKeyBanner({ services }: { services: Service[] }) {
  const [missing, setMissing] = useState<Service[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/secrets');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const m = services.filter((s) => !data?.[s]?.configured);
        setMissing(m);
      } catch {
        if (!cancelled) setMissing([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.join(',')]);

  if (!missing || missing.length === 0) return null;

  return (
    <div
      role="status"
      className="fade-in-up rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 shadow-[0_0_22px_-8px_rgba(250,204,21,0.45)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-yellow-300">
            ⚠ Chave{missing.length === 1 ? '' : 's'} pendente
            {missing.length === 1 ? '' : 's'}
          </div>
          <div className="mt-0.5 text-[11px] text-yellow-300/80">
            Esta ferramenta usa{' '}
            <span className="font-semibold text-white">
              {missing.map((m) => LABEL[m]).join(' + ')}
            </span>
            . Configure em Configurações → API antes de processar — sem isso
            a chamada falha no meio.
          </div>
        </div>
        <Link
          href="/configuracoes/api"
          className="btn-primary shrink-0 !py-1.5 text-xs"
        >
          Configurar →
        </Link>
      </div>
    </div>
  );
}
