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

/**
 * Um requisito da ferramenta. Um Service sozinho = obrigatorio. Um ARRAY =
 * "qualquer uma destas serve" (ha fallback no servidor) — so' vira pendencia
 * quando NENHUMA das opcoes esta configurada.
 */
type Requirement = Service | Service[];

// Rótulos por CAPACIDADE (nunca o fornecedor) — o cliente vê "Transcrição",
// não "AssemblyAI". Exceção: HeyGen, que pode ser citado.
const LABEL: Record<Service, string> = {
  anthropic: 'IA de texto',
  assemblyai: 'Transcrição',
  elevenlabs: 'Clonagem de voz',
  heygen: 'HeyGen',
  replicate: 'Geração de vídeo',
  groq: 'Transcrição',
};

// Nome do CARD em /configuracoes/api. A capacidade diz PRA QUE serve; o card
// diz ONDE colar — sem isso o cliente lê "Transcrição" e não sabe qual dos
// campos da tela preencher (foi exatamente o que aconteceu no beta).
const CARD: Record<Service, string> = {
  anthropic: 'Anthropic',
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  replicate: 'Replicate',
  groq: 'Groq',
};

/** "AssemblyAI ou Groq" / "AssemblyAI" */
function cardsOf(req: Service[]): string {
  const names = req.map((s) => CARD[s]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`;
}

/**
 * Banner amarelo no topo das tool pages: detecta quais chaves o user
 * NAO configurou e linka pra /configuracoes/api. Evita que o usuario
 * use a ferramenta e leve um 400 no meio do processamento.
 *
 * Ferramenta com FALLBACK declara o grupo: services={[['groq','assemblyai']]}.
 * Assim quem tem SO' a AssemblyAI (que funciona) nao leva mais alarme falso.
 */
export function MissingKeyBanner({ services }: { services: Requirement[] }) {
  const [missing, setMissing] = useState<Service[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/secrets');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const groups = services.map((s) => (Array.isArray(s) ? s : [s]));
        // Grupo pendente = NENHUMA das alternativas configurada.
        const m = groups.filter((g) => g.every((s) => !data?.[s]?.configured));
        setMissing(m);
      } catch {
        if (!cancelled) setMissing([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(services)]);

  if (!missing || missing.length === 0) return null;

  const plural = missing.length > 1;
  // Uma linha por capacidade faltando, ja' dizendo o card exato.
  const linhas = missing.map((g) => ({
    capacidade: LABEL[g[0]],
    cards: cardsOf(g),
    alternativa: g.length > 1,
  }));

  return (
    <div
      role="status"
      className="fade-in-up rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 shadow-[0_0_22px_-8px_rgba(250,204,21,0.45)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-yellow-300">
            {plural ? '⚠ Chaves pendentes' : '⚠ Chave pendente'}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-yellow-300/80">
            {plural
              ? 'Esta ferramenta ainda não tem as chaves de:'
              : 'Esta ferramenta ainda não tem a chave de:'}
            <ul className="mt-1 flex flex-col gap-0.5">
              {linhas.map((l) => (
                <li key={l.cards}>
                  <span className="font-semibold text-white">{l.capacidade}</span>
                  {' — cole em '}
                  <span className="font-semibold text-white">{l.cards}</span>
                  {l.alternativa
                    ? ', em Configurações → API. Basta UMA das duas.'
                    : ', em Configurações → API.'}
                </li>
              ))}
            </ul>
            <span className="mt-1 block">
              Sem isso a chamada falha no meio do processamento.
            </span>
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
