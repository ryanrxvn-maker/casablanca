import { redirect } from 'next/navigation';

/**
 * Closed beta — recuperacao de senha pelo usuario desabilitada.
 * Senhas sao gerenciadas pelo admin via /admin.
 */
export default function ForgotPasswordDisabled() {
  redirect('/login?beta=closed');
}
