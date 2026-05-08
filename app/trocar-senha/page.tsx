'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/client';

/**
 * /trocar-senha — forca o user a trocar a senha provisoria pela propria.
 * Middleware redireciona pra ca quando profile.must_change_password=true.
 *
 * Apos a troca, chama /api/user/clear-password-flag e libera /tools.
 */

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError('A senha precisa ter no minimo 8 caracteres.');
      return;
    }
    if (pw !== pw2) {
      setError('As senhas nao batem. Confira e tente de novo.');
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: pwErr } = await supabase.auth.updateUser({
        password: pw,
      });
      if (pwErr) {
        setError(pwErr.message);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/user/clear-password-flag', {
        method: 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Falha ao confirmar a troca de senha.');
        setLoading(false);
        return;
      }

      // Tudo certo — manda pra /tools
      router.replace('/tools');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Crie sua senha"
      subtitle="A senha que voce recebeu e provisoria. Defina uma senha so sua agora — depois disso, nem o admin tera acesso a ela."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label-field" htmlFor="pw">
            Nova senha (mínimo 8 caracteres)
          </label>
          <input
            id="pw"
            type="password"
            required
            minLength={8}
            className="input-field"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label-field" htmlFor="pw2">
            Confirme a nova senha
          </label>
          <input
            id="pw2"
            type="password"
            required
            minLength={8}
            className="input-field"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div
            key={error}
            role="alert"
            className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar e entrar'}
        </button>

        <p className="text-center text-[11px] text-text-muted">
          Sua nova senha fica salva so com voce. Use uma senha forte e nao
          compartilhe.
        </p>
      </form>
    </AuthShell>
  );
}
