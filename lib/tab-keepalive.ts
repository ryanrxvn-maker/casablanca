/**
 * KEEP-ALIVE de aba (anti-congelamento) — mantém o trabalho pesado avançando mesmo com
 * a aba em SEGUNDO PLANO.
 *
 * Problema (causa recorrente do "trava e só resolve quando eu volto/atualizo"): sob
 * pressão de memória + aba oculta, o Chrome CONGELA a aba (Page Lifecycle 'frozen'): a
 * MAIN THREAD para. Como a montagem client-side é orquestrada na main thread (aguardar
 * mensagens do worker do ffmpeg) E o empacotamento final (JSZip generateAsync) roda na
 * main thread, tudo paralisa — a task fica "MONTANDO / done 1/1" parada por horas até o
 * user trazer a aba pro foco ou recarregar. Nenhum timer salva thread congelada — só
 * IMPEDIR o freeze salva.
 *
 * Mecanismo: um AudioContext MANTIDO em estado 'running' enquanto há trabalho. Uma aba
 * com AudioContext ativo processando áudio NÃO é congelada pelo Chrome (o callback de
 * áudio precisa seguir rodando). O tom é sub-audível (20Hz) num gain MINÚSCULO (0.0001 =
 * −80dB), então é imperceptível — mas NÃO-ZERO de propósito: gain 0 podia não registrar
 * a aba como "tocando áudio" (a isenção de throttle/freeze depende de saída não-nula).
 *
 * UNLOCK por gesto: `resume()` do AudioContext só é permitido a partir de um GESTO do
 * usuário. Como o keep-alive é adquirido em contexto ASSÍNCRONO (dentro do runHeyGenGated,
 * depois de awaits), um resume() ali seria rejeitado. Então desbloqueamos no PRIMEIRO
 * gesto (click/tecla) — depois de desbloqueado uma vez, resume() funciona de qualquer
 * contexto. O disparo sempre nasce de um clique (START/Processar fila/Retomar), então o
 * unlock acontece bem antes de precisar.
 *
 * Fail-safe TOTAL: sem AudioContext (SSR/sem suporte) ou resume() rejeitado, cai no
 * comportamento atual (pode congelar, mas o Retomar/reload recupera) SEM erro. Nunca
 * quebra o fluxo. Contador de referência: várias tasks ativas compartilham um contexto.
 * Ver [[feedback_blindagem_fluxos]] princípio 5.
 */

let _ctx: AudioContext | null = null;
let _osc: OscillatorNode | null = null;
let _refs = 0;
let _unlocked = false;

function ensureGraph(): void {
  if (_ctx || typeof window === 'undefined') return;
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001; // NÃO-ZERO (registra como "tocando") mas −80dB = inaudível
    const osc = ctx.createOscillator();
    osc.frequency.value = 20; // sub-audível
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    _ctx = ctx;
    _osc = osc;
  } catch {
    _ctx = null;
    _osc = null;
  }
}

/** Resume o contexto (best-effort). Só tem efeito de verdade depois do unlock por gesto. */
function tryResume(): void {
  ensureGraph();
  if (_ctx && _ctx.state !== 'closed') {
    _ctx.resume?.().then(() => { _unlocked = true; }).catch(() => { /* autoplay bloqueado — fallback */ });
  }
}

// UNLOCK no primeiro gesto do usuário: cria o contexto, dá resume() (permitido no gesto)
// e — se não houver trabalho no momento — suspende de novo. O que importa é DESBLOQUEAR:
// depois disso, o resume() do acquireKeepAlive funciona mesmo em contexto assíncrono.
if (typeof window !== 'undefined') {
  const onFirstGesture = () => {
    ensureGraph();
    if (!_ctx) return;
    _ctx.resume?.().then(() => {
      _unlocked = true;
      if (_refs === 0) _ctx?.suspend?.().catch(() => { /* ignora */ }); // idle → solta
    }).catch(() => { /* tenta de novo no próximo gesto */ });
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(ev, onFirstGesture, { capture: true, passive: true });
  }
}

/**
 * Adquire o keep-alive (idempotente por contador). Chame ao INICIAR um trabalho pesado
 * (dispatch/montagem). Mantém o AudioContext 'running' → a aba não congela em background.
 */
export function acquireKeepAlive(): void {
  _refs++;
  tryResume();
}

/**
 * Solta o keep-alive. Quando o contador zera, SUSPENDE o áudio (libera o processamento;
 * a aba pode voltar a ser throttled/congelada, o que é ok quando não há trabalho).
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

/** true se o contexto já foi desbloqueado por um gesto (o keep-alive tem efeito real). */
export function keepAliveUnlocked(): boolean {
  return _unlocked;
}
