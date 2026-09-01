'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';
import { HeyGenConectar } from '@/components/HeyGenConectar';

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
  | 'heygen_oauth'
  | 'replicate'
  | 'groq';

type SecretsStatus = {
  anthropic: { configured: boolean; last4: string | null };
  assemblyai: { configured: boolean; last4: string | null };
  elevenlabs: { configured: boolean; last4: string | null };
  heygen: { configured: boolean; last4: string | null };
  heygen_oauth: { configured: boolean; last4: string | null };
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
  /** Rotulo do CTA quando o card tem passo a passo. */
  linkLabel?: string;
  /** Passo a passo de onde tirar a chave — some atras de um <details>. */
  steps?: Array<{ t: string; d: string }>;
  /** Recado que evita o erro classico do servico (ex.: achar que precisa de saldo). */
  warn?: string;
  /**
   * Aviso SEMPRE visivel logo abaixo do "Usado em". Existe pra dizer quando
   * duas chaves fazem a MESMA coisa (AssemblyAI x Groq): sem isso o cliente
   * ve dois cards de transcricao e acha que precisa das duas.
   */
  note?: string;
}> = [
  {
    id: 'assemblyai',
    label: 'AssemblyAI',
    helper:
      'Chave alfanumerica longa. Pega em assemblyai.com (dashboard, sidebar).',
    link: 'https://www.assemblyai.com/app/account',
    usedBy:
      'Legendas Automáticas · Decupagem por Copy · Gerador de SRT · Camuflagem · Diarização de vozes (VA)',
    note:
      'TRANSCRIÇÃO: esta chave e a do Groq fazem a mesma coisa — basta UMA das duas pra Legendas Automáticas, Decupagem por Copy e Gerador de SRT. Só a Camuflagem e a Diarização exigem esta aqui.',
  },
  {
    id: 'heygen',
    label: 'HeyGen',
    helper:
      'E a chave que liga a SUA biblioteca de avatares e vozes ao AutoEdit. Criar e de graça e leva 1 minuto — você NÃO precisa comprar saldo de API.',
    link: 'https://app.heygen.com/developers/api',
    linkLabel: 'Abrir a tela da chave ↗',
    steps: [
      {
        t: 'Entre na conta certa.',
        d: 'Abra o HeyGen e confira que você está logado na conta (e no workspace) onde estão os SEUS avatares — a chave só enxerga a biblioteca dessa conta.',
      },
      {
        t: 'Vá pra área Developers.',
        d: 'O botão verde aqui embaixo já abre a tela certa. No HeyGen ela fica no ícone </>, no pé da barra lateral esquerda.',
      },
      {
        t: 'Passe direto pelo topo.',
        d: 'O aviso amarelo de créditos e o botão azul “Add balance” são pra quem gera vídeo pela API. Não clique — desça a página.',
      },
      {
        t: 'Clique em “Create API Key”.',
        d: 'Fica na linha da seção “API Keys”, no canto direito. Dê um nome qualquer (autoedit serve) e confirme.',
      },
      {
        t: 'Copie e cole aqui em cima.',
        d: 'A chave aparece uma vez só. Copie na hora, cole no campo deste card e clique em Salvar — o selo vermelho vira CONFIGURADA.',
      },
    ],
    warn:
      'Saldo não entra nessa história: o Balance da tela só é debitado por quem GERA VÍDEO pela API, e aqui a chave só LÊ sua biblioteca — funciona com US$ 0,00. Já tinha criado uma chave e não anotou? O HeyGen não mostra de novo: clique em “Regenerate” na linha dela (a antiga para de funcionar na hora).',
    usedBy: 'Seletor de avatares e vozes · Clonagem de voz (HeyGen)',
  },
  {
    id: 'heygen_oauth',
    label: 'HeyGen OAuth (modo imagem)',
    helper:
      'NÃO é a API key acima. A diferença é de COBRANÇA: a key cai no tier de API (saldo USD à parte) e o OAuth sai do crédito do plano, que você já paga. Use o botão "Conectar HeyGen agora" — ele tira um login PRÓPRIO do app e renova sozinho todo dia. Colar o token do CLI aqui também funciona, mas aí o CLI e o app disputam a MESMA corrente (o refresh é de uso único): quem renovar primeiro derruba o outro, e é por isso que o login vivia expirando.',
    link: 'https://developers.heygen.com/docs/cli',
    usedBy: 'ClickUp Pilot — MODO IMAGEM (animar imagem sem avatar da biblioteca)',
  },
  {
    id: 'groq',
    label: 'Groq (Whisper barato)',
    helper:
      'Token gsk_... — Whisper-large-v3 a ~$0.04/h (vs $0.45 AssemblyAI). Crie em console.groq.com → API Keys.',
    link: 'https://console.groq.com/keys',
    usedBy: 'Legendas Automáticas · Decupagem por Copy · Gerador de SRT',
    note:
      'TRANSCRIÇÃO: esta chave e a do AssemblyAI fazem a mesma coisa — basta UMA das duas. Se você já configurou o AssemblyAI, estas ferramentas JÁ funcionam e este card é opcional: com as duas salvas, o AutoEdit usa a Groq (mais barata) e cai pro AssemblyAI se ela falhar.',
  },
];

