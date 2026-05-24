/**
 * app-discover.js — content script
 *
 * Roda em qualquer URL onde o app Auto Edit pode estar (vercel.app, dominios
 * proprios, localhost). Verifica se a pagina é o app via meta tag
 * <meta name="auto-edit-app" content="true">. Se for, registra o origin
 * na extensao pra ser usado como endpoint nos syncs.
 *
 * Isso elimina hardcode de URL — qualquer aba aberta do app já registra.
 */

(() => {
  try {
    const meta = document.querySelector('meta[name="auto-edit-app"]');
    if (!meta) return;
    const content = meta.getAttribute('content') || '';
    if (content !== 'true' && content !== '1' && content !== '') return;
    const origin = location.origin;
    chrome.runtime.sendMessage({ type: 'register-app-origin', origin }, () => {
      // resposta ignorada — só queremos garantir que enviou
      if (chrome.runtime.lastError) {
        // background pode estar dormindo — silencioso
      }
    });
  } catch (e) {
    console.warn('[auto-edit-discover]', e);
  }
})();
