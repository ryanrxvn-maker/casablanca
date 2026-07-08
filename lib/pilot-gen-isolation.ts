/**
 * ISOLAÇÃO POR GERAÇÃO do ClickUp Pilot (fix 2026-07-08) — "cada disparo tem o SEU".
 *
 * PROBLEMA que resolve: os artefatos por-parte do disparo no IndexedDB (blob de
 * cada take + clips intermediários leveled/decupado) eram keyed SÓ por
 * (taskId, label). Como o `taskId` é o id da task no ClickUp — o MESMO em TODA
 * re-geração do mesmo AD — e os labels também (HOOK 1, BODY 1...), cada nova
 * geração gravava POR CIMA da anterior na mesma chave. O disparo do zero não
 * sofria (monta dos blobs em memória), mas o RETOMAR (após F5 no meio da
 * montagem) HIDRATA do IndexedDB: se ele não regerasse TODAS as partes, lia da
 * chave compartilhada o que sobrou de uma GERAÇÃO ANTERIOR (avatar antigo) →
 * a montagem final saía com os avatares EMBARALHADOS. Foi o caso do AD13
 * (diálogo entre 2 avatares) reportado em 2026-07-08.
 *
 * SOLUÇÃO: cada disparo/re-disparo DO ZERO ganha um `genId` único, gravado no
 * BatchTaskState (sobrevive F5). TODA chave por-parte passa a ser namespaced
 * por ele (`pilot:<taskId>:g:<genId>:...`). Assim a geração atual só enxerga o
 * que ELA mesma salvou; qualquer parte que falte é re-baixada do HeyGen pelo
 * videoId ATUAL (avatar certo) — é IMPOSSÍVEL puxar um take de outra geração.
 * No disparo do zero ainda limpamos os artefatos das gerações anteriores
 * (`deletePrefix('pilot:<taskId>:')`) pra não acumular lixo no IndexedDB.
 * Batches legados (sem genId) caem na chave antiga → sem regressão.
 *
 * INVARIANTES (travadas em pilot-gen-isolation.test.ts):
 *  1. genIds distintos ⇒ chaves NUNCA colidem (nenhuma leitura cruza gerações).
 *  2. QUALQUER prefixo de geração começa com o prefixo-base `pilot:<taskId>:`,
 *     então o purge do disparo do zero apaga TODAS as gerações + legado.
 *  3. genId ausente ⇒ chave IDÊNTICA ao formato antigo (compat total).
 *  4. `newPilotGenId()` é único mesmo em rajada (ms + nonce aleatório).
 *  5. O separador `:` protege contra colisão de prefixo entre ids onde um é
 *     prefixo textual do outro (task "12" nunca casa com chaves da task "123").
 */

/** genId único por geração: ms em base36 + nonce aleatório. Dois disparos no
 *  mesmo milissegundo nunca colidem — cada geração é uma memória por-parte
 *  independente. */
export function newPilotGenId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Prefixo dos artefatos por-parte de UMA geração no IndexedDB. `genId` ausente
 *  (batch legado) devolve o prefixo-base antigo, sem o segmento de geração —
 *  que é EXATAMENTE o prefixo usado pra purgar todas as gerações de uma task. */
export function pilotGenPrefix(taskId: string, genId?: string | null): string {
  return genId ? `pilot:${taskId}:g:${genId}:` : `pilot:${taskId}:`;
}

/** Chave do blob do take de UMA parte (label), ISOLADA por geração. */
export function pilotPartKey(taskId: string, genId: string | null | undefined, label: string): string {
  return `${pilotGenPrefix(taskId, genId)}part:${label}`;
}
