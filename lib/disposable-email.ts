/**
 * Domínios de email descartável (temporário) barrados no cadastro.
 *
 * POLÍTICA (escolhida em 14/08/2026): bloqueamos SÓ descartável. Qualquer
 * domínio real passa — inclusive email de empresa (contato@agencia.com.br),
 * que é cliente pagante. Uma allowlist de "só Gmail/Outlook" barraria essas
 * vendas, então não é o caminho.
 *
 * ⚠ ESTA LISTA É SÓ PARA A MENSAGEM AMIGÁVEL NO FORMULÁRIO. Ela NÃO é a
 * defesa: o cadastro vai do navegador direto pro Supabase com a anon key, que
 * é pública, então quem quiser burlar chama a API do Supabase sem passar pela
 * nossa tela. Quem barra de verdade é o trigger `reject_disposable_email` em
 * `auth.users` (migration 030), que roda no banco e vale pra qualquer caminho.
 *
 * PRA ADICIONAR UM DOMÍNIO NOVO: o que importa é o banco —
 *   INSERT INTO public.blocked_email_domains (domain, note)
 *   VALUES ('novodescartavel.com', 'motivo');
 * Acrescentar aqui também é opcional; só melhora a mensagem de erro (sem
 * isso o usuário recebe o erro genérico do cadastro em vez do texto claro).
 */

/** Domínios conhecidos de email temporário. Mantido em sync com a migration 030. */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  '10minutemail.com',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'harakirimail.com',
  'inboxkitten.com',
  'jetable.org',
  'luxusmail.org',
  'mail-temp.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailexpire.com',
  'mailinator.com',
  'mailnesia.com',
  'minuteinbox.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'spam4.me',
  'spambox.us',
  'spamgourmet.com',
  'tempail.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempinbox.com',
  'tempmail.com',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];

const BLOCKED = new Set(DISPOSABLE_EMAIL_DOMAINS);

/**
 * True se o email for de um descartável conhecido.
 *
 * Casa o domínio exato E subdomínio (`mail.mailinator.com`), que é como esses
 * serviços costumam multiplicar endereço sem registrar domínio novo.
 */
export function isDisposableEmail(email: string): boolean {
  const domain = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[1];
  if (!domain) return false;
  if (BLOCKED.has(domain)) return true;
  return DISPOSABLE_EMAIL_DOMAINS.some((d) => domain.endsWith('.' + d));
}
