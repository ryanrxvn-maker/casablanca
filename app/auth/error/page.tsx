'use client';

import { Suspense } from 'react';
import { AuthShell } from '@/components/AuthShell';
import AuthErrorClient from './error-client';

/**
 * /auth/error — mostra ao user por que o link de confirmação falhou
 * e oferece "reenviar email" pra desbloquear sem reiniciar o signup.
 */
export default function AuthErrorPage() {
  return (
    <AuthShell
      title="Não consegui confirmar"
      subtitle="O link expirou ou foi aberto em outro navegador. Vamos reenviar."
      footer={
        <span className="text-text-muted">
          Quer voltar?{' '}
          <a href="/login" className="text-violet hover:text-white">
            Entrar
          </a>
        </span>
      }
    >
      <Suspense fallback={null}>
        <AuthErrorClient />
      </Suspense>
    </AuthShell>
  );
}
