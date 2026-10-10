'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';
import { HeyGenConectar } from '@/components/HeyGenConectar';
import { AulaVideo } from '@/components/AulaVideo';
import { FriendlyError, toFriendlyMessage } from '@/lib/friendly-error';
import { DA_CHAVE } from '@/lib/key-errors';

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
      'Chave longa, de letras e números. Fica no painel da sua conta na AssemblyAI, no menu lateral.',
    link: 'https://www.assemblyai.com/app/account',
    usedBy:
      'Legendas Automáticas · Remover Silêncios por Copy · Gerador de SRT · Camuflagem · Diarização de vozes (VA)',
    note:
      'Transcrição: nas Legendas Automáticas, no Remover Silêncios por Copy e no Gerador de SRT, esta chave e a do Groq fazem a mesma coisa, então basta uma das duas. A conferência da Camuflagem e a Diarização de vozes só funcionam com esta.',
  },
  {
    id: 'heygen',
    label: 'HeyGen',
    helper:
      'É a chave que liga a SUA biblioteca de avatares e vozes ao Auto Edit. Criar é de graça e leva um minuto, e você NÃO precisa comprar saldo de API.',
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
      'Saldo não entra nessa história: o Balance da tela só é debitado por quem GERA VÍDEO pela API, e aqui a chave só LÊ sua biblioteca, então funciona com US$ 0,00. Já tinha criado uma chave e não anotou? O HeyGen não mostra de novo: clique em “Regenerate” na linha dela (a antiga para de funcionar na hora).',
    usedBy: 'Seletor de avatares e vozes · Clonagem de voz (HeyGen)',
  },
  {
    id: 'heygen_oauth',
    label: 'HeyGen OAuth (modo imagem)',
    helper:
      'Não é a chave de cima. Aqui você conecta a sua conta do HeyGen pelo botão "Conectar HeyGen agora", e o que for gerado por essa conexão sai do crédito do seu plano do HeyGen, não do saldo de API. A conexão se renova sozinha. Se você também usa o CLI do HeyGen, prefira o botão: colar o token do CLI aqui faz os dois disputarem a mesma conexão, e um derruba o outro.',
    link: 'https://developers.heygen.com/docs/cli',
    usedBy: 'Pilot · MODO IMAGEM (animar imagem sem avatar da biblioteca)',
  },
  {
    id: 'groq',
    label: 'Groq (Whisper barato)',
    helper:
      'Chave que começa com gsk_. Crie em console.groq.com, na área API Keys. O Groq tem plano gratuito e costuma sair mais barato que a AssemblyAI.',
    link: 'https://console.groq.com/keys',
    usedBy: 'Legendas Automáticas · Remover Silêncios por Copy · Gerador de SRT',
    note:
      'Transcrição: nessas ferramentas, esta chave e a da AssemblyAI fazem a mesma coisa, então basta uma das duas. Se você já salvou a da AssemblyAI, elas JÁ funcionam e este card é opcional. Com as duas salvas, se uma falhar, a ferramenta tenta a outra sozinha.',
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
  // Card em destaque quando o cliente chega pelo aviso de chave pendente
  // (/configuracoes/api#chave-groq): rola até ele e acende a borda por 2,6 s.
  const [foco, setFoco] = useState<Service | null>(null);

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
      if (!res.ok) throw new FriendlyError(json.error || 'Não consegui carregar suas chaves agora. Recarregue a página.');
      setStatus(json);
    } catch (e) {
      setError(toFriendlyMessage(e, 'Não consegui carregar suas chaves agora. Recarregue a página.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let limpar: ReturnType<typeof setTimeout> | undefined;
    const aplicar = () => {
      const m = /^#chave-([a-z_]+)$/.exec(window.location.hash);
      const id = m?.[1] as Service | undefined;
      if (!id || !META.some((x) => x.id === id)) return;
      setFoco(id);
      requestAnimationFrame(() =>
        document.getElementById(`chave-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
      clearTimeout(limpar);
      limpar = setTimeout(() => setFoco(null), 2600);
    };
    aplicar();
    window.addEventListener('hashchange', aplicar);
    return () => {
      clearTimeout(limpar);
      window.removeEventListener('hashchange', aplicar);
    };
  }, []);

  async function save(service: Service) {
    const key = drafts[service].trim();
    if (key.length < 10) {
      flash('err', 'Essa chave parece curta demais. Confira se você copiou ela inteira.');
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
      if (!res.ok) throw new FriendlyError(json.error || 'Não consegui salvar a chave agora. Tente de novo em instantes.');
      flash('ok', `Chave ${DA_CHAVE[service]} salva. Já pode usar nas ferramentas.`);
      setDrafts((d) => ({ ...d, [service]: '' }));
      await load();
    } catch (e) {
      flash('err', toFriendlyMessage(e, 'Não consegui salvar a chave agora. Tente de novo em instantes.'));
    } finally {
      setBusy((b) => ({ ...b, [service]: false }));
    }
  }

  async function clear(service: Service) {
    if (
      !window.confirm(
        `Remover a chave ${DA_CHAVE[service]}? O que depende dela para de funcionar até você colar outra.`,
      )
    )
      return;
    setBusy((b) => ({ ...b, [service]: true }));
    try {
      const res = await fetch('/api/user/secrets', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service }),
      });
      const json = await res.json();
      if (!res.ok) throw new FriendlyError(json.error || 'Não consegui remover a chave agora. Tente de novo em instantes.');
      flash('ok', `Chave ${DA_CHAVE[service]} removida.`);
      await load();
    } catch (e) {
      flash('err', toFriendlyMessage(e, 'Não consegui remover a chave agora. Tente de novo em instantes.'));
    } finally {
      setBusy((b) => ({ ...b, [service]: false }));
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Chaves de IA"
          description="Aqui você cola as chaves das suas contas de IA. Cada ferramenta usa a sua própria chave, e o uso é cobrado direto pelo serviço. As chaves ficam cifradas no servidor: depois de salvas, só aparecem os 4 últimos dígitos."
        >
          <div className="mb-4 flex items-center gap-3">
            <Link href="/configuracoes" className="btn-ghost text-xs">
              ← Voltar pra Configurações
            </Link>
          </div>

          {/* Aula em vídeo: o passo a passo de cada chave */}
          <AulaVideo path="/configuracoes/api" className="mb-6 max-w-[640px]" />

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
                  id={`chave-${m.id}`}
                  className={
                    'scroll-mt-24 rounded-[12px] border bg-bg p-4 transition-[border-color,box-shadow] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ' +
                    (foco === m.id
                      ? 'border-amber/60 shadow-[0_0_0_3px_rgb(var(--amber)/0.18)]'
                      : 'border-line')
                  }
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
                            NÃO CONFIGURADA
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
                  Suas chaves estão protegidas
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Elas ficam cifradas no servidor e não aparecem pra ninguém
                  no app, nem pra outros usuários: depois de salvas, até pra
                  você só aparecem os 4 últimos dígitos. O que cada ferramenta
                  consome sai direto da sua conta no serviço da chave.
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
