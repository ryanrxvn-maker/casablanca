'use client';

import { useEffect, useState } from 'react';
import { getClickUpToken, setClickUpToken } from '@/lib/clickup-client';

/**
 * Credencial do ClickUp exibida na página geral de configurações.
 * O token continua sendo salvo no mesmo localStorage usado pelo Pilot.
 */
export function ClickUpPilotTokenSection({
  flash,
}: {
  flash: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setHasToken(!!getClickUpToken());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  function saveToken() {
    const token = tokenInput.trim();
    if (!token) return;
    setClickUpToken(token);
    setHasToken(true);
    setTokenInput('');
    flash('ok', 'Token salvo. O ClickUp Pilot já pode carregar suas tasks.');
  }

  function clearToken() {
    if (!window.confirm('Limpar o token do ClickUp? Você vai precisar configurar de novo.')) return;
    setClickUpToken(null);
    setHasToken(false);
    flash('ok', 'Token do ClickUp limpo.');
  }

  return (
    <section className="border-t border-line pt-6">
      <h2 className="label-field !mb-3">ClickUp Pilot — acesso</h2>
      {hasToken ? (
        <div className="flex items-center justify-between rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-xs">
          <span className="text-lime">✓ Token do ClickUp configurado</span>
          <button
            type="button"
            onClick={clearToken}
            className="rounded-md border border-line-strong px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
          >
            Limpar
          </button>
        </div>
      ) : (
        <div className="rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-sm">
          <p className="mb-2 text-[11px] text-text-muted">
            Cole aqui o token da sua conta do ClickUp. Você encontra em{' '}
            <a
              href="https://app.clickup.com/settings/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-lime hover:underline"
            >
              Settings → Apps → API Token
            </a>
            . Começa com <code className="mono text-fuchsia-200">pk_</code>.
            O token fica salvo somente neste navegador.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Token ClickUp"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveToken();
              }}
              placeholder="pk_..."
              className="input-field flex-1"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={saveToken}
              disabled={!tokenInput.trim()}
              className="btn-primary"
            >
              Salvar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
