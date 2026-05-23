'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Decodifica códigos de erro em mensagens humanas.
 * Mantém o motivo cru também (mono, pequeno) pra debug.
 */
function humanReason(code: string | null, raw: string | null): string {
  if (!code && !raw) return 'Link inválido ou já usado.';
  if (code === 'pkce_failed') {
    return 'Você clicou o link num navegador diferente daquele em que se cadastrou. Vamos te mandar um novo — clique aqui no mesmo aparelho que está usando agora.';
  }
  if (code === 'token_hash_failed' || code === 'token_hash_invalid') {
    return 'O link expirou ou já foi usado. Sem stress — peça um novo abaixo.';
  }
  if (code === 'missing_params') {
    return 'Link de confirmação incompleto. Pode pedir um novo.';
  }
  if (raw && /expired/i.test(raw)) {
    return 'O link expirou (validade de 24h). Peça um novo.';
  }
  if (raw && /already.+used/i.test(raw)) {
    return 'Esse link já foi usado. Tente fazer login direto.';
  }
  return raw || 'Não consegui validar o link. Peça um novo abaixo.';
}

export default function AuthErrorClient() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const code = params.get('code');

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim() || !/.+@.+\..+/.test(email)) {
      setError('Informe seu email.');
      return;
    }
    setSending(true);
    try {
      // Server-side route — usa NEXT_PUBLIC_SITE_URL canônico
      const res = await fetch('/api/auth/resend-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || 'Falha ao reenviar.');
        return;
      }
      setInfo('Email reenviado. Verifique sua caixa (e o spam).');
    } catch (e) {
      setError((e as Error)?.message ?? 'Falha ao reenviar.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="alert"
        className="rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm leading-relaxed text-yellow-200"
      >
        {humanReason(code, reason)}
      </div>

      <form onSubmit={handleResend} className="flex flex-col gap-3">
        <div>
          <label className="label-field" htmlFor="resend-email">
            Email do cadastro
          </label>
          <input
            id="resend-email"
            type="email"
            required
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
          />
        </div>

        {error ? (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            role="status"
            className="rounded-[12px] border border-lime/40 bg-lime/10 px-3 py-2 text-xs text-lime"
          >
            {info}
          </div>
        ) : null}

        <button type="submit" className="btn-primary" disabled={sending}>
          {sending ? 'Reenviando…' : 'Reenviar link de confirmação'}
        </button>
      </form>

      {code || reason ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] uppercase tracking-widest text-text-muted hover:text-text">
            Detalhe técnico
          </summary>
          <div className="mono mt-2 rounded-md border border-line bg-black/40 p-2 text-[10.5px] leading-relaxed text-text-muted">
            {code ? <div>code: {code}</div> : null}
            {reason ? <div>reason: {reason}</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
