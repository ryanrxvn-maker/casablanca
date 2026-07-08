/**
 * Trava de lançamento do plano Pro.
 * ────────────────────────────────────────────────────────────────────────────
 * Enquanto `PRO_LAUNCH_OPEN === false`:
 *   • Ninguém consegue ASSINAR o Pro. O checkout é barrado server-side
 *     (app/api/billing/checkout) — não dá pra furar nem por curl/DevTools — e a
 *     vitrine /planos mostra "Lançamento em breve" no card Pro, empurrando o
 *     visitante pro Basic.
 *   • Quem JÁ é Pro (pagou OU foi liberado manualmente) NÃO perde nada: mantém
 *     acesso integral às ferramentas e passa a aparecer como BETA PRO — moldura
 *     ciano brilhando ao redor do avatar, distinta de Pro/Basic/Admin.
 *   • Admin fica exatamente igual.
 *   • Stripe fica NORMAL: produtos, assinaturas ativas, renovações e webhooks
 *     seguem funcionando. Esta trava NÃO desfaz nada do que já existe.
 *
 * PARA REABRIR O PRO (quando quiser):
 *   troque `PRO_LAUNCH_OPEN` pra `true` e faça deploy. Tudo volta sozinho —
 *   os BETA PRO voltam a aparecer como Pro, o checkout do Pro reabre. Zero
 *   migração, zero cirurgia no banco, nada pra reverter à mão.
 *
 * O tipo é anotado como `boolean` (e não inferido como o literal `false`) de
 * propósito: assim os dois lados de cada `if (PRO_LAUNCH_OPEN)` continuam
 * válidos pro TypeScript e virar a chave é só editar esta linha.
 */
export const PRO_LAUNCH_OPEN: boolean = false;

/** Alias legível: `true` quando o Pro está travado agora. */
export const PRO_LOCKED: boolean = !PRO_LAUNCH_OPEN;

/** Tier de ACESSO real (o que decide o que a conta pode usar). */
export type AccessTier = 'free' | 'basic' | 'pro' | 'admin';

/** Tier de EXIBIÇÃO (só aparência) — inclui o estado BETA PRO. */
export type DisplayTier = AccessTier | 'beta';

/**
 * Converte o tier de ACESSO no tier de EXIBIÇÃO. Puramente cosmético: um Pro
 * (não-admin) vira `'beta'` enquanto o lançamento está fechado; quando reabre,
 * volta a `'pro'` automaticamente. Não altera nenhuma decisão de acesso —
 * useTier/requireTier continuam enxergando 'pro' e liberando tudo.
 */
export function displayTierOf(
  access: AccessTier | null | undefined,
): DisplayTier {
  if (!access) return 'free';
  if (PRO_LAUNCH_OPEN) return access;
  return access === 'pro' ? 'beta' : access;
}

/** True se a conta é um Pro exibido como BETA PRO agora. */
export function isBetaPro(access: AccessTier | null | undefined): boolean {
  return displayTierOf(access) === 'beta';
}
