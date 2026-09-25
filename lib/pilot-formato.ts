/**
 * FORMATO DO DISPARO NO HEYGEN (9:16 × 16:9) — Pilot.
 *
 * Até aqui todo take do Pilot saía em pé: o runner mandava
 * `video_orientation: 'portrait'` fixo e a montagem (normalizeForConcat /
 * concatAvatarParts) forçava 1080x1920 com crop. Um take 16:9 que passasse
 * pelo HeyGen seria CORTADO no meio pra caber em pé — por isso o formato não é
 * só um campo no submit: ele tem que viajar do botão até a montagem.
 *
 * Regras que este módulo garante (e o teste blinda):
 *  - PADRÃO É 9:16. Qualquer valor desconhecido/ausente (task antiga, registro
 *    sem o campo, localStorage sujo) cai em 9:16 — exatamente o comportamento
 *    de antes. 16:9 só existe quando alguém escolheu de propósito.
 *  - O enquadramento de 9:16 é BYTE A BYTE o filtro que já existia
 *    (`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`).
 */

export type FormatoVideo = '9:16' | '16:9';

export const FORMATO_PADRAO: FormatoVideo = '9:16';

export const FORMATOS: readonly FormatoVideo[] = ['9:16', '16:9'] as const;

/** Só '16:9' exato vira 16:9. Todo o resto (inclusive undefined) é 9:16. */
export function normalizarFormato(v: unknown): FormatoVideo {
  return v === '16:9' ? '16:9' : FORMATO_PADRAO;
}

/** O `video_orientation` que o /v2/avatar/shortcut/submit do HeyGen entende. */
export function orientacaoHeyGen(f: unknown): 'portrait' | 'landscape' {
  return normalizarFormato(f) === '16:9' ? 'landscape' : 'portrait';
}

/** Resolução da montagem pro formato (sempre Full HD). */
export function dimensoesDoFormato(f: unknown): { w: number; h: number } {
  return normalizarFormato(f) === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

/** Filtro de enquadramento (cover sem borda) usado na montagem. */
export function filtroDeEnquadramento(f: unknown): string {
  const { w, h } = dimensoesDoFormato(f);
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
}

/** Rótulo curto pra tela. */
export function rotuloDoFormato(f: unknown): string {
  return normalizarFormato(f) === '16:9' ? '16:9 · Horizontal' : '9:16 · Vertical';
}

/**
 * Formato de uma geração JÁ DISPARADA (retomar, auto-cura, regerar take,
 * remontar). Usa o carimbo gravado no disparo; sem carimbo é disparo de antes
 * deste recurso — e esses eram TODOS 9:16. Nunca olha o botão atual: trocar o
 * botão depois do disparo não pode fazer um take faltante sair deitado no meio
 * de um AD em pé.
 */
export function formatoDaGeracao(carimbo: unknown): FormatoVideo {
  return normalizarFormato(carimbo);
}

/**
 * Formato de um disparo que começa AGORA (do zero). O carimbo de quem enfileirou
 * vence; sem ele, vale a escolha atual do botão.
 */
export function formatoDoNovoDisparo(carimbo: unknown, escolhaAtual: unknown): FormatoVideo {
  return carimbo === '9:16' || carimbo === '16:9' ? carimbo : normalizarFormato(escolhaAtual);
}
