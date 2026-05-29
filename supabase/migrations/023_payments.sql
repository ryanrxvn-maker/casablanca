-- 023_payments.sql
-- Registro de cada pagamento confirmado (trilha de auditoria). Fonte de
-- verdade = Stripe; aqui guardamos um espelho com o link do comprovante
-- oficial pra o dono conferir no dashboard quem realmente pagou.
--
-- Segurança: gravado SÓ pelo webhook (service role, assinatura Stripe
-- verificada). Ninguém vira pro sem um registro aqui (ou liberação manual
-- do admin). Leitura só admin.

CREATE TABLE IF NOT EXISTS payments (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  email                    text,
  amount                   integer NOT NULL,          -- centavos
  currency                 text NOT NULL DEFAULT 'brl',
  plan                     text,                       -- basic | pro
  billing                  text,                       -- monthly | annual
  status                   text NOT NULL DEFAULT 'paid',
  stripe_payment_intent    text,
  stripe_checkout_session  text UNIQUE,                -- idempotência
  receipt_url              text,                       -- comprovante oficial Stripe
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments(user_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Só admin lê (o dashboard usa service role; isto fecha leitura via anon).
DROP POLICY IF EXISTS "payments_select_admin" ON payments;
CREATE POLICY "payments_select_admin" ON payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

-- Sem policy de INSERT/UPDATE: só o service role (webhook) escreve.
