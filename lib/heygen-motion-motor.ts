/**
 * BACKSTOP DE MOTOR DO APPLY CUSTOM MOTION.
 *
 * O Avatar III não tem motion: `createVideo` só copia o `motion_prompt` pro
 * payload quando `eng.supports_motion_prompt` é true, e no III é false. Ou
 * seja, pedir gesto no III não dá erro nenhum — o HeyGen aceita, renderiza e
 * devolve um take PARADO. O disparo termina verde e o problema só aparece na
 * montagem do criativo, quando já se gastou cota.
 *
 * Por isso a regra mora aqui e é aplicada no runner, o único ponto por onde os
 * dois disparos passam (ClickUp Pilot e fila do Hey Auto): cena com movimento
 * sobe pro Avatar IV sozinha. O V já aceita motion, então fica como está.
 */

export type Motor = 'III' | 'IV' | 'V';

export function motorEfetivo(motor: Motor, motionPrompt?: string | null): Motor {
  if (!motionPrompt || !motionPrompt.trim()) return motor;
  return motor === 'III' ? 'IV' : motor;
}

/**
 * Esta cena vira UM take só, ou pode ser picotada em pedaços de ~20s?
 *
 * Fora do Avatar III, picotar cobra caro duas vezes:
 *  • DINHEIRO — IV/V e modo imagem cobram POR GERAÇÃO (~6 créditos cada, contra
 *    1 do III). Cinco pedaços do MESMO look custam cinco vezes. Medido no lote
 *    WL PL (16/08): as cenas com movimento davam 27 takes picotadas e dão 8
 *    inteiras — 114 créditos de diferença, no mesmo material.
 *  • QUALIDADE — o gesto é pedido por geração, então cada pedaço REFAZ o
 *    movimento do zero: picotado, o avatar repete a colher a cada corte.
 *
 * O III segue picotado como sempre — lá o take é barato e o corte curto ajuda a
 * montagem.
 */
export function takeUnicoPorLook(args: {
  engine?: Motor | null;
  motionPrompt?: string | null;
  imageMode?: boolean;
}): boolean {
  if (args.imageMode) return true; // sem avatar, cada geração re-envia a imagem
  return motorEfetivo(args.engine || 'III', args.motionPrompt) !== 'III';
}
