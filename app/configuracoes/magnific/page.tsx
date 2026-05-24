'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';

/**
 * /configuracoes/magnific — paste de cookies da sessão Magnific.com.
 *
 * Por que cookies em vez de API key?
 *   Magnific não publica API key. A pipeline server-side reutiliza a
 *   sessão Web do user (mesma que ele usa no navegador logado em
 *   freepik/magnific). Cookies + XSRF-TOKEN são cifrados AES-256-GCM
 *   no banco e nunca voltam pro client em plaintext.
 *
 * Fluxo:
 *   1. User abre magnific.com (logado) em outro tab
 *   2. DevTools > Application > Cookies > magnific.com
 *   3. Copia todos cookies como header `Cookie:` (formato `k1=v1; k2=v2; ...`)
 *   4. Copia `XSRF-TOKEN` cookie, decoda URI (decodeURIComponent)
 *   5. Cola aqui — validamos via /auth/verify e descobrimos user_id
 */

type Status = {
  configured: boolean;
  magnificUserId: number | null;
  plan: string | null;
  updatedAt: string | null;
};

export default function MagnificConfigPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(
    null,
  );

  const [cookie, setCookie] = useState('');
  const [xsrf, setXsrf] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 3500);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/auto-broll-v2/save-creds', { method: 'GET' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha.');
      setStatus(j as Status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Polling rápido (3s) enquanto desconectado — pra detectar quando a
    // extensão Freepik Sync acabou de sincronizar e ficar 'conectado' sem o
    // user precisar dar refresh.
    const id = setInterval(() => {
      if (!status?.configured) load();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.configured]);

  /**
   * Tenta extrair XSRF-TOKEN automaticamente do cookie completo,
   * decodificando URI (igual o browser faz antes de mandar no header).
   */
  function tryAutoFillXsrf(rawCookie: string) {
    const m = rawCookie.match(/XSRF-TOKEN=([^;]+)/);
    if (!m) return;
    try {
      const decoded = decodeURIComponent(m[1]);
      setXsrf(decoded);
    } catch {
      /* ignora */
    }
  }

  async function save() {
    const c = cookie.trim();
    const x = xsrf.trim();
    if (c.length < 50) {
      flash('err', 'Cookie muito curto — copie o conteúdo COMPLETO.');
      return;
    }
    if (x.length < 20) {
      flash('err', 'XSRF-TOKEN inválido.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/auto-broll-v2/save-creds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cookie: c, xsrfToken: x }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha.');
      flash(
        'ok',
        `Conectado · ${j.plan || 'Plano'} · ${j.credits ?? '∞'} créditos`,
      );
      setCookie('');
      setXsrf('');
      await load();
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remover credenciais Magnific?')) return;
    setRemoving(true);
    try {
      const r = await fetch('/api/auto-broll-v2/save-creds', {
        method: 'DELETE',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha.');
      flash('ok', 'Credenciais removidas.');
      await load();
    } catch (e) {
      flash('err', (e as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Magnific (Auto B-Roll v2)"
          description="Conecta sua conta Magnific.com (Freepik Premium+) à pipeline server-side. 12 imagens + 6 vídeos simultâneos via API direta — 10x mais rápido que a extension. Cookies cifrados AES-256-GCM, só você acessa."
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

          {/* STATUS */}
          <div className="mb-6 rounded-[12px] border border-line bg-bg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-white">
                    Status da Conexão
                  </h3>
                  {loading ? (
                    <span className="mono rounded-full bg-white/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted">
                      CARREGANDO…
                    </span>
                  ) : status?.configured ? (
                    <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime">
                      CONECTADO · USER {status.magnificUserId}
                    </span>
                  ) : (
                    <span className="mono rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300">
                      NÃO CONECTADO
                    </span>
                  )}
                </div>
                {status?.configured ? (
                  <p className="mt-1 text-[11px] text-text-muted">
                    Plano: <span className="text-lime">{status.plan || '—'}</span>
                    {' · '}
                    Atualizado:{' '}
                    {status.updatedAt
                      ? new Date(status.updatedAt).toLocaleString('pt-BR')
                      : '—'}
                  </p>
                ) : null}
              </div>
              {status?.configured ? (
                <button
                  onClick={remove}
                  disabled={removing}
                  className="rounded-[12px] border border-red-500/40 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10 active:scale-[0.96] disabled:opacity-40"
                >
                  {removing ? 'Removendo…' : 'Desconectar'}
                </button>
              ) : null}
            </div>
          </div>

          {/* PATH 1 — EXTENSION (RECOMENDADO) */}
          <div className="mb-4 rounded-[12px] border-2 border-lime/40 bg-lime/[0.04] p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-lime px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-black">
                Recomendado
              </span>
              <h4 className="text-sm font-semibold uppercase tracking-widest text-lime">
                Extensão Freepik Sync
              </h4>
            </div>
            <p className="mb-3 text-[12px] text-text-muted">
              Instala 1 vez. Fica logado no Freepik = fica conectado. Sincroniza
              automático quando o cookie renova. Zero copy/paste.
            </p>
            <ol className="mb-4 space-y-1.5 text-[12px] text-text-muted">
              <li>
                1.{' '}
                <a
                  href="/api/extension-freepik-sync/download"
                  download
                  className="text-lime underline hover:text-white"
                >
                  Baixar darkolab-freepik-sync.zip
                </a>
              </li>
              <li>2. Descompactar numa pasta qualquer</li>
              <li>
                3. Abrir{' '}
                <code className="mono rounded bg-bg-soft px-1.5 py-0.5 text-[11px]">
                  chrome://extensions
                </code>
              </li>
              <li>
                4. Ativar &ldquo;Modo de desenvolvedor&rdquo; (canto superior direito)
              </li>
              <li>
                5. Clicar &ldquo;Carregar sem compactação&rdquo; → escolher a pasta
              </li>
              <li>
                6. Logar em{' '}
                <a
                  href="https://www.magnific.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime underline"
                >
                  magnific.com
                </a>{' '}
                (conta Freepik Premium+)
              </li>
              <li>7. Pronto — extensão sincroniza automático em ~3 segundos</li>
            </ol>
            <a
              href="/api/extension-freepik-sync/download"
              download
              className="btn-primary inline-block"
            >
              ⬇ Baixar Extensão
            </a>
          </div>

          {/* PATH 2 — MANUAL (FALLBACK) */}
          <details className="mb-4 rounded-[12px] border border-line bg-bg p-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-text-muted hover:text-white">
              Manual (fallback se extensão não funcionar)
            </summary>
            <div className="mt-3">
              <p className="mb-2 text-[11px] text-text-muted">
                Em{' '}
                <a
                  href="https://www.magnific.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime hover:underline"
                >
                  magnific.com
                </a>{' '}
                logado: F12 → Console → cola{' '}
                <code className="rounded bg-bg-soft px-1.5 py-0.5 text-[11px] text-lime">
                  document.cookie
                </code>{' '}
                → copia o resultado.
              </p>
              <label className="block">
                <span className="text-[11px] uppercase tracking-widest text-text-muted">
                  Cookie completo
                </span>
                <textarea
                  value={cookie}
                  onChange={(e) => {
                    setCookie(e.target.value);
                    tryAutoFillXsrf(e.target.value);
                  }}
                  placeholder="laravel_session=abc...; XSRF-TOKEN=eyJ...;"
                  rows={4}
                  className="input-field mt-1 w-full font-mono text-[11px]"
                  disabled={saving}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[11px] uppercase tracking-widest text-text-muted">
                  XSRF-TOKEN (auto se possível)
                </span>
                <input
                  type="text"
                  value={xsrf}
                  onChange={(e) => setXsrf(e.target.value)}
                  placeholder="eyJpdiI6Ii..."
                  className="input-field mt-1 w-full font-mono text-[11px]"
                  disabled={saving}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                onClick={save}
                disabled={saving || cookie.length < 50 || xsrf.length < 20}
                className="btn-primary mt-4"
              >
                {saving ? 'Validando + salvando…' : 'Validar e Salvar'}
              </button>
            </div>
          </details>

          {/* SECURITY NOTE */}
          <div className="mt-6 rounded-[12px] border border-lime/30 bg-lime/5 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg" aria-hidden>
                🔒
              </span>
              <div>
                <div className="text-sm font-semibold text-lime">
                  Cifragem AES-256-GCM
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Cookies são cifrados antes de tocar o banco. Nem admin
                  nem outros usuários conseguem ler. Cookies expiram quando você
                  desloga do Magnific — basta voltar aqui e atualizar.
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
              ? 'border-lime/50 bg-bg/80 text-lime shadow-[0_0_28px_-8px_rgba(200,255,0,0.6)]'
              : 'border-red-500/50 bg-bg/80 text-red-300 shadow-[0_0_28px_-8px_rgba(248,113,113,0.6)]')
          }
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
