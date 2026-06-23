'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';

/**
 * /configuracoes/api — gerenciamento das chaves de IA do proprio usuario.
 *
 * Cada usuario do beta paga as proprias APIs (BYOK). As chaves sao
 * cifradas no servidor (AES-256-GCM com SECRETS_ENCRYPTION_KEY) e so
 * o dono ve via RLS. A UI nunca mostra a chave em plaintext de volta —
 * so um indicador "configurada · ····xxxx".
 */

type Service =
  | 'anthropic'
  | 'assemblyai'
  | 'elevenlabs'
  | 'heygen'
  | 'replicate'
  | 'groq';

type SecretsStatus = {
  anthropic: { configured: boolean; last4: string | null };
  assemblyai: { configured: boolean; last4: string | null };
  elevenlabs: { configured: boolean; last4: string | null };
  heygen: { configured: boolean; last4: string | null };
  replicate: { configured: boolean; last4: string | null };
  groq: { configured: boolean; last4: string | null };
  updatedAt: string | null;
};

const META: Array<{
  id: Service;
  label: string;
  helper: string;
  link: string;
  usedBy: string;
}> = [
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    helper:
      'Chave alfanumerica longa. Pega em assemblyai.com (dashboard, sidebar).',
    link: 'https://www.assemblyai.com/app/account',
    usedBy: 'Troca de Produto · Decupagem por Copy',
  },
  {
    id: 'heygen',
    label: 'HeyGen',
    helper:
      'API key de avatares. Crie em app.heygen.com → API Keys.',
    link: 'https://app.heygen.com/settings?tab=api',
    usedBy: 'Mind Ads Suite (admin)',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    helper:
      'API token (formato r8_...). Crie em replicate.com → Account → API tokens.',
    link: 'https://replicate.com/account/api-tokens',
    usedBy: 'Mind Ads Suite (admin)',
  },
  {
    id: 'groq',
    label: 'Groq (Whisper barato)',
    helper:
      'Token gsk_... — Whisper-large-v3 a ~$0.04/h (vs $0.45 AssemblyAI). Crie em console.groq.com → API Keys.',
    link: 'https://console.groq.com/keys',
    usedBy: 'Mind Ads Suite (tier eco/padrao)',
  },
];

const INIT_DRAFTS: Record<Service, string> = {
  anthropic: '',
  assemblyai: '',
  elevenlabs: '',
  heygen: '',
  replicate: '',
  groq: '',
};
const INIT_BUSY: Record<Service, boolean> = {
  anthropic: false,
  assemblyai: false,
  elevenlabs: false,
  heygen: false,
  replicate: false,
  groq: false,
};

export default function ApiKeysPage() {
  const [status, setStatus] = useState<SecretsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: 'ok' | 'err';
    msg: string;
  } | null>(null);

  // Inputs locais por service
  const [drafts, setDrafts] = useState<Record<Service, string>>(INIT_DRAFTS);
  const [busy, setBusy] = useState<Record<Service, boolean>>(INIT_BUSY);

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 3500);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/user/secrets');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha.');
      setStatus(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(service: Service) {
    const key = drafts[service].trim();
    if (key.length < 10) {
      flash('err', 'Chave muito curta.');
      return;
    }
    setBusy((b) => ({ ...b, [service]: true }));
    try {
      const res = await fetch('/api/user/secrets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service, key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha ao salvar.');
      flash('ok', `Chave ${service} salva.`);
      setDrafts((d) => ({ ...d, [service]: '' }));
      await load();
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [service]: false }));
    }
  }

  async function clear(service: Service) {
    if (!window.confirm(`Remover chave ${service}?`)) return;
    setBusy((b) => ({ ...b, [service]: true }));
    try {
      const res = await fetch('/api/user/secrets', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha.');
      flash('ok', `Chave ${service} removida.`);
      await load();
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [service]: false }));
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="API Keys"
          description="Cada usuario do DARKO LAB paga as proprias chamadas de IA. Configure suas chaves abaixo — elas sao cifradas no servidor e nunca compartilhadas. Sem chave configurada, a ferramenta correspondente nao funciona."
        >
          <div className="mb-4 flex items-center gap-3">
            <Link href="/configuracoes" className="btn-ghost text-xs">
              ← Voltar pra Configurações
            </Link>
          </div>

          {error ? (
            <div
              key={error}
              role="alert"
              className="error-shake mb-4 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {META.map((m) => {
              const s = status?.[m.id];
              const isBusy = busy[m.id];
              return (
                <div
                  key={m.id}
                  className="rounded-[12px] border border-line bg-bg p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold uppercase tracking-widest text-white">
                          {m.label}
                        </h3>
                        {s?.configured ? (
                          <span className="label-tech rounded-full bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                            CONFIGURADA · ····{s.last4}
                          </span>
                        ) : (
                          <span className="label-tech rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300">
                            NAO CONFIGURADA
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        Usado em: <span className="text-lime">{m.usedBy}</span>
                      </p>
                    </div>
                    {s?.configured ? (
                      <button
                        onClick={() => clear(m.id)}
                        disabled={isBusy}
                        className="rounded-[12px] border border-red-500/40 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10 active:scale-[0.96] disabled:opacity-40"
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      type="password"
                      autoComplete="off"
                      value={drafts[m.id]}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                      }
                      placeholder={
                        s?.configured
                          ? 'Substituir chave (cole pra trocar)'
                          : 'Cole aqui sua chave'
                      }
                      className="input-field"
                      disabled={isBusy}
                    />
                    <button
                      onClick={() => save(m.id)}
                      disabled={isBusy || drafts[m.id].length < 10}
                      className="btn-primary"
                    >
                      {isBusy ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>

                  <p className="mt-2 text-[11px] text-text-muted">
                    {m.helper}{' '}
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lime hover:underline"
                    >
                      Abrir painel ↗
                    </a>
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-[12px] border border-lime/30 bg-lime/5 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg" aria-hidden>
                🔒
              </span>
              <div>
                <div className="text-sm font-semibold text-lime">
                  Suas chaves estao protegidas
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Ninguem ve suas chaves alem de voce — nem o administrador,
                  nem outros usuarios. Os creditos que cada ferramenta
                  consome saem direto da sua conta na API
                  correspondente.
                </p>
              </div>
            </div>
          </div>
        </ToolShell>
      </main>

      {toast ? (
        <div
          role="status"
          className={
            'toast-pop fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-5 py-2.5 text-xs font-medium uppercase tracking-widest shadow-2xl backdrop-blur-md ' +
            (toast.kind === 'ok'
              ? 'border-lime/50 bg-bg/80 text-lime shadow-[0_0_28px_-8px_rgba(200,232,124,0.6)]'
              : 'border-red-500/50 bg-bg/80 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
