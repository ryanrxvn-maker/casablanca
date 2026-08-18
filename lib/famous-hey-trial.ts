/**
 * JANELA GRÁTIS DO FAMOUS HEY — liberado pra todo mundo por 10 dias.
 *
 * É uma trava que se DESFAZ SOZINHA: passou a data, a ferramenta volta a ser
 * admin/BETA PRO sem ninguém precisar lembrar de reverter nada. Promoção que
 * depende de alguém desligar na mão vira acesso permanente por esquecimento.
 *
 * A data é fixa e commitada de propósito — em vez de "10 dias a partir do
 * primeiro acesso de cada um", que exigiria uma coluna nova, um backfill e
 * abriria a porta pra reset com conta nova. Uma janela só, igual pra todos.
 *
 * ⚠ Isto NÃO gasta crédito da casa: o Famous Hey usa a credencial HeyGen DO
 * PRÓPRIO usuário (getUserKey por conta). Quem entrar sem HeyGen configurado vê
 * o aviso e não gera nada — a janela dá acesso à tela, não a créditos nossos.
 */

/** Fim da janela (UTC). Liberada em 18.08.2026, fecha 10 dias depois. */
export const FAMOUS_HEY_GRATIS_ATE = Date.UTC(2026, 7, 28, 23, 59, 59);

export const FAMOUS_HEY_PATH = '/tools/famous-hey';

/** True enquanto a janela está aberta. `agora` é injetável pra teste. */
export function famousHeyGratis(agora: number = Date.now()): boolean {
  return agora <= FAMOUS_HEY_GRATIS_ATE;
}

/** Dias inteiros que ainda faltam (0 = último dia). Negativo vira 0. */
export function famousHeyDiasRestantes(agora: number = Date.now()): number {
  return Math.max(0, Math.ceil((FAMOUS_HEY_GRATIS_ATE - agora) / 86400_000));
}

/** True se o path cai na janela grátis (cobre sub-rotas). */
export function famousHeyLiberaPath(path: string, agora: number = Date.now()): boolean {
  if (!famousHeyGratis(agora)) return false;
  return path === FAMOUS_HEY_PATH || path.startsWith(FAMOUS_HEY_PATH + '/');
}
