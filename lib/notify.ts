/**
 * Notifica o DONO por email (via Resend) sobre eventos importantes:
 * nova venda, cancelamento, etc. Best-effort — se RESEND_API_KEY não estiver
 * configurado, simplesmente não envia (não quebra o webhook).
 *
 * Envs:
 *   RESEND_API_KEY      — a mesma chave re_... do Resend (SMTP)
 *   OWNER_NOTIFY_EMAIL  — pra onde mandar (default ryanrxvn@gmail.com)
 *   NOTIFY_FROM         — remetente (default AutoEdit <naoresponda@darkoautoedit.com>)
 */

export async function notifyOwner(subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const to = process.env.OWNER_NOTIFY_EMAIL || 'ryanrxvn@gmail.com';
  const from = process.env.NOTIFY_FROM || 'AutoEdit <naoresponda@darkoautoedit.com>';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } catch {
    /* não bloqueia o fluxo principal */
  }
}

/** Formata centavos (BRL) pra exibir no email. */
export function brlFromCents(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
