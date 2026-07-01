/**
 * KEEP-ALIVE de aba (anti-congelamento) — mantém a MONTAGEM avançando mesmo com
 * a aba em SEGUNDO PLANO.
 *
 * Problema (a causa recorrente do "só resolve quando eu volto pra aba"): sob
 * pressão de memória + aba oculta por >5min, o Chrome CONGELA a aba (Page
 * Lifecycle 'frozen'): a main thread para, o ffmpeg-wasm para de receber
 * mensagens, e o card fica em 'post' parado até o user trazer a aba pro foco.
 * Nenhum timer salva uma thread congelada — só IMPEDIR o freeze salva.
 *
 * Mecanismo: um AudioContext MANTIDO em estado 'running' enquanto houver trabalho
 * pesado. Uma aba com um AudioContext ativo processando áudio NÃO é congelada
 * pelo Chrome (o callback de áudio segue rodando). O grafo é 100% SILENCIOSO
 * (GainNode gain=0), então NÃO há nenhum artefato audível pro cliente. Se o
 * gain=0 não bastar pra evitar o intensive-throttling (timers mais lentos), tudo
 * bem: o throttle residual já é coberto pelas outras camadas (watchdog por Date.now,
 * poll com sleepUnthrottled) — o que este módulo garante é o pior caso: NÃO CONGELAR.
 *
 * Contador de referência: várias tasks ativas compartilham UM contexto; o áudio
 * só é suspenso quando a última solta.
 *
 * Fail-safe TOTAL: sem AudioContext (SSR/navegador sem suporte) ou se o resume()
 * for rejeitado (autoplay bloqueado quando não há gesto do usuário — ex
 * auto-retomar após F5), cai no comportamento atual (throttle) SEM erro. NUNCA
 * quebra o fluxo. Ver [[feedback_blindagem_fluxos]] princípio 5.
 */

let _ctx: AudioContext | null = null;
let _started = false;
let _refs = 0;

function ensureGraph(): void {
  if (typeof window === 'undefined') return;
  if (_ctx) return;
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const gain = ctx.createGain();
    gain.gain.value = 0; // SILENCIOSO — zero volume, inaudível
    const osc = ctx.createOscillator();
    osc.frequency.value = 30; // sub-audível; o gain=0 zera de qualquer forma
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    _ctx = ctx;
    _started = true;
  } catch {
    _ctx = null;
    _started = false;
  }
}

/**
 * Adquire o keep-alive (idempotente por contador). Chame ao INICIAR um trabalho
 * pesado (montagem/troca). Idealmente disparado a partir de um gesto do usuário
 * (clique em Start/Processar fila) pra o autoplay permitir o resume().
 */
export function acquireKeepAlive(): void {
  _refs++;
  ensureGraph();
  if (_ctx && _ctx.state !== 'closed') {
    // best-effort: sem gesto do usuário o resume() pode ser rejeitado → ignora
    // (cai no fallback de throttle, sem erro).
    _ctx.resume?.().catch(() => { /* ignora */ });
  }
}

/**
 * Solta o keep-alive. Quando o contador zera, SUSPENDE o áudio (libera o
 * processamento; a aba pode voltar a ser throttled/congelada, o que é ok quando
 * não há mais nada rodando).
 */
export function releaseKeepAlive(): void {
  _refs = Math.max(0, _refs - 1);
  if (_refs === 0 && _ctx && _ctx.state === 'running') {
    _ctx.suspend?.().catch(() => { /* ignora */ });
  }
}

/** Nº de trabalhos ativos segurando o keep-alive (debug/telemetria). */
export function keepAliveRefs(): number {
  return _refs;
}

/** Só pra evitar "unused" em builds onde _started não é lido em runtime. */
export function keepAliveActive(): boolean {
  return _started && _refs > 0;
}
