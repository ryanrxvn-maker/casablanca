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