const INIT_DRAFTS: Record<Service, string> = {
  anthropic: '',
  assemblyai: '',
  elevenlabs: '',
  heygen: '',
  heygen_oauth: '',
  replicate: '',
  groq: '',
};
const INIT_BUSY: Record<Service, boolean> = {
  anthropic: false,
  assemblyai: false,
  elevenlabs: false,
  heygen: false,
  heygen_oauth: false,
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
                      {m.note ? (
                        <p className="mt-1.5 max-w-[62ch] rounded-[10px] border border-line bg-bg-soft/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
                          {m.note}
                        </p>
                      ) : null}
                      {/* Caminho PRINCIPAL do OAuth: login pelo próprio app, em
                          corrente que o CLI não derruba. O campo de colar
                          continua logo abaixo, como saída manual. */}
                      {m.id === 'heygen_oauth' ? <HeyGenConectar compacto /> : null}
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

                  <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                    {m.helper}
                    {m.steps ? null : (
                      <>
                        {' '}
                        <a
                          href={m.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-lime hover:underline"
                        >
                          Abrir painel ↗
                        </a>
                      </>
                    )}
                  </p>

                  {m.steps ? (
                    <details
                      // Quem ainda nao configurou ja abre no passo a passo;
                      // quem tem chave ve o bloco recolhido.
                      open={!s?.configured}
                      className="group mt-3 overflow-hidden rounded-[12px] border border-line bg-bg-soft/60"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted transition hover:text-white">
                        <span>Onde eu pego essa chave? · passo a passo</span>
                        <span
                          aria-hidden
                          className="text-lime transition-transform duration-300 group-open:rotate-180"
                        >
                          ▾
                        </span>
                      </summary>

                      <ol className="flex flex-col gap-2.5 border-t border-line px-3 py-3">
                        {m.steps.map((st, i) => (
                          <li key={st.t} className="flex gap-2.5">
                            <span className="label-tech mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lime/15 text-[9px] text-lime">
                              {i + 1}
                            </span>
                            <p className="text-[11px] leading-relaxed text-text-muted">
                              <span className="font-semibold text-white">
                                {st.t}
                              </span>{' '}
                              {st.d}
                            </p>
                          </li>
                        ))}
                      </ol>

                      {m.warn ? (
                        <p className="mx-3 rounded-[10px] border border-amber/30 bg-amber-soft px-3 py-2 text-[11px] leading-relaxed text-amber">
                          {m.warn}
                        </p>
                      ) : null}

                      <div className="p-3">
                        <a
                          href={m.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-primary !py-1.5 text-xs"
                        >
                          {m.linkLabel ?? 'Abrir painel ↗'}
                        </a>
                      </div>
                    </details>
                  ) : null}
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
