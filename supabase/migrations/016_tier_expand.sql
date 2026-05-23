-- 016_tier_expand.sql
-- Expande os tiers pra: free / basic / pro / admin.
-- O tier 'beta' (legacy do fechado) vira 'pro' (acesso completo).
--
-- Compatibilidade total: usuários existentes mantêm o acesso que tinham.

-- Drop constraint anterior
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_tier_chk;

-- Adiciona constraint nova
ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_chk
  CHECK (tier IN ('free', 'basic', 'pro', 'beta', 'admin'));

-- Migra 'beta' → 'pro' (preserva acesso completo dos usuários atuais)
UPDATE profiles SET tier = 'pro' WHERE tier = 'beta';

-- Após migrar, remove 'beta' do CHECK (limpa)
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_tier_chk;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_tier_chk
  CHECK (tier IN ('free', 'basic', 'pro', 'admin'));
