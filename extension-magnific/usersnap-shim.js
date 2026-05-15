/**
 * DARKO LAB — Usersnap Crash Shim (MAIN WORLD content script)
 * v3.5.38
 *
 * Roda no MAIN WORLD da página magnific.com em document_start (antes do
 * Magnific anexar listeners). Não sujeito ao CSP da página (content scripts
 * de extensão são isentos).
 *
 * RAIZ do crash recorrente (v3.5.33→v3.5.37): Magnific's useSpacesUsersnap
 * registra listener document-level que faz `event.target.closest(...)`.
 * Quando nosso evento sintético (clickRealElement / positionNode) tem target
 * sem .closest (document, Text node, window), o handler LANÇA
 * `TypeError: t.closest is not a function`. Como roda dentro de um event
 * handler async do Magnific, a exceção propaga e ABORTA o runWithConcurrency
 * do nosso pipeline (setup loop morre → 0 nodes → stall total).
 *
 * FIX: garantir que todo possível event.target tenha .closest() retornando
 * null (comportamento logicamente correto: esses alvos não casam seletor),
 * + window.onerror trap como defesa final. Não altera nada do Magnific além
 * de impedir o throw fatal.
 */
(function () {
  try {
    var noop = function () { return null; };
    if (typeof Document !== 'undefined' && !Document.prototype.closest) {
      Document.prototype.closest = noop;
    }
    if (typeof DocumentFragment !== 'undefined' && !DocumentFragment.prototype.closest) {
      DocumentFragment.prototype.closest = noop;
    }
    if (typeof Text !== 'undefined' && !Text.prototype.closest) {
      Text.prototype.closest = noop;
    }
    if (typeof CharacterData !== 'undefined' && !CharacterData.prototype.closest) {
      CharacterData.prototype.closest = noop;
    }
    if (typeof Window !== 'undefined' && Window.prototype && !Window.prototype.closest) {
      Window.prototype.closest = noop;
    }
    try {
      if (typeof window !== 'undefined' && typeof window.closest !== 'function') {
        window.closest = noop;
      }
    } catch (e) {}

    // Defesa final: trap da exceção exata no nível window. Só engole o erro
    // específico do Usersnap (closest is not a function) — não mascara outros.
    window.addEventListener('error', function (ev) {
      var m = ev && ev.message ? String(ev.message) : '';
      if (/closest is not a function/.test(m)) {
        if (ev.preventDefault) ev.preventDefault();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        if (window.console && console.warn) {
          console.warn('[DARKO USERSNAP-SHIM MW] suprimido crash Usersnap (closest)');
        }
        return true;
      }
    }, true);

    if (window.console && console.log) {
      console.log('[DARKO USERSNAP-SHIM MW] v3.5.38 ativo no MAIN WORLD (document_start)');
    }
  } catch (e) {
    if (window.console && console.warn) {
      console.warn('[DARKO USERSNAP-SHIM MW] falha:', e && e.message);
    }
  }
})();
