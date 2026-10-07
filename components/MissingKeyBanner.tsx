'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DA_CHAVE, type KeyService } from '@/lib/key-errors';

/**
 * Só os serviços que TÊM card em Configurações › Chaves de IA. Pedir uma chave
 * que o cliente não tem onde colar seria um aviso sem saída — o tipo barra.
 */
type Service = Extract<KeyService, 'assemblyai' | 'groq' | 'heygen'>;

/**
 * Um requisito da ferramenta. Um Service sozinho = obrigatorio. Um ARRAY =
 * "qualquer uma destas serve" (ha fallback no servidor) — so' vira pendencia
 * quando NENHUMA das opcoes esta configurada.
 */
type Requirement = Service | Service[];

/** O que a chave faz, quando a ferramenta não diz (`uso`). */
const USO_PADRAO: Record<Service, string> = {
  assemblyai: 'transcrever a fala do vídeo',
  groq: 'transcrever a fala do vídeo',
  heygen: 'listar seus avatares e vozes do HeyGen',
};

/** Nome curto da capacidade, pra lista quando falta mais de uma chave. */
const CAPACIDADE: Record<Service, string> = {
  assemblyai: 'Transcrição',
  groq: 'Transcrição',
  heygen: 'Avatares e vozes',
};

/** "a do Groq ou a da AssemblyAI" */
function alternativas(g: Service[]): string {
  const partes = g.map((s) => `a ${DA_CHAVE[s]}`);
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} ou ${partes[partes.length - 1]}`;
}

/**
 * Aviso de CHAVE PENDENTE no topo das ferramentas. Só aparece quando o
 * servidor CONFIRMA que a chave não está salva (falha de rede = sem aviso,
 * nunca alarme falso) e some sozinho quando o cliente volta pra aba depois
 * de colar a chave.
 *
 * Ferramenta com FALLBACK declara o grupo: services={[['groq','assemblyai']]}.
 * `uso` diz, em português, pra que a chave serve NESTA ferramenta; `semChave`
 * diz o que continua funcionando sem ela (quando a chave é só de uma etapa).
 * Nada aqui pode afirmar que a ferramenta inteira quebra se não quebra.
 */
export function MissingKeyBanner({
  services,
  uso,
  semChave,
}: {
  services: Requirement[];
  uso?: string;
  semChave?: string;
}) {
  const [missing, setMissing] = useState<Service[][] | null>(null);
  const chave = JSON.stringify(services);

  const checar = useCallback(async (sinal?: { cancelado: boolean }) => {
    try {
      const res = await fetch('/api/user/secrets', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (sinal?.cancelado) return;
      const groups = (JSON.parse(chave) as Requirement[]).map((s) => (Array.isArray(s) ? s : [s]));
      // Grupo pendente = NENHUMA das alternativas configurada.
      setMissing(groups.filter((g) => g.every((s) => !data?.[s]?.configured)));
    } catch {
      /* sem resposta confiável: não acusa nada */
    }
  }, [chave]);

  useEffect(() => {
    const sinal = { cancelado: false };
    void checar(sinal);
    // Voltou pra aba (provavelmente depois de colar a chave): confere de novo
    // e o aviso some sozinho, sem precisar recarregar.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void checar(sinal);
    };
    window.addEventListener('focus', aoVoltar);
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      sinal.cancelado = true;
      window.removeEventListener('focus', aoVoltar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [checar]);

  if (!missing || missing.length === 0) return null;

  const primeiro = missing[0];
  const destino = `/configuracoes/api#chave-${primeiro[0]}`;
  const varias = missing.length > 1;

  let titulo: string;
  let corpo: React.ReactNode;
  if (varias) {
    titulo = `Faltam ${missing.length} chaves pra usar tudo aqui`;
    corpo = (
      <ul className="mt-1.5 flex flex-col gap-1">
        {missing.map((g) => (
          <li key={g.join('|')} className="flex gap-2">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber" />
            <span>
              <span className="font-semibold text-text">{CAPACIDADE[g[0]]}:</span>{' '}
              {g.length > 1 ? `serve ${alternativas(g)} (basta uma).` : `a sua chave ${DA_CHAVE[g[0]]}.`}
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (primeiro.length > 1) {
    titulo = 'Falta uma chave de transcrição';
    corpo = (
      <>
        Pra {uso ?? USO_PADRAO[primeiro[0]]}, esta ferramenta usa a sua própria
        chave. Serve {alternativas(primeiro)} (basta uma), e ela fica salva pra
        próxima vez.
      </>
    );
  } else {
    const s = primeiro[0];
    titulo = `Falta a sua chave ${DA_CHAVE[s]}`;
    corpo = (
      <>
        Pra {uso ?? USO_PADRAO[s]}, esta ferramenta usa a sua própria chave{' '}
        {DA_CHAVE[s]}. Você cola uma vez e ela fica salva.
      </>
    );
  }

  return (
    <div
      role="status"
      className="fade-in-up rounded-[22px] p-1.5"
      style={{
        background: 'rgb(var(--amber) / 0.07)',
        boxShadow:
          'inset 0 0 0 1px rgb(var(--amber) / 0.24), 0 22px 44px -30px rgb(var(--amber) / 0.55)',
      }}
    >
      <div
        className="rounded-[16px] px-4 py-4 sm:px-5"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--bg-softer)), rgb(var(--bg-soft)))',
          boxShadow:
            'inset 0 1px 0 rgb(255 255 255 / 0.05), inset 0 0 0 1px rgb(var(--amber) / 0.10)',
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {/* Ícone no próprio círculo, com halo âmbar discreto */}
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-amber"
              style={{
                background: 'rgb(var(--amber) / 0.12)',
                boxShadow: 'inset 0 0 0 1px rgb(var(--amber) / 0.32), 0 0 22px -6px rgb(var(--amber) / 0.55)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7.5" cy="15.5" r="4.5" />
                <path d="M10.7 12.3 20 3" />
                <path d="m16 7 3 3" />
                <path d="m14 9 2 2" />
              </svg>
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[14px] font-semibold leading-snug text-text">{titulo}</p>
              <div className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-text-muted">
                {corpo}
              </div>
              {semChave ? (
                <p className="mt-1.5 max-w-[68ch] text-[12.5px] leading-relaxed text-text-muted">
                  {semChave}
                </p>
              ) : null}
            </div>
          </div>

          {/* CTA com a seta no próprio círculo, colado na borda interna */}
          <Link
            href={destino}
            className="btn-primary group w-full shrink-0 !justify-between !gap-3 !py-1.5 !pl-4 !pr-1.5 text-[13px] sm:w-auto sm:self-center"
          >
            Adicionar chave
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-px group-hover:translate-x-0.5 group-hover:scale-105"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
