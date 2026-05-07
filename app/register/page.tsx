import { redirect } from 'next/navigation';

/**
 * Closed beta — /register desabilitado.
 * Apos o middleware, qualquer GET aqui redireciona pra /login com flag.
 * Este componente e fallback caso o middleware seja burlado.
 */
export default function RegisterDisabled() {
  redirect('/login?beta=closed');
}
