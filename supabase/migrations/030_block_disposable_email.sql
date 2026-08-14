-- 030_block_disposable_email.sql
-- Bloqueia cadastro com email DESCARTÁVEL (temporário).
--
-- POLÍTICA (14/08/2026): bloqueia só descartável. Qualquer domínio real passa,
-- inclusive email de empresa (contato@agencia.com.br) — que é cliente pagante.
-- Uma allowlist de "só Gmail/Outlook" barraria essas vendas.
--
-- POR QUE NO BANCO E NÃO NO FORMULÁRIO: o cadastro vai do navegador DIRETO pro
-- Supabase usando a anon key, que é pública (está no bundle JS). Validar só na
-- tela não barra ninguém — é só chamar a API do Supabase por fora. O trigger
-- abaixo roda dentro do banco, então vale pra QUALQUER caminho: nossa tela, curl
-- na API do Supabase, painel, admin/create-user. A validação no formulário
-- continua existindo, mas o papel dela é só dar a mensagem amigável.

-- ─────────────────────────────────────────────────────────────────────────────
-- Lista em TABELA (e não fixa na função) pra você adicionar domínio novo com um
-- INSERT, sem precisar reescrever função nem fazer deploy:
--   INSERT INTO public.blocked_email_domains (domain, note)
--   VALUES ('novodescartavel.com', 'apareceu em cadastro falso');
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blocked_email_domains (
  domain     text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS ligada e SEM policy: nem anon nem authenticated leem ou escrevem. Só o
-- service_role (e a função abaixo, que é SECURITY DEFINER) enxerga. Sem isso a
-- própria lista viraria reconhecimento fácil pra quem quer burlar.
ALTER TABLE public.blocked_email_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_email_domains FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger de rejeição.
--   SECURITY DEFINER: precisa ler blocked_email_domains apesar da RLS.
--   SET search_path: mesma blindagem da migration 026 — sem isso, um schema
--   malicioso no search_path poderia sequestrar as referências da função.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_disposable_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  dom text;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN
    RETURN NEW;
  END IF;

  dom := lower(split_part(NEW.email, '@', 2));
  IF dom = '' THEN
    RETURN NEW;
  END IF;

  -- Casa o domínio exato E subdomínio (mail.mailinator.com), que é como esses
  -- serviços multiplicam endereço sem registrar domínio novo.
  IF EXISTS (
    SELECT 1
      FROM public.blocked_email_domains b
     WHERE dom = b.domain
        OR dom LIKE '%.' || b.domain
  ) THEN
    RAISE EXCEPTION 'Email domain not allowed: %', dom
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_disposable_email_insert ON auth.users;
CREATE TRIGGER reject_disposable_email_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.reject_disposable_email();

-- Também na TROCA de email: sem isso, bastava cadastrar com um email real e
-- depois trocar pro descartável, deixando a conta sem caixa de entrada válida.
-- O guard de IS DISTINCT evita rodar em update que não mexe no email.
DROP TRIGGER IF EXISTS reject_disposable_email_update ON auth.users;
CREATE TRIGGER reject_disposable_email_update
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.reject_disposable_email();

-- ─────────────────────────────────────────────────────────────────────────────
-- Semente. Idempotente — rodar de novo não duplica.
-- Mantida em sync com lib/disposable-email.ts (que só serve pra mensagem).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.blocked_email_domains (domain, note) VALUES
  ('10minutemail.com',   'descartável'),
  ('discard.email',      'descartável'),
  ('dispostable.com',    'descartável'),
  ('emailondeck.com',    'descartável'),
  ('fakeinbox.com',      'descartável'),
  ('getnada.com',        'descartável'),
  ('grr.la',             'descartável (guerrillamail)'),
  ('guerrillamail.com',  'descartável'),
  ('guerrillamail.net',  'descartável'),
  ('guerrillamail.org',  'descartável'),
  ('harakirimail.com',   'descartável'),
  ('inboxkitten.com',    'descartável'),
  ('jetable.org',        'descartável'),
  ('luxusmail.org',      'descartável'),
  ('mail-temp.com',      'descartável'),
  ('mailcatch.com',      'descartável'),
  ('maildrop.cc',        'descartável'),
  ('mailexpire.com',     'descartável'),
  ('mailinator.com',     'descartável'),
  ('mailnesia.com',      'descartável'),
  ('minuteinbox.com',    'descartável'),
  ('moakt.com',          'descartável'),
  ('mohmal.com',         'descartável'),
  ('mytemp.email',       'descartável'),
  ('nada.email',         'descartável'),
  ('sharklasers.com',    'descartável (guerrillamail)'),
  ('spam4.me',           'descartável'),
  ('spambox.us',         'descartável'),
  ('spamgourmet.com',    'descartável'),
  ('tempail.com',        'descartável'),
  ('temp-mail.io',       'descartável'),
  ('temp-mail.org',      'descartável'),
  ('tempinbox.com',      'descartável'),
  ('tempmail.com',       'descartável'),
  ('tempmailo.com',      'descartável'),
  ('tempr.email',        'descartável'),
  ('throwawaymail.com',  'descartável'),
  ('tmpmail.net',        'descartável'),
  ('tmpmail.org',        'descartável'),
  ('trashmail.com',      'descartável'),
  ('trashmail.de',       'descartável'),
  ('yopmail.com',        'descartável'),
  ('yopmail.fr',         'descartável'),
  ('yopmail.net',        'descartável'),
  -- Não é descartável: é ANTI-IMPERSONAÇÃO. Foi assim que o pentester criou
  -- `admin@darkoautoedit.com` — conta que não dá poder nenhum no app (admin
  -- depende da flag no profile), mas rende print convincente pra enganar
  -- cliente e suporte. Se algum dia você precisar criar uma conta no próprio
  -- domínio, remova a linha e recoloque depois:
  --   DELETE FROM public.blocked_email_domains WHERE domain = 'darkoautoedit.com';
  ('darkoautoedit.com',  'anti-impersonação (pentest 13.08)')
ON CONFLICT (domain) DO NOTHING;
