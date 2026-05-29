-- 021_billing.sql
-- Integração de pagamento (Stripe). Guarda o vínculo entre o profile e a
-- assinatura Stripe pra que o webhook saiba qual usuário promover/rebaixar.
--
-- Segurança: o webhook roda com SERVICE_ROLE (bypassa o trigger enforce_tier_column),
-- então é a ÚNICA via fora do admin que pode setar tier='basic'/'pro'. Usuário
-- comum continua sem conseguir auto-promover (trigger da 014 segue ativo).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- Lookup rápido no webhook (customer.subscription.* traz o customer/subscription id)
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx
  ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_idx
  ON profiles(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN profiles.stripe_customer_id IS
  'ID do Customer no Stripe (cus_...). Setado no primeiro checkout.';
COMMENT ON COLUMN profiles.subscription_status IS
  'Espelho do status da assinatura Stripe: active, trialing, past_due, canceled, etc.';
COMMENT ON COLUMN profiles.subscription_plan IS
  'Plano pago atual: basic | pro. Reflete o price comprado.';
COMMENT ON COLUMN profiles.current_period_end IS
  'Fim do ciclo pago atual. Acesso mantido até aqui mesmo após cancelar.';
